"""Turn batch answers into proposed English letter moves.
A move is proposed when Opus's start lies more than SMALL characters from the current one."""
import json, re, collections
SMALL = 40
pairs = {p["cid"]: p for p in json.load(open("pairs.json"))}
R = json.load(open("results.json"))
moves, stats = [], collections.Counter()
for cid, p in pairs.items():
    d = R["results"].get(cid)
    if d is None: stats["failed"] += 1; continue
    eng = p["ea"].rstrip() + " " + p["eb"].lstrip()
    cur = len(p["ea"].rstrip()) + 1 if p["ea"] else 0
    q = d["english_start"].strip()
    hits = [m.start() for m in re.finditer(re.escape(q), eng)]
    if len(hits) != 1:
        stats["quote_not_unique" if hits else "quote_not_found"] += 1
        moves.append({**{k: p[k] for k in ("work", "a", "b")}, "problem": f"{len(hits)} hits", **d}); continue
    shift = hits[0] - cur
    if abs(shift) <= SMALL: stats["ok"] += 1; continue
    stats["move_conf" if d["confident"] else "move_doubt"] += 1
    moves.append({"work": p["work"], "a": p["a"], "b": p["b"], "shift": shift, **d,
                  "now": eng[max(0, cur - 60):cur] + " ‖ " + eng[cur:cur + 60],
                  "proposed": eng[max(0, hits[0] - 60):hits[0]] + " ‖ " + eng[hits[0]:hits[0] + 60]})
json.dump(moves, open("moves.json", "w"), ensure_ascii=False, indent=1)
print(dict(stats), "cost", R["cost_usd"])
print(collections.Counter(m["work"] for m in moves if "shift" in m).most_common())
