"""Stage 8: recurrent phrases across the whole corpus.

The pipeline's first CROSS-WORK stage. Every other stage builds one manifest per
invocation, but a phrase that appears in more than one dialogue is exactly the
kind a reader wants; deciding that needs all the works at once. Stage 6 leaves
each work's fold streams in build/ngrams/<work>.json; this merges them.

Sharded by the phrase's fold-initial letter and split by what a reader needs
when. The browse list needs every phrase; only an EXPANDED phrase needs its
offsets, so keeping them together would defeat sharding.

  build/dist/ngrams/<stream>/<letter>.json          the browse list
      { "<fold phrase>": [n, count, score, works] }

  build/dist/ngrams/<stream>/occ/<letter>-<n>.json  fetched on expand
      { "<fold phrase>": { "Apology": [1204, 88, 310] } }

Occurrences are per-work global offsets, delta-encoded after the first. The work
map doubles as the per-work breakdown, so a reader can be told "37 times across
5 works" from the browse list alone, without loading a single offset.

Rules, none of them re-derived here:
  * A phrase never spans a BOOK edge. Book bounds come from the same
    offsets.json the search uses.
  * A phrase never spans a token no index can key (a stage 3 key failure).
  * A phrase is kept only if it occurs at least twice CORPUS-WIDE.
  * Turn straddling is NOT filtered at build time. It is a query-time toggle
    defaulting to keep, and dropping the occurrences here would make the toggle
    unimplementable. Each phrase records how many of its occurrences cross a
    turn so the UI can say so.

Also emits build/dist/lemma-map/<letter>.json — fold(surface) -> the headwords
that surface can belong to. It needs the same corpus-wide pass and lets a typed
phrase be widened to its inflected variants without the reader knowing any
headwords.

And build/dist/speaker-registry.json — each verbatim speaker label's token and
turn counts corpus-wide and per work. Like lemma-map, this is not an n-gram
artifact; it lives here because stage 8 is the pipeline's cross-work pass.

Both streams are indexed: `form` (the surface word as written) and `lemma`. A
position licensing several lemmas contributes EVERY reading, not a chosen one —
excluding a reading here would put it beyond the reach of any later filter.
"""

from __future__ import annotations

import json
import math
import re
import struct
from collections import Counter, defaultdict
from pathlib import Path

from .config import BUILD_DIR

NS = (2, 3, 4, 5)
MIN_COUNT = 2
GREEK_STREAMS = ("form", "lemma")
ENGLISH_STREAM = "english"
STREAMS = (*GREEK_STREAMS, ENGLISH_STREAM)
_ENGLISH_WORD = re.compile(r"[a-z']+")


def _shard_letter(phrase: str) -> str:
    first = phrase[0] if phrase else ""
    return first if "a" <= first <= "z" else "_"


def _readings(entry, limit: int = 0):
    """Return every phrase a window of positions licenses, not a chosen one."""
    combos = [[]]
    for options in entry:
        combos = [c + [option] for c in combos for option in options]
        if limit and len(combos) > limit:
            return combos[:limit]
    return combos


def _phrases(stream: list, books: list[int], total: int):
    """Yield (phrase, global-offset) n-grams that stay inside book bounds."""
    edges = books + [total]
    for book in range(len(edges) - 1):
        lo, hi = edges[book], edges[book + 1]
        for n in NS:
            for start in range(lo, hi - n + 1):
                window = stream[start:start + n]
                if any(options is None for options in window):
                    continue
                for reading in _readings(window):
                    yield " ".join(reading), start


def _english_stream(work: str) -> tuple[list[list[str]], list[int], list[dict]]:
    """Return one work's English words, segment bounds, and citation segments."""
    stream: list[list[str]] = []
    bounds: list[int] = []
    segments: list[dict] = []
    work_dir = BUILD_DIR / "dist" / work
    for book_path in sorted(work_dir.glob("book-*.json")):
        book = json.loads(book_path.read_text(encoding="utf-8"))
        for segment in book.get("segments", []):
            text = (segment.get("english") or {}).get("text") or ""
            words = _ENGLISH_WORD.findall(text.lower())
            if not words:
                continue
            bounds.append(len(stream))
            segments.append({
                "book": book.get("book"),
                "column": segment.get("column"),
                "base": len(stream),
                "words": len(words),
            })
            stream.extend([word] for word in words)
    return stream, bounds, segments


def _speaker_artifacts(work: str, token_count: int) -> tuple[dict, list[int], dict]:
    """Load one emitted speaker dictionary, packed column, and offsets."""
    search_dir = BUILD_DIR / "dist" / work / "search"
    offsets = json.loads(
        (search_dir / "offsets.json").read_text(encoding="utf-8")
    )
    if offsets["token_count"] != token_count:
        raise ValueError(
            f"stage8: {work} offsets token_count disagrees with its stream "
            f"({offsets['token_count']} vs {token_count}) — stale build"
        )
    speaker_dict = json.loads(
        (search_dir / "speaker-dict.json").read_text(encoding="utf-8")
    )
    width = speaker_dict["width"]
    if width not in (2, 4):
        raise ValueError(f"stage8: {work} unsupported speaker width {width}")
    data = (search_dir / "speaker-col.bin").read_bytes()
    if len(data) % width:
        raise ValueError(
            f"stage8: {work} speaker column has {len(data) % width} trailing byte(s)"
        )
    code = "H" if width == 2 else "I"
    column = [
        value[0] for value in struct.iter_unpack(f"<{code}", data)
    ]
    if len(column) != token_count:
        raise ValueError(
            f"stage8: {work} speaker column length {len(column)} "
            f"!= token_count {token_count}"
        )
    return speaker_dict, column, offsets


def _turn_starts(offsets: dict) -> set[int]:
    """Read Plato's turn starts from the emitted offset primitive.

    The fold stream deliberately has Aristotle's key-for-key shape, including
    its empty chapter_bounds. Turns therefore remain in offsets.json, where
    stage 6 emitted them. A work without speaker turns simply has no straddles.
    """
    return {turn["start"] for turn in offsets.get("turn_bounds", [])}


def run() -> Path:
    source = BUILD_DIR / "ngrams"
    files = sorted(source.glob("*.json"))
    if not files:
        raise ValueError(
            "stage8: no per-work streams in build/ngrams — run stage6 for every work first"
        )

    surface_lemmas: dict[str, set] = defaultdict(set)
    counts: dict[str, Counter] = {stream: Counter() for stream in STREAMS}
    offsets: dict[str, dict[str, dict[str, list[int]]]] = {
        stream: defaultdict(lambda: defaultdict(list)) for stream in STREAMS
    }
    straddles: dict[str, Counter] = {stream: Counter() for stream in STREAMS}
    unigrams: dict[str, Counter] = {stream: Counter() for stream in STREAMS}
    tokens: dict[str, int] = {stream: 0 for stream in STREAMS}
    works: list[str] = []
    english_segments: dict[str, list[dict]] = {}
    speaker_counts: dict[str, dict[str, Counter]] = defaultdict(
        lambda: defaultdict(Counter)
    )
    reserved_counts: dict[str, dict[str, Counter]] = {
        "none": defaultdict(Counter),
        "unknown": defaultdict(Counter),
    }
    speaker_token_count = 0
    speaker_turn_count = 0

    for path in files:
        doc = json.loads(path.read_text(encoding="utf-8"))
        work, total = doc["work"], doc["token_count"]
        works.append(work)
        if len(doc["form"]) != total or len(doc["lemma"]) != total:
            raise ValueError(
                f"stage8: {work} stream length disagrees with its token_count "
                f"({len(doc['form'])}/{len(doc['lemma'])} vs {total}) — stale build"
            )
        books = [bound["start"] for bound in doc["book_bounds"]]
        speaker_dict, speaker_column, speaker_offsets = _speaker_artifacts(work, total)
        turns = _turn_starts(speaker_offsets)
        labels = speaker_dict["speakers"]
        if speaker_dict["reserved"] != {"none": 0, "unknown": 1}:
            raise ValueError(f"stage8: {work} speaker reserved ids are not 0/1")
        speaker_token_count += total
        for speaker_id, count in Counter(speaker_column).items():
            if not 0 <= speaker_id < len(labels):
                raise ValueError(
                    f"stage8: {work} unresolved speaker id {speaker_id}"
                )
            if speaker_id == 0:
                reserved_counts["none"][work]["tokens"] += count
            elif speaker_id == 1:
                reserved_counts["unknown"][work]["tokens"] += count
            else:
                speaker_counts[labels[speaker_id]][work]["tokens"] += count
        turns_by_book: dict[int, list[dict]] = defaultdict(list)
        for turn in speaker_offsets.get("turn_bounds", []):
            turns_by_book[turn["book"]].append(turn)
        book_bounds = speaker_offsets.get("book_bounds", [])
        for book_index, bound in enumerate(book_bounds):
            book_end = (
                book_bounds[book_index + 1]["start"]
                if book_index + 1 < len(book_bounds)
                else total
            )
            book_turns = turns_by_book.get(bound["book"], [])
            for turn_index, turn in enumerate(book_turns):
                end = (
                    book_turns[turn_index + 1]["start"]
                    if turn_index + 1 < len(book_turns)
                    else book_end
                )
                if end <= turn["start"]:
                    continue
                speaker_turn_count += 1
                speaker = turn.get("speaker")
                if speaker is None:
                    reserved_counts["unknown"][work]["turns"] += 1
                else:
                    speaker_counts[speaker][work]["turns"] += 1
        for surface, lemmas in zip(doc["form"], doc["lemma"]):
            if surface and lemmas:
                surface_lemmas[surface].update(lemmas)

        for stream_name in GREEK_STREAMS:
            raw = doc[stream_name]
            stream = [
                None if entry is None else ([entry] if isinstance(entry, str) else entry)
                for entry in raw
            ]
            for options in stream:
                if not options:
                    continue
                for token in options:
                    unigrams[stream_name][token] += 1
                    tokens[stream_name] += 1
            for gram, start in _phrases(stream, books, total):
                counts[stream_name][gram] += 1
                offsets[stream_name][gram][work].append(start)
                if any(bound in turns for bound in range(start + 1, start + gram.count(" ") + 1)):
                    straddles[stream_name][gram] += 1

        english, bounds, segments = _english_stream(work)
        if english:
            english_segments[work] = segments
            for options in english:
                unigrams[ENGLISH_STREAM][options[0]] += 1
                tokens[ENGLISH_STREAM] += 1
            for gram, start in _phrases(english, bounds, len(english)):
                counts[ENGLISH_STREAM][gram] += 1
                offsets[ENGLISH_STREAM][gram][work].append(start)

    summary: dict = {"works": len(works), "streams": {}}
    out_root = BUILD_DIR / "dist" / "ngrams"
    for stream_name in STREAMS:
        kept = {gram: count for gram, count in counts[stream_name].items() if count >= MIN_COUNT}
        total_tokens = tokens[stream_name]
        shards: dict[str, dict] = defaultdict(dict)
        occurrence_shards: dict[tuple, dict] = defaultdict(dict)
        for gram, count in kept.items():
            words = gram.split(" ")
            expected = total_tokens
            for word in words:
                expected *= unigrams[stream_name][word] / total_tokens
            score = count * math.log2(count / expected) if expected > 0 else 0.0
            per_work = {}
            for work, starts in offsets[stream_name][gram].items():
                starts.sort()
                per_work[work] = [starts[0]] + [
                    starts[index] - starts[index - 1]
                    for index in range(1, len(starts))
                ]
            letter = _shard_letter(gram)
            n = len(words)
            row = [n, count, round(score, 1), len(per_work)]
            if straddles[stream_name][gram]:
                row.append(straddles[stream_name][gram])
            shards[letter][gram] = row
            occurrence_shards[(letter, n)][gram] = per_work

        out_dir = out_root / stream_name
        occ_dir = out_dir / "occ"
        occ_dir.mkdir(parents=True, exist_ok=True)
        for existing in list(out_dir.glob("*.json")) + list(occ_dir.glob("*.json")):
            existing.unlink()
        for letter, data in shards.items():
            (out_dir / f"{letter}.json").write_text(
                json.dumps(data, ensure_ascii=False), encoding="utf-8"
            )
        for (letter, n), data in occurrence_shards.items():
            (occ_dir / f"{letter}-{n}.json").write_text(
                json.dumps(data, ensure_ascii=False), encoding="utf-8"
            )
        by_n = Counter(len(gram.split(" ")) for gram in kept)
        summary["streams"][stream_name] = {
            "distinct": len(counts[stream_name]),
            "kept": len(kept),
            "occurrences": sum(kept.values()),
            "shards": len(shards),
            "by_n": {str(n): by_n[n] for n in NS},
        }

    (out_root / "english-segments.json").write_text(
        json.dumps(english_segments, ensure_ascii=False), encoding="utf-8"
    )
    summary["english_works"] = len(english_segments)

    map_dir = BUILD_DIR / "dist" / "lemma-map"
    map_dir.mkdir(parents=True, exist_ok=True)
    for existing in map_dir.glob("*.json"):
        existing.unlink()
    map_shards: dict[str, dict] = defaultdict(dict)
    for surface, lemmas in surface_lemmas.items():
        map_shards[_shard_letter(surface)][surface] = sorted(lemmas)
    for letter, data in map_shards.items():
        (map_dir / f"{letter}.json").write_text(
            json.dumps(data, ensure_ascii=False), encoding="utf-8"
        )
    summary["surface_forms"] = len(surface_lemmas)
    summary["surface_forms_ambiguous"] = sum(
        1 for lemmas in surface_lemmas.values() if len(lemmas) > 1
    )

    speaker_registry = {
        "works": len(works),
        "tokens": speaker_token_count,
        "turns": speaker_turn_count,
        "speakers": {
            speaker: {
                "tokens": sum(row["tokens"] for row in per_work.values()),
                "turns": sum(row["turns"] for row in per_work.values()),
                "works": {
                    work: {
                        "tokens": row["tokens"],
                        "turns": row["turns"],
                    }
                    for work, row in sorted(per_work.items())
                    if row["tokens"] or row["turns"]
                },
            }
            for speaker, per_work in sorted(speaker_counts.items())
        },
        "reserved": {
            name: {
                "id": speaker_id,
                "tokens": sum(row["tokens"] for row in per_work.values()),
                "turns": sum(row["turns"] for row in per_work.values()),
                "works": {
                    work: {
                        "tokens": row["tokens"],
                        "turns": row["turns"],
                    }
                    for work, row in sorted(per_work.items())
                    if row["tokens"] or row["turns"]
                },
            }
            for name, speaker_id, per_work in (
                ("none", 0, reserved_counts["none"]),
                ("unknown", 1, reserved_counts["unknown"]),
            )
        },
    }
    (BUILD_DIR / "dist" / "speaker-registry.json").write_text(
        json.dumps(speaker_registry, ensure_ascii=False), encoding="utf-8"
    )
    summary["speakers"] = len(speaker_registry["speakers"])
    summary["speaker_turns"] = speaker_turn_count
    summary["speaker_tokens_none"] = speaker_registry["reserved"]["none"]["tokens"]
    summary["speaker_tokens_unknown"] = (
        speaker_registry["reserved"]["unknown"]["tokens"]
    )

    (out_root / "summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    return out_root
