"""Review aid: place each final Greek voice change in the row's Loeb English, so
the review page can mark speakers on the English too. Not part of the labelling
itself; a misplaced English mark misleads only the review display.

  map_english.py submit Charmides Lysis Republic
  map_english.py fetch
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import label  # noqa: E402

OUT = label.OUT
GROUP = 15

TASK = """Each <row> below gives a passage of Plato's Greek split into numbered voice segments (who speaks where), and a Loeb English translation of the same passage. For every segment, find where the translation of that segment begins in the English and copy the first three to six English words exactly as printed. Segments are in order, so your English starts must be in order too.
If the English sets a segment's opening somewhere else (translators often move "he said" or reorder a clause), quote where the English rendering of that segment begins. If a segment has no counterpart in the English, or the English for it lies outside this row, give an empty string."""


def shown_rows(work: str) -> list[int]:
    """Indexes of review-page rows plus their neighbours."""
    entries = json.loads((OUT / f"final-{work}.json").read_text())
    want = set()
    for i, e in enumerate(entries):
        if e.get("shown"):
            want |= {i - 1, i, i + 1}
    return sorted(k for k in want if 0 <= k < len(entries))


def submit(works: list[str]) -> None:
    import anthropic
    reqs, meta = [], {}
    for work in works:
        entries = json.loads((OUT / f"final-{work}.json").read_text())
        idx = shown_rows(work)
        for k in range(0, len(idx), GROUP):
            chunk = [entries[i] for i in idx[k:k + GROUP]]
            body = ""
            for e in chunk:
                toks = e["greek"].split()
                segs = e["final"]
                body += f'<row id="{e["id"]}">\n'
                for n, s in enumerate(segs):
                    end = segs[n + 1]["tok"] if n + 1 < len(segs) else len(toks)
                    body += f'<seg n="{n}" speaker="{s["speaker"]}">{" ".join(toks[s["tok"]:end])}</seg>\n'
                body += f'<english>{e["english"]}</english>\n</row>\n'
            ids = [e["id"] for e in chunk]
            cid = f"eng-{work[:3]}-{k // GROUP:02d}"
            meta[cid] = {"work": work, "rows": ids}
            reqs.append({"custom_id": cid, "params": {
                "model": label.MODEL, "max_tokens": 16000, "thinking": {"type": "adaptive"},
                "output_config": {"effort": "low", "format": {"type": "json_schema", "schema": {
                    "type": "object", "additionalProperties": False, "required": ["starts"],
                    "properties": {"starts": {"type": "array", "items": {
                        "type": "object", "additionalProperties": False,
                        "required": ["row", "seg", "english"],
                        "properties": {"row": {"type": "string", "enum": ids},
                                       "seg": {"type": "integer"},
                                       "english": {"type": "string"}}}}}}}},
                "messages": [{"role": "user", "content": TASK + "\n\n" + body}]}})
        print(work, len(idx), "rows in", -(-len(idx) // GROUP), "requests")
    batch = anthropic.Anthropic().messages.batches.create(requests=reqs)
    (OUT / "eng-batch.json").write_text(json.dumps({"id": batch.id, "meta": meta}, indent=1))
    print("batch", batch.id)


def fetch() -> None:
    import anthropic
    client = anthropic.Anthropic()
    info = json.loads((OUT / "eng-batch.json").read_text())
    while (b := client.messages.batches.retrieve(info["id"])).processing_status != "ended":
        print(time.strftime("%H:%M"), b.request_counts, flush=True)
        time.sleep(30)
    starts: dict[str, dict[str, str]] = {}
    out_tok = in_tok = 0
    for r in client.messages.batches.results(info["id"]):
        if r.result.type != "succeeded" or r.result.message.stop_reason != "end_turn":
            print(r.custom_id, r.result.type)
            continue
        msg = r.result.message
        in_tok += msg.usage.input_tokens
        out_tok += msg.usage.output_tokens
        data = json.loads(next(x.text for x in msg.content if x.type == "text"))
        for s in data["starts"]:
            starts.setdefault(s["row"], {})[str(s["seg"])] = s["english"]
    (OUT / "english-starts.json").write_text(json.dumps(starts, ensure_ascii=False, indent=1))
    print("rows", len(starts), "cost", round((in_tok * 2 + out_tok * 10) / 1e6, 2))


if __name__ == "__main__":
    {"submit": lambda: submit(sys.argv[2:]), "fetch": fetch}[sys.argv[1]]()
