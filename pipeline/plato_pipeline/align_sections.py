"""Place Stephanus section starts inside an alternate translation's turns.

The turn aligner (``align_turns.py``) pairs each alternate-translation turn
(Jowett) with a reference turn (the Loeb), whose section starts are measured
(``es``, from the Perseus TEI). Inside a paired turn the alternate has no
marks, so this module finds, for each reference section start, the word in the
alternate where the same content begins.

The method is aristotle-reader's Ross-against-Rackham aligner
(``align/aligner.py``), scoped to one turn instead of one chapter: both sides
are English, so each reference boundary is fingerprinted by the words just
after it and just before it, every word start in the alternate is scored by
TF-IDF cosine against that fingerprint, and an order-keeping pass picks one
start per section. The reference's own position (proportional placement) is
a weak prior that breaks ties and holds a tick where the words say nothing.

Pure functions; no I/O. ``align_turns.py`` calls :func:`place_sections`.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass

_WORD = re.compile(r"[A-Za-z]+")
_WORD_SPAN = re.compile(r"\S+")

# Fingerprint width, in reference words, on each side of the boundary.
WIN = 12
# Weight of the proportional-position prior: score falls by PRIOR at a
# distance of one average section length from the proportional position.
PRIOR = 0.25
# Bonus for a candidate that opens a sentence / a clause.
SENT_BONUS = 0.08
CLAUSE_BONUS = 0.04
# A tick whose best score beats the proportional candidate by less than this
# keeps the proportional (snapped) position instead.
MIN_GAIN = 0.0


@dataclass
class Placed:
    o: int
    c: str
    score: float
    matched: bool   # False = fell back to the proportional position


def _norm(w: str) -> str:
    w = w.lower()
    # crude plural / possessive fold so "gods"/"god", "men's"/"men" meet
    if len(w) > 4 and w.endswith("s") and not w.endswith("ss"):
        w = w[:-1]
    return w


def tokens(text: str) -> list[str]:
    return [_norm(w) for w in _WORD.findall(text)]


def build_idf(docs: list[str]) -> dict[str, float]:
    """IDF over a work's turns (both translations), so common words weigh little."""
    n = len(docs)
    df: Counter[str] = Counter()
    for d in docs:
        df.update(set(tokens(d)))
    return {t: math.log((n + 1) / (c + 1)) + 1.0 for t, c in df.items()}


def _vec(toks: list[str], idf: dict[str, float], default: float) -> dict[str, float]:
    tf = Counter(toks)
    v = {t: c * idf.get(t, default) for t, c in tf.items()}
    norm = math.sqrt(sum(x * x for x in v.values())) or 1.0
    return {t: x / norm for t, x in v.items()}


def _cos(a: dict[str, float], b: dict[str, float]) -> float:
    if len(a) > len(b):
        a, b = b, a
    return sum(x * b.get(t, 0.0) for t, x in a.items())


def _words(text: str) -> list[tuple[int, str]]:
    """(char offset, word) for every whitespace-delimited word."""
    return [(m.start(), m.group()) for m in _WORD_SPAN.finditer(text)]


def _boundary_kind(text: str, off: int) -> int:
    """2 = opens a sentence, 1 = opens a clause, 0 = plain word."""
    j = off - 1
    while j >= 0 and text[j].isspace():
        j -= 1
    while j >= 0 and text[j] in "'\"”’)]":
        j -= 1
    if j < 0:
        return 2
    if text[j] in ".?!":
        return 2
    if text[j] in ";:,—-":
        return 1
    return 0


def place_sections(ref: str, ref_es: list[tuple[int, str]], alt: str,
                   idf: dict[str, float]) -> list[Placed]:
    """One placement per reference section start, strictly increasing.

    ``ref_es`` offsets index ``ref``; returned offsets index ``alt``. A start
    at reference offset 0 maps to 0 (and only the first start can be at 0). A tick that cannot get a strictly later
    word start than its predecessor is dropped (as ``projectTicks`` does).
    """
    if not ref_es or not ref.strip() or not alt.strip():
        return []
    default = max(idf.values()) if idf else 1.0
    rw = _words(ref)
    aw = _words(alt)
    if not aw:
        return []
    ratio = len(aw) / max(1, len(rw))
    awin = max(3, round(WIN * ratio))
    a_starts = [o for o, _ in aw]
    a_toks = [tokens(w) for _, w in aw]

    def ref_index(o: int) -> int:
        # first reference word starting at or after o
        for k, (wo, _) in enumerate(rw):
            if wo >= o:
                return k
        return len(rw)

    def span_vec(toks_list, a, b):
        flat = [t for ts in toks_list[max(0, a):max(0, b)] for t in ts]
        return _vec(flat, idf, default)

    r_toks = [tokens(w) for _, w in rw]
    avg_sec = len(aw) / (len(ref_es) + 1)
    a_after = [span_vec(a_toks, j, j + awin) for j in range(len(aw))]
    a_before = [span_vec(a_toks, j - awin, j) for j in range(len(aw))]
    bonuses = []
    for j in range(len(aw)):
        kind = _boundary_kind(alt, a_starts[j])
        bonuses.append(SENT_BONUS if kind == 2 else CLAUSE_BONUS if kind == 1 else 0.0)
    rows: list[list[float]] = []
    for o, _c in ref_es:
        k = ref_index(o)
        after = span_vec(r_toks, k, k + WIN)
        before = span_vec(r_toks, k - WIN, k)
        prop = k / max(1, len(rw)) * len(aw)
        row = []
        for j in range(len(aw)):
            s_after = _cos(after, a_after[j])
            s_before = _cos(before, a_before[j]) if k > 0 else 0.0
            bonus = bonuses[j]
            prior = PRIOR * abs(j - prop) / max(1.0, avg_sec)
            row.append(s_after + s_before + bonus - prior)
        rows.append(row)

    # Order-keeping pass: strictly increasing word index, max total score.
    # A tick at reference offset 0 is pinned to alternate word 0.
    T, J = len(rows), len(aw)
    NEG = -1e18
    dp = [[NEG] * J for _ in range(T)]
    bk = [[-1] * J for _ in range(T)]
    for i in range(T):
        pinned = ref_es[i][0] <= 0
        best, arg = NEG, -1
        for j in range(J):
            if i > 0 and j > 0 and dp[i - 1][j - 1] > best:
                best, arg = dp[i - 1][j - 1], j - 1
            if pinned and j != 0:
                continue
            if i == 0:
                dp[i][j] = rows[i][j]
            elif best > NEG:
                dp[i][j] = rows[i][j] + best
                bk[i][j] = arg
    end = max(range(J), key=lambda j: dp[T - 1][j])
    if dp[T - 1][end] <= NEG / 2:
        # more ticks than words: place what fits on successive word starts,
        # keeping a reference offset-0 start at 0
        T = min(T, J)
        return [Placed(0 if i == 0 else a_starts[i], ref_es[i][1], 0.0, False)
                for i in range(T)]
    path = [0] * T
    j = end
    for i in range(T - 1, -1, -1):
        path[i] = j
        j = bk[i][j]
    out = []
    for i, j in enumerate(path):
        out.append(Placed(a_starts[j] if j > 0 else 0, ref_es[i][1],
                          round(rows[i][j], 4), True))
    return out
