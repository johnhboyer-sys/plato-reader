"""Score section placement in an alternate translation against a gold sample.

Compares the reader's current proportional placement (a port of
shared/lib/sect-ticks.ts projectTicks) with align_sections.place_sections.

    python tools/eval_section_match.py <dist_dir> <gold_sample.json> <answers.jsonl>...

gold_sample.json: [{work, book, turn, c, o, ref, alt}, ...] (index = item id)
answers.jsonl: {"item": n, "start": "<verbatim words>" | null, "confidence": ...}
"""
from __future__ import annotations

import json
import re
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from plato_pipeline.align_sections import build_idf, place_sections  # noqa: E402
from plato_pipeline.align_turns import _row_refs  # noqa: E402

TRANS = "jowett"


# ── port of projectTicks (shared/lib/sect-ticks.ts) ──────────────────────────
def project_ticks(ref: str, ticks: list[tuple[int, str]], alt: str) -> dict[str, int]:
    if not ticks or not ref or not alt.strip():
        return {}
    ws = " \t\n\r\f"
    sent = {0, len(alt)}
    for i, ch in enumerate(alt):
        if ch in ".?!;":
            j = i + 1
            while j < len(alt) and alt[j] in "'\"”’»)]}":
                j += 1
            while j < len(alt) and alt[j] in ws:
                j += 1
            sent.add(j)
    word = {0, len(alt)} | {i for i in range(1, len(alt)) if alt[i - 1] in ws and alt[i] not in ws}
    sent, word = sorted(sent), sorted(word)
    allb = sorted(set(sent) | set(word))
    max_snap = 0.25 * (len(alt) / len(ticks))
    out, prev = {}, -1
    nearest = lambda bs, t: min(bs, key=lambda b: (abs(b - t), b))  # noqa: E731
    for o, c in ticks:
        p = 0 if o <= 0 else round(o / len(ref) * len(alt))
        p = max(0, min(p, len(alt)))
        ns = nearest(sent, p)
        s = ns if abs(ns - p) <= max_snap else nearest(word, p)
        if s <= prev:
            nxt = next((b for b in allb if b > prev), None)
            if nxt is None:
                continue
            s = nxt
        if s <= prev:
            continue
        out[c] = s
        prev = s
    return out


def main() -> None:
    dist, sample_p, *answer_ps = sys.argv[1:]
    sample = json.loads(Path(sample_p).read_text())
    answers = {}
    for ap in answer_ps:
        for line in Path(ap).read_text().splitlines():
            if line.strip():
                a = json.loads(line)
                answers[a["item"]] = a
    idf_cache: dict[str, dict] = {}
    rows = []
    for n, it in enumerate(sample):
        a = answers.get(n)
        if not a or not a.get("start"):
            continue
        alt = it["alt"]
        hits = [m.start() for m in re.finditer(re.escape(a["start"]), alt)]
        if not hits:
            print(f"item {n}: gold start not found verbatim: {a['start']!r}")
            continue
        prop_guess = it["o"] / len(it["ref"]) * len(alt)
        gold = min(hits, key=lambda h: abs(h - prop_guess))
        book = json.loads((Path(dist) / it["work"] / it["book"]).read_text())
        ref, es = _row_refs(book["turnFlow"])[it["turn"]]
        if it["work"] not in idf_cache:
            docs = []
            for bp in sorted((Path(dist) / it["work"]).glob("book-*.json")):
                for tt in json.loads(bp.read_text())["turnFlow"]["turns"]:
                    docs += [x for x in (tt.get("e"), ((tt.get("alt") or {}).get(TRANS) or {}).get("e")) if x]
            idf_cache[it["work"]] = build_idf(docs)
        prop = project_ticks(ref, es, alt).get(it["c"])
        placed = {p.c: p for p in place_sections(ref, es, alt, idf_cache[it["work"]])}
        m = placed.get(it["c"])
        rows.append(dict(n=n, work=it["work"], c=it["c"], conf=a.get("confidence"),
                         prop=None if prop is None else abs(prop - gold),
                         match=None if m is None else abs(m.o - gold)))

    def summary(key: str, sub: list[dict]) -> str:
        errs = [r[key] for r in sub if r[key] is not None]
        if not errs:
            return "n/a"
        w = lambda k: sum(e <= k for e in errs) / len(errs)  # noqa: E731
        return (f"median {statistics.median(errs):.0f}c  exact {w(0):.0%}  "
                f"≤30c {w(30):.0%}  ≤60c {w(60):.0%}  ≤150c {w(150):.0%}  (n={len(errs)})")

    for label, sub in [("all", rows), ("high-confidence gold", [r for r in rows if r["conf"] == "high"])]:
        print(f"[{label}]")
        print("  proportional:", summary("prop", sub))
        print("  matched:     ", summary("match", sub))
    worse = sorted((r for r in rows if r["match"] is not None and r["prop"] is not None and r["match"] > r["prop"] + 30),
                   key=lambda r: r["prop"] - r["match"])
    print("matched worse than proportional by >30c:", [(r["n"], r["work"], r["c"], r["prop"], r["match"]) for r in worse])


if __name__ == "__main__":
    main()
