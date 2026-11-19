"""Check Republic labels against the Hackett (Cooper 1997) running heads.

The verso head names the speakers of each two-page spread. It lists the main
speakers, not every bit part, so a mismatch is a flag for review, not an error.
The heads were never shown to the model, so this stays an independent check.

  hackett.py final    # compares final-Republic.json (after adjudication)
  hackett.py 1|2      # compares one labelling pass from Republic.resolved.json

Reads hackett-republic-spreads.json from the run folder: [{from, to, speakers}].
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import check  # noqa: E402

MIN_WORDS = 3   # a speaker counts for a spread only with this many Greek words of speech


def key(ref: str) -> tuple[int, str]:
    m = re.match(r"(\d+)([a-e])", ref)
    return int(m.group(1)), m.group(2)


def main(which: str) -> None:
    spreads = json.loads((check.OUT / "hackett-republic-spreads.json").read_text())
    if which == "final":
        entries = [(e, e["final"]) for e in json.loads((check.OUT / "final-Republic.json").read_text())]
    else:
        entries = [(e, e["passes"][which]["segments"])
                   for e in json.loads((check.OUT / "Republic.resolved.json").read_text())]
    rows = {r["id"]: r for r in json.loads((check.OUT / "Republic.rows.json").read_text())}
    last = max(key(e["ref"]) for e, _ in entries)
    out = []
    for sp in spreads:
        a, b = key(sp["from"]), key(sp["to"])
        if a > last:
            break
        words: dict[str, int] = {}
        for e, segs in entries:
            if not a <= key(e["ref"]) < b:
                continue
            toks = rows[e["id"]]["greek"].split()
            for k, s in enumerate(segs):
                if s["kind"] != "speech":
                    continue
                end = segs[k + 1]["tok"] if k + 1 < len(segs) else len(toks)
                for who in s["speaker"].split("+"):
                    words[who] = words.get(who, 0) + end - s["tok"]
        head = {n.lower().replace("clitophon", "cleitophon") for n in sp["speakers"]}
        found = {w for w, n in words.items() if n >= MIN_WORDS}
        extra, missing = sorted(found - head), sorted(head - found)
        if extra or missing:
            out.append({"from": sp["from"], "to": sp["to"], "head": sorted(head),
                        "labels_add": {w: words[w] for w in extra}, "labels_lack": missing})
    (check.OUT / f"hackett-{which}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    n = sum(1 for sp in spreads if key(sp["from"]) <= last)
    print(f"{len(out)} of {n} spreads differ from the Hackett heads")
    for o in out:
        print(f'  {o["from"]}–{o["to"]} head {"/".join(o["head"])}: labels add {o["labels_add"]} lack {o["labels_lack"]}')


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "final")
