# Handoff: advanced search for the Plato Reader

**Written from aristotle-reader, 2026-07-27**, the day the advanced-search work
shipped there (PR #56, deployed to gh-pages `de0cfb2f`). Plato was bootstrapped
from that repo and still shares its pipeline/shared/app shape, so most of this
is a port, not an invention. Do the work **in the plato-reader repo/session**.
Read aristotle-reader's code for reference; never edit it from here.

Everything below was measured against the two repos as they stand today. Where
a number is an estimate it says so.

---

## 1. Where the two repos stand

Plato already has the lexical half: per-work Greek form and lemma indexes, an
English index, and the `/search` page over them.

| | Aristotle | Plato |
|---|---|---|
| `stage6_search.py` | 481 lines | 191 lines |
| per-work search artifacts | `greek_form` `greek_lemma` `english` `meta` `offsets.json` `grammar-dict.json` `grammar-col.bin` | `greek_form` `greek_lemma` `english` `meta` |
| corpus-wide n-gram stage | `stage8_ngrams.py` (302 lines) | none |
| corpus-wide shards | `/data/ngrams/**` (97 MB), `/data/lemma-map/`, `/data/lemma-picker/` | none |
| client library | `shared/lib/search.ts`, 1,188 lines | 1,188-line file exists but is the pre-advanced version — diff it |
| UI | `Search.svelte` 2,599 lines, `Phrases.svelte` 1,355, `/advanced` 723, `/phrases` | `Search.svelte` (older), no `Phrases.svelte`, no `/advanced`, no `/phrases` |

Corpus scale, so you can size the build before running it: Aristotle indexes
848,592 Greek tokens; Plato's 36 works come to **~561,500** (counted as Greek
form postings across `build/dist/*/search/greek_form.json` — close enough for
sizing, not a citable figure). Aristotle's n-gram payload is 61 MB of Greek
(form 18 MB, lemma 42 MB). Plato should land near **40 MB**. Measure it before
you commit to shipping it; do not assume.

---

## 2. What to build, in order

Each step is independently verifiable. Do not start the next until the current
one passes its gate.

### Step 1 — the offset primitive (`stage6_search.py`)

Port the `-- Offset primitive --` block (aristotle `stage6_search.py:261`). It
emits `offsets.json`:

```
{ token_count, seg_base_offset[], segments[{book, column, line_runs}],
  book_bounds[], chapter_bounds[] }
```

The global offset of any posting is `seg_base_offset[seg_idx] + token_pos`, so
**no existing posting changes and no reverse map is needed**. It counts every
stage-3 token, keyless ones included, so it stays in step with `token_pos`.
`token_count` doubles as a build fingerprint: every artifact indexed by offset
must agree on it or they came from different runs, and the client throws when
they disagree. Keep that check.

**The one place Plato genuinely differs.** The coordinate fields are named for
Bekker but the shape is scheme-neutral: a Plato segment is keyed `(book,
column)` too, where `column` is the Stephanus token `34b`. Keep the field names
so `shared/lib/search.ts` ports unchanged; the values are Stephanus.

`chapter_bounds` has **no Plato analogue and must not be faked.** Plato has no
chapters. Emit it empty for now, and see §3 for what belongs in its place.

*Gate:* port `check_offsets` from `stage2_validate.py` and run it over all 36
works.

### Step 2 — the grammatical index (`stage6_search.py:342`)

Port `_FEATURES`, `parse_reading`, `signature`, and the emission of
`grammar-dict.json` + `grammar-col.bin`. It is a signature dictionary plus a
packed column, **not an inverted index** — grammatical predicates are
anti-selective (`case=gen` matches ~10% of every token) so postings go
near-dense and dwarf the lexical index.

Four rules in that code are load-bearing and were each arrived at the hard way:

- **No part of speech.** Morpheus emits no noun/verb/adjective field. Inferring
  one would overstate the data: participles carry both nominal and verbal
  morphology, and nouns and adjectives are indistinguishable here. Only
  Morpheus's own explicit markers are indexed, under `marker`.
- **`part` is the participle mood, not `particle`.** Different tags. Never
  conflate them.
- **Syncretic values expand inside a reading.** `nom/voc/acc` becomes three
  values in that one reading. A single analysis spanning three cases is
  genuinely three-way ambiguous and must not be reported as one certain parse.
- **Whole readings are kept, never a per-category union.** Analyses
  `{masc nom sg, fem acc pl}` must not satisfy a query for masc + acc + sg. A
  flattened union would wrongly allow it.

Reserved ids `SIG_UNKEYED = 0` and `SIG_UNANALYSED = 1` keep the column aligned
with the offset space where there is nothing to say about a token.

*Gate:* `check_grammar` from `stage2_validate.py`; the column's length must
equal `token_count` for every work.

### Step 3 — the fold streams (`stage6_search.py`) and stage 7 copy

Stage 6 also writes per-work fold streams to `build/ngrams/<work>.json` — one
for `form`, one for `lemma`. Stage 8 merges them. Extend Plato's `stage7_emit`
to copy the new files into `build/dist/<work>/search/`.

**Fix `english_head` while you are in here.** Plato's stage 6 still truncates it
to the first 500 chars and Aristotle's docstring still calls the field a legacy
name. Query time uses it for exact-phrase verification and English occurrence
counting, so it **must carry the full English chunk**. A truncated head silently
undercounts. Same for `greek_head`: Aristotle now emits the first line, Plato
the first two — match whichever the ported client expects and say which in the
docstring.

### Step 4 — `stage8_ngrams.py` (new file)

The pipeline's first cross-work stage. Copy aristotle's whole module; its
header docstring is the spec. Output shape:

```
build/dist/ngrams/<stream>/<letter>.json         browse list
    { "<fold phrase>": [n, count, score, works] }
build/dist/ngrams/<stream>/occ/<letter>-<n>.json fetched on expand
    { "<fold phrase>": { "EN": [1204, 88, 310], "Republic": [90211] } }
```

Occurrences are per-work global offsets, delta-encoded after the first. The
browse list carries the work map so the UI can say "37 times across 5 works"
without loading a single offset. The browse/occurrence split is not cosmetic:
keeping them together made one Aristotle shard 10.4 MB, which defeats sharding.

Four build-time rules:

- A phrase never spans a **book** edge (bounds come from `offsets.json`).
- A phrase never spans a token no index can key (a stage-3 key failure).
- A phrase is kept only if it occurs **at least twice corpus-wide**.
- Chapter straddling is **not** filtered at build time — it is a query-time
  toggle, and dropping the occurrences would make the toggle unimplementable.
  For Plato this becomes turn straddling, or nothing (§3).

Stage 8 also emits `build/dist/lemma-map/<letter>.json` — `fold(surface)` → the
headwords that surface can belong to. Not an n-gram artifact, but it needs the
same corpus-wide pass, and it is what lets a typed word be widened to its
inflected variants without the reader knowing any headwords. **Do not skip it**
(see §4, the lemma bug).

Both streams index every reading a position licenses, never a chosen one.
Excluding a reading here puts it beyond the reach of every later filter.

*Gate:* `check_ngram_streams`; plus `build:public` must invoke stage 8.

### Step 5 — wire stage 8 into the build

`scripts/build-public.mjs` cleans `build/dist` and then runs the per-work
stages. Stage 8 takes no `--work`, so it is **not part of `all`** and must be
called explicitly after the clean. Aristotle's `build-public.mjs:62` has the
call and the comment explaining why: without it a full rebuild emits a site
whose `/phrases` pages have no data behind them. Copy both.

### Step 6 — the client

Port from `shared/lib/search.ts`: `grammarSearchWork`, the combo path
(`~line 997`), offset→citation resolution (`~line 456`), and the lemma-map
widening (`~line 661`, `~line 1136`). The offset→citation function must be
rewritten for Stephanus: it turns a global offset into a citable position using
`offsets.json` alone, and Plato's output is `34b`, with no user-facing line
number (repo hard rule).

Then the UI: `Search.svelte` panels, a new `Phrases.svelte`, an `/advanced`
guide page, a `/phrases` page. §4 is the list of UI decisions Aristotle got
wrong first — read it before you copy the components, not after.

---

## 3. What Plato needs that Aristotle does not

**Turns are the missing structural unit.** Aristotle's `chapter_bounds` exists
so a query can say "within one chapter" and so the phrase index can flag a
phrase that straddles one. Plato's equivalent is the **turn** — already computed
by `pipeline/plato_pipeline/turns.py`, already global per book, already carrying
a speaker. Emit `turn_bounds[]` in `offsets.json` in the same shape
(`{start, accuracy}` plus speaker), and every downstream use of chapter bounds
maps over cleanly. This is a substitution, not a new mechanism.

**A speaker column is the feature the TLG cannot match.** Once turns are in the
offset space, one more artifact — `speaker-dict.json` plus `speaker-col.bin`,
built exactly like the grammar column — makes queries like *ἀρετή in Socrates'
mouth only* or *ψυχή anywhere but Socrates* answerable. Nobody else can run
that query on Plato. My recommendation: build the port first, ship it, then do
the speaker column as its own PR. It is the headline, but it is worthless on
top of a half-ported index.

**English is easier here.** Aristotle's English phrase index is weakened by 28
translators rendering one Greek phrase a dozen ways — the Greek↔English column
overlap test came out at 18%, which is why that feature shipped as a *ranking*
and not an equivalence (see aristotle-reader `docs/english-phrase-index.md`).
Plato is mostly Jowett. The same bridge should be markedly more reliable. Worth
testing early with one phrase; still not worth building before the Greek side
is done.

---

## 4. Mistakes Aristotle made first

Each of these cost a round trip. None need repeating.

- **A lemma search must accept the inflected form.** Typing `λόγου` in lemma
  mode returned nothing for a word occurring 2,269 times, because the index is
  keyed by headword. Resolve the surface through `lemma-map` at query time.
  This is why step 4 cannot skip the lemma-map emission.
- **Grammar is combo-only.** A standalone grammar query returns 33,504 hits for
  genitive-plural-feminine, which is not a search result, it is the corpus. Ship
  grammar as a filter on a lexical query and nothing else. Aristotle disabled
  its standalone grammar panel after building it.
- **No jargon in the radio labels.** "Any form of this word" / "Only as I typed
  it" — not "lemma" / "form".
- **Every number on the guide page must be generated or verified against the
  built corpus.** Aristotle's `/advanced` shipped with a "70 words" figure that
  was Nicomachean-Ethics-only, a phrase count 4× off (408 vs 102), and corpus
  totals from an older build. Numbers typed from a session go stale silently.
- **`<details>` needs `bind:open`, not a one-way binding**, or panels collapse
  as the user types.
- **Any regex over refs must be tested against section letters.** Aristotle lost
  51 lines across 13 works to a `[a-z]` class that swept lettered Bekker lines
  into headings. Plato's Stephanus columns are *all* letter-suffixed, so the
  exposure is larger, not smaller.
- **Snippets go through the shared sanitizer.** The search markup path has had
  an XSS defect before.

---

## 5. Success criteria

Machine-checkable, in the order they should pass:

1. `stage2_validate` gates green for all 36 works: `check_offsets`,
   `check_grammar`, `check_ngram_streams`.
2. `npm test` in `shared/` green — port aristotle's `combo.test.ts` and its
   `search.test.ts` additions, and add Stephanus cases to the offset→citation
   tests.
3. A full corpus rebuild followed by `npm run build:public` with **0 broken
   links** (`scripts/check-links.mjs` is the deploy gate; CI cannot run it,
   the corpus is machine-local).
4. Spot queries with counts verified by hand against the text — at least one
   per mode: form, lemma-widened-from-an-inflected-form, grammar-in-combo,
   phrase, English.
5. `/data/ngrams` total size measured and recorded. If it lands far from the
   ~40 MB estimate, find out why before shipping it.

## 6. Blast radius

Touch: `pipeline/plato_pipeline/{stage6_search,stage7_emit,stage2_validate}.py`,
a new `stage8_ngrams.py`, `scripts/build-public.mjs`, `shared/lib/search.ts`,
`shared/components/Search.svelte`, a new `shared/components/Phrases.svelte`,
`app/src/pages/{advanced,phrases}.astro`, and their tests.

Do not touch: the reader, turn-flow rendering, alignment, stages 1–5, or the
lexicon. `turns.py` is read-only for step 3's turn bounds — read what it emits,
do not change how it pairs.

Repo rules that still apply: summarize and wait for John's go-ahead before
committing on main (worktrees excepted), and never deploy without his explicit
say-so.

---

## 7. Addendum, 2026-07-28: the Phrases page in Svelte — read before Step 6

**Written from aristotle-reader the day the n-gram page was fixed to accept the
phrase as it stands on the page** (PR #57, deployed to gh-pages `99f0b57f`).

**This supersedes what §2 Step 6 implies about the phrase index.** That step
describes a page whose typed prefix names one shard. That design is wrong — it
made the commonest formula in the Metaphysics unfindable — and retrofitting it
in aristotle-reader cost a 325-line diff. Build it the way described here the
first time.

Everything below was measured in aristotle-reader. It applies to Plato as
written: the component, its two exports from `shared/lib/search.ts`, and its
tests port unchanged.

### A1. The defect the design must not repeat

The dictionary-form index is keyed on **headwords**. So the phrase a reader has
in front of them matches nothing when typed literally: `to ti hn einai` is
stored as `o tis eimi eimi`, because τό is not a headword — ὁ is. Prefix-match
the typed string and the commonest formula in the Metaphysics returns zero rows
while occurring 127 times.

The fix is to resolve each typed word through `/data/lemma-map/<letter>.json`
(fold(surface) → headwords) and match **every reading** of the phrase. Three
rules, each of which cost something to learn:

- **A single character never widens.** The letter-browse buttons type into the
  same box, and `h` is the surface of ἡ → ὁ, so widening one letter silently
  moves the browse to the O shard.
- **A word the map records uses its headwords alone** — do not union the typed
  word back in. A dictionary form is always among its own headwords (`o` → `o`,
  `os`), so the union changes no result, and τό is a headword of nothing:
  reading it literally fetched a 3.3 MB shard with zero matching rows.
  (`resolveHeadwords` in `search.ts` *does* union, correctly — there the extra
  option costs one index lookup, not a shard.)
- **A word the map does not record falls back to itself.** That is the fragment
  still being typed, and it is what keeps the list narrowing keystroke by
  keystroke.

Cap the fan-out at `VARIANT_READING_CAP` (64) and say so in the UI when it bites.

### A2. Shape it as a plan, not a letter

The readings of one typed phrase **do not live in one shard**. `hn einai` reads
E, H and O and merges 686 rows. So the query resolves to:

```ts
interface Plan {
  key: string;        // `${stream}|${normalizedPrefix}` — the query it answers
  stream: NgramStream;
  byLetter: Array<{ letter: string; prefixes: string[] }>;   // [] prefixes = whole shard
  readings: string[][];
  cappedFrom: number;
}
```

Bounded: the worst case across all 45,942 mapped surface forms is 4 letters, and
96% need 1. Do not cap it — a cap here drops rows silently.

Two consequences that are easy to get wrong and hard to notice:

- **A row's occurrence file comes from the row's own key**, never from the typed
  letter: `shardLetter(item.key)`, not `letter`. Same for the DOM id that keys
  expanded rows. Get this wrong and expanding a widened row 404s or, worse,
  silently resolves against the wrong shard.
- **The work filter should fetch occurrence files only for letters that actually
  produced rows**, not every planned letter. Widening ἦν plans three shards and
  two are routinely dead ends; at up to 2.9 MB per (letter × length) that is the
  difference between 4 fetches and 12.

### A3. Svelte specifics

- **Async derivation needs a signature guard.** An async step in a reactive
  chain must stamp `requestedKey = key` *synchronously, before its first await*,
  and consumers must check `plan.key === wantedKey` before rendering. Otherwise
  a fast typist renders rows for a query they have already replaced. Same
  pattern as the existing shard and work-filter loaders — reuse it, do not
  invent a second one.
- **One scan pass, prefixes grouped by shard letter.** A shard holds up to
  93,000 keys and the prefix test is per reading; testing every key against
  every reading is 6M `startsWith` calls per keystroke. Iterate each shard
  against only the readings that begin with its own letter.
- **Do not put the row filter in a `.filter()` chain if you also need to know
  which readings matched.** One pass returns both; a second pass over 93k keys
  to compute the note is the lazy version of the same work.

### A4. Testing it (the trap that cost the most time)

`shared/lib/data.ts` caches every fetched shard per letter for the life of the
module. Under vitest that means **the second test in a file sees zero fetches**
and passes or fails for the wrong reason.

The obvious fix does not work: `vi.resetModules()` plus a dynamic
`import('../components/Phrases.svelte')` gives you a **second Svelte 5 runtime
instance**, and the component dies with `effect_orphan` — "`$effect` can only be
used inside an effect".

What works: mock the data module and record the calls.

```ts
const { shardCalls } = vi.hoisted(() => ({ shardCalls: [] as string[] }));
vi.mock('../lib/data', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/data')>()),
  fetchNgramShard: vi.fn(async (stream, letter) => {
    shardCalls.push(`${stream}/${letter}`);
    return shards[`${stream}/${letter}`] ?? {};
  }),
}));
beforeEach(() => { shardCalls.length = 0; /* spy fetch for lemma-map only */ });
```

Two more that will bite:

- **The page prints accent-free Greek.** Keys are accent-folded Beta Code, so
  `betaToGreek` yields `ο τις ειμι ειμι`, not `ὁ τίς εἰμί εἰμί`. Assert on what
  the page shows.
- **A phrase appears twice** — once as a row, once named in the note under the
  box — so scope row queries: `findByText(greek, { selector: '.phrase-greek' })`.

Write the failing test first and confirm it fails with the widening off. Five of
the nine tests in `shared/__tests__/phrases.test.ts` do.

### A5. Two control decisions, already made here

Copy them; both were John's calls after using the page.

- **Sort belongs in the results head, above the list** — not in the filter
  panel. It orders results; it does not filter them, and buried among filters
  nobody sees which order they are looking at.
- **The work filter is a checkbox list, not `<select multiple>`.** Picking two
  works out of 41 in a list box needs a modifier key nobody is told about, and
  one stray click throws the whole selection away. Two scrolled columns of
  checkboxes, `bind:group`, and a clear button carrying the count.
- The stream radio reads **"Word in any of its forms"**, not "Dictionary word":
  the word *dictionary* names the knowledge the fix exists to stop demanding.

### A6. Blast radius

Adds to what the main handoff lists: `shared/lib/search.ts` gains two exports
(`lemmaOptions`, and `lemmaReadings` becomes exported), and
`shared/components/Phrases.svelte` owns the plan. Nothing in the pipeline
changes — `stage8_ngrams.py` already emits `/data/lemma-map/`, which is what
makes all of this possible. If your port skipped that emit, go back for it.
