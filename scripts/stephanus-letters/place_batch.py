"""Place every Greek Stephanus section start in the English (full run, Batch API).
  place_batch.py submit <data_dir> <out_dir>
  place_batch.py fetch <out_dir>"""
import json, glob, sys, re, time
import anthropic
MODEL = "claude-opus-5-5"
SYSTEM = """You are checking a parallel Greek/English reader of Plato. The Greek is Burnet's Oxford text, divided into Stephanus sections. The English is a Loeb translation. Two consecutive Greek sections, A and B, are given separately. The English for both is given as one run, with no mark between them.
Find the English word where the rendering of Greek section B begins: the first English word that translates the first words of B. If the translation reorders a sentence so that no clean point exists, choose the English word boundary that best splits A's content from B's, and say so in the note.
english_start: copy the first six to ten English words of B exactly as printed, so the spot can be found by string search."""
SCHEMA = {"type": "object", "additionalProperties": False, "required": ["english_start", "confident", "note"],
          "properties": {"english_start": {"type": "string"}, "confident": {"type": "boolean"}, "note": {"type": "string"}}}

def submit(data_dir, out):
    pairs = []
    for w in sorted(glob.glob(f"{data_dir}/*/")):
        name = w.rstrip("/").split("/")[-1]
        seq = []
        for f in sorted(glob.glob(f"{w}book-*.json")):
            for s in json.load(open(f))["segments"]:
                seq.append((s["id"], s["column"], " ".join(l["text"] for l in s["greek"]), (s.get("english") or {}).get("text", "")))
        for A, B in zip(seq, seq[1:]):
            if not (A[2] and B[2]): continue
            pairs.append({"cid": f"b{len(pairs):05d}", "work": name, "a": A[0], "b": B[0],
                          "ga": A[2], "gb": B[2], "ea": A[3], "eb": B[3]})
    json.dump(pairs, open(f"{out}/pairs.json", "w"), ensure_ascii=False)
    reqs = []
    for p in pairs:
        if not (p["ea"] or p["eb"]): continue
        eng = p["ea"].rstrip() + " " + p["eb"].lstrip()
        body = f'<greek_A ref="{p["a"].split(":")[-1]}">{p["ga"]}</greek_A>\n<greek_B ref="{p["b"].split(":")[-1]}">{p["gb"]}</greek_B>\n<english>{eng}</english>'
        reqs.append({"custom_id": p["cid"], "params": {"model": MODEL, "max_tokens": 16000,
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": "high", "format": {"type": "json_schema", "schema": SCHEMA}},
            "system": [{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
            "messages": [{"role": "user", "content": body}]}})
    print(len(pairs), "pairs,", len(reqs), "requests")
    b = anthropic.Anthropic().messages.batches.create(requests=reqs)
    json.dump({"id": b.id}, open(f"{out}/batch.json", "w"))
    print("batch", b.id, b.processing_status)

def fetch(out):
    c = anthropic.Anthropic()
    bid = json.load(open(f"{out}/batch.json"))["id"]
    while (b := c.messages.batches.retrieve(bid)).processing_status != "ended":
        print(time.strftime("%H:%M"), b.request_counts, flush=True); time.sleep(120)
    res, usage, bad = {}, [0, 0, 0], []
    for r in c.messages.batches.results(bid):
        if r.result.type != "succeeded" or r.result.message.stop_reason != "end_turn":
            bad.append(r.custom_id); continue
        m = r.result.message
        usage[0] += m.usage.input_tokens; usage[1] += m.usage.cache_read_input_tokens or 0; usage[2] += m.usage.output_tokens
        res[r.custom_id] = json.loads(next(x.text for x in m.content if x.type == "text"))
    cost = (usage[0] * 2 + usage[1] * 0.2 + usage[2] * 10) / 1e6
    json.dump({"results": res, "failed": bad, "usage": usage, "cost_usd": round(cost, 2)}, open(f"{out}/results.json", "w"), ensure_ascii=False)
    print(len(res), "ok,", len(bad), "failed, cost $%.2f" % cost)

if __name__ == "__main__":
    {"submit": lambda: submit(sys.argv[2], sys.argv[3]), "fetch": lambda: fetch(sys.argv[2])}[sys.argv[1]]()
