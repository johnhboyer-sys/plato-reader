"""Measure rows whose English is out of step with their Greek.

A row is out of step when the translation of the END of one row's Greek sits at
the START of the next row's English (the English row break comes late), or the
other way round (it comes early). Charmides 153a1/153b7 is the reported case:
Chaerephon's question closes Greek row 153a1 but opens English row 153b7.

Method (built data only, no pipeline state): per book, split each row's Greek
at . and ; and its English at . ? !, so every row boundary is a sentence
boundary on both sides, then sentence-align the whole book with a monotone
dynamic programme (Gale-Church length cost, 1:1 up to 3:1 / 1:3 beads, minus a
bonus for the English words found among the Greek tokens' glosses, proper
names by consonant skeleton, and the first/third-person attribution formulae).
A row boundary the alignment path does not pass through is a candidate; the
gap is its shift in sentences: +n means B's first n English sentences belong
with A's Greek (the 153a1/153b7 case), -n means A's last n belong with B's.
A candidate is reported only if re-cutting the English there also makes the
two rows together agree strictly better with their Greek (row-level length + gloss cost), which
drops the short-row misreads (one Greek reply rendered as two sentences).

Precision, hand-checked 2026-11-17: 13 of 15 random flags real on the live
data (Republic, Symposium, Letters, Apology, Phaedo), all 9 checked in a
spine-mode Charmides/Lovers build. Recall is lower: the row-level check
drops some real one-word replies moved between long rows, so the counts
are a floor. It does not reuse `para_align.match_section`, the matcher that
cuts the spine-mode works (only its `stem` and `fold` helpers).

    pipeline/.venv/bin/python tools/measure_row_drift.py <data dir> [Work ...]
        [--json out.json] [--examples N]
"""

from __future__ import annotations

import argparse
import glob
import json
import math
import os
import re
import sys
from collections import Counter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from plato_pipeline.para_align import fold, stem  # noqa: E402

# Narrated works: para flow (Apology, Charmides, Letters, Lovers), spine mode
# (Republic, Phaedo, Symposium, Timaeus, Critias, Menexenus, Epinomis,
# Clitophon), and the narrated dialogues left on the dialogue flow.
DEFAULT_WORKS = [
    "Apology", "Charmides", "Letters", "Lovers",
    "Republic", "Phaedo", "Symposium", "Timaeus", "Critias", "Menexenus",
    "Epinomis", "Clitophon",
    "Lysis", "Parmenides", "Protagoras", "Euthydemus",
]

_EN_SENT = re.compile(r"(?<=[.?!])[’”\"')\]]*\s+(?=[(“‘\"'A-Z—])")
_EN_WORD = re.compile(r"[A-Za-z]+")
_STOP = set("""a an the and or but of to in on at by for with from as is are was
were be been being it its this that these those he she they them his her their
i me my we us our you your not no so if then than there here what which who whom
whose when where how why all any some such one do does did have has had will
would shall should can could may might must said say says replied asked also
very more most only too just upon into out up about over even yet indeed""".split())

_GK_FIRST = re.compile(r"ην δ'\s?εγω|\bειπον\b|\bεφην\b|ην δε εγω")
_GK_THIRD = re.compile(r"\bεφη\b|η δ'\s?ος|\bεφατο\b")
_EN_FIRST = re.compile(r"\b(?:said i|i said|i replied|i asked|i answered"
                       r"|i rejoined|i inquired|i went on|i continued)\b", re.I)
_EN_THIRD = re.compile(r"\b(?:he said|said he|he replied|he asked|she said"
                       r"|said she|he answered|he rejoined|he went on"
                       r"|he continued|he cried|he exclaimed)\b", re.I)

_TRANSLIT = str.maketrans({
    "β": "b", "γ": "g", "δ": "d", "ζ": "z", "θ": "t", "κ": "c", "λ": "l",
    "μ": "m", "ν": "n", "ξ": "x", "π": "p", "ρ": "r", "σ": "s", "ς": "s",
    "τ": "t", "φ": "p", "χ": "c", "ψ": "ps",
})


def _skeleton(word: str, greek: bool) -> str | None:
    """First three consonants of a proper name, h dropped, k/ch → c, ph → p,
    th → t: Χαιρεφῶν and Chaerephon both give 'crp'."""
    if greek:
        w = fold(word).translate(_TRANSLIT)
    else:
        w = word.lower().replace("ph", "p").replace("th", "t") \
            .replace("ch", "c").replace("k", "c").replace("h", "")
    cons = re.sub(r"[^bcdfgjlmnpqrstvwxz]", "", w)
    return cons[:3] if len(cons) >= 3 else None


def _greek_bag(text: str, tokens: list[dict], analyses: dict) -> list[str]:
    words: list[str] = []
    for t in tokens:
        a = analyses.get(t.get("k") or "")
        gloss = a[0].get("gloss", "") if a else ""
        if gloss:
            words += [stem(w) for w in _EN_WORD.findall(gloss)
                      if w.lower() not in _STOP]
        surf = t.get("t", "")
        if surf[:1].isupper() and not gloss:
            sk = _skeleton(surf, greek=True)
            if sk:
                words.append("NAME_" + sk)
    f = fold(text)
    words += ["CUE_1"] * len(_GK_FIRST.findall(f))
    words += ["CUE_3"] * len(_GK_THIRD.findall(f))
    return words


def _english_bag(text: str, names: set[str]) -> list[str]:
    words: list[str] = []
    for i, w in enumerate(_EN_WORD.findall(text)):
        if w[0].isupper() and w.lower() not in _STOP:
            sk = _skeleton(w, greek=False)
            if sk and sk in names:
                words.append("NAME_" + sk)
                continue
        if w.lower() not in _STOP:
            words.append(stem(w))
    words += ["CUE_1"] * len(_EN_FIRST.findall(text))
    words += ["CUE_3"] * len(_EN_THIRD.findall(text))
    return words


def _sentences(text: str) -> list[str]:
    return [s for s in _EN_SENT.split(text) if s.strip()]


def load_rows(path: str) -> list[dict]:
    """Each turnFlow row with its Greek text and tokens (pin to next pin)."""
    d = json.load(open(path))
    tf = d.get("turnFlow")
    if not tf:
        return []
    flat, idx = [], {}
    for seg in d["segments"]:
        for l in seg.get("greek", []):
            idx[(seg["column"], l["n"])] = len(flat)
            flat.append((seg["column"], l["text"], l.get("tokens", [])))
    pins = []
    for t in tf["turns"]:
        g = t.get("g")
        pins.append((idx[(g["c"], g["n"])], g.get("o", 0))
                    if g and (g["c"], g["n"]) in idx else None)
    rows = []
    for k, t in enumerate(tf["turns"]):
        if pins[k] is None:
            continue
        li, o = pins[k]
        nxt = next((p for p in pins[k + 1:] if p is not None), None)
        end_li, end_o = nxt if nxt else (len(flat) - 1, None)
        parts, toks = [], []
        for i in range(li, end_li + 1):
            _, txt, tk = flat[i]
            a = o if i == li else 0
            b = len(txt) if (i < end_li or end_o is None) else end_o
            if b <= a:
                continue
            parts.append(txt[a:b])
            toks += [x for x in tk if a <= x["o"] < b]
        # The reader prints `e` and then any stacked one-sided speeches
        # (`sub`); Lysis' section-anchored rows carry only `sub`.
        eng = " ".join([t.get("e") or ""]
                       + [x.get("e") or "" for x in t.get("sub") or []])
        rows.append({"g": t["g"], "e": eng.strip(), "greek": " ".join(parts),
                     "tokens": toks, "book": d.get("book")})
    return rows


_GK_SPLIT = re.compile(r"(?<=[.;\u037e])\s+")

# Bead priors (cost) for the sentence alignment: (greek, english) sentences.
_BEADS = {(1, 1): 0.0, (1, 2): 1.5, (2, 1): 1.5, (2, 2): 3.0,
          (1, 3): 3.5, (3, 1): 3.5, (1, 0): 4.5, (0, 1): 4.5}
W_LEX = 4.0      # lexical bonus weight
S2 = 6.8         # Gale-Church variance per char
BAND = 60        # sentences either side of the diagonal
CONFIRM = 0.0    # row-level cost a re-cut must save to be reported


def _split(text: str, rx: re.Pattern) -> list[str]:
    return [p for p in rx.split(text) if p.strip()]


def _tokens_for(row: dict) -> list[list[dict]]:
    """Greek tokens per Greek sentence, by order (token offsets are per line,
    so split the row's token list in proportion to word counts)."""
    out, k = [], 0
    toks = row["tokens"]
    pieces = _split(row["greek"], _GK_SPLIT)
    total = sum(len(p.split()) for p in pieces) or 1
    for p in pieces:
        n = round(len(p.split()) * len(toks) / total)
        out.append(toks[k:k + n])
        k += n
    if out and k < len(toks):
        out[-1] = out[-1] + toks[k:]
    return out


def align_book(rows: list[dict], analyses: dict, names: set[str],
               idf: dict) -> list[dict]:
    """Sentence-align one book and report each row boundary's English shift."""
    G, E = [], []                       # (text, bag) per sentence
    gstart, estart = [], []             # row k starts at sentence index
    for r in rows:
        gstart.append(len(G))
        estart.append(len(E))
        pieces = _split(r["greek"], _GK_SPLIT)
        for p, tk in zip(pieces, _tokens_for(r)):
            G.append((p, Counter(_greek_bag(p, tk, analyses))))
        for s in _sentences(r["e"]):
            E.append((s, _english_bag(s, names)))
    nG, nE = len(G), len(E)
    if not nG or not nE:
        return []
    c = sum(len(e[0]) for e in E) / max(1, sum(len(g[0]) for g in G))

    def lex(gi0, gi1, ej0, ej1) -> float:
        bag = [w for _, b in E[ej0:ej1] for w in b]
        if not bag:
            return 0.0
        side = Counter()
        for _, b in G[gi0:gi1]:
            side.update(b)
        tot = sum(idf.get(w, 1.0) for w in bag)
        return sum(idf.get(w, 1.0) for w in bag if side.get(w)) / tot

    def cost(i0, di, j0, dj) -> float:
        lg = sum(len(G[k][0]) for k in range(i0, i0 + di))
        le = sum(len(E[k][0]) for k in range(j0, j0 + dj))
        d = (le - c * lg) / math.sqrt(max(1.0, lg) * S2)
        lx = lex(i0, i0 + di, j0, j0 + dj) if di and dj else 0.0
        return _BEADS[(di, dj)] + d * d / 2 - W_LEX * lx

    def row_cost(i0, i1, j0, j1) -> float:
        lg = sum(len(G[k][0]) for k in range(i0, i1))
        le = sum(len(E[k][0]) for k in range(j0, j1))
        d = (le - c * lg) / math.sqrt(max(1.0, lg) * S2)
        return d * d / 2 - W_LEX * lex(i0, i1, j0, j1) * 2

    INF = float("inf")
    dp = {(0, 0): 0.0}
    bk = {}
    for i in range(nG + 1):
        mid = round(i * nE / nG)
        for j in range(max(0, mid - BAND), min(nE, mid + BAND) + 1):
            if (i, j) == (0, 0):
                continue
            best, arg = INF, None
            for (di, dj), _ in _BEADS.items():
                p = (i - di, j - dj)
                if p[0] < 0 or p[1] < 0 or p not in dp:
                    continue
                v = dp[p] + cost(p[0], di, p[1], dj)
                if v < best:
                    best, arg = v, p
            if arg is not None:
                dp[(i, j)] = best
                bk[(i, j)] = arg
    if (nG, nE) not in dp:
        return []
    path = [(nG, nE)]
    while path[-1] != (0, 0):
        path.append(bk[path[-1]])
    path.reverse()

    out = []
    for k in range(1, len(rows)):
        gi, ej = gstart[k], estart[k]
        if gi in (0, nG) or not rows[k]["e"] or not rows[k - 1]["e"]:
            continue
        on = [j for i, j in path if i == gi]
        if on:
            lo, hi = min(on), max(on)
        else:   # gi falls inside a bead: anywhere within it is consistent
            prev = max((p for p in path if p[0] < gi))
            nxt = min((p for p in path if p[0] > gi))
            lo, hi = prev[1], nxt[1]
            if lo < ej < hi:
                continue
        if lo <= ej <= hi:
            continue
        shift = lo - ej if ej < lo else hi - ej     # +: B's head belongs to A
        # Confirm at row level: re-cutting the English must make the two rows
        # together agree strictly better with their Greek (length, and the words their English
        # shares with it). The sentence path alone over-reads short rows,
        # where one Greek reply is two English sentences ("Why not? I said:
        # only he must come.").
        ga0, gb1 = gstart[k - 1], gstart[k + 1] if k + 1 < len(rows) else nG
        ea0, eb1 = estart[k - 1], estart[k + 1] if k + 1 < len(rows) else nE
        cut = ej + shift
        if not ea0 < cut < eb1:
            continue
        before = row_cost(ga0, gi, ea0, ej) + row_cost(gi, gb1, ej, eb1)
        after = row_cost(ga0, gi, ea0, cut) + row_cost(gi, gb1, cut, eb1)
        if before - after <= CONFIRM:
            continue
        if shift > 0:
            moved = [E[j][0] for j in range(ej, ej + shift)]
        else:
            moved = [E[j][0] for j in range(ej + shift, ej)]
        out.append({"a": rows[k - 1]["g"], "b": rows[k]["g"],
                    "book": rows[k]["book"], "shift": shift,
                    "moved": " ".join(moved)[:240],
                    "moved_chars": sum(len(s) for s in moved),
                    "greek_a_tail": rows[k - 1]["greek"][-160:],
                    "greek_b_head": rows[k]["greek"][:160]})
    return out


def measure_work(data_dir: str, work: str) -> dict:
    analyses = json.load(open(os.path.join(data_dir, work, "analyses.json")))
    books = []
    for f in sorted(glob.glob(os.path.join(data_dir, work, "book-*.json"))):
        r = load_rows(f)
        if r:
            books.append(r)
    nrows = sum(len(b) for b in books)
    if not nrows:
        return {"work": work, "rows": 0, "boundaries": 0, "flags": []}

    # Names the Greek side actually carries (unglossed capitals), so an
    # English capital that is no name in this work never becomes one.
    names = set()
    for b in books:
        for r in b:
            for t in r["tokens"]:
                s = t.get("t", "")
                a = analyses.get(t.get("k") or "")
                if s[:1].isupper() and not (a and a[0].get("gloss")):
                    sk = _skeleton(s, greek=True)
                    if sk:
                        names.add(sk)

    df: Counter = Counter()
    nsent = 0
    for b in books:
        for r in b:
            for s in _sentences(r["e"]):
                df.update(set(_english_bag(s, names)))
                nsent += 1
    idf = {w: math.log((nsent + 1) / (c + 1)) + 1 for w, c in df.items()}
    idf["CUE_1"] = idf["CUE_3"] = 2.5

    flags = []
    bounds = 0
    echars = sum(len(r["e"]) for b in books for r in b)
    for b in books:
        bounds += sum(1 for k in range(1, len(b)) if b[k]["e"] and b[k - 1]["e"])
        flags += align_book(b, analyses, names, idf)
    return {"work": work, "rows": nrows, "boundaries": bounds, "flags": flags,
            "english_chars": echars}


def _ref(g: dict) -> str:
    return f"{g['c']}{g['n']}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("data_dir")
    ap.add_argument("works", nargs="*")
    ap.add_argument("--json")
    ap.add_argument("--examples", type=int, default=3)
    args = ap.parse_args()
    works = args.works or DEFAULT_WORKS
    results = [measure_work(args.data_dir, w) for w in works]
    print(f"{'work':<12}{'rows':>6}{'bounds':>8}{'flagged':>9}{'late(+)':>9}"
          f"{'early(-)':>9}{'%':>7}{'misplaced':>11}")
    for r in results:
        late = sum(1 for f in r["flags"] if f["shift"] > 0)
        early = len(r["flags"]) - late
        pct = 100 * len(r["flags"]) / r["boundaries"] if r["boundaries"] else 0
        # Share of the English that sits in the wrong row: fairer than the
        # flag rate across row sizes (four small rows each a sentence off
        # misplace less than one long row eight sentences off).
        mis = sum(f["moved_chars"] for f in r["flags"])
        print(f"{r['work']:<12}{r['rows']:>6}{r['boundaries']:>8}"
              f"{len(r['flags']):>9}{late:>9}{early:>9}{pct:>6.1f}%"
              f"{100 * mis / r.get('english_chars', 1) if r.get('english_chars') else 0:>10.1f}%")
    for r in results:
        if not r["flags"] or not args.examples:
            continue
        print(f"\n## {r['work']}")
        for f in sorted(r["flags"], key=lambda f: -abs(f["shift"]))[:args.examples]:
            print(f"  {_ref(f['a'])} | {_ref(f['b'])}  shift {f['shift']:+d}"
                  f"\n    moved: {f['moved']}")
    if args.json:
        with open(args.json, "w") as fh:
            json.dump(results, fh, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
