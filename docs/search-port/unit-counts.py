"""Counting units for Plato's search, measured on the built corpus (build/dist).

Aristotle's search now counts chapters. Plato's dialogues have none
(chapter_bounds is empty in every work), so this measures the candidates:
the Stephanus section (70a), the Stephanus page (70), the reader's row (a
speech in a dialogue, a paragraph in a narrated work), and the book (the
whole dialogue for one-book works; what the ported code would fall back to).

For each search it counts, per unit: units with the Greek, with the English,
with both anywhere in the unit ("and"), Greek only, English only, either
("or"); plus Greek hits (words). Greek hits come from each work's
search/greek_lemma.json (all forms of the lemma). English comes from the main
translation only (search/english.json, John's one-translation-per-work rule),
with the search's "any form" spellings listed in SEARCHES. Row placement of
English uses each row's own English text (turnFlow), split as stage6 splits.

Rows are approximate in two ways (Codex review, 16 Nov): a Greek-bearing turn
the reader folds into the row before it (p false, stacked speeches only) is
counted as a row of its own, and Greek before a book's first row is counted
with that row rather than as a leading row.

    pipeline/.venv/bin/python docs/search-port/unit-counts.py build/dist > docs/search-port/unit-counts.json
"""
import json
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipeline"))
from plato_pipeline.stage6_search import english_words  # noqa: E402

SEARCHES = [
    {"name": "ἀρετή + virtue", "lemma": "areth", "english": ["virtue", "virtue's", "virtues"]},
    {"name": "ψυχή + soul", "lemma": "yuxh", "english": ["soul", "soul's", "souls"]},
    {"name": "δικαιοσύνη + justice", "lemma": "dikaiosunh", "english": ["justice", "justice's", "justices"]},
]
UNITS = ["section", "page", "row", "book"]


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def page_of(column):
    return column.rstrip("abcde")


def work_model(wdir):
    """Everything the counts need for one work: each segment's book, column
    and global token start; each row's global Greek start and English text."""
    off = load(wdir / "search" / "offsets.json")
    segs = off["segments"]
    base = off["seg_base_offset"]
    seg_of = {(s["book"], s["column"]): i for i, s in enumerate(segs)}
    rows = []  # (book, global_start, english_text)
    for bf in sorted(wdir.glob("book-*.json")):
        doc = load(bf)
        book = doc["book"]
        tok_before = {}  # (column, line, char) -> tokens before it in the segment
        seg_lines = {s["column"]: s["greek"] for s in doc["segments"]}
        for t in (doc.get("turnFlow") or {}).get("turns", []):
            g = t.get("g")
            if not g:
                # A turn with no Greek of its own continues the row before it.
                if rows and rows[-1][0] == book:
                    extra = " ".join([t.get("e") or ""] + [x.get("e") or "" for x in t.get("sub") or []])
                    rows[-1] = (rows[-1][0], rows[-1][1], rows[-1][2] + " " + extra)
                continue
            col, n, o = g["c"], g["n"], g["o"]
            k = 0
            for line in seg_lines.get(col, []):
                for tok in line.get("tokens", []):
                    if line["n"] < n or (line["n"] == n and tok["o"] < o):
                        k += 1
            si = seg_of.get((book, col))
            if si is None:
                continue
            # A row's English is its own slice plus any stacked speeches
            # folded under it (`sub`; see FlowTurn in shared/lib/data.ts).
            english = " ".join([t.get("e") or ""] + [x.get("e") or "" for x in t.get("sub") or []])
            rows.append((book, base[si] + k, english))
    rows.sort(key=lambda r: r[1])
    return off, segs, base, rows


def row_index(rows, book, glob):
    """The last row of the book that starts at or before a global offset; a
    token before the book's first row goes with that row."""
    best = None
    for i, (b, start, _) in enumerate(rows):
        if b != book:
            continue
        if start <= glob:
            best = i
        elif best is None:
            return i
        else:
            break
    return best


def main(dist):
    dist = Path(dist)
    works = sorted(p.parent.parent.name for p in dist.glob("*/search/offsets.json"))
    models = {w: work_model(dist / w) for w in works}

    # Unit lengths in Greek words.
    lengths = {u: [] for u in UNITS}
    for w, (off, segs, base, rows) in models.items():
        total = off["token_count"]
        seg_len = [(base[i + 1] if i + 1 < len(base) else total) - base[i] for i in range(len(segs))]
        page_len = {}
        book_len = {}
        for s, n in zip(segs, seg_len):
            lengths["section"].append(n)
            page_len[(s["book"], page_of(s["column"]))] = page_len.get((s["book"], page_of(s["column"])), 0) + n
            book_len[s["book"]] = book_len.get(s["book"], 0) + n
        lengths["page"] += page_len.values()
        lengths["book"] += book_len.values()
        book_end = {}
        for s, b0, n in zip(segs, base, seg_len):
            book_end[s["book"]] = max(book_end.get(s["book"], 0), b0 + n)
        for i, (b, start, _) in enumerate(rows):
            nxt = rows[i + 1][1] if i + 1 < len(rows) and rows[i + 1][0] == b else book_end[b]
            lengths["row"].append(max(0, nxt - start))

    def summary(xs):
        xs = sorted(xs)
        return {"units": len(xs), "median": statistics.median(xs), "mean": round(statistics.mean(xs), 1),
                "p90": xs[int(0.9 * (len(xs) - 1))], "max": xs[-1], "min": xs[0]}

    out = {"unit_lengths_greek_words": {u: summary(v) for u, v in lengths.items()}, "searches": []}

    for q in SEARCHES:
        forms = set(q["english"])
        grk = {u: set() for u in UNITS}
        eng = {u: set() for u in UNITS}
        grk_hits = 0
        eng_hits = 0
        eng_row_hits = 0
        for w, (off, segs, base, rows) in models.items():
            sdir = dist / w / "search"
            for seg, pos in load(sdir / "greek_lemma.json").get(q["lemma"], []):
                s = segs[seg]
                grk_hits += 1
                glob = base[seg] + pos
                grk["section"].add((w, s["book"], s["column"]))
                grk["page"].add((w, s["book"], page_of(s["column"])))
                grk["book"].add((w, s["book"]))
                ri = row_index(rows, s["book"], glob)
                if ri is not None:
                    grk["row"].add((w, ri))
            en = load(sdir / "english.json")
            for form in forms:
                for seg, _pos in en.get(form, []):
                    s = segs[seg]
                    eng_hits += 1
                    eng["section"].add((w, s["book"], s["column"]))
                    eng["page"].add((w, s["book"], page_of(s["column"])))
                    eng["book"].add((w, s["book"]))
            for ri, (_b, _start, text) in enumerate(rows):
                n = sum(1 for word in english_words(text) if word in forms)
                if n:
                    eng_row_hits += n
                    eng["row"].add((w, ri))
        res = {"name": q["name"], "greek_hits": grk_hits, "english_hits_index": eng_hits,
               "english_hits_rows": eng_row_hits, "units": {}}
        for u in UNITS:
            g, e = grk[u], eng[u]
            res["units"][u] = {"greek": len(g), "english": len(e), "and": len(g & e),
                               "greek_only": len(g - e), "english_only": len(e - g), "or": len(g | e)}
        out["searches"].append(res)
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
    print()


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "build/dist")
