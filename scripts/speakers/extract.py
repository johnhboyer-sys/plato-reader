"""Cut a narrated work into labelled-row units for the speaker pilot.

Reads the built reader data (app/public/data/<Work>/book-NN.json) for the
Greek lines and row starts, and the TLG export only for Burnet's paragraph
indents (rend="indent(1)"), which become a pilcrow before the line.

Writes build/speakers-pilot/<Work>.rows.json:
  [{id, book, c, n, o, ref, greek, english}]
Greek is TLG-derived, so the output stays under build/ (never committed).
"""
from __future__ import annotations

import argparse
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "app/public/data"
EXPORT = ROOT / "build/export/Diogenes-Resources/xml/tlg"
OUT = Path(__file__).resolve().parents[2] / "build" / os.environ.get("SPEAKERS_RUN", "speakers-pilot")


def indents(tlg_work: str) -> set[tuple[str, int]]:
    """(column, line) pairs whose TLG line opens one of Burnet's paragraphs."""
    xml = (EXPORT / f"tlg0059{tlg_work}.xml").read_text()
    found: set[tuple[str, int]] = set()
    page = sec = None
    for m in re.finditer(r'<div type="(Stephanus-page|section)" n="([^"]+)"|<l n="(\d+)"([^>]*)>', xml):
        if m.group(1) == "Stephanus-page":
            page = m.group(2)
        elif m.group(1) == "section":
            sec = m.group(2)
        elif "indent(1)" in (m.group(4) or ""):
            found.add((f"{page}{sec}", int(m.group(3))))
    return found


def row_english(turn: dict) -> str:
    if turn.get("e"):
        return turn["e"]
    return " ".join(s.get("e") or "" for s in turn.get("sub") or []).strip()


def extract(work: str, tlg_work: str, books: list[int] | None) -> list[dict]:
    paras = indents(tlg_work)
    rows: list[dict] = []
    for f in sorted((DATA / work).glob("book-*.json")):
        d = json.loads(f.read_text())
        if books and d["book"] not in books:
            continue
        lines = [(s["column"], l["n"], l["text"]) for s in d["segments"] for l in s["greek"]]
        at = {(c, n): i for i, (c, n, _) in enumerate(lines)}
        turns = d["turnFlow"]["turns"]
        starts = [(at[(t["g"]["c"], t["g"]["n"])], t["g"]["o"]) for t in turns]
        for k, t in enumerate(turns):
            i, o = starts[k]
            j, o2 = starts[k + 1] if k + 1 < len(turns) else (len(lines) - 1, len(lines[-1][2]))
            parts = []
            for m in range(i, j + 1):
                c, n, text = lines[m]
                a = o if m == i else 0
                b = o2 if m == j else len(text)
                piece = text[a:b].strip()
                if not piece:
                    continue
                if a == 0 and (c, n) in paras and m != i:
                    piece = "¶ " + piece
                parts.append(piece)
            rows.append({
                "id": f"{work[:3].upper()}{d['book']:02d}-{k:04d}",
                "book": d["book"], "c": t["g"]["c"], "n": t["g"]["n"], "o": t["g"]["o"],
                "ref": f"{t['g']['c']}{t['g']['n']}",
                # Burnet sets a dash with no spaces (τρίχας—Αὔριον): make it its own token so a
                # speech that opens after it can be anchored
                "greek": re.sub(r"\s*—\s*", " — ", " ".join(parts)).strip(),
                "english": row_english(t),
            })
    return rows


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("work")
    ap.add_argument("tlg_work")
    ap.add_argument("--books", type=int, nargs="*")
    a = ap.parse_args()
    rows = extract(a.work, a.tlg_work, a.books)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{a.work}.rows.json").write_text(json.dumps(rows, ensure_ascii=False, indent=1))
    g = sum(len(r["greek"]) for r in rows)
    print(f"{a.work}: {len(rows)} rows, {g} Greek chars, {sum(r['greek'].count('¶') for r in rows)} inner paragraph marks")
