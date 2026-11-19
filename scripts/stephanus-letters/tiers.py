"""Pick the moves worth a reader's eye, then sort them for the review page.
Run in the run folder after fetch: writes moves2.json (all candidate moves) and tiers.json.
  candidate: Opus's start crosses a sentence boundary from the current one, or lies >100 chars off
  tier1 = confident and |shift| >= 80, tier2 = not confident and |shift| >= 80, small = the rest"""
import json, re
pairs = {p["cid"]: p for p in json.load(open("pairs.json"))}
R = json.load(open("results.json"))["results"]
SB = re.compile(r'[.?!;:—][’”"\')]*\s+[‘“"(]?[A-Z]')
out = []
for cid, p in pairs.items():
    d = R[cid]; eng = p["ea"].rstrip() + " " + p["eb"].lstrip(); cur = len(p["ea"].rstrip()) + 1 if p["ea"] else 0
    new = eng.find(d["english_start"].strip()); lo, hi = sorted((cur, new))
    inner = [m for m in SB.finditer(eng, lo, hi) if m.end() - 1 > lo + 1 and m.start() < hi - 1]
    if inner or hi - lo > 100:
        out.append({"cid": cid, "work": p["work"], "a": p["a"].split(":")[-1], "b": p["b"], "shift": new - cur, "crossed": len(inner), **d,
                    "now": eng[max(0, cur - 90):cur] + " ‖ " + eng[cur:cur + 90], "proposed": eng[max(0, new - 90):new] + " ‖ " + eng[new:new + 90]})
json.dump(out, open("moves2.json", "w"), ensure_ascii=False, indent=1)
t1 = [x for x in out if x["confident"] and abs(x["shift"]) >= 80]
t2 = [x for x in out if not x["confident"] and abs(x["shift"]) >= 80]
small = [x for x in out if abs(x["shift"]) < 80]
json.dump({"tier1": t1, "tier2": t2, "small": small}, open("tiers.json", "w"), ensure_ascii=False, indent=1)
print("moves", len(out), "tier1", len(t1), "tier2", len(t2), "small", len(small))
