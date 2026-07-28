# Addendum: the Phrases page in Svelte — read before writing `Phrases.svelte`

**Written from aristotle-reader, 2026-07-28**, after the n-gram page was fixed
to accept the phrase as it stands on the page. Everything here was measured in
that repo. It applies unchanged to plato-reader and homer-reader: the component,
its two exports from `shared/lib/search.ts`, and its tests port as-is.

The handoff you already have describes a phrase index whose typed prefix names
one shard. **That design is wrong, and this addendum replaces it.** Build it
this way the first time; retrofitting cost a 325-line diff here.

---

## 1. The defect the design must not repeat

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

## 2. Shape it as a plan, not a letter

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

## 3. Svelte specifics

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

## 4. Testing it (the trap that cost the most time)

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

## 5. Two control decisions, already made here

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

## 6. Blast radius

Adds to what the main handoff lists: `shared/lib/search.ts` gains two exports
(`lemmaOptions`, and `lemmaReadings` becomes exported), and
`shared/components/Phrases.svelte` owns the plan. Nothing in the pipeline
changes — `stage8_ngrams.py` already emits `/data/lemma-map/`, which is what
makes all of this possible. If your port skipped that emit, go back for it.
