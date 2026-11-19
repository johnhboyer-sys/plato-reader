"""Step D: send every row the passes disagree on, or that a check flagged, back
to Opus once with both readings and wider context; it picks or corrects.

  adjudicate.py submit Charmides Lysis Republic
  adjudicate.py fetch
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import label  # noqa: E402

OUT = label.OUT
SIDE = 3000  # Greek characters of context on each side

TASK = """Two independent readings of the rows inside <disputed> disagree, or a code check flagged them. Each reading is shown as the row's Greek with [speaker · kind] marks where a segment starts; flags follow. Decide who speaks where, using the context on both sides, and give the final segments for every disputed row in the same format as before. In `cue` say briefly why, quoting the Greek that decides it. Flags are prompts to look again, not verdicts: a flag can be a false alarm."""


def reading(row: dict, segs: list[dict]) -> str:
    toks = row["greek"].split()
    starts = {s["tok"]: s for s in segs}
    out = []
    for i, t in enumerate(toks):
        if i in starts:
            s = starts[i]
            mark = s["speaker"] + (" · " + s["kind"] if s["kind"] != "speech" else "")
            if s["kind"] == "reported":
                mark += f" within {s['within']}"
            out.append(f"[{mark}]")
        out.append(t)
    return " ".join(out)


def disputed(entry: dict) -> bool:
    p1, p2 = entry["passes"]["1"], entry["passes"]["2"]
    return (not entry["agree"] or p1["flags"] or p2["flags"] or p1["problems"] or p2["problems"]
            or entry.get("perseus_miss"))


def submit(works: list[str]) -> None:
    import anthropic
    reqs, meta = [], {}
    for work in works:
        resolved = json.loads((OUT / f"{work}.resolved.json").read_text())
        base, _ = label.requests_for(work)
        system = base[0]["params"]["system"]
        sheet = json.loads((OUT / f"{work}.cast.json").read_text())
        cast_ids = [c["id"] for c in sheet["cast"]]
        idx = [i for i, e in enumerate(resolved) if disputed(e)]
        groups: list[list[int]] = []
        for i in idx:  # neighbouring disputed rows go in one request
            if groups and i - groups[-1][-1] <= 2 and len(groups[-1]) < 12:
                groups[-1].append(i)
            else:
                groups.append([i])
        for k, g in enumerate(groups):
            lo, hi = g[0], g[-1]
            before, size = [], 0
            for e in reversed(resolved[:lo]):
                if size >= SIDE:
                    break
                before.insert(0, e)
                size += len(e["greek"])
            after, size = [], 0
            for e in resolved[hi + 1:]:
                if size >= SIDE:
                    break
                after.append(e)
                size += len(e["greek"])
            mid = resolved[lo:hi + 1]
            ids = [e["id"] for e in mid]
            body = "<context>\n" + "\n".join(label.fmt(e) for e in before) + "\n</context>\n<disputed>\n"
            for e in mid:
                body += label.fmt(e) + "\n"
                for p in ("1", "2"):
                    d = e["passes"][p]
                    body += f"<reading n=\"{p}\">{reading(e, d['segments'])}</reading>\n"
                    for f in d["flags"] + d["problems"]:
                        body += f"<flag reading=\"{p}\">{f}</flag>\n"
                for m in e.get("perseus_miss", []):
                    body += f"<flag>the Perseus English tags a speech by {m}; neither reading has that speaker in this row</flag>\n"
            body += "</disputed>\n<context>\n" + "\n".join(label.fmt(e) for e in after) + "\n</context>\n\n" + TASK
            cid = f"adj-{work[:3]}-{k:02d}"
            meta[cid] = {"work": work, "rows": ids}
            reqs.append({"custom_id": cid, "params": {
                "model": label.MODEL, "max_tokens": 48000, "thinking": {"type": "adaptive"},
                "output_config": {"effort": "high", "format": {
                    "type": "json_schema", "schema": label.schema(cast_ids, ids)}},
                "system": system, "messages": [{"role": "user", "content": body}]}})
        print(work, len(idx), "disputed rows in", len(groups), "requests")
    batch = anthropic.Anthropic().messages.batches.create(requests=reqs)
    (OUT / "adj-batch.json").write_text(json.dumps({"id": batch.id, "meta": meta}, indent=1))
    print("batch", batch.id)


def fetch() -> None:
    import anthropic
    client = anthropic.Anthropic()
    info = json.loads((OUT / "adj-batch.json").read_text())
    while (b := client.messages.batches.retrieve(info["id"])).processing_status != "ended":
        print(time.strftime("%H:%M"), b.request_counts, flush=True)
        time.sleep(60)
    d = OUT / "adj-results"
    d.mkdir(exist_ok=True)
    usage = {"input": 0, "cache_read": 0, "cache_write": 0, "output": 0}
    for r in client.messages.batches.results(info["id"]):
        if r.result.type != "succeeded":
            print(r.custom_id, r.result.type)
            continue
        msg = r.result.message
        u = msg.usage
        usage["input"] += u.input_tokens
        usage["cache_read"] += u.cache_read_input_tokens or 0
        usage["cache_write"] += u.cache_creation_input_tokens or 0
        usage["output"] += u.output_tokens
        text = next((x.text for x in msg.content if x.type == "text"), "")
        (d / f"{r.custom_id}.json").write_text(json.dumps(
            {"stop": msg.stop_reason, "data": json.loads(text) if msg.stop_reason == "end_turn" else None},
            ensure_ascii=False, indent=1))
    usage["cost_usd"] = round((usage["input"] * 2 + usage["cache_read"] * 0.10
                               + usage["cache_write"] * 2.5 + usage["output"] * 10) / 1e6, 2)
    (OUT / "adj-usage.json").write_text(json.dumps(usage, indent=1))
    print(usage)


if __name__ == "__main__":
    {"submit": lambda: submit(sys.argv[2:]), "fetch": fetch}[sys.argv[1]]()
