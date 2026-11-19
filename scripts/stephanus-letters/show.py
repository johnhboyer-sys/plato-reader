import json,glob,sys
w=sys.argv[1]; cols=sys.argv[2:]
for f in sorted(glob.glob(f'app/public/data/{w}/book-*.json')):
    for s in json.load(open(f))['segments']:
        if s['column'] in cols:
            g=' '.join(l['text'] for l in s['greek']); e=(s.get('english') or {}).get('text','')
            print('==',s['id'],len(g),len(e)); print('G:',g[:160],'…',g[-160:]); print('E:',e[:200],'…',e[-200:])
