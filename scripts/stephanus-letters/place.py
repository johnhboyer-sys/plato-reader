"""Place each Greek Stephanus section start in the English (small test).
  place.py <data_dir> <lentest.json> <out.json>
Opus sees both sections' Greek and the two sections' English joined with no mark,
so it cannot copy the current placement."""
import json, glob, sys, random, re, concurrent.futures as cf
import anthropic
data_dir, flagged_f, out_f = sys.argv[1:4]
MODEL = "claude-opus-5-5"
CLIENT = anthropic.Anthropic()
CLIENT.messages.create(model=MODEL, max_tokens=5, messages=[{"role": "user", "content": "ok"}])
secs = {}
for w in sorted(glob.glob(f"{data_dir}/*/")):
    name = w.rstrip("/").split("/")[-1]
    seq = []
    for f in sorted(glob.glob(f"{w}book-*.json")):
        for s in json.load(open(f))["segments"]:
            seq.append((s["column"], " ".join(l["text"] for l in s["greek"]), (s.get("english") or {}).get("text", "")))
    if seq: secs[name] = seq
flagged = json.load(open(flagged_f))
pairs = [(r[1], r[2], r[3], "flagged") for r in flagged[:30]]
random.seed(7)
fl = {(r[1], r[2]) for r in flagged}
pool = [(w, a[0], b[0]) for w, seq in secs.items() for a, b in zip(seq, seq[1:])
        if (w, a[0]) not in fl and len(a[1]) > 150 and len(b[1]) > 150 and a[2] and b[2]]
pairs += [(w, a, b, "control") for w, a, b in random.sample(pool, 10)]

SYSTEM = """You are checking a parallel Greek/English reader of Plato. The Greek is Burnet's Oxford text, divided into Stephanus sections. The English is a Loeb translation. Two consecutive Greek sections, A and B, are given separately. The English for both is given as one run, with no mark between them.
Find the English word where the rendering of Greek section B begins: the first English word that translates the first words of B. If the translation reorders a sentence so that no clean point exists, choose the English word boundary that best splits A's content from B's, and say so in the note.
english_start: copy the first six to ten English words of B exactly as printed, so the spot can be found by string search."""
SCHEMA = {"type": "object", "additionalProperties": False, "required": ["english_start", "confident", "note"],
          "properties": {"english_start": {"type": "string"}, "confident": {"type": "boolean"}, "note": {"type": "string"}}}

def ask(p):
    w, a, b, kind = p
    seq = secs[w]; i = next(k for k, s in enumerate(seq) if s[0] == a)
    A, B = seq[i], seq[i + 1]
    eng = A[2].rstrip() + " " + B[2].lstrip()
    body = f"<greek_A ref=\"{a}\">{A[1]}</greek_A>\n<greek_B ref=\"{b}\">{B[1]}</greek_B>\n<english>{eng}</english>"
    m = CLIENT.messages.create(model=MODEL, max_tokens=16000, thinking={"type": "adaptive"},
        output_config={"effort": "high", "format": {"type": "json_schema", "schema": SCHEMA}},
        system=SYSTEM, messages=[{"role": "user", "content": body}])
    d = json.loads(next(x.text for x in m.content if x.type == "text"))
    q = d["english_start"].strip()
    hits = [h.start() for h in re.finditer(re.escape(q), eng)]
    cur = len(A[2].rstrip()) + 1
    return {"work": w, "a": a, "b": b, "kind": kind, **d, "found": len(hits),
            "shift_chars": (hits[0] - cur) if len(hits) == 1 else None, "eng_len": len(eng),
            "usage": [m.usage.input_tokens, m.usage.output_tokens]}

with cf.ThreadPoolExecutor(8) as ex:
    res = list(ex.map(ask, pairs))
inp = sum(r["usage"][0] for r in res); out = sum(r["usage"][1] for r in res)
print(f"{len(res)} calls, in {inp} out {out}, cost ${(inp*4+out*20)/1e6:.2f}")
json.dump(res, open(out_f, "w"), ensure_ascii=False, indent=1)
for r in res:
    print(r["kind"], r["work"], r["b"], "found", r["found"], "shift", r["shift_chars"], "conf", r["confident"], "|", r["english_start"][:60])
