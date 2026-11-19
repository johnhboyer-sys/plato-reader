"""Steps C/D input: resolve each pass's quoted starts in the Greek, run the code
checks, compare the passes, and score against Perseus' <said who> tags.

  check.py Charmides Lysis Republic

Writes build/speakers-pilot/<Work>.resolved.json (per row: tokens, both passes'
segments with token starts, flags) and prints the summary.
"""
from __future__ import annotations

import json
import os
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parents[2] / "build" / os.environ.get("SPEAKERS_RUN", "speakers-pilot")
ENG = ROOT / "sources/perseus-eng"
TLG = {"Phaedo": "004", "Charmides": "018", "Lysis": "020", "Republic": "030"}


def fold(s: str) -> str:
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if not unicodedata.combining(c)).lower().replace("ς", "σ")
    return re.sub(r"[^\w]", "", s)


def words(s: str) -> list[str]:
    return [w for w in (fold(x) for x in s.split()) if w]


FIRST_INQUIT = re.compile(r"\b(ην δ εγω|εφην|ειπον)\b")
THIRD_INQUIT = re.compile(r"\b(εφη|η δ οσ)\b")


def stephanus(ref: str) -> tuple[int, str, int]:
    m = re.match(r"(\d+)([a-e])(\d*)", ref)
    return (int(m.group(1)), m.group(2), int(m.group(3) or 0)) if m else (0, "", 0)


def resolve(row: dict, segs: list[dict]) -> tuple[list[dict], list[str]]:
    """Attach a token start to each segment, in order; return segs + problems."""
    raw = row["greek"].split()
    toks = [fold(t) for t in raw]

    def opens(i: int) -> bool:  # a voice usually begins a sentence or a paragraph
        return i == 0 or raw[i - 1] == "¶" or raw[i - 1][-1] in ".;·:!?"

    # Choose every anchor of the row at once: positions must rise in order, and a
    # candidate scores for matching the quote's case and for opening a sentence.
    cand = []
    for s in segs:
        q = words(s["words"])
        first = s["words"].lstrip("¶ \"'“‘(")[:1]
        cs = [(i, (raw[i].lstrip("\"'“‘(")[:1] == first) + opens(i)) for i in range(len(toks))
              if q and toks[i] and [t for t in toks[i:i + len(q) * 2] if t][:len(q)] == q]
        cand.append(cs)
    # best[k][j] = (score, prev) for segment k placed at its j-th candidate; a segment may also be skipped
    best: list[dict] = []
    for k, cs in enumerate(cand):
        cur = {}
        for j, (i, sc) in enumerate(cs):
            top = (sc, None)
            for kk in range(k - 1, -1, -1):
                for jj, (v, _) in best[kk].items():
                    if cand[kk][jj][0] < i and v + sc - (k - kk - 1) * 10 > top[0]:
                        top = (v + sc - (k - kk - 1) * 10, (kk, jj))
            cur[j] = (top[0] - k * 10 if top[1] is None else top[0], top[1])
        best.append(cur)
    tail = max(((v - (len(cand) - 1 - k) * 10, (k, j)) for k, b in enumerate(best) for j, (v, _) in b.items()),
               default=None)
    chosen = {}
    node = tail[1] if tail else None
    while node:
        k, j = node
        chosen[k] = cand[k][j][0]
        node = best[k][j][1]
    out, problems = [], []
    for k, s in enumerate(segs):
        if k in chosen:
            out.append({**s, "tok": chosen[k]})
        else:
            problems.append(f"unresolved quote “{s['words']}”")
    if out and out[0]["tok"] != next(i for i, t in enumerate(toks) if t):
        problems.append("first segment does not start the row")
    return out, problems


def token_speakers(row: dict, segs: list[dict]) -> list[str | None]:
    n = len(row["greek"].split())
    lab: list[str | None] = [None] * n
    for k, s in enumerate(segs):
        end = segs[k + 1]["tok"] if k + 1 < len(segs) else n
        for i in range(s["tok"], end):
            lab[i] = s["speaker"]
    return lab


def flags(row: dict, segs: list[dict], sheet: dict) -> list[str]:
    raw = row["greek"].split()
    narrator = sheet["narrator"]
    voc = {c["id"]: fold(c["greek_vocative"].replace("ὦ", "")) for c in sheet["cast"]}
    nom = {c["id"]: fold(c["greek_nominative"]) for c in sheet["cast"]}
    out = []
    starts = {s["tok"] for s in segs}
    for i, t in enumerate(raw):
        # narration runs across Burnet's paragraphs; in the pilot every such flag was a false alarm
        held = next((s for s in reversed(segs) if s["tok"] <= i), None)
        if t == "¶" and i + 1 not in starts and not (held and held["kind"] == "narration"):
            out.append(f"¶ at “{' '.join(raw[i+1:i+4])}” with no new segment")
    for k, s in enumerate(segs):
        end = segs[k + 1]["tok"] if k + 1 < len(segs) else len(raw)
        text = " ".join(fold(t) for t in raw[s["tok"]:end] if fold(t))
        tag = f"{s['speaker']} at “{s['words']}”"
        if s["kind"] == "speech" and s["speaker"] != narrator and FIRST_INQUIT.search(text):
            out.append(f"first-person inquit in {tag}")
        if s["kind"] == "speech" and s["speaker"] == narrator and THIRD_INQUIT.search(text):
            out.append(f"third-person inquit in {tag}")
        v = voc.get(s["speaker"])
        if v and s["kind"] != "narration":
            hit = (f"ω {v}" in text) if v == nom.get(s["speaker"]) else (f" {v} " in f" {text} ")
            if hit:
                out.append(f"own vocative in {tag}")
        if s["speaker"] == "unknown" or s["doubt"]:
            out.append(f"doubt/unknown: {tag} ({s['cue']})")
        scene = next((sc for sc in sheet["scenes"]
                      if stephanus(sc["start"]) <= stephanus(row["ref"]) <= stephanus(sc["end"])), None)
        if scene and s["speaker"] not in scene["speakers"] + [narrator] and s["kind"] == "speech":
            out.append(f"speaker not in scene map: {tag}")
    return out


def perseus_tags(work: str) -> list[tuple[str, str]]:
    """(who, opening words) for each <said who> span in the English TEI."""
    x = (ENG / f"tlg0059.tlg{TLG[work]}.perseus-eng2.xml").read_text()
    out = []
    for m in re.finditer(r'<said who="#([^" ]+)"[^>]*>(.{0,400})', x, re.S):
        if "merge" in m.group(0)[:80]:
            continue
        t = re.sub(r"<note.*?</note>|<[^>]+>", " ", m.group(2))
        out.append((m.group(1).lower(), " ".join(t.split()[:6])))
    return out


def run(work: str) -> dict:
    rows = json.loads((OUT / f"{work}.rows.json").read_text())
    sheet = json.loads((OUT / f"{work}.cast.json").read_text())
    meta = json.loads((OUT / "batch.json").read_text())["meta"]
    by_pass: dict[int, dict[str, list[dict]]] = {1: {}, 2: {}}
    missing = 0
    for cid, m in meta.items():
        if m["work"] != work:
            continue
        f = OUT / "results" / f"{cid}.json"
        data = json.loads(f.read_text())["data"] if f.exists() else None
        if not data:
            missing += 1
            continue
        for s in data["segments"]:
            by_pass[m["pass"]].setdefault(s["row"], []).append(s)
    stats = {"rows": len(rows), "missing_windows": missing, "segments": [0, 0], "unresolved": [0, 0],
             "row_start": [0, 0], "rows_unlabelled": [0, 0], "flags": [0, 0],
             "tokens": 0, "tokens_agree": 0, "rows_agree": 0}
    resolved = []
    for r in rows:
        entry = {"id": r["id"], "ref": r["ref"], "greek": r["greek"], "english": r["english"], "passes": {}}
        labs = []
        for p in (1, 2):
            segs, probs = resolve(r, by_pass[p].get(r["id"], []))
            fl = flags(r, segs, sheet) if segs else []
            stats["segments"][p - 1] += len(segs)
            stats["unresolved"][p - 1] += sum("unresolved" in x for x in probs)
            stats["row_start"][p - 1] += sum("first segment" in x for x in probs)
            stats["rows_unlabelled"][p - 1] += not segs
            stats["flags"][p - 1] += len(fl)
            entry["passes"][p] = {"segments": segs, "problems": probs, "flags": fl}
            labs.append(token_speakers(r, segs))
        same = [a == b for a, b in zip(*labs) if a or b]
        stats["tokens"] += len(same)
        stats["tokens_agree"] += sum(same)
        entry["agree"] = all(same)
        stats["rows_agree"] += entry["agree"]
        resolved.append(entry)
    # Perseus: the tagged speaker must speak somewhere near the tag's place in the row.
    if work != "Republic":
        hits = near = total = 0
        eng = [(e, " ".join(e["english"].split())) for e in resolved]
        for who, opening in perseus_tags(work):
            if len(opening.split()) < 3:
                continue
            for e, text in eng:
                at = text.find(opening)
                if at < 0:
                    continue
                total += 1
                segs = e["passes"][1]["segments"]
                lab = token_speakers(e, segs)
                if who in {s["speaker"] for s in segs}:
                    hits += 1
                    frac = at / max(len(text), 1)
                    i = int(frac * len(lab))
                    window = lab[max(0, i - 8): i + 8]
                    near += who in window
                else:
                    e.setdefault("perseus_miss", []).append(f"{who}: {opening}")
                break
        stats["perseus"] = {"tags_found": total, "speaker_in_row": hits, "speaker_near_tag": near}
    (OUT / f"{work}.resolved.json").write_text(json.dumps(resolved, ensure_ascii=False, indent=1))
    return stats


if __name__ == "__main__":
    for w in sys.argv[1:]:
        s = run(w)
        agree = s["tokens_agree"] / max(s["tokens"], 1)
        print(f"{w}: {json.dumps(s)}  token agreement {agree:.1%}")
