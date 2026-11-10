# Handoff: search hits show Greek and aligned English together

Written 2026-11-09 by the aristotle-reader search session, for a plato-reader session to build now. The Aristotle reader is waiting on its own redesign, so Plato goes first this time, and Aristotle ports from Plato afterwards.

## The goal

John's ruling, 2026-11-09:

> every search hit shows the Greek AND the aligned English, whether the query was Greek, English or both.

What Plato does today (`shared/components/Search.svelte`, `buildGroups`, ~lines 1158–1225):

| Search | Each hit shows |
|---|---|
| Greek only | A Greek snippet only (`lang: 'grk'`, `greekKwic`). |
| English only | One row per translation (`rows`, `englishSnippets`). No Greek. |
| Both | Greek and English hits as separate instances in the same group. They are not paired. |

Aristotle is in the same state on the live site. Its unmerged redesign stage 4 adds one English line under a Greek hit, cut by Bekker line ticks. Plato has no Bekker ticks but has something better: the turn flow.

## Part 0: two accent-filter fixes from Aristotle (small; do first, own commit)

Aristotle fixed both in aristotle-reader commit `ec0bf17610` (PR #194). Read it with `git -C ~/Developer/aristotle-reader show ec0bf17610`. Do not copy files across: Plato's `betacode.ts` and `Search.svelte` have diverged.

### 0a. Beta Code with "Match accents exactly"

- **The bug in Aristotle:** `grkAccentTerms` ran the raw query through `accentNorm` (Plato: `Search.svelte:1405-1406`). A Beta Code term such as `lo/gos` was compared as typed against the Greek-script word λόγος, so every hit was dropped.
- **Plato may only half-share it.** Plato converts Beta Code as you type when the Beta Code tab is on (`liveGreek`, line 1604). But a URL such as `/search?g=lo/gos&acc=1`, or Latin letters typed with the tab off, may still reach the filter raw.
- **Write the failing test first.** If no route reaches the filter raw, record that and skip 0a.
- **If it does fail:** convert each term before `accentNorm`. Try Plato's own `liveGreek` first: it already reads `*` after a letter as the wildcard and a leading `*` as the capital marker. It must also pass every case below. Port Aristotle's `betaQueryToGreek` only if `liveGreek` cannot be made to.

The cases (Aristotle's, from `shared/__tests__/betacode.test.ts` and `components.test.ts`), with the hit as the word λόγος:

| Query | Expected |
|---|---|
| `lo/gos` | kept |
| `lo/g*` | kept |
| `lo/g?s` | kept |
| `*lo/gos` | kept |
| `lo\gos` (grave accent) | dropped |
| `logos` (no accent) | dropped |
| `**)/a` | becomes `Ἄ`: every leading `*` is the capital marker, as `compilePattern` in `shared/lib/search.ts` strips `^\*+` |
| `*a1`, `lo/g*1` | the digits are dropped, as `greekFold` drops them |

### 0b. Elision marks

- `accentNorm` (Plato line 362) does not fold `’` (U+2019) or `ʼ` (U+02BC) to `'`, though `greekFold` (`shared/lib/search.ts:187`) folds all three alike.
- Plato's text stores `'` in 14,520 Greek words (36 works) and `’` in 5 (2 works). So a pasted `δ’` misses nearly every elided word when the box is ticked.
- **Fix:** append `.replace(/[’ʼ]/g, "'")` to `accentNorm`.
- **Tests:** in both directions (`'` typed against a stored `’`, and `’` or `ʼ` against a stored `'`), plus a same-mark control and a wrong-letter control (`τ'` against `δ’`: dropped).
- **Test rig:** Aristotle's `marksFor(url, token?)` helper in `components.test.ts` replaces the word at position 0 with `vi.mocked(fetchBook).mockResolvedValueOnce(...)`. Also add an `afterEach` that calls `vi.mocked(fetchBook).mockReset().mockResolvedValue(fixtureBook)`, because an unused `Once` value outlives `vi.clearAllMocks()`. Codex found that leak in Aristotle's version.

## Part 1: pair every hit with its counterpart

### The alignment unit: the turn, cut to the section

Every book in `build/dist` has a `turnFlow`: 56 books, 18,670 turns, and every turn has a Greek pin. That includes the narrated works, whose rows are `kind: 'para'`. Each `FlowTurn` (`shared/lib/data.ts:51`) holds:

| Field | What it is |
|---|---|
| `g: {c, n, o}` | Where the turn's Greek starts: Stephanus section token (= `Segment.column`), Greek line `n`, character offset `o` in that line. The Greek runs to the next turn's `g`. |
| `e` | The turn's English in the reference translation. `null` for a Greek-only residual. |
| `alt[id].e` | The same turn in each alternate translation, written by `align_turns.py`. `null` where that translation has no match. |
| `es` | Offsets in `e` where each Stephanus section begins (also on `alt[id]` and on `sub` entries). Use these to cut a long turn down to the hit's section. |
| `sub` | Stacked one-sided speeches under the row (Lysis, Parmenides…). Treat each one as a turn. |

The alignment unit for a hit is **the turn that holds it, cut to the hit's section with `es`**. A turn is the finest unit both sides share. A section alone is too coarse (a whole Stephanus section of English under one word), and a turn alone is too long (Timaeus' monologue spans pages).

Build a small pure helper in `shared/lib/` (new file `shared/lib/paired-hit.ts`, so the hunk ports back to Aristotle cleanly):

```ts
// One aligned unit of a book: a turn, or a turn's part inside one section.
interface PairUnit {
  section: string;                 // Stephanus column token
  greek: { n: number; from: number; to: number }[];  // line spans of the Greek
  english: Record<string, string>; // translation id → text cut to this section
}
function pairUnits(book: BookData, translations: TranslationRef[]): PairUnit[];
function unitAtGreek(units: PairUnit[], seg: Segment, pos: number): PairUnit | undefined;
function unitAtEnglish(units: PairUnit[], seg: Segment, t: TranslationRef, wordPos: number): PairUnit | undefined;
```

`unitAtGreek` maps a Greek token position the same way `lineOfPosition` (Search.svelte:1069) does, then finds the last unit whose `g` comes at or before that token, by (section, line, offset). Units with no Greek (`g` null) are never chosen for a Greek hit.

`unitAtEnglish` is the hard part, so check before you trust it:
- **Overlay (alternate) translations:** `translationTexts` already returns one text per turn for the section (`turnTranslationTexts`, english-hit.ts:25), in index order. So the hit's word position, counted through those texts, names the turn directly.
  - A turn is filed under the section where it **starts** (`g.c`), so a hit inside a long turn is indexed under the turn's first section, even when its words lie in a later one.
  - Use the turn's `alt[id].es` to find which section the matched word really falls in, and cut there.
- **The reference translation:** the section's text is the single string `seg.english.text`. First test, over every book in `build/dist`, whether it equals the section's turn slices (`e`, and `sub[].e`) joined in order, after the same plain-text stripping the index uses. If it does, count words through the slices. If it does not hold for some works, fall back to the section level for those works (the whole section's Greek) and list them in the PR.
- Either way, write the check as a test that fails on a fixture where the join does not match, so the fallback is proven to fire.

### What each hit shows

| Search | Hit shows |
|---|---|
| **Greek** | The Greek snippet, as now, then the unit's English in one translation, labelled with the translator's short name and linked into the reader in that translation. If two Greek hits in a row share a unit, the English is shown once, under the first (Aristotle's stage 4 does the same). |
| **English** | The English rows, as now, then the unit's Greek (`lang="grc"`, unmarked, since no Greek word matched). |
| **Both** | A Greek hit and an English hit in the same unit become one instance: Greek with its matches marked, then English with its matches marked. No second row. A hit with no partner in its unit shows as Greek-only or English-only does above. |

**Length caps**, set as named constants in the helper:
- English under a Greek hit: at most 60 words, taken from the start of the unit's section cut, ending in `…` when cut.
- Greek under an English hit: at most 3 Greek lines, from the start of the unit, ending in `…` when cut.

No explanatory labels: the translator's short name, the citation and the two texts only (the house rule on reader text).

**Speaker filter.** A Greek hit under a speaker filter carries `speaker`. Its paired English comes from the same turn, so the speaker matches. Keep the `inst-speaker` label as it is.

**Counts.** A merged instance counts every hit it holds, Greek and English, exactly as the two separate instances did. The total and the work and translator chips must not change. Test that.

### Ask John before building this: which translation goes under a Greek hit?

- (a) the reference translation (the `english` slot) always;
- (b) the translator chip in use (`transFilter`), falling back to the reference translation (**recommended**: the reader picked it);
- (c) every translation the work carries, stacked like the English rows.

Build to his answer. If he is away, build (b) and say so in the PR.

## Where the code goes

- `shared/lib/paired-hit.ts` (new): the units and lookups. Pure, no Svelte, so it can be unit-tested and ported.
- `shared/components/Search.svelte`:
  - `Instance` gains `pairGreek?: string` (html) and `pairEnglish?: { html, label, title, jumpUrl }`;
  - `buildGroups` fills them and merges same-unit instances when both queries ran;
  - the markup at ~2386–2420 draws them under `inst-snippet` / `sx-tr`.
- Styles go in the global stylesheet, not the component's `<style>`. aristotle-reader found component styles dead on its built reader pages, so check the built page.
- Nothing may assume Bekker numbers, and nothing may assume a turn flow exists. If a book lacks `turnFlow`, fall back to the section, so the helper ports back to Aristotle.

## Done when

1. Part 0's tests failed before each fix and pass after. Prove it once by reverting the fix line and watching them fail.
2. The paired-hit tests fail first and then pass. Each must fail when nothing renders: use Aristotle's settle pattern (wait for the status line and `fetchBook`, then assert).
   - `paired-hit.ts` unit tests:
     - a Greek position at a turn's first token, last token, and across a section break inside one turn;
     - a `sub` speech;
     - a narrated `kind: 'para'` row;
     - a `g: null` residual;
     - the reference-translation join check (holds, and a fixture where it fails → section fallback).
   - Component tests:
     - Greek-only shows English under the hit;
     - English-only shows Greek;
     - both merges one unit into one instance with both sets of marks;
     - counts unchanged;
     - consecutive hits in one unit show the English once.
3. `cd shared && npm test` and `npm run check` are clean, and the repo's own gates pass (`scripts/verify-rebuild.mjs` is not needed: no data changes).
4. Functional check, following Plato's CLAUDE.md (functional, not screenshots, unless John asks), at `npm run dev` in `app/`:
   - `/search?g=ἀρετή`, `/search?e=virtue`, `/search?g=ἀρετή&e=virtue`;
   - a narrated work (Republic), a turn-aligned Jowett work, Timaeus' monologue (the cap), and a speaker-filtered search.

   Read each page's text and check that the English under a Greek hit is the same turn and section as the Greek, for five hits by hand.
5. Cross-family review: Codex, `--model gpt-6.1-sol --effort medium`, findings only, on the diff. Fix its findings, or say why not.
6. Work in a worktree on a `claude/` branch and push it. The PR ends with a **port note** for aristotle-reader: the hunks, the new `paired-hit.ts`, the Bekker-tick fallback Aristotle needs where Plato uses turns, and anything specific to Plato.

## Out of scope

- The rest of the TLG plan (word-form list with checkboxes, grammar view, wildcards, textual search…). It lives in aristotle-reader `docs/search-update/tlg-comparison.md` and comes later, one PR at a time.
- Deploying. That is John's call.

## Reference

- John's decisions on the whole search track, 2026-11-09:
  - search upgrades are ported across the readers;
  - textual and part-of-speech search are in scope;
  - saved searches stay in the browser, with no accounts;
  - Middle Liddell waits.

  All are in aristotle-reader `docs/search-update/tlg-comparison.md`.
- Aristotle's stage-4 version of the Greek → English line: aristotle-reader `.claude/worktrees/redesign-build`, `shared/components/Search.svelte` ~1055–1066 and 1754. That worktree is local and unpushed; read it, don't build on it.
