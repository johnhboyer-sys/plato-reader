import json, glob, os, statistics, math, sys
rows=[]
for w in sorted(os.listdir('app/public/data')):
    fs=sorted(glob.glob(f'app/public/data/{w}/book-*.json'))
    if not fs: continue
    segs=[]
    for f in fs:
        segs+=json.load(open(f))['segments']
    data=[]
    for s in segs:
        g=sum(len(l['text']) for l in s['greek'])
        e=s.get('english') or {}
        e=len(e.get('text','')) if isinstance(e,dict) else 0
        data.append((s['column'],s['id'],g,e))
    rs=[math.log(e/g) for _,_,g,e in data if g>150 and e>0]
    if not rs: continue
    med=statistics.median(rs); sd=statistics.pstdev(rs)
    # boundary skew: section i short and i+1 long (or vice versa)
    for i in range(len(data)-1):
        c1,id1,g1,e1=data[i]; c2,id2,g2,e2=data[i+1]
        if g1<80 or g2<80 or e1==0 or e2==0: continue
        z1=(math.log(e1/g1)-med)/sd; z2=(math.log(e2/g2)-med)/sd
        if z1*z2<0 and min(abs(z1),abs(z2))>1.5:
            rows.append((round(abs(z1)+abs(z2),1),w,c1,c2,round(z1,1),round(z2,1)))
    empty=[c for c,_,g,e in data if g>100 and e==0]
    if empty: print('EMPTY english',w,empty[:10],len(empty))
rows.sort(reverse=True)
print(len(rows),'adjacent pairs skewed opposite ways (|z|>1.5 both)')
from collections import Counter
print(Counter(r[1] for r in rows).most_common())
for r in rows[:40]: print(r)
json.dump(rows,open(sys.argv[1],'w'),ensure_ascii=False)
