"""Turn pairing for Stephanus dialogues (stage 7).

The Greek spine emits, per segment, the speaker turns that START in that segment
(`speakers: [{line, offset, label}]`); the English walker emits, per chunk, the
turns that start in it (`turns: [{offset, speaker, display}]`). This module pairs
them so the reader can lay each speaker's Greek beside the same speaker's English.

The GREEK is the arbiter of the pairing: we walk the Greek events and the English
turns in reading order and pair position-by-position. A segment pairs iff the two
sequences have the SAME length AND every position agrees on speaker — where a
null speaker (the Greek's bare "—" dash, the English's `who="-"`) is a wildcard
that matches anything. On any mismatch we emit NO pairs for the segment and the
reader falls back to section-aligned prose; a pairing is therefore never wrong,
and the per-work `turn_reconciliation` metric reports how much of a work pairs.

Turns spanning sections are not events: a segment whose speech merely continues
one begun earlier has zero turns on both sides and pairs trivially as a
continuation (no boundaries to emit).
"""
from __future__ import annotations

import re

_DASH_PREFIX = re.compile(r"^[—\-\s<]+")


def base_siglum(label: str) -> str:
    """The base siglum of a Greek turn label: strip a leading dash, whitespace
    and stray '<' from a compound resumption marker ("— ΣΩ.", "—<ΙΠ."); a bare
    "—" normalises to "" (the unattributed turn)."""
    return _DASH_PREFIX.sub("", label).strip()


def greek_speaker(label: str, sigla: dict[str, str]) -> tuple[str | None, bool]:
    """(canonical name, mapped?) for a Greek turn label. A bare dash → (None,
    True): a legitimately unattributed turn. An unmapped non-empty siglum →
    (the base siglum, False): it can only match an identical English name, so it
    forces the segment to fall back — and `mapped=False` lets the caller report
    it."""
    base = base_siglum(label)
    if base == "":
        return None, True
    if base in sigla:
        return sigla[base], True
    return base, False


def _names_match(a: str | None, b: str | None) -> bool:
    """Two speakers agree if either is null (a dash/unattributed wildcard) or
    they are the same canonical name."""
    return a is None or b is None or a == b


def pair_segment(
    greek_events: list[dict],
    english_turns: list[dict],
    sigla: dict[str, str],
) -> tuple[list[dict] | None, list[str]]:
    """Pair a segment's Greek events with its English turns.

    Returns (turnPairs, unmapped_sigla). `turnPairs` is None when the sequences
    do not reconcile (different length, or a non-null speaker disagreement); it
    is a list of {g:{line,offset}, e:{offset}, speaker, display} otherwise (empty
    when both sides are pure continuation). `unmapped_sigla` lists any Greek base
    siglum with no roster entry, for reporting."""
    unmapped: list[str] = []
    g_names: list[str | None] = []
    for ev in greek_events:
        name, ok = greek_speaker(ev["label"], sigla)
        if not ok:
            unmapped.append(name)
        g_names.append(name)

    if len(greek_events) != len(english_turns):
        return None, unmapped
    for gn, et in zip(g_names, english_turns):
        if not _names_match(gn, et.get("speaker")):
            return None, unmapped

    pairs = [
        {
            "g": {"line": ge["line"], "offset": ge["offset"]},
            "e": {"offset": et["offset"]},
            # Prefer the concrete (non-null) canonical name; a dash pairs against
            # a named English turn (or vice versa) and takes the named side.
            "speaker": gn if gn is not None else et.get("speaker"),
            # The English lead-in as printed (small-caps in the reader); null for
            # a dash/reported-speech turn, which the reader shows as an em-dash.
            "display": et.get("display"),
        }
        for ge, et, gn in zip(greek_events, english_turns, g_names)
    ]
    return pairs, unmapped


def reconcile_work(segments: list[dict], english_by_id: dict[str, dict],
                   sigla: dict[str, str]) -> dict:
    """Pair every segment of a work, attaching `turnPairs` to each paired
    segment (in place, only when it has ≥1 boundary) and returning a report:

        {dialogue_segments, paired, mismatched: [ids], unmapped: {siglum: n}}

    A dialogue segment is one with at least one turn boundary on either side;
    a pure-continuation segment (0/0) is trivial and excluded from the metric."""
    dialogue = paired = 0
    mismatched: list[str] = []
    unmapped: dict[str, int] = {}
    for seg in segments:
        greek_events = seg.get("speakers", [])
        eng = english_by_id.get(seg["id"])
        english_turns = eng.get("turns", []) if eng else []
        if not greek_events and not english_turns:
            continue  # continuation-only: trivially paired, no boundaries
        dialogue += 1
        pairs, un = pair_segment(greek_events, english_turns, sigla)
        for u in un:
            unmapped[u] = unmapped.get(u, 0) + 1
        if pairs is None:
            mismatched.append(seg["id"])
            continue
        paired += 1
        if pairs:
            seg["turnPairs"] = pairs
    return {
        "dialogue_segments": dialogue,
        "paired": paired,
        "mismatched": mismatched,
        "unmapped": unmapped,
    }
