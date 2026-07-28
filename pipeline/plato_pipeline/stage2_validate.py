"""Stage 2: validation of the Stage 1 spine, chunks, and alignment.

Checks:
  1. Column completeness and monotonic order across 1094a-1181b.
  2. Line-number gaps inside columns (book-boundary gaps are expected and
     verified against the manifest; anything else is flagged).
  3. Alignment coverage in both directions.
  4. Greek/English length-ratio outliers (> 1.5 SD from the mean ratio).
  5. Proper-name spot check: names that should co-occur in the same column
     in both languages.
  6. Sigla/character inventory of the Greek text: every non-Greek,
     non-expected character with counts and sample locations.

Emits build/stage2/validation_report.json and .md (human-readable).
"""

from __future__ import annotations

import json
import hashlib
import statistics
import unicodedata
from bisect import bisect_right
from collections import defaultdict
from pathlib import Path

from . import scheme as scheme_mod
from .config import BUILD_DIR, Manifest
from .refs import column_key, column_range, ref_key

def _base(text: str) -> str:
    decomposed = unicodedata.normalize("NFD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).lower()

# Characters we expect in Bywater's text besides Greek letters.
EXPECTED_NON_GREEK = set(" .,·;'’ʼ—-()[]")
GRAMMAR_EVEN_SAMPLES = 257
GRAMMAR_EDGE_SEGMENTS = 32


def _is_greek_letter(ch: str) -> bool:
    if not ch.isalpha():
        return False
    try:
        return "GREEK" in unicodedata.name(ch)
    except ValueError:
        return False


def check_offsets(offsets: dict, segments: list[dict]) -> dict:
    """Validate the stage6 word-offset primitive against the stage3 segments.

    Lives here with the other checks, but runs from stage6 — offsets.json does
    not exist yet when stage 2 runs. Plato has no chapter bounds; turn bounds
    are checked against the same offset and book partitions instead.

    Structural failures (a base that walks backwards, a base delta that misses
    its segment's token count, an out-of-range turn anchor) are hard: every
    offset-indexed feature downstream would silently read the wrong word. A
    line-snapped turn bound is not a failure — it is a known limit of the
    source, counted here so it can be surfaced rather than hidden.
    """
    base = offsets["seg_base_offset"]
    coords = offsets["segments"]
    problems: list[str] = []

    if len(base) != len(segments) or len(coords) != len(segments):
        problems.append(
            f"length mismatch: {len(base)} bases / {len(coords)} coords / "
            f"{len(segments)} segments"
        )
    else:
        for i, seg in enumerate(segments):
            count = sum(len(l["tokens"]) for l in seg["lines"])
            if i and base[i] < base[i - 1]:
                problems.append(f"base decreases at seg {i} ({seg['id']})")
            expected = base[i] + count
            actual = base[i + 1] if i + 1 < len(base) else offsets["token_count"]
            if actual != expected:
                problems.append(
                    f"seg {i} ({seg['id']}): base delta {actual - base[i]} != "
                    f"token count {count}"
                )
            expected_runs = [[line["n"], len(line["tokens"])] for line in seg["lines"]]
            if coords[i]["line_runs"] != expected_runs:
                problems.append(
                    f"seg {i} ({seg['id']}): line_runs do not match stage3 lines "
                    f"(expected {expected_runs!r}, got {coords[i]['line_runs']!r})"
                )

    # Round-trip a sample: global -> (seg, pos) must return the original.
    def to_local(g: int) -> tuple[int, int]:
        lo, hi = 0, len(base) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if base[mid] <= g:
                lo = mid
            else:
                hi = mid - 1
        return lo, g - base[lo]

    sampled = 0
    if not problems:
        for i, seg in enumerate(segments):
            count = sum(len(l["tokens"]) for l in seg["lines"])
            for pos in {0, count // 2, count - 1}:
                if not 0 <= pos < count:
                    continue
                sampled += 1
                if to_local(base[i] + pos) != (i, pos):
                    problems.append(f"round-trip failed at seg {i} pos {pos}")

    if offsets["chapter_bounds"]:
        problems.append("chapter_bounds must be empty for Plato")

    book_bounds = offsets["book_bounds"]
    expected_books = []
    if len(base) == len(segments):
        for i, seg in enumerate(segments):
            if not expected_books or expected_books[-1]["book"] != seg["book"]:
                expected_books.append({"book": seg["book"], "start": base[i]})
    if book_bounds != expected_books:
        problems.append(
            f"book_bounds do not match segment partition "
            f"(expected {expected_books!r}, got {book_bounds!r})"
        )

    book_ranges = {
        bound["book"]: (
            bound["start"],
            book_bounds[i + 1]["start"]
            if i + 1 < len(book_bounds)
            else offsets["token_count"],
        )
        for i, bound in enumerate(book_bounds)
    }
    turn_bounds = offsets["turn_bounds"]
    for i, turn in enumerate(turn_bounds):
        lo, hi = book_ranges.get(turn["book"], (-1, -1))
        if not lo <= turn["start"] < hi:
            problems.append(
                f"turn {i} in book {turn['book']}: start {turn['start']} "
                f"outside book range [{lo}, {hi})"
            )
    if any(a["start"] > b["start"] for a, b in zip(turn_bounds, turn_bounds[1:])):
        problems.append("turn_bounds are not in offset order")

    snapped = [t for t in turn_bounds if t["accuracy"] != "exact"]
    return {
        "token_count": offsets["token_count"],
        "segments": len(segments),
        "round_trips_sampled": sampled,
        "book_bounds": len(book_bounds),
        "turn_bounds": len(turn_bounds),
        "turn_bounds_exact": len(turn_bounds) - len(snapped),
        "turn_bounds_line_snapped": len(snapped),
        "problems": problems,
        "ok": not problems,
    }


def check_ngram_streams(
    form_stream: list,
    lemma_stream: list,
    greek_form: dict,
    greek_lemma: dict,
    base: list[int],
    token_count: int,
) -> dict:
    """The n-gram streams must say exactly what the search indexes say.

    They are gathered in a different walk from the posting lists, so nothing but
    a comparison stops the two drifting. If they drift, the phrase browser would
    offer phrases the search cannot find — or miss ones it can.
    """
    problems: list[str] = []
    if len(form_stream) != token_count or len(lemma_stream) != token_count:
        problems.append(
            f"stream lengths {len(form_stream)}/{len(lemma_stream)} != "
            f"token_count {token_count}"
        )
        return {"problems": problems, "ok": False}

    expected_form: list = [None] * token_count
    for key, posts in greek_form.items():
        for si, pos in posts:
            expected_form[base[si] + pos] = key
    expected_lemma: list = [set() for _ in range(token_count)]
    for key, posts in greek_lemma.items():
        for si, pos in posts:
            expected_lemma[base[si] + pos].add(key)

    form_bad = [i for i in range(token_count) if expected_form[i] != form_stream[i]]
    lemma_bad = [
        i for i in range(token_count)
        if (sorted(expected_lemma[i]) or None) != lemma_stream[i]
    ]
    if form_bad:
        i = form_bad[0]
        problems.append(
            f"{len(form_bad)} form-stream mismatches (first at offset {i}: "
            f"index says {expected_form[i]!r}, stream says {form_stream[i]!r})"
        )
    if lemma_bad:
        i = lemma_bad[0]
        problems.append(
            f"{len(lemma_bad)} lemma-stream mismatches (first at offset {i}: "
            f"index says {sorted(expected_lemma[i]) or None!r}, "
            f"stream says {lemma_stream[i]!r})"
        )
    return {
        "form_tokens": sum(1 for t in form_stream if t),
        "lemma_tokens": sum(1 for t in lemma_stream if t),
        "multi_lemma_tokens": sum(1 for t in lemma_stream if t and len(t) > 1),
        "problems": problems,
        "ok": not problems,
    }


def check_grammar(
    grammar: dict,
    column: list[int],
    offsets: dict,
    segments: list[dict],
    key_map: dict,
    analyses: dict,
    signature_fn,
    allow_semantic_superset: bool = False,
) -> dict:
    """Validate the stage6 grammatical index. Runs from stage6, like the above.

    The column is indexed by global offset, so a length that disagrees with the
    offset primitive means every grammatical hit would name the wrong word —
    hard fail. Ambiguity rates are reported, not judged.
    """
    sigs = grammar["sigs"]
    problems: list[str] = []

    if len(column) != offsets["token_count"]:
        problems.append(
            f"column length {len(column)} != token_count {offsets['token_count']}"
        )
    if grammar["token_count"] != offsets["token_count"]:
        problems.append("grammar/offsets token_count disagree — mismatched build")
    bad = [i for i, s in enumerate(column) if not 0 <= s < len(sigs)]
    if bad:
        problems.append(f"{len(bad)} out-of-range signature ids (first at {bad[0]})")
    for slot, name in ((grammar["reserved"]["unkeyed"], "unkeyed"),
                       (grammar["reserved"]["unanalysed"], "unanalysed")):
        if sigs[slot]:
            problems.append(f"reserved slot {slot} ({name}) is not empty")

    # Range checks cannot detect a well-formed column joined to the wrong token.
    # Re-derive morphology from stage3/stage4 at deterministic offsets spread
    # across the work, with extra coverage at early segment boundaries.
    nonempty_starts: list[int] = []
    nonempty_indexes: list[int] = []
    expected_count = 0
    edge_segments = 0
    samples: set[int] = set()
    for si, seg in enumerate(segments):
        count = sum(len(line["tokens"]) for line in seg["lines"])
        if count:
            nonempty_starts.append(expected_count)
            nonempty_indexes.append(si)
            if edge_segments < GRAMMAR_EDGE_SEGMENTS:
                samples.update((expected_count, expected_count + count - 1))
                edge_segments += 1
        expected_count += count

    if expected_count:
        evenly_spaced = min(GRAMMAR_EVEN_SAMPLES, expected_count)
        if evenly_spaced == 1:
            samples.add(0)
        else:
            samples.update(
                i * (expected_count - 1) // (evenly_spaced - 1)
                for i in range(evenly_spaced)
            )

    semantic_sampled = 0
    for g in sorted(samples):
        if g >= len(column):
            continue  # the length failure above already names this corruption
        sid = column[g]
        if not 0 <= sid < len(sigs):
            continue  # likewise for the signature-id range failure
        nonempty_i = bisect_right(nonempty_starts, g) - 1
        si = nonempty_indexes[nonempty_i]
        local = g - nonempty_starts[nonempty_i]
        token = None
        token_pos = local
        for line in segments[si]["lines"]:
            if token_pos < len(line["tokens"]):
                token = line["tokens"][token_pos]
                break
            token_pos -= len(line["tokens"])
        if token is None:
            problems.append(f"semantic sample {g} did not resolve to a stage3 token")
            continue

        semantic_sampled += 1
        key = token.get("k")
        if not key:
            expected_sid = grammar["reserved"]["unkeyed"]
            if sid != expected_sid:
                problems.append(
                    f"grammar semantic mismatch at global offset {g} "
                    f"(seg {si} {segments[si]['id']}, token {local}): "
                    f"unkeyed token expected reserved id {expected_sid}, got {sid}"
                )
            continue

        stored = key_map.get(key)
        entries = analyses.get(stored, []) if stored else []
        expected_sig = signature_fn(entries)
        if not expected_sig:
            if allow_semantic_superset:
                # The reusable emitted-artifact gate sees stage 7's licensed
                # (filtered) analyses. An empty filtered set cannot disprove a
                # non-empty stage-4 signature, so the build-time exact check
                # remains authoritative for this token.
                continue
            expected_sid = grammar["reserved"]["unanalysed"]
            if sid != expected_sid:
                problems.append(
                    f"grammar semantic mismatch at global offset {g} "
                    f"(seg {si} {segments[si]['id']}, token {local}, key {key!r}): "
                    f"unanalysed token expected reserved id {expected_sid}, got {sid}"
                )
            continue

        expected_content = [
            {category: list(values) for category, values in reading}
            for reading in expected_sig
        ]
        actual_content = sigs[sid]
        semantic_matches = (
            all(reading in actual_content for reading in expected_content)
            if allow_semantic_superset
            else actual_content == expected_content
        )
        if not semantic_matches:
            relation = "to include" if allow_semantic_superset else "to equal"
            problems.append(
                f"grammar semantic mismatch at global offset {g} "
                f"(seg {si} {segments[si]['id']}, token {local}, key {key!r}): "
                f"expected id {sid} {relation} {expected_content!r}, "
                f"got {actual_content!r}"
            )

    # Ambiguity, per category: of the tokens that license a value for it, how
    # many license more than one? This is the honesty signal — it counts values
    # a reader could be shown, not analysis records.
    valid_ids = [s for s in column if 0 <= s < len(sigs)]
    analysed = sum(1 for s in valid_ids if sigs[s])
    ambiguity: dict[str, dict] = {}
    for category in grammar["categories"]:
        present = ambiguous = 0
        for sid, count in _counts(valid_ids).items():
            readings = sigs[sid]
            if not readings:
                continue
            values = {v for r in readings for v in r.get(category, [])}
            if not values:
                continue
            present += count
            if len(values) > 1:
                ambiguous += count
        if present:
            ambiguity[category] = {
                "tokens": present,
                "ambiguous": ambiguous,
                "rate": round(ambiguous / present, 4),
            }

    return {
        "signatures": len(sigs),
        "width_bytes": grammar["width"],
        "tokens": len(column),
        "semantic_offsets_sampled": semantic_sampled,
        "tokens_analysed": analysed,
        "tokens_unkeyed": sum(1 for s in column if s == grammar["reserved"]["unkeyed"]),
        "tokens_unanalysed": sum(
            1 for s in column if s == grammar["reserved"]["unanalysed"]
        ),
        "ambiguity": ambiguity,
        "problems": problems,
        "ok": not problems,
    }


def _counts(column: list[int]) -> dict[int, int]:
    out: dict[int, int] = defaultdict(int)
    for s in column:
        out[s] += 1
    return out


def check_ngram_artifacts(ngram_root: Path, work_docs: dict[str, dict]) -> dict:
    """Cross-check stage 8 browse rows and delta-encoded occurrence shards.

    Counts and work totals are checked in both directions, so neither a missing
    browse row nor an orphaned occurrence row can pass. Decoded offsets are
    also checked against the persisted stage-6 streams (and the independently
    tokenized emitted English supplied by the gate runner), which makes a
    changed-but-still-well-formed delta visible.

    ``work_docs`` uses the stage-6 ngram document shape. A runner may add
    ``english`` and ``english_bounds`` fields for the English stream.
    """
    problems: list[str] = []
    problem_count = 0
    browse_rows = occurrence_lists = decoded_offsets = verified_offsets = 0

    def problem(message: str) -> None:
        nonlocal problem_count
        problem_count += 1
        if len(problems) < 100:
            problems.append(message)

    def occurrence_files(occ_dir: Path) -> dict[tuple[str, int], Path]:
        out: dict[tuple[str, int], Path] = {}
        for path in sorted(occ_dir.glob("*.json")):
            try:
                letter, raw_n = path.stem.rsplit("-", 1)
                n = int(raw_n)
            except (ValueError, TypeError):
                problem(f"{path}: occurrence shard name must end in -<n>.json")
                continue
            out[(letter, n)] = path
        return out

    def source_for(work: str, stream_name: str):
        doc = work_docs.get(work)
        if doc is None:
            return None
        if stream_name == "english":
            stream = doc.get("english")
            bounds = doc.get("english_bounds")
        else:
            stream = doc.get(stream_name)
            bounds = [bound["start"] for bound in doc.get("book_bounds", [])]
        if stream is None or bounds is None:
            return None
        return stream, bounds

    def licenses(stream_name: str, entry, word: str) -> bool:
        if stream_name in ("form", "english"):
            return entry == word
        return isinstance(entry, list) and word in entry

    def verify_occurrences(
        stream_name: str,
        phrase: str,
        per_work,
        location: str,
    ) -> int:
        nonlocal occurrence_lists, decoded_offsets, verified_offsets
        if not isinstance(per_work, dict):
            problem(f"{location}: occurrence row for {phrase!r} is not an object")
            return 0
        words = phrase.split(" ")
        total = 0
        for work, encoded in per_work.items():
            occurrence_lists += 1
            if not isinstance(encoded, list) or not encoded:
                problem(f"{location}: {phrase!r}/{work} has an empty or invalid delta list")
                continue
            starts: list[int] = []
            current = 0
            valid = True
            for i, value in enumerate(encoded):
                if isinstance(value, bool) or not isinstance(value, int):
                    problem(f"{location}: {phrase!r}/{work} delta {i} is not an integer")
                    valid = False
                    break
                if i == 0:
                    current = value
                    if current < 0:
                        problem(f"{location}: {phrase!r}/{work} starts below zero")
                        valid = False
                        break
                else:
                    if value <= 0:
                        problem(f"{location}: {phrase!r}/{work} delta {i} is not positive")
                        valid = False
                        break
                    current += value
                starts.append(current)
            total += len(encoded)
            decoded_offsets += len(starts)
            if not valid:
                continue

            source = source_for(work, stream_name)
            if source is None:
                problem(f"{location}: no {stream_name} source stream for work {work}")
                continue
            stream, bounds = source
            edges = list(bounds) + [len(stream)]
            for start in starts:
                if start < 0 or start + len(words) > len(stream):
                    problem(
                        f"{location}: {phrase!r}/{work} offset {start} is out of range"
                    )
                    continue
                partition = bisect_right(bounds, start) - 1
                if partition < 0 or start + len(words) > edges[partition + 1]:
                    problem(
                        f"{location}: {phrase!r}/{work} offset {start} crosses a boundary"
                    )
                    continue
                if not all(
                    licenses(stream_name, stream[start + i], word)
                    for i, word in enumerate(words)
                ):
                    problem(
                        f"{location}: {phrase!r}/{work} is not licensed at offset {start}"
                    )
                    continue
                verified_offsets += 1
        return total

    for stream_name in ("form", "lemma", "english"):
        stream_dir = ngram_root / stream_name
        occ_dir = stream_dir / "occ"
        browse_files = {path.stem: path for path in sorted(stream_dir.glob("*.json"))}
        occ_files = occurrence_files(occ_dir)
        letters = sorted(set(browse_files) | {letter for letter, _ in occ_files})

        for letter in letters:
            browse = {}
            browse_path = browse_files.get(letter)
            if browse_path is not None:
                browse = json.loads(browse_path.read_text(encoding="utf-8"))
                if not isinstance(browse, dict):
                    problem(f"{browse_path}: browse shard is not an object")
                    browse = {}

            ns = {n for (shard_letter, n) in occ_files if shard_letter == letter}
            for row in browse.values():
                if isinstance(row, list) and row and isinstance(row[0], int):
                    ns.add(row[0])
            occurrence_docs: dict[int, dict] = {}
            for n in sorted(ns):
                path = occ_files.get((letter, n))
                if path is None:
                    occurrence_docs[n] = {}
                    continue
                data = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(data, dict):
                    problem(f"{path}: occurrence shard is not an object")
                    data = {}
                occurrence_docs[n] = data

            for phrase, row in browse.items():
                browse_rows += 1
                location = str(browse_path)
                if not isinstance(row, list) or len(row) < 4:
                    problem(f"{location}: browse row for {phrase!r} is malformed")
                    continue
                n, count, _, works = row[:4]
                if n != len(phrase.split(" ")):
                    problem(f"{location}: {phrase!r} has n={n}")
                    continue
                per_work = occurrence_docs.get(n, {}).get(phrase)
                if per_work is None:
                    problem(f"{location}: {phrase!r} has no occurrence row")
                    continue
                actual_count = verify_occurrences(
                    stream_name, phrase, per_work, location
                )
                if count != actual_count:
                    problem(
                        f"{location}: {phrase!r} browse count {count} != "
                        f"decoded occurrence count {actual_count}"
                    )
                if not isinstance(per_work, dict) or works != len(per_work):
                    actual_works = len(per_work) if isinstance(per_work, dict) else 0
                    problem(
                        f"{location}: {phrase!r} browse works {works} != "
                        f"occurrence works {actual_works}"
                    )

            for n, occurrence_doc in occurrence_docs.items():
                for phrase in occurrence_doc:
                    row = browse.get(phrase)
                    if row is None:
                        problem(
                            f"{occ_files[(letter, n)]}: {phrase!r} has no browse row"
                        )
                    elif not isinstance(row, list) or not row or row[0] != n:
                        problem(
                            f"{occ_files[(letter, n)]}: {phrase!r} disagrees with "
                            f"its browse n"
                        )

    return {
        "browse_rows": browse_rows,
        "occurrence_lists": occurrence_lists,
        "decoded_offsets": decoded_offsets,
        "verified_offsets": verified_offsets,
        "problem_count": problem_count,
        "problems": problems,
        "ok": problem_count == 0,
    }


def validate(manifest: Manifest, spine: dict, english: dict, alignment: dict) -> dict:
    report: dict = {"checks": {}}
    segments = spine["segments"]
    # Dispatch structural rules on the citation scheme instead of ad-hoc string
    # tests. "observed" schemes (busse, stephanus) carry irregular, per-work
    # column spans whose page numbers are not globally unique and whose interior
    # pages are not guaranteed to hold every section letter, so their expected
    # column set is the OBSERVED spine, never a rectangular page x side range;
    # editorial line-number gaps on those schemes are demoted (not failures).
    sch = scheme_mod.for_manifest(manifest)
    observed = sch.validation_mode == "observed"

    # --- 1. column completeness + monotonicity --------------------------
    seen_cols: list[str] = []
    for seg in segments:
        if seg["column"] not in seen_cols:
            seen_cols.append(seg["column"])
    expected = list(seen_cols) if observed else column_range(
        manifest.first_column, manifest.last_column, sch.range_sides)
    missing = sorted(set(expected) - set(seen_cols), key=column_key)
    extra = sorted(set(seen_cols) - set(expected), key=column_key)
    keys = [column_key(c) for c in seen_cols]
    monotonic = all(a <= b for a, b in zip(keys, keys[1:]))
    report["checks"]["columns"] = {
        "expected": len(expected),
        "found": len(seen_cols),
        "missing": missing,
        "extra": extra,
        "monotonic": monotonic,
        "ok": not missing and not extra and monotonic,
    }

    # --- 1b. section-token order (observed schemes only) ----------------
    # The spine's columns must be STRICTLY increasing in ref order (17e before
    # 18a). Missing letters within a page or skipped pages are legal (works
    # start/end mid-page; interior pages need not carry every letter) and are
    # reported as info, honouring manifest-declared `expected_section_gaps`.
    if observed:
        letter_ix = {ch: i for i, ch in enumerate(sch.section_letters)}
        declared_gaps = {
            (g["after"], g["next"])
            for g in manifest.data.get("expected_section_gaps", [])
            if isinstance(g, dict) and {"after", "next"} <= g.keys()
        }
        strictly_increasing = all(a < b for a, b in zip(keys, keys[1:]))
        section_gaps: list[dict] = []
        for (c_prev, k_prev), (c_next, k_next) in zip(
            zip(seen_cols, keys), zip(seen_cols[1:], keys[1:])
        ):
            (p0, l0), (p1, l1) = k_prev, k_next
            contiguous = (
                (p0 == p1 and letter_ix.get(l1, -99) == letter_ix.get(l0, -1) + 1)
                or (p1 == p0 + 1)  # advancing to the next page is normal
            )
            if not contiguous:
                section_gaps.append({
                    "after": c_prev,
                    "next": c_next,
                    "expected": (c_prev, c_next) in declared_gaps,
                })
        report["checks"]["section_order"] = {
            "strictly_increasing": strictly_increasing,
            "gaps": section_gaps,  # informational
            "ok": strictly_increasing,
        }

    # --- 1c. immutable observed-section baseline -----------------------
    # Stephanus exports are irregular, so a rectangular range cannot establish
    # completeness.  Instead, compare the ordered section-token spine with the
    # verified per-work manifest fingerprint captured from stage 1.
    if sch.has_sections:
        baseline = manifest.data.get("section_spine") or {}
        expected_count = baseline.get("count")
        expected_sha256 = baseline.get("sha256")
        got_count = len(seen_cols)
        got_sha256 = hashlib.sha256(",".join(seen_cols).encode("utf-8")).hexdigest()
        count_ok = isinstance(expected_count, int) and got_count == expected_count
        hash_ok = (
            isinstance(expected_sha256, str)
            and len(expected_sha256) == 64
            and got_sha256 == expected_sha256.lower()
        )
        first_ok = bool(seen_cols) and seen_cols[0] == manifest.first_column
        last_ok = bool(seen_cols) and seen_cols[-1] == manifest.last_column

        first_diverging = None
        if not count_ok:
            # A digest-only baseline intentionally does not duplicate the full
            # token list. Pinpoint the first structurally suspicious observed
            # token: an undeclared within-page jump (the common deletion case),
            # or the first/last token when the boundary itself moved.
            if not first_ok and seen_cols:
                first_diverging = {"index": 0, "token": seen_cols[0]}
            else:
                for i, ((prev, pkey), (nxt, nkey)) in enumerate(
                    zip(zip(seen_cols, keys), zip(seen_cols[1:], keys[1:])), 1
                ):
                    same_page_jump = (
                        pkey[0] == nkey[0]
                        and letter_ix.get(nkey[1], -99) > letter_ix.get(pkey[1], -1) + 1
                    )
                    if same_page_jump and (prev, nxt) not in declared_gaps:
                        first_diverging = {"index": i, "token": nxt, "after": prev}
                        break
                if first_diverging is None and seen_cols:
                    i = min(got_count, expected_count or got_count) - 1
                    first_diverging = {"index": max(i, 0), "token": seen_cols[max(i, 0)]}

        report["checks"]["section_spine"] = {
            "expected": {"count": expected_count, "sha256": expected_sha256},
            "got": {"count": got_count, "sha256": got_sha256},
            "count_match": count_ok,
            "hash_match": hash_ok,
            "first_column": {"expected": manifest.first_column,
                             "got": seen_cols[0] if seen_cols else None,
                             "ok": first_ok},
            "last_column": {"expected": manifest.last_column,
                            "got": seen_cols[-1] if seen_cols else None,
                            "ok": last_ok},
            "first_diverging_token": first_diverging,
            "ok": count_ok and hash_ok and first_ok and last_ok,
        }

    # --- 1d. book partition (section schemes) ---------------------------
    # The declared books MUST partition the observed spine: ordered and
    # non-overlapping by (page, letter), and every observed section falls in
    # exactly one book. A section outside every declared range is an ERROR (the
    # book table is missing coverage); a section claimed by two ranges means the
    # ranges overlap. Bekker/busse books are handled by the line-gap check.
    if sch.has_sections:
        from .refs import column_prefix_key

        ranges = [
            (b["n"], column_prefix_key(b["start"]), column_prefix_key(b["end"]))
            for b in manifest.books
        ]
        within = all(s <= e for _, s, e in ranges)
        ordered = all(a[2] < b[1] for a, b in zip(ranges, ranges[1:]))
        outside: list[str] = []
        overlapping: list[str] = []
        for col in seen_cols:
            k = column_prefix_key(col)
            hits = [n for n, s, e in ranges if s <= k <= e]
            if not hits:
                outside.append(col)
            elif len(hits) > 1:
                overlapping.append(col)
        report["checks"]["book_partition"] = {
            "books": len(ranges),
            "ordered_non_overlapping": within and ordered,
            "sections_outside_any_book": outside,
            "sections_in_multiple_books": overlapping,
            "ok": within and ordered and not outside and not overlapping,
        }

    # --- 2. line-number gaps ---------------------------------------------
    # Expected gaps: between one book's end and the next book's start when
    # they share a column (Bekker numbering skips the heading lines). Only
    # line-bearing schemes declare book boundaries with a line number; section
    # schemes (stephanus) bound books by a page+letter column and demote all
    # intra-column line gaps below, so their book table is skipped here.
    expected_gaps = set()
    books = manifest.books
    if not observed:
        for prev, nxt in zip(books, books[1:]):
            e_page, e_side, e_line = ref_key(prev["end"])
            s_page, s_side, s_line = ref_key(nxt["start"])
            if (e_page, e_side) == (s_page, s_side):
                expected_gaps.add((f"{e_page}{e_side}", e_line, s_line))
    # Edition quirks declared in the manifest (e.g. a repeated line number).
    for g in manifest.data.get("expected_line_gaps", []):
        expected_gaps.add((g["column"], g["after"], g["next"]))
    gaps = []
    lines_by_col: dict[str, list[int]] = defaultdict(list)
    for seg in segments:
        lines_by_col[seg["column"]].extend(l["n"] for l in seg["lines"])
    for col, nums in lines_by_col.items():
        for a, b in zip(nums, nums[1:]):
            if b != a + 1:
                entry = {
                    "column": col,
                    "after_line": a,
                    "next_line": b,
                    "expected": (col, a, b) in expected_gaps,
                }
                gaps.append(entry)
    # observed schemes: line numbers are editorial (busse per-page numbering with
    # section headings dropped; stephanus lines restart per section and are not
    # user-facing citation targets), so intra-column line-number gaps are demoted
    # to non-failing warnings rather than treated as spine defects.
    if observed:
        for g in gaps:
            g["expected"] = True
    unexpected_gaps = [g for g in gaps if not g["expected"]]
    report["checks"]["line_gaps"] = {
        "gaps": gaps,
        "unexpected": unexpected_gaps,
        "ok": not unexpected_gaps,
    }

    # --- 3. alignment coverage -------------------------------------------
    unmatched = [p["segment"] for p in alignment["pairs"] if p["english"] is None]
    # Columns the English TEI demonstrably cannot cover (Perseus omitted a Bekker
    # page milestone, or assigns a book-straddling column to a single book) are
    # declared in the manifest so they're surfaced but don't fail the build.
    allowed = set(manifest.data.get("alignment_allow_unmatched", []))
    unexpected_unmatched = [s for s in unmatched if s not in allowed]
    # A book-boundary edition mismatch is symmetric: the English TEI places a
    # book division a column off from the Greek, leaving both an unpaired Greek
    # segment and an unpaired English chunk. The allowance covers either side.
    unexpected_english_only = [s for s in alignment["english_only"] if s not in allowed]
    report["checks"]["alignment"] = {
        "pairs": len(alignment["pairs"]),
        "unmatched_segments": unmatched,
        "allowed_unmatched": sorted(allowed & (set(unmatched) | set(alignment["english_only"]))),
        "unexpected_unmatched": unexpected_unmatched,
        "english_only": alignment["english_only"],
        "unexpected_english_only": unexpected_english_only,
        "ok": not unexpected_unmatched and not unexpected_english_only,
    }

    # --- 4. length-ratio outliers ------------------------------------------
    eng_by_id = {c["id"]: c for c in english["chunks"]}
    ratios = []
    for seg in segments:
        eng = eng_by_id.get(seg["id"])
        if eng is None:
            continue
        glen = sum(len(l["text"]) for l in seg["lines"])
        elen = len(eng["text"])
        if glen and elen:
            ratios.append((seg["id"], elen / glen, glen, elen))
    vals = [r[1] for r in ratios]
    # No paired English yet (e.g. a stephanus work whose English walker runs in a
    # separate pass) → nothing to compare; report an empty, passing check.
    if len(vals) < 2:
        report["checks"]["length_ratio"] = {
            "mean": 0.0, "sd": 0.0, "outliers": [], "ok": True,
        }
    else:
        mean, sd = statistics.mean(vals), statistics.stdev(vals)
        outliers = [
            {"id": rid, "ratio": round(r, 3), "greek_chars": g, "english_chars": e}
            for rid, r, g, e in ratios
            if abs(r - mean) > 1.5 * sd
        ]
        report["checks"]["length_ratio"] = {
            "mean": round(mean, 3),
            "sd": round(sd, 3),
            "outliers": sorted(outliers, key=lambda o: -abs(o["ratio"] - mean)),
            "ok": True,  # informational; outliers need eyes, not a hard fail
        }

    # --- 5. proper-name spot check ------------------------------------------
    greek_text_by_col: dict[str, str] = defaultdict(str)
    eng_text_by_col: dict[str, str] = defaultdict(str)
    for seg in segments:
        greek_text_by_col[seg["column"]] += " ".join(l["text"] for l in seg["lines"])
    for c in english["chunks"]:
        eng_text_by_col[c["column"]] += c["text"]
    greek_base_by_col = {c: _base(t) for c, t in greek_text_by_col.items()}
    proper_names = [tuple(p) for p in manifest.data.get("proper_names", [])]
    name_results = []
    for grc, eng_name in proper_names:
        grc_cols = {c for c, t in greek_base_by_col.items() if grc in t}
        eng_cols = {c for c, t in eng_text_by_col.items() if eng_name in t}
        # English chunk boundaries sit exactly at milestones, but a sentence
        # begun late in one column is often translated as overflowing the
        # boundary; allow +/- one column of slack.
        def near(col, others):
            i = expected.index(col)
            window = set(expected[max(0, i - 1) : i + 2])
            return bool(window & others)

        only_greek = sorted(c for c in grc_cols if not near(c, eng_cols))
        only_english = sorted(c for c in eng_cols if not near(c, grc_cols))
        name_results.append(
            {
                "greek": grc,
                "english": eng_name,
                "greek_columns": len(grc_cols),
                "english_columns": len(eng_cols),
                "greek_without_english": only_greek,
                "english_without_greek": only_english,
            }
        )
    report["checks"]["proper_names"] = {
        "names": name_results,
        "ok": all(
            not n["greek_without_english"] and not n["english_without_greek"]
            for n in name_results
        ),
    }

    # --- 6. sigla / character inventory ------------------------------------
    inventory: dict[str, dict] = {}
    for seg in segments:
        for line in seg["lines"]:
            for ch in line["text"]:
                if _is_greek_letter(ch) or ch in EXPECTED_NON_GREEK:
                    continue
                entry = inventory.setdefault(
                    ch,
                    {
                        "char": ch,
                        "name": unicodedata.name(ch, "UNKNOWN"),
                        "count": 0,
                        "samples": [],
                    },
                )
                entry["count"] += 1
                if len(entry["samples"]) < 5:
                    entry["samples"].append(
                        {"ref": f"{seg['column']}{line['n']}", "text": line["text"][:80]}
                    )
    report["checks"]["sigla"] = {
        "characters": sorted(inventory.values(), key=lambda e: -e["count"]),
        "ok": True,  # informational
    }

    report["ok"] = all(c.get("ok") for c in report["checks"].values())
    return report


def _to_markdown(report: dict) -> str:
    c = report["checks"]
    lines = ["# Stage 2 validation report", ""]
    lines.append(f"Overall: {'PASS' if report['ok'] else 'FAIL'}")
    cols = c["columns"]
    lines += [
        "",
        "## Columns",
        f"- {cols['found']}/{cols['expected']} columns, monotonic: {cols['monotonic']}",
        f"- missing: {cols['missing'] or 'none'}; extra: {cols['extra'] or 'none'}",
        "",
        "## Line gaps",
        f"- {len(c['line_gaps']['gaps'])} gaps, "
        f"{len(c['line_gaps']['unexpected'])} unexpected",
    ]
    for g in c["line_gaps"]["gaps"]:
        marker = "expected (book boundary)" if g["expected"] else "**UNEXPECTED**"
        lines.append(
            f"  - {g['column']}: {g['after_line']} -> {g['next_line']} ({marker})"
        )
    if "section_order" in c:
        so = c["section_order"]
        lines += [
            "",
            "## Section order (observed scheme)",
            f"- strictly increasing: {so['strictly_increasing']}; "
            f"{len(so['gaps'])} section gaps (info)",
        ]
        for g in so["gaps"]:
            tag = "declared" if g["expected"] else "gap"
            lines.append(f"  - {g['after']} -> {g['next']} ({tag})")
    if "section_spine" in c:
        ss = c["section_spine"]
        lines += [
            "",
            "## Section spine baseline",
            f"- count: expected {ss['expected']['count']}, got {ss['got']['count']}; "
            f"sha256: expected {ss['expected']['sha256']}, got {ss['got']['sha256']}",
            f"- span: {ss['first_column']['got']}..{ss['last_column']['got']} "
            f"(expected {ss['first_column']['expected']}..{ss['last_column']['expected']})",
        ]
        if ss["first_diverging_token"]:
            lines.append(f"- first diverging token: {ss['first_diverging_token']}")
    if "book_partition" in c:
        bp = c["book_partition"]
        lines += [
            "",
            "## Book partition (section scheme)",
            f"- {bp['books']} books, ordered & non-overlapping: "
            f"{bp['ordered_non_overlapping']}",
            f"- sections outside any book: "
            f"{bp['sections_outside_any_book'] or 'none'}",
            f"- sections in multiple books: "
            f"{bp['sections_in_multiple_books'] or 'none'}",
        ]
    a = c["alignment"]
    lines += [
        "",
        "## Alignment",
        f"- {a['pairs']} pairs; unmatched segments: {a['unmatched_segments'] or 'none'}; "
        f"english-only: {a['english_only'] or 'none'}",
        "",
        "## Length ratios (english chars / greek chars)",
        f"- mean {c['length_ratio']['mean']}, sd {c['length_ratio']['sd']}, "
        f"{len(c['length_ratio']['outliers'])} outliers > 1.5 SD",
    ]
    for o in c["length_ratio"]["outliers"][:15]:
        lines.append(
            f"  - {o['id']}: ratio {o['ratio']} "
            f"(grc {o['greek_chars']}, eng {o['english_chars']})"
        )
    lines += ["", "## Proper names"]
    for n in c["proper_names"]["names"]:
        status = (
            "ok"
            if not n["greek_without_english"] and not n["english_without_greek"]
            else f"grc-only {n['greek_without_english']} eng-only {n['english_without_greek']}"
        )
        lines.append(
            f"- {n['greek']} / {n['english']}: grc in {n['greek_columns']} cols, "
            f"eng in {n['english_columns']} cols — {status}"
        )
    lines += ["", "## Non-Greek character inventory"]
    for e in c["sigla"]["characters"]:
        sample = e["samples"][0]["ref"] if e["samples"] else ""
        lines.append(
            f"- U+{ord(e['char']):04X} {e['char']!r} {e['name']} x{e['count']} "
            f"(e.g. {sample})"
        )
    return "\n".join(lines) + "\n"


def run(manifest: Manifest) -> Path:
    stage1 = BUILD_DIR / "stage1"
    spine = json.loads((stage1 / "greek_spine.json").read_text(encoding="utf-8"))
    # The English side may not be built yet (a stephanus work whose Stephanus TEI
    # walker runs as a separate pass). Validate the Greek spine alone in that case.
    eng_path = stage1 / "english_chunks.json"
    align_path = stage1 / "alignment.json"
    english = (json.loads(eng_path.read_text(encoding="utf-8"))
               if eng_path.exists() else {"chunks": []})
    alignment = (json.loads(align_path.read_text(encoding="utf-8"))
                 if align_path.exists() else {"pairs": [], "english_only": []})
    report = validate(manifest, spine, english, alignment)
    out_dir = BUILD_DIR / "stage2"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "validation_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    md_path = out_dir / "validation_report.md"
    md_path.write_text(_to_markdown(report), encoding="utf-8")
    return md_path
