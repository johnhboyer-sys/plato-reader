"""Build the Stephanus-letter review page: doubtful moves first, then the confident ones with Grok's verdict."""
import json, html, os, re
SHOW = {"Alcibiades1": "Alcibiades I", "Alcibiades2": "Alcibiades II", "HippiasMajor": "Hippias Major", "HippiasMinor": "Hippias Minor"}
pairs = {p["cid"]: p for p in json.load(open("pairs.json"))}
t = json.load(open("tiers.json"))
R = json.load(open("results.json"))
key = json.load(open("grok-key.json"))
grok = {}
for i in (1, 2, 3):
    f = f"grok-verdicts-{i}.jsonl"
    if os.path.exists(f):
        for line in open(f):
            if line.strip():
                d = json.loads(line); grok[d["id"]] = d
E = html.escape

import unicodedata
_L = dict(zip("abgdezhqiklmncoprstufxyw", "αβγδεζηθικλμνξοπρστυφχψω"))
_M = {")": "̓", "(": "̔", "/": "́", "\\": "̀", "=": "͂", "|": "ͅ", "+": "̈"}
def greek(b):
    out, i = [], 0
    while i < len(b):
        c = b[i]
        if c == "*":
            j = i + 1; marks = ""
            while j < len(b) and b[j] in _M: marks += b[j]; j += 1
            if j < len(b) and b[j] in _L:
                out.append(_L[b[j]].upper() + "".join(_M[m] for m in marks)); i = j + 1; continue
            i += 1; continue
        if c in _L: out.append(_L[c])
        elif c in _M and out: out[-1] += _M[c]
        elif c in "^_0123456789": pass
        else: out.append(c)
        i += 1
    t = unicodedata.normalize("NFC", "".join(out))
    return re.sub(r"σ(?=$|[^\w])", "ς", t)

import glob
# A FULL-corpus build (all 36 works); the main checkout often holds only part of one.
D = os.environ.get("STEPHANUS_DATA", "/Users/johnboyer/Developer/plato-reader/.claude/worktrees/intelligent-curran-f4c120/app/public/data/").rstrip("/") + "/"
LEM = json.load(open(D + "lemmata.json"))
SEG, AN, USED = {}, {}, {}

def seg(work, sid):
    if work not in SEG:
        SEG[work] = {}
        for f in sorted(glob.glob(D + work + "/book-*.json")):
            for g in json.load(open(f))["segments"]:
                SEG[work][g["id"]] = g
        AN[work] = json.load(open(D + work + "/analyses.json"))
    return SEG[work][sid]

def words(work, sid, tail):
    """The section's Greek as clickable words: the last ~300 chars (tail) or the first ~300."""
    items = []  # (html, length)
    for line in seg(work, sid)["greek"]:
        pos, txt = 0, line["text"]
        for tk in line.get("tokens", []):
            o = tk["o"]; w = tk["t"]
            pre = txt[pos:o]
            k = tk.get("k")
            if k and k in AN[work]:
                USED[k] = [{"l": LEM.get(a["lemma"], {}).get("head") or greek(a["lemma"]), "p": a.get("parse", ""), "g": a.get("gloss", "")}
                           for a in AN[work][k] if not a.get("unlikely")] or [{"l": greek(a["lemma"]), "p": a.get("parse", ""), "g": a.get("gloss", "")} for a in AN[work][k]]
                items.append((E(pre) + f'<span class="w" data-k="{E(k)}">{E(w)}</span>', len(pre) + len(w)))
            else:
                items.append((E(pre + w), len(pre) + len(w)))
            pos = o + len(w)
        items.append((E(txt[pos:]) + " ", len(txt) - pos + 1))
    out, n = [], 0
    seq = reversed(items) if tail else items
    for h, ln in seq:
        out.append(h); n += ln
        if n >= 300: break
    return "".join(reversed(out) if tail else out).strip()

def card(x, group):
    p = pairs[x["cid"]]
    eng = p["ea"].rstrip() + " " + p["eb"].lstrip()
    cur = len(p["ea"].rstrip()) + 1
    new = eng.find(x["english_start"].strip())
    ma, mb = p["a"].split(":")[-1], p["b"].split(":")[-1]
    marks = [(cur, f'<span class="m now">now {mb}</span>'), (new, f'<span class="m new">Opus {mb}</span>')]
    gline = ""
    if group == "confident":
        g = grok.get(x["cid"])
        if g:
            lab = {v: k for k, v in key[x["cid"]].items()}  # P/Q -> NOW/NEW
            if g["verdict"] in ("P", "Q"):
                side = lab[g["verdict"]]
                gline = f'<p class="gk {"agree" if side == "NEW" else "disagree"}">Grok: {"agrees with Opus" if side == "NEW" else "keeps the current place"}. {E(g["reason"])}</p>'
            else:
                at = eng.find(g["english_start"].strip()) if g["english_start"].strip() else -1
                if at >= 0: marks.append((at, f'<span class="m grok">Grok {mb}</span>'))
                gline = f'<p class="gk disagree">Grok: neither{"" if at >= 0 else " (its words not found)"}. {E(g["reason"])}</p>'
        else:
            gline = '<p class="gk">Grok: no verdict.</p>'
    lo = min(m[0] for m in marks); hi = max(m[0] for m in marks)
    a, b = max(0, lo - 260), min(len(eng), hi + 260)
    out, pos = [], a
    for at, tag in sorted(marks):
        out.append(E(eng[pos:at])); out.append(tag); pos = at
    out.append(E(eng[pos:b]))
    snip = ("…" if a else "") + "".join(out) + ("…" if b < len(eng) else "")
    rid = x["cid"]
    return f'''<article class="row">
<header><span class="ref">{E(SHOW.get(p["work"], p["work"]))} {ma} → {mb}</span><span class="ref">moves {abs(x["shift"])} characters {"earlier" if x["shift"] < 0 else "later"}</span></header>
<div class="pair"><p class="grc"><span class="gl">end of {ma}</span> …{words(p["work"], p["a"], True)}<br><span class="gl">start of {mb}</span> {words(p["work"], p["b"], False)}…</p><p class="eng">{snip}</p></div>
<p class="note">Opus: {E(x["note"])}</p>{gline}
<div class="mark" hidden data-row="{rid}" data-ref="{E(p["work"])} {mb}" data-group="{group}">
<button type="button" data-v="new" aria-pressed="false">Opus is right</button><button type="button" data-v="now" aria-pressed="false">Current is right</button><button type="button" data-v="other" aria-pressed="false">Neither</button>
<input type="text" placeholder="Note (where it should go, if neither)" aria-label="Note"><span class="saved"></span></div>
</article>'''

doubt = "\n".join(card(x, "doubtful") for x in t["tier2"])
conf = "\n".join(card(x, "confident") for x in t["tier1"])
ng = sum(1 for x in t["tier1"] if x["cid"] in grok)
agree = sum(1 for x in t["tier1"] if x["cid"] in grok and grok[x["cid"]]["verdict"] in "PQ" and key[x["cid"]][ "NEW"] == grok[x["cid"]]["verdict"])
head = open("page.head.html").read().replace("<title>Narrated Speakers Test</title>", "<title>Stephanus Letter Review</title>")
css = """
.m { font-family: var(--font-ui); font-size: .68rem; font-weight: 600; letter-spacing: .04em; border-radius: 3px; padding: 0 4px; margin: 0 3px; vertical-align: 2px; white-space: nowrap; }
.m.now { color: var(--muted); border: 1px dashed var(--muted); }
.m.new { color: var(--accent); border: 1px solid var(--accent); }
.m.grok { color: var(--s4); border: 1px solid var(--s4); }
.gl { font-family: var(--font-ui); font-size: .68rem; color: var(--muted); text-transform: uppercase; letter-spacing: .05em; margin-right: 4px; }
.w { cursor: pointer; } .w:hover, .w.on { background: color-mix(in srgb, var(--accent) 18%, transparent); border-radius: 2px; }
#pop { position: absolute; z-index: 9; max-width: 340px; background: var(--bg); color: var(--fg); border: 1px solid var(--muted); border-radius: 6px; padding: 8px 10px; box-shadow: 0 4px 16px rgba(0,0,0,.18); font-family: var(--font-ui); font-size: .85rem; }
#pop .lm { font-family: var(--font-greek, serif); font-size: 1rem; font-weight: 600; } #pop .ps { color: var(--muted); } #pop div + div { margin-top: 6px; padding-top: 6px; border-top: 1px solid color-mix(in srgb, var(--muted) 30%, transparent); }
.gk { font-family: var(--font-ui); font-size: .85rem; margin: 2px 0; }
.gk.agree { color: var(--s3); } .gk.disagree { color: var(--accent-2); }
.mark button[aria-pressed="true"][data-v="new"] { color: var(--s3); border-color: var(--s3); font-weight: 600; }
.mark button[aria-pressed="true"][data-v="now"], .mark button[aria-pressed="true"][data-v="other"] { color: var(--accent-2); border-color: var(--accent-2); font-weight: 600; }
"""
head = head.replace("</style>", css + "</style>")
body = f'''<main>
<header class="ui" style="display:grid;gap:8px">
<h1>Where the English Stephanus letters belong</h1>
<p class="lede">The English letters come from the Perseus edition of the Loeb translations and were never checked against Burnet's Greek. Claude Opus 5.5 read every one of the 8,516 section boundaries in the corpus, seeing the Greek of both sections and the English run together with no mark, and named the English words where the second section begins. It agreed with the current place, or came within a line of it, at 8,289 boundaries. These cards are the 227 where it would move the letter a line or more.</p>
<p class="lede">In the English, the dashed tag is where the letter sits now and the blue tag is where Opus would put it. The Greek shows the end of one section and the start of the next. Mark each card; nothing changes in the source until you have.</p>
</header>
<p class="tally" id="tally">Marking loads once you're signed in to claude.ai. Without it the page still reads.</p>
<h2>Doubtful moves <span class="cn">{len(t["tier2"])}</span></h2>
<p class="note">Opus marked these as not confident, mostly where the translator reorders a sentence across the boundary. Its note says why.</p>
{doubt}
<h2>Confident moves, checked by Grok <span class="cn">{len(t["tier1"])}</span></h2>
<p class="note">Grok saw each of these blind: the two places were labelled P and Q at random, and it had to say which renders the start of the Greek section. Grok agrees with Opus on {agree} of {ng} so far. It chose neither place on none of them. On the one where it kept the current place (Laws 719e → 720a), the Greek favours Opus: 719e ends on ἐπ', which governs ἄλλον … νόμον at the start of 720a, and the English renders the phrase as \"and so turn off to another law\".</p>
{conf}
</main>'''
script = open("/Users/johnboyer/Developer/plato-reader/scripts/speakers/review.test.template.html").read().split("</main>", 1)[1]
script = script.replace('const sample = boxes.filter(b => b.dataset.group === "sample");', 'const sample = boxes;')
script = script.replace('`Random sample: <b>${done.length}</b> of ${sample.length} marked, ` +\n      `<b>${done.filter(b => marks[b.dataset.row].verdict === "wrong").length}</b> wrong. ` +\n      `All rows: <b>${wrong}</b> marked wrong. Mark a row Right or Wrong; a note saves when you leave the box.`',
  '`<b>${done.length}</b> of ${sample.length} marked: <b>${done.filter(b => marks[b.dataset.row].verdict === "new").length}</b> Opus right, <b>${done.filter(b => marks[b.dataset.row].verdict === "now").length}</b> current right, <b>${done.filter(b => marks[b.dataset.row].verdict === "other").length}</b> neither. A note saves when you leave the box.`')
popjs = """<div id="pop" hidden></div><script>
const AN = """ + json.dumps(USED, ensure_ascii=False).replace("</", "<\\/") + """;
(() => {
  const pop = document.getElementById("pop"); let on = null;
  const esc = s => s.replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const close = () => { pop.hidden = true; if (on) on.classList.remove("on"); on = null; };
  document.addEventListener("click", e => {
    const w = e.target.closest(".w");
    if (!w) { if (!e.target.closest("#pop")) close(); return; }
    if (w === on) { close(); return; }
    close(); on = w; w.classList.add("on");
    const a = AN[w.dataset.k] || [];
    pop.innerHTML = a.length ? a.map(x => `<div><span class="lm">${esc(x.l)}</span> <span class="gs">${esc(x.g)}</span><br><span class="ps">${esc(x.p)}</span></div>`).join("") : "<div>No analysis.</div>";
    pop.hidden = false;
    const r = w.getBoundingClientRect();
    const left = Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 8);
    pop.style.left = Math.max(8, left) + "px"; pop.style.top = (window.scrollY + r.bottom + 4) + "px";
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
})();
</script>"""
script = script.replace("</body>", popjs + "</body>") if "</body>" in script else script + popjs
open("review.html", "w").write(head + body + script)
print("cards", len(t["tier2"]) + len(t["tier1"]), "grok verdicts", ng, "agree", agree, "bytes", os.path.getsize("review.html"))
