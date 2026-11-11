"""A work's Greek as one running text, for the search page's running-text mode.

Stage 6 writes search/running.json:

  {"v": 1, "token_count": N, "text": "..."}

`text` is every stage3 token of the work in document order, each as its Beta
Code letters (lowercase, the search indexes' letters) with its diacritics
kept after each letter in one fixed order, and between two tokens the
punctuation the page prints there. The two never share a character:

  token  a-z  '  ( ) / \\ = | +     (letters, elision, Beta Code marks)
  gap    space , . ; : " -          (: is the raised dot, " every quote mark)

so the n-th run of token characters IS global token n: the offset map back to
segment, line and token is offsets.json, which counts the same tokens in the
same order. Editorial sigla ([ ] < > † *) and parentheses (which Beta Code
spends on breathings) are not text and are left out. The client strips the
marks for an accent-blind search and turns each gap into one space for a
search that ignores punctuation (shared/lib/running-text.ts mirrors
token_spans below).
"""

from __future__ import annotations

import re
import unicodedata

from .beta import _BASE, _MARKS
from .stage3_tokenize import _APOSTROPHES, _clean

TOKEN_CHARS = frozenset("abcdefghijklmnopqrstuvwxyz'()/\\=|+")
GAP_CHARS = frozenset(' ,.;:"-')

# The order a letter's marks are written in, whatever order they arrived in:
# breathing, diaeresis, accent, iota subscript (ἔ e)/, ΐ i+/, ᾗ h(=|).
_MARK_RANK = {")": 0, "(": 0, "+": 1, "/": 2, "\\": 2, "=": 2, "|": 3}

_GAP_MAP = {
    ",": ",", ".": ".", ";": ";", ";": ";",
    "·": ":", "·": ":", ":": ":",
    '"': '"', "“": '"', "”": '"', "‘": '"', "’": '"',
    "«": '"', "»": '"', "'": '"', "᾽": '"', "ʼ": '"',
    "—": "-", "–": "-", "-": "-",
}

_RUN = re.compile(r"[^\s—]+")  # stage3's word runs


def token_beta(surface: str) -> str:
    """A token's Beta Code with its marks, each letter's marks in _MARK_RANK
    order. Grave stays grave: this is the text as printed, not a lookup key."""
    units: list[list[str]] = []
    for ch in unicodedata.normalize("NFD", surface):
        if ch in _APOSTROPHES:
            units.append(["'"])
            continue
        low = ch.lower()
        if low in _BASE:
            units.append([_BASE[low]])
        elif "a" <= low <= "z":  # a Beta Code letter is its own fold, as in greekFold
            units.append([low])
        elif ch in _MARKS and units and units[-1][0] != "'":
            if _MARKS[ch]:
                units[-1].append(_MARKS[ch])
        # anything else (a stray symbol) is not part of the word
    out = "".join(u[0] + "".join(sorted(u[1:], key=_MARK_RANK.__getitem__)) for u in units)
    if not any(c.isalpha() for c in out):
        raise ValueError(f"running text: token {surface!r} has no Greek letter")
    return out


def gap_text(raw: str) -> str:
    """The punctuation between two words as the running text keeps it: every
    space run one space, sigla and parentheses gone."""
    kept = "".join(" " if ch.isspace() else _GAP_MAP.get(ch, "") for ch in raw)
    return re.sub(r" {2,}", " ", kept)


def _letterish(ch: str) -> bool:
    return unicodedata.category(ch)[0] in "LM" and ch not in _APOSTROPHES


def line_pieces(text: str) -> list[tuple[str, str]]:
    """A printed line as ('gap', raw) and ('tok', surface) pieces, the tokens
    exactly as stage3 cut them (its own _clean, on its own runs)."""
    out: list[tuple[str, str]] = []
    pos = 0
    for m in _RUN.finditer(text):
        out.append(("gap", text[pos:m.start()]))
        pos = m.end()
        raw = m.group(0)
        token, _ = _clean(raw)
        if not token:
            out.append(("gap", raw))
            continue
        letters = [i for i, ch in enumerate(raw) if _letterish(ch)]
        first, last = letters[0], letters[-1] + 1
        if token[-1] in _APOSTROPHES and last < len(raw) and raw[last] in _APOSTROPHES:
            last += 1
        # Sigla inside the word (ἀ<μφι>γνοεῖν) are dropped with the word's own
        # span; what stands before and after it is punctuation.
        out += [("gap", raw[:first]), ("tok", token), ("gap", raw[last:])]
    out.append(("gap", text[pos:]))
    return out


def build_running_text(segments: list[dict], spine: dict) -> str:
    """The work's running text from stage3's segments and the spine's lines.
    Raises if the spine's words do not cut into stage3's tokens one for one,
    since every token after a slip would then be cited and marked wrongly."""
    line_text = {
        (seg["id"], line["n"]): line["text"]
        for seg in spine["segments"]
        for line in seg["lines"]
    }
    parts: list[str] = []
    gap = ""
    for seg in segments:
        for line in seg["lines"]:
            if not line["tokens"]:
                continue
            want = [tok["t"] for tok in line["tokens"]]
            text = line_text.get((seg["id"], line["n"]))
            if text is None:
                raise ValueError(f"running text: {seg['id']} line {line['n']} is not in the spine")
            got = []
            gap += " "
            for kind, value in line_pieces(text):
                if kind == "gap":
                    gap += value
                    continue
                got.append(value)
                if parts:
                    parts.append(re.sub(r" {2,}", " ", gap_text(gap)) or " ")
                parts.append(token_beta(value))
                gap = ""
            if got != want:
                raise ValueError(
                    f"running text: {seg['id']} line {line['n']} cuts into {got}, stage3 has {want}"
                )
    return "".join(parts)


def token_spans(text: str) -> list[tuple[int, int]]:
    """Each token's [start, end) in the running text: its runs of token
    characters, in order. The n-th span is global token n."""
    spans: list[tuple[int, int]] = []
    start = -1
    for i, ch in enumerate(text):
        if ch in TOKEN_CHARS:
            if start < 0:
                start = i
        elif ch in GAP_CHARS:
            if start >= 0:
                spans.append((start, i))
                start = -1
        else:
            raise ValueError(f"running text: unexpected character {ch!r} at {i}")
    if start >= 0:
        spans.append((start, len(text)))
    return spans
