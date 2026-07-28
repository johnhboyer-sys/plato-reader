"""Stage 6: build the search index for the Astro frontend.

Emits these files under build/stage6/:

  greek_lemma.json — {fold_lemma: [[seg_idx, token_pos], ...]}
                 keyed by the token's dictionary HEADWORD (lemma), so a query
                 finds every inflected form of a word. fold_lemma strips all
                 accents, breathings, iotasubscript, macrons from the Beta Code
                 key (only base letters remain), so wildcard prefix matching
                 works uniformly.

  greek_form.json — {fold(surface): [[seg_idx, token_pos], ...]}
                 keyed by the SURFACE form as written (the inflected token), so
                 a query can match the exact form rather than the whole lemma.

  english.json — {word: [seg_idx, ...]}
                 Lowercased, punctuation-stripped English words.
                 Phrase search is handled at query time via string inclusion
                 on the (small) English chunk texts in meta.json, so
                 positions are not stored here.

  meta.json    — [{id, book, column, greek_head, english_head}]
                 Ordered list of segment metadata, indexed by seg_idx.
                 greek_head: surface text from the first two Greek lines. The
                   field is emitted, but no current client reads it.
                 english_head: the FULL English chunk. Query
                   time uses it for exact-phrase verification and English
                   occurrence counting, so it must not be truncated.

  offsets.json — the global token-offset primitive, including book and turn
                 bounds. Coordinate field names remain Bekker-flavoured for
                 client compatibility, while their values are Stephanus.

  grammar-dict.json + grammar-col.bin — an interned morphology-signature
                 dictionary and one packed signature id per global token.

All search artifacts above are copied to build/dist/{work}/search/ by stage7.
"""

from __future__ import annotations

import json
import re
import struct
from collections import defaultdict
from pathlib import Path

from .config import BUILD_DIR, Manifest
from .stage2_validate import check_grammar, check_ngram_streams, check_offsets

_FOLD = re.compile(r"[^a-z']")  # keep only base letters and apostrophe
_EN_WORD = re.compile(r"[a-z']+")


def fold_lemma(beta_key: str) -> str:
    """Strip all Beta Code diacritics; keep only base letters + apostrophe."""
    return _FOLD.sub("", beta_key.lower())


# -- Morphology feature vocabulary -------------------------------------------
# There is deliberately NO part-of-speech category. Morpheus emits no
# noun/verb/adjective field, and inferring one would overstate the data.
# `part` is the participle mood; `particle` is a distinct explicit marker.
_FEATURES: dict[str, str] = {
    value: category
    for category, values in {
        "gender": "masc fem neut masc/fem masc/neut masc/fem/neut",
        "case": "nom gen dat acc voc nom/acc nom/voc nom/voc/acc gen/dat",
        "number": "sg pl dual",
        "person": "1st 2nd 3rd",
        "tense": "pres imperf fut aor perf plup futperf",
        "mood": "ind subj opt imperat inf part",
        "voice": "act mid pass mp",
        "degree": "comp superl irreg_comp",
        "marker": "adverb adverbial particle prep conj interrog exclam indecl numeral letter",
    }.items()
    for value in values.split()
}

SIG_UNKEYED = 0
SIG_UNANALYSED = 1


def parse_reading(parse: str) -> dict[str, list[str]]:
    """One Morpheus parse string -> {category: [values]}.

    Syncretic values expand inside the reading: ``nom/voc/acc`` is three
    genuinely licensed case values, not one certain parse.
    """
    reading: dict[str, list[str]] = {}
    for word in parse.replace("(", " ").replace(")", " ").split():
        category = _FEATURES.get(word)
        if category is None:
            continue
        values = reading.setdefault(category, [])
        for value in word.split("/"):
            if value not in values:
                values.append(value)
    return {category: sorted(values) for category, values in reading.items()}


def signature(entries: list[dict]) -> tuple:
    """Return distinct whole readings in canonical order.

    Readings are never flattened into a per-category union, preserving the
    correlations between gender, case, number, and verbal features.
    """
    readings = []
    for entry in entries:
        reading = parse_reading(entry.get("parse") or "")
        if not reading:
            continue
        key = tuple(
            (category, tuple(values))
            for category, values in sorted(reading.items())
        )
        if key not in readings:
            readings.append(key)
    return tuple(sorted(readings))


def build_turn_bounds(
    spine: dict,
    segments: list[dict],
    seg_base_offset: list[int],
    sigla: dict[str, str],
    stats: dict[str, int] | None = None,
) -> list[dict]:
    """Resolve turns.py's per-book Greek turn sequence into global offsets.

    A speaker event carries an exact character offset within its Greek line.
    When that offset equals a stage3 token start the bound is exact; otherwise
    it explicitly falls back to that line's first token. If supplied, ``stats``
    receives the count of turns dropped because their column or line did not
    resolve to a token-bearing stage3 line.
    """
    from . import turns as turns_mod

    seg_index = {
        (segment["book"], segment["column"]): i
        for i, segment in enumerate(segments)
    }
    spine_by_book: dict[int, list[dict]] = defaultdict(list)
    for segment in spine["segments"]:
        spine_by_book[segment["book"]].append(segment)

    bounds: list[dict] = []
    dropped = 0
    for book in sorted(spine_by_book):
        turns, _ = turns_mod.collect_greek_turns(spine_by_book[book], sigla)
        for turn in turns:
            si = seg_index.get((book, turn["column"]))
            if si is None:
                dropped += 1
                continue
            base = seg_base_offset[si]
            target_line = None
            for line in segments[si]["lines"]:
                if line["n"] == turn["line"]:
                    target_line = line
                    break
                base += len(line["tokens"])
            if target_line is None or not target_line["tokens"]:
                dropped += 1
                continue
            exact = next(
                (
                    i
                    for i, token in enumerate(target_line["tokens"])
                    if token["o"] == turn["offset"]
                ),
                None,
            )
            bounds.append(
                {
                    "book": book,
                    "speaker": turn["name"],
                    "start": base + (exact if exact is not None else 0),
                    "accuracy": "exact" if exact is not None else "line-snapped",
                }
            )
    bounds.sort(key=lambda turn: turn["start"])
    if stats is not None:
        stats["dropped"] = dropped
    return bounds


def run(manifest: Manifest) -> Path:
    tokens_doc = json.loads(
        (BUILD_DIR / "stage3" / "tokens.json").read_text(encoding="utf-8")
    )
    key_map = json.loads(
        (BUILD_DIR / "stage4" / "key_map.json").read_text(encoding="utf-8")
    )
    analyses = json.loads(
        (BUILD_DIR / "stage4" / "analyses.json").read_text(encoding="utf-8")
    )
    english = json.loads(
        (BUILD_DIR / "stage1" / "english_chunks.json").read_text(encoding="utf-8")
    )
    spine = json.loads(
        (BUILD_DIR / "stage1" / "greek_spine.json").read_text(encoding="utf-8")
    )

    # Ordered segment list for index keys
    segments = tokens_doc["segments"]
    seg_idx = {s["id"]: i for i, s in enumerate(segments)}

    eng_by_id = {c["id"]: c for c in english["chunks"]}

    # Token fold sequences per segment — needed by the client for phrase search.
    # One space-separated string of fold lemma keys in document order.
    fold_seq_by_id: dict[str, str] = {}
    for seg in segments:
        folds = []
        for line in seg["lines"]:
            for tok in line["tokens"]:
                key = tok.get("k")
                stored = key_map.get(key) if key else None
                if stored:
                    lemmata = [a["lemma"] for a in analyses.get(stored, []) if a["lemma"]]
                    if lemmata:
                        folds.append(fold_lemma(lemmata[0]))
                    else:
                        folds.append(fold_lemma(stored))
                elif key:
                    folds.append(fold_lemma(key))
        fold_seq_by_id[seg["id"]] = " ".join(folds)

    # -- Greek inverted indexes ----------------------------------------------
    # Two parallel indexes, both fold_lemma -> [(seg_idx, token_pos), ...]:
    #   lemma_posts: keyed by each token's dictionary headword(s) — "all forms".
    #   form_posts:  keyed by the token's surface form as written — "exact form".
    lemma_posts: dict[str, list] = defaultdict(list)
    form_posts: dict[str, list] = defaultdict(list)
    for seg in segments:
        si = seg_idx[seg["id"]]
        pos = 0
        for line in seg["lines"]:
            for tok in line["tokens"]:
                key = tok.get("k")
                if key:
                    sf = fold_lemma(key)  # surface form as written
                    if sf:
                        form_posts[sf].append([si, pos])
                stored = key_map.get(key) if key else None
                if stored:
                    for a in analyses.get(stored, []):
                        fl = fold_lemma(a["lemma"]) if a["lemma"] else fold_lemma(stored)
                        if fl:
                            lemma_posts[fl].append([si, pos])
                pos += 1

    # Deduplicate each index (a lemma may repeat from homonym analyses; a
    # surface key is added once per token but dedupe defensively).
    def _dedupe(posts: dict[str, list]) -> dict[str, list]:
        out: dict[str, list] = {}
        for fl, plist in posts.items():
            seen: set[tuple] = set()
            deduped = []
            for pair in plist:
                t = tuple(pair)
                if t not in seen:
                    seen.add(t)
                    deduped.append(pair)
            out[fl] = deduped
        return out

    greek_lemma = _dedupe(lemma_posts)
    greek_form = _dedupe(form_posts)

    # -- English inverted index -----------------------------------------------
    # word -> sorted list of unique seg_idxs
    eng_posts: dict[str, set] = defaultdict(set)
    for seg in segments:
        eng = eng_by_id.get(seg["id"])
        if not eng:
            continue
        si = seg_idx[seg["id"]]
        for word in _EN_WORD.findall(eng["text"].lower()):
            eng_posts[word].add(si)
    english_idx = {w: sorted(idxs) for w, idxs in eng_posts.items()}

    # -- Segment metadata -----------------------------------------------------
    meta = []
    for seg in segments:
        # Greek head is emitted as the first two lines of surface text. No
        # current client reads it.
        lines = seg["lines"]
        greek_head = " ".join(
            " ".join(t["t"] for t in l["tokens"])
            for l in lines[:2]
        )
        eng = eng_by_id.get(seg["id"])
        # Full English chunk (NOT truncated). Query-time exact-phrase
        # verification and English occurrence counting run against this, so a
        # cap (formerly [:500]) silently dropped matches and undercounted
        # repeats past the cut. It equals the emitted segment's english.text, so
        # char offsets found here map straight onto the rendered passage.
        english_head = eng["text"] if eng else ""
        meta.append(
            {
                "id": seg["id"],
                "book": seg["book"],
                "column": seg["column"],
                "greek_head": greek_head,
                "greek_tokens": fold_seq_by_id.get(seg["id"], ""),
                "english_head": english_head,
            }
        )

    # -- Offset primitive ------------------------------------------------------
    # One running word number per work in the same document order as postings.
    # Counts every stage3 token, including keyless tokens.
    seg_base_offset: list[int] = []
    seg_coords: list[dict] = []
    running = 0
    for seg in segments:
        seg_base_offset.append(running)
        line_runs = [[line["n"], len(line["tokens"])] for line in seg["lines"]]
        running += sum(count for _, count in line_runs)
        seg_coords.append(
            {"book": seg["book"], "column": seg["column"], "line_runs": line_runs}
        )
    token_count = running

    book_bounds: list[dict] = []
    for i, seg in enumerate(segments):
        if not book_bounds or book_bounds[-1]["book"] != seg["book"]:
            book_bounds.append({"book": seg["book"], "start": seg_base_offset[i]})

    sigla = ((manifest.data.get("speakers") or {}).get("sigla")) or {}
    turn_stats: dict[str, int] = {}
    turn_bounds = build_turn_bounds(
        spine, segments, seg_base_offset, sigla, stats=turn_stats
    )
    chapter_bounds: list[dict] = []
    offsets = {
        # Build fingerprint shared by every offset-indexed artifact.
        "token_count": token_count,
        "seg_base_offset": seg_base_offset,
        "segments": seg_coords,
        "book_bounds": book_bounds,
        "chapter_bounds": chapter_bounds,
        "turn_bounds": turn_bounds,
    }

    # -- Grammatical index -----------------------------------------------------
    # Intern whole-reading signatures and write one packed id per global token.
    sig_ids: dict[tuple, int] = {}
    sig_list: list[tuple] = [(), ()]
    column: list[int] = []
    form_stream: list[str | None] = []
    lemma_stream: list[list[str] | None] = []
    for seg in segments:
        for line in seg["lines"]:
            for tok in line["tokens"]:
                key = tok.get("k")
                form_stream.append(fold_lemma(key) or None if key else None)
                if not key:
                    column.append(SIG_UNKEYED)
                    lemma_stream.append(None)
                    continue
                stored = key_map.get(key)
                entries = analyses.get(stored, []) if stored else []
                lemmas = sorted({
                    fold_lemma(entry["lemma"])
                    if entry["lemma"]
                    else fold_lemma(stored)
                    for entry in entries
                } - {""})
                lemma_stream.append(lemmas or None)
                sig = signature(entries)
                if not sig:
                    column.append(SIG_UNANALYSED)
                    continue
                sid = sig_ids.get(sig)
                if sid is None:
                    sid = len(sig_list)
                    sig_ids[sig] = sid
                    sig_list.append(sig)
                column.append(sid)

    width = 4 if len(sig_list) > 0xFFFF else 2
    grammar_dict = {
        "token_count": token_count,
        "width": width,
        "categories": sorted(set(_FEATURES.values())),
        "reserved": {"unkeyed": SIG_UNKEYED, "unanalysed": SIG_UNANALYSED},
        "sigs": [
            [
                {category: list(values) for category, values in reading}
                for reading in sig
            ]
            for sig in sig_list
        ],
    }

    streams_check = check_ngram_streams(
        form_stream,
        lemma_stream,
        greek_form,
        greek_lemma,
        seg_base_offset,
        token_count,
    )
    offsets_check = check_offsets(offsets, segments)
    grammar_check = check_grammar(
        grammar_dict, column, offsets, segments, key_map, analyses, signature
    )
    for name, check in (
        ("offset", offsets_check),
        ("grammar", grammar_check),
        ("n-gram stream", streams_check),
    ):
        if not check["ok"]:
            raise ValueError(
                f"stage6: {name} validation failed —\n  "
                + "\n  ".join(check["problems"][:20])
            )

    out_dir = BUILD_DIR / "stage6"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "offsets.json").write_text(
        json.dumps(offsets, ensure_ascii=False), encoding="utf-8"
    )
    (out_dir / "grammar-dict.json").write_text(
        json.dumps(grammar_dict, ensure_ascii=False), encoding="utf-8"
    )
    (out_dir / "grammar-col.bin").write_bytes(
        struct.pack(f"<{len(column)}{'I' if width == 4 else 'H'}", *column)
    )

    # Fold streams live outside the per-work scratch directory so stage 8 can
    # merge all works after their individual stage6 runs.
    ngram_dir = BUILD_DIR / "ngrams"
    ngram_dir.mkdir(parents=True, exist_ok=True)
    (ngram_dir / f"{manifest.work_id}.json").write_text(
        json.dumps(
            {
                "work": manifest.work_id,
                "token_count": token_count,
                "book_bounds": book_bounds,
                "chapter_bounds": chapter_bounds,
                "form": form_stream,
                "lemma": lemma_stream,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (out_dir / "greek_lemma.json").write_text(
        json.dumps(greek_lemma, ensure_ascii=False), encoding="utf-8"
    )
    (out_dir / "greek_form.json").write_text(
        json.dumps(greek_form, ensure_ascii=False), encoding="utf-8"
    )
    (out_dir / "english.json").write_text(
        json.dumps(english_idx, ensure_ascii=False), encoding="utf-8"
    )
    (out_dir / "meta.json").write_text(
        json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    summary = {
        "greek_lemmata": len(greek_lemma),
        "greek_forms": len(greek_form),
        "english_terms": len(english_idx),
        "segments": len(meta),
        "tokens": token_count,
        "turn_bounds": len(turn_bounds),
        "turn_bounds_dropped": turn_stats["dropped"],
        "turn_bounds_line_snapped": sum(
            1 for turn in turn_bounds if turn["accuracy"] != "exact"
        ),
        "signatures": grammar_check["signatures"],
        "tokens_unanalysed": grammar_check["tokens_unanalysed"],
        "ngram_form_tokens": streams_check["form_tokens"],
        "ngram_multi_lemma": streams_check["multi_lemma_tokens"],
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=1))
    (out_dir / "grammar_report.json").write_text(
        json.dumps({"offsets": offsets_check, "grammar": grammar_check}, indent=1)
    )
    return out_dir
