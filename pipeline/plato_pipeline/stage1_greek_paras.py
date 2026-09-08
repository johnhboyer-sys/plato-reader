"""Greek paragraph marks for narrated works — a STRUCTURAL donor, not a text.

The TLG export carries no paragraphing: a section's Greek is a run of numbered
lines and nothing says where one speech or paragraph ends. The narrated works
(Republic, Apology, Charmides, Letters, Lovers) pair English PARAGRAPHS against
that unparagraphed Greek, so `turns.build_para_flow` had to guess where in a
section a row's Greek begins — the guess that left Republic 450a's English
column blank while the Greek ran on (reported 2026-08-18).

Perseus's Burnet TEI for the same works marks the paragraphs Burnet printed
(`<milestone unit="para"/>`, one per speech exchange — 4,234 in the Republic).
This module imports their POSITIONS onto our TLG spine and nothing else: no
Perseus text is read into the build, and the displayed Greek stays the TLG
Burnet spine, unchanged (the repo's hard rule — the Greek edition is never
swapped). A mark is located by matching the first few words after it, accents
and apostrophes stripped, inside the section the milestone itself names — so
the search space is one section, and a match is exact rather than fuzzy.

Emits build/stage1/greek_paras.json:

    {"work", "source", "marks": [{"c": column, "n": line, "o": offset}, ...],
     "stats": {"marks", "located", "missed", "spillover"}}

Marks are in reading order, deduplicated, and every one is a real position in
the spine. Works with no donor declared emit nothing (the flow keeps its
proportional estimate).
"""
from __future__ import annotations

import re
import unicodedata
from pathlib import Path

from .config import BUILD_DIR, SOURCES_DIR, Manifest
from .stage1_common import write_json

# Milestones and their attributes. The TEI writes attributes in no fixed order
# (`unit="section" resp="Stephanus" n="327a"` in one file, n-before-unit in
# another), so parse the tag's attributes rather than positional groups.
_TAG = re.compile(r"<milestone\b([^>]*)>")
_ATTR = re.compile(r'(\w+)="([^"]*)"')
_LABEL = re.compile(r"<label\b[^>]*>.*?</label>|<label\b[^>]*>.*$", re.S)
# Elisions: the donor writes them with U+02BC (a LETTER in Unicode, so \w keeps
# it), the TLG spine with a typographic or ASCII apostrophe. Dropping all of
# them makes "ἦ δ' ὅς" and "ἦ δʼ ὅς" the same string.
_APOS = frozenset("'\u2019\u02bc\u1fbd\u0313\u0027")
# Words matched per mark: enough to be unique inside one section, short enough
# that a mark near a section end still fits before the boundary.
_PROBE_WORDS = 8
_MIN_WORDS = 3
# Raw XML read past each mark to find those words. Perseus' markup is heavy —
# a <persName> carries a 60-character key — and a two-word reply at a page end
# ("πάνυ γε." at 75e) saw only tags where its next words should have been,
# came up short of _MIN_WORDS, and was dropped before it could be looked for.
_PROBE_WINDOW = 1200


def _fold(text: str) -> tuple[str, list[int]]:
    """Accent/punctuation-folded text, plus the source index of each kept char.

    The index list is what makes this a POSITION importer: a match in the folded
    string maps straight back to a raw offset in the spine's own text."""
    out: list[str] = []
    idx: list[int] = []
    for i, ch in enumerate(text):
        if ch in _APOS:
            continue
        for c in unicodedata.normalize("NFD", ch):
            if unicodedata.combining(c):
                continue
            c = c.lower()
            if not (c.isalnum() or c.isspace()):
                c = " "
            if c.isspace() and out and out[-1] == " ":
                continue          # collapse runs, keeping index alignment
            out.append(c if not c.isspace() else " ")
            idx.append(i)
            break
    return "".join(out), idx


def _donor_path(manifest: Manifest) -> Path | None:
    greek = manifest.data.get("greek") or {}
    name = (greek.get("paragraphs") or {}).get("file")
    return SOURCES_DIR / name if name else None


def parse_marks(tei_path: Path) -> list[tuple[str, list[str]]]:
    """(section token, first words after the mark) for each paragraph milestone.

    Section state comes from the section milestones the donor already carries,
    so each paragraph mark knows which Stephanus section it opens in."""
    raw = tei_path.read_text(encoding="utf-8")
    marks: list[tuple[str, list[str]]] = []
    section: str | None = None
    for m in _TAG.finditer(raw):
        attrs = dict(_ATTR.findall(m.group(1)))
        unit = attrs.get("unit")
        if unit == "section":
            section = attrs.get("n")
        elif unit == "para" and section:
            # Probe text: strip tags so an interleaved milestone or <said> can't
            # enter the probe as markup. A speaker label goes with its tags —
            # the TLG spine lifts labels out of the line text, so "ΦΑΙΔ." is
            # not a word the probe can find; the Phaedo donor reopens a
            # labelled <said> at every page break, and a short reply at a
            # page end ("πάνυ γε.") carried the label as its second word. A
            # tag the window cuts through is dropped whole as well.
            probe = raw[m.end():m.end() + _PROBE_WINDOW]
            probe = _LABEL.sub(" ", probe)
            probe = re.sub(r"<[^>]*>?", " ", probe)
            words = _fold(probe)[0].split()[:_PROBE_WORDS]
            if len(words) >= _MIN_WORDS:
                marks.append((section, words))
    return marks


def locate(marks, segments) -> tuple[list[dict], dict]:
    """Map each mark onto the spine as {c, n, o}. Returns (marks, stats).

    A mark is searched in its own section first; a paragraph opening within a
    few words of a section end has its probe spill across the boundary, so the
    section plus its successor is tried next (`spillover`). Anything still
    unmatched is dropped — a wrong position would cut a row mid-clause, and the
    flow's proportional estimate is a better answer than a wrong anchor."""
    order = [s["column"] for s in segments]
    rank = {c: i for i, c in enumerate(order)}
    lines = {s["column"]: s.get("lines", []) for s in segments}

    def folded(cols: list[str]):
        """Folded text of `cols` joined, with a (line n, offset) per kept char.

        Space runs collapse ACROSS the line joins as well as inside a line: a
        line ending in punctuation folds to a trailing space, and a second space
        at the join would break every probe that spans a line break (the OCT
        wraps mid-sentence, so most of them do)."""
        chars, spans = [], []

        def push(ch, where):
            if ch == " " and (not chars or chars[-1] == " "):
                return
            chars.append(ch)
            spans.append(where)

        for col in cols:
            for ln in lines.get(col, []):
                f, idx = _fold(ln["text"])
                for ch, i in zip(f, idx):
                    push(ch, (col, ln["n"], i))
                push(" ", (col, ln["n"], len(ln["text"])))
        return "".join(chars), spans

    def _word_start(seg_lines: list[dict], n: int, o: int) -> int:
        """Back the offset up to the start of its whitespace-delimited word.

        The fold maps a match to the first LETTER, which can sit inside a word
        the reader treats as one unit: Letters 309b opens `"Πλάτων`, and the
        tokenizer files the token at the quote. Cutting between the quote and
        the pi splits that token off from its own text — the head row then keeps
        a token it can no longer find and prints the word an extra time. Cutting
        on the whitespace boundary keeps every token whole on one side."""
        text = next((l["text"] for l in seg_lines if l["n"] == n), "")
        while 0 < o <= len(text) and not text[o - 1].isspace():
            o -= 1
        return o

    out: list[dict] = []
    stats = {"marks": len(marks), "located": 0, "missed": 0, "spillover": 0}
    seen: set[tuple[str, int, int]] = set()
    for section, words in marks:
        if section not in rank:
            continue                       # a section this book doesn't hold
        nxt = order[rank[section] + 1:rank[section] + 2]
        scopes = [([section], False)] + ([([section] + nxt, True)] if nxt else [])
        placed = False
        for scope, spill in scopes:
            hay, spans = folded(scope)
            hit = -1
            for k in range(len(words), _MIN_WORDS - 1, -1):
                hit = hay.find(" ".join(words[:k]))
                if hit != -1:
                    break
            if hit == -1:
                continue
            col, n, o = spans[hit]
            o = _word_start(lines[col], n, o)
            if (col, n, o) not in seen:
                seen.add((col, n, o))
                out.append({"c": col, "n": n, "o": o})
            stats["located"] += 1
            if spill:
                stats["spillover"] += 1
            placed = True
            break
        if not placed:
            stats["missed"] += 1
    out.sort(key=lambda m: (rank.get(m["c"], -1), m["n"], m["o"]))
    return out, stats


def run(manifest: Manifest, spine: dict) -> Path | None:
    """Write build/stage1/greek_paras.json, or None when no donor is declared.

    Stale output from a previous work's build is removed either way — stage1
    scratch is single-work, and a leftover file would hand the next work another
    text's paragraphing."""
    out_path = BUILD_DIR / "stage1" / "greek_paras.json"
    out_path.unlink(missing_ok=True)
    donor = _donor_path(manifest)
    if donor is None:
        return None
    if not donor.exists():
        raise FileNotFoundError(f"greek.paragraphs donor missing: {donor}")
    located, stats = locate(parse_marks(donor), spine["segments"])
    out_path.parent.mkdir(parents=True, exist_ok=True)
    write_json(out_path, {"work": manifest.work_id, "source": donor.name,
                          "marks": located, "stats": stats})
    return out_path
