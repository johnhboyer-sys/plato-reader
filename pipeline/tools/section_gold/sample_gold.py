"""Draw a random sample of Loeb section starts (o>0) in Jowett-paired turns,
and write two gold-request files for a cross-family reader."""
import json, random, glob, re
random.seed(20261109)
items = []
for bp in sorted(glob.glob('build/dist/*/book-*.json')):
    work = bp.split('/')[2]
    d = json.load(open(bp))
    for ti, t in enumerate(d['turnFlow']['turns']):
        a = (t.get('alt') or {}).get('jowett') or {}
        if not a.get('e'):
            continue
        parts, es, pos = [], [], 0
        for txt, ss in [(t.get('e'), t.get('es'))] + [(s.get('e'), s.get('es')) for s in (t.get('sub') or [])]:
            if not txt: continue
            if parts: pos += 1
            es += [(pos + x['o'], x['c']) for x in (ss or [])]
            parts.append(txt); pos += len(txt)
        ref = ' '.join(parts)
        for o, c in es:
            if o > 0:
                items.append(dict(work=work, book=bp.split('/')[-1], turn=ti, c=c, o=o, ref=ref, alt=a['e']))
print('candidates', len(items))
sample = random.sample(items, 80)
json.dump(sample, open('pipeline/tools/section_gold/gold_sample.json', 'w'), ensure_ascii=False, indent=1)
def window(text, center, half):
    a, b = max(0, center - half), min(len(text), center + half)
    return text[a:b], a
for k in range(2):
    out = []
    for i, it in enumerate(sample[k*40:(k+1)*40]):
        n = k*40 + i
        ref = it['ref']; o = it['o']
        before = ref[max(0, o-500):o]; after = ref[o:o+500]
        prop = round(o / len(ref) * len(it['alt']))
        alt = it['alt']
        if len(alt) > 3000:
            alt, _ = window(alt, prop, 1500)
        out.append(f"### ITEM {n}  ({it['work']} {it['c']})\nLOEB (section {it['c']} starts at ‖):\n…{before}‖{after}…\n\nJOWETT passage:\n{alt}\n")
    open(f'build/sectmatch/gold_request_{k}.md', 'w').write('\n'.join(out))
