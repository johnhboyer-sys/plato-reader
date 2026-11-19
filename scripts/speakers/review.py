"""Merge the passes and the adjudication into final labels, re-run the checks on
them, and write the pilot review page.

  review.py Charmides Lysis Republic   → build/speakers-pilot/final-<Work>.json, review.html
"""
from __future__ import annotations

import html
import json
import os
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import check  # noqa: E402

OUT = check.OUT
SAMPLE = {"Charmides": 12, "Lysis": 12, "Republic": 16, "Phaedo": 16}
SPAN = {"Republic": " I" if os.environ.get("SPEAKERS_RUN", "speakers-pilot") == "speakers-pilot" else " I–II"}


def final(work: str) -> tuple[list[dict], list[dict], dict]:
    resolved = json.loads((OUT / f"{work}.resolved.json").read_text())
    rows = {r["id"]: r for r in json.loads((OUT / f"{work}.rows.json").read_text())}
    sheet = json.loads((OUT / f"{work}.cast.json").read_text())
    meta = json.loads((OUT / "adj-batch.json").read_text())["meta"]
    adj: dict[str, list[dict]] = {}
    for cid, m in meta.items():
        if m["work"] != work:
            continue
        data = json.loads((OUT / "adj-results" / f"{cid}.json").read_text())["data"]
        for s in data["segments"]:
            adj.setdefault(s["row"], []).append(s)
    out, stats = [], {"adjudicated": 0, "changed": 0, "unresolved": 0, "flags_left": []}
    for e in resolved:
        r = rows[e["id"]]
        segs = e["passes"]["1"]["segments"]
        decided = None
        if e["id"] in adj:
            stats["adjudicated"] += 1
            decided, probs = check.resolve(r, adj[e["id"]])
            stats["unresolved"] += len(probs)
            lab_new = check.token_speakers(r, decided)
            if lab_new != check.token_speakers(r, segs):
                stats["changed"] += 1
            segs = decided
        fl = check.flags(r, segs, sheet)
        stats["flags_left"] += [f"{e['ref']}: {f}" for f in fl]
        out.append({**e, "final": segs, "decided": decided is not None, "final_flags": fl})
    return out, sheet["cast"], stats


PALETTE = ["--s1", "--s2", "--s3", "--s4", "--s5", "--s6"]


def render(entry: dict, color: dict[str, str], display: dict[str, str], segs: list[dict]) -> str:
    toks = entry["greek"].split()
    parts = []
    for k, s in enumerate(segs):
        end = segs[k + 1]["tok"] if k + 1 < len(segs) else len(toks)
        text = html.escape(" ".join(toks[s["tok"]:end]))
        who = display.get(s["speaker"], s["speaker"])
        if s["kind"] == "reported":
            who += f" <i>in {html.escape(display.get(s['within'], s['within']))}</i>"
        cls = f"seg {s['kind']}"
        parts.append(f'<span class="{cls}" style="--c: var({color.get(s["speaker"], "--s6")})">'
                     f'<b class="who">{who}</b> {text}</span>')
    return " ".join(parts)


def render_eng(entry: dict, color: dict[str, str], display: dict[str, str], starts: dict) -> str:
    """The row's English with a chip where each Greek voice change was placed in it."""
    text = " ".join(entry["english"].split())
    toks = entry["greek"].split()
    segs = entry["final"]
    marks, pos = [], 0
    for n, s in enumerate(segs):
        end = segs[n + 1]["tok"] if n + 1 < len(segs) else len(toks)
        if s["kind"] == "narration" and end - s["tok"] <= 4:
            continue  # a bare lead-in (Καὶ ὁ Ἀδείμαντος): translators fold it into the speech as "he said"
        q = " ".join((starts.get(entry["id"], {}).get(str(n)) or "").split())
        if not q:
            continue
        at = text.find(q, pos)
        if at < 0:
            at = text.find(q)  # the translator moved this voice ahead of the one before
        if at >= 0 and all(at != m for m, _ in marks):
            marks.append((at, s))
            pos = max(pos, at + 1)
    marks.sort(key=lambda m: m[0])
    if not marks:
        return html.escape(text)
    if marks[0][0] > 0:  # English before the first placed mark stays unmarked
        marks.insert(0, (0, None))
    out = []
    for k, (at, s) in enumerate(marks):
        end = marks[k + 1][0] if k + 1 < len(marks) else len(text)
        chunk = html.escape(text[at:end])
        if s is None:
            out.append(chunk)
            continue
        who = display.get(s["speaker"], s["speaker"])
        out.append(f'<span class="seg {s["kind"]}" style="--c: var({color.get(s["speaker"], "--s6")})">'
                   f'<b class="who">{who}</b> {chunk}</span>')
    return " ".join(out)


def pair(e: dict, color, display, starts, ctx: bool = False) -> str:
    ref = f'<span class="ref ctxref">{e["ref"]}</span>' if ctx else ""
    return (f'<div class="pair{" ctx" if ctx else ""}">{ref}'
            f'<p class="grc" lang="grc">{render(e, color, display, e["final"])}</p>'
            f'<p class="eng" lang="en">{render_eng(e, color, display, starts)}</p></div>')


def main(works: list[str]) -> None:
    random.seed(16)
    usage = json.loads((OUT / "usage.json").read_text())
    adj_usage = json.loads((OUT / "adj-usage.json").read_text())
    sections, summary = [], []
    for work in works:
        entries, cast, st = final(work)
        sf = OUT / "english-starts.json"
        starts = json.loads(sf.read_text()) if sf.exists() else {}
        display = {c["id"]: c["display"].rstrip(".") for c in cast} | {"unknown": "?"}
        counts: dict[str, int] = {}
        for e in entries:
            for s in e["final"]:
                counts[s["speaker"]] = counts.get(s["speaker"], 0) + 1
        color = {sp: PALETTE[i % 5] for i, sp in enumerate(sorted(counts, key=lambda x: -counts[x]))}
        res = json.loads((OUT / f"{work}.resolved.json").read_text())
        agree = sum(e["agree"] for e in res)
        summary.append((work, len(entries), sum(len(e["final"]) for e in entries), agree, st))
        cards = []
        decided = [e for e in entries if e["decided"]]
        pool = [e for e in entries if not e["decided"]]
        sample = sorted(random.sample(pool, min(SAMPLE[work], len(pool))), key=lambda e: entries.index(e))
        for e in decided + sample:
            e["shown"] = True
        (OUT / f"final-{work}.json").write_text(json.dumps(entries, ensure_ascii=False, indent=1))
        at = {e["id"]: i for i, e in enumerate(entries)}
        for title, group, note in (
            ("Decided by adjudication", decided,
             "The two passes disagreed here, or a check flagged the row. Shown is the final reading, with the adjudicator's reasons."),
            ("Random sample of rows both passes agreed on", sample,
             "Drawn at random from rows no check flagged. These are the ones to judge the error rate by."),
        ):
            cards.append(f'<h3>{title} <span class="n">{len(group)}</span></h3><p class="note">{note}</p>')
            for e in group:
                why = ""
                if e["decided"]:
                    cues = [f'{html.escape(display.get(s["speaker"], s["speaker"]))}: {html.escape(s["cue"])}'
                            for s in e["final"] if s.get("cue")]
                    p1 = check.token_speakers(e, e["passes"]["1"]["segments"])
                    p2 = check.token_speakers(e, e["passes"]["2"]["segments"])
                    fin = check.token_speakers(e, e["final"])
                    verdict = ("kept both passes' reading" if p1 == p2 == fin else
                               "sided with pass 1" if fin == p1 else
                               "sided with pass 2" if fin == p2 else "gave a new reading")
                    why = (f'<details><summary>Adjudicator {verdict}</summary><ul>'
                           + "".join(f"<li>{c}</li>" for c in cues) + "</ul></details>")
                flagged = "".join(f'<li>{html.escape(f)}</li>' for f in e["final_flags"])
                flagged = f'<ul class="flags">{flagged}</ul>' if flagged else ""
                cards.append(
                    f'<article class="row" id="{e["id"]}"><header><span class="ref">{work} {e["ref"]}</span></header>'
                    + (pair(entries[at[e["id"]] - 1], color, display, starts, True) if at[e["id"]] > 0 else "")
                    + pair(e, color, display, starts)
                    + (pair(entries[at[e["id"]] + 1], color, display, starts, True)
                       if at[e["id"]] + 1 < len(entries) else "")
                    + f'{why}{flagged}'
                    f'<div class="mark" hidden data-row="{e["id"]}" data-ref="{work} {e["ref"]}" data-group="{"adjudicated" if e["decided"] else "sample"}">'
                    f'<button type="button" data-v="ok">Right</button><button type="button" data-v="wrong">Wrong</button>'
                    f'<input id="note-{e["id"]}" type="text" placeholder="What is wrong, e.g. “Ναί is Charmides”" aria-label="Note on {work} {e["ref"]}">'
                    f'<span class="saved" aria-live="polite"></span></div></article>')
        legend = " ".join(f'<span class="chip" style="--c: var({color[s]})">{html.escape(display.get(s, s))}</span>'
                          f'<span class="cn">{html.escape(next((c["english"] for c in cast if c["id"] == s), s))}</span>'
                          for s in sorted(counts, key=lambda x: -counts[x]))
        sections.append(f'<section id="{work}"><h2>{work}{SPAN.get(work, "")}</h2>'
                        f'<p class="legend">{legend}</p>{"".join(cards)}</section>')
    rows_html = "".join(
        f"<tr><td>{w}{SPAN.get(w, '')}</td><td>{n}</td><td>{segs}</td><td>{agree} ({agree / n:.0%})</td>"
        f"<td>{st['adjudicated']}</td><td>{st['changed']}</td><td>{len(st['flags_left'])}</td></tr>"
        for w, n, segs, agree, st in summary)
    cost = usage["cost_usd"] + adj_usage["cost_usd"]
    tpl = "review.template.html" if os.environ.get("SPEAKERS_RUN", "speakers-pilot") == "speakers-pilot" else "review.test.template.html"
    page = (Path(__file__).parent / tpl).read_text()
    page = page.replace("{{TABLE}}", rows_html).replace("{{SECTIONS}}", "".join(sections)) \
        .replace("{{COST}}", f"${cost:.2f}").replace("{{COST1}}", f"${usage['cost_usd']:.2f}") \
        .replace("{{COST2}}", f"${adj_usage['cost_usd']:.2f}")
    (OUT / "review.html").write_text(page)
    for w, n, segs, agree, st in summary:
        print(w, n, "rows", segs, "segments; adjudicated", st["adjudicated"], "changed", st["changed"],
              "unresolved", st["unresolved"], "flags left", len(st["flags_left"]))
        for f in st["flags_left"]:
            print("   ", f[:140])
    print("cost", cost)


if __name__ == "__main__":
    main(sys.argv[1:])
