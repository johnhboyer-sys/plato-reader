# Search port: what differs, file by file

Plato's `shared/` against aristotle-reader `origin/main` (`eae145a3f1`, which holds the redesign merge
`de57f687c6`), measured 16 Nov 2026. The plan is aristotle-reader's `HANDOFF-SEARCH-PORT.md`. Nothing here
is ported yet. The hunk-by-hunk list is [`diff-map-hunks.md`](diff-map-hunks.md), written by
[`diff-map.py`](diff-map.py); run it again after Aristotle's counting PR lands.

## How the hunks were sorted

- **The common base is Plato's own code.** Aristotle's commit `86693cb7ad` ("Search build S1: adopt Plato's
  search stack, keep everything Aristotle's") copied the search from plato-reader `51aa7c3b22` and put back
  Aristotle's own behaviour: Bekker lines, Busse, authenticity, chapter pages, `?q=`, the old CSV columns.
  Every Plato file below is unchanged since `51aa7c3b22`, so no hunk is a Plato change Aristotle lacks.
- So each hunk of Plato → Aristotle is one of:
  - **port**: new in Aristotle since S1 (the new search), on lines S1 did not touch. Bring it over.
  - **port?**: the same, but its Aristotle side names Bekker, chapters, authenticity or Busse. New, but
    probably Aristotle's own: read it before porting.
  - **keep**: a line S1 changed and nothing changed since. Aristotle's own behaviour over Plato's; Plato
    keeps its side (Stephanus, speakers, sections).
  - **both**: overlaps an S1 change and differs from it. Aristotle's own lines that the new search changed
    again. Merge by hand.
- Old Aristotle main (`6941109fb7`) is not a usable base: most of these files did not exist there, or held
  Aristotle's old search.

## Headline

- **About 3,400 changed lines to port, almost all in five files**: `Search.svelte` (248 clean hunks, 2,467
  lines), `search.ts` (50, 485), `result-views.ts` (12, 298), `search-url.ts` (18, 94), plus the new
  `proximity-sentence.ts` (110). Smaller clean ports: `greek-keys.ts`, `betacode.ts`, `saved-searches.ts`,
  `SavedSearches.svelte`.
- **Plus the B styles, about 3,800 lines Plato lacks entirely**: `b.css` (1,391), `b-search.css` (2,237),
  `b-guide.css` (154). The new `Search.svelte` drops its own 1,158-line `<style>` block for 140 lines and
  leans on `b-search.css`. If John keeps Plato's look, `b-search.css` has to be rewritten against Plato's
  tokens instead of copied: the largest single job in the port.
- **30 hand merges** (`both`): 22 in `Search.svelte` (901 lines, 596 of them the style block), 3 in
  `paired-hit.ts`, 2 each in `search-url.ts` and `data.ts`, 1 in `search.ts`, and 52 in `works.ts` that
  the search does not need (see below).
- **Riskiest files:**
  1. **`chapter-pages.ts`** (Aristotle-only, 160 lines). The new pager cuts pages between chapters, read
     from `offsets.json` `chapter_bounds`. **Plato's `chapter_bounds` is empty in all 36 works**, and the
     pager then lays each book out whole (`!starts?.length` branch). Ported as is: Meno's every ἀρετή hit on
     one page, a Republic book per page, and after the counting PR the bar would count books. Plato needs
     its counting unit (John's ruling) emitted as `chapter_bounds` (or a Plato pager) before this works.
  2. **`paired-hit.ts`, `english-place.ts`, and the pairing hunks of `Search.svelte` (~2024–2136).**
     Aristotle pairs a hit with the other language by Bekker-tick span (`seg.english.bekker`). Plato's
     English carries no Bekker ticks (`english.bekker` is `[]`); Plato pairs by section and turnFlow row.
     These are `both` hunks: Plato's pairing must stay, the new display around it comes over.
  3. **The `<style>` move** (`both`, `Search.svelte` 4810–5405). Depends on the look ruling.
  4. **Imports Plato's modules do not export** (the port fails to compile until each is answered):

     | Module | Missing in Plato | Used by |
     |---|---|---|
     | `lib/works` | `AUTHENTIC_IDS`, `HAS_SPEAKERS`, `SEARCH_GROUPS` | `Search.svelte`, `search-url.ts` |
     | `lib/data` | `isChapterSection` (also `BekkerRef`, `citeLabel`, `citeLabelOf`, `lineRef` for the palette and resume, not the search) | `Search.svelte` |
     | `lib/chapter-pages` | the file | `Search.svelte` |
     | `lib/proximity-sentence` | the file | `Search.svelte` |
     | `lib/english-hit` | `englishPlace`, `overlayPieces`, `WINDOW` | `Search.svelte`, `paired-hit.ts`, `english-place.ts` |
     | `lib/paired-hit` | `bekkerEnglish`, `pairContext`, `pairEnglishWindow`, `pairGreekWindow` | `Search.svelte` |
     | `lib/result-views` | `formKey`, `ownGrammar`, `paradigmOf`, `searchKind`, `viewsOffered` | `Search.svelte` |
     | `lib/search` | `COMBO_TERMS_MAX`, `ComboGroup`, `comboGroups` | `Search.svelte`, `search-url.ts`, `proximity-sentence.ts` |
     | `lib/greek-keys` | `KEY_ROWS` | `Search.svelte` |

     `HAS_SPEAKERS` is `false` in Aristotle and gates the speaker controls; Plato sets it `true`.
     `AUTHENTIC_IDS` drives the form's "authentic works" choice and `w=auth`. Plato's registry already
     marks ten works `authenticity: 'dubious'` (Alcibiades I and II, Hipparchus, Lovers, Theages, Hippias
     Major, Clitophon, Minos, Epinomis, Letters), so the list is one line; whether Plato's form offers the
     choice is John's call.

## File by file

Hunks are from `diff-map-hunks.md`; cells are hunks (changed lines). Size is a rough guide to the port's
work, not to lines typed.

| File | port | port? | keep | both | Port size | Notes |
|---|---|---|---|---|---|---|
| `components/Search.svelte` | 248 (2,467) | 21 (545) | 35 (88) | 22 (901) | **Large** | The form (sheets on a phone, the In: row, Proximity menu), result bar, views, CSV. `keep` hunks are Bekker/chapter labels over Plato's Stephanus. New prop `chapterTitles` (Plato passes `{}`). |
| `components/SavedSearches.svelte` | 1 (2) | – | – | – | Trivial | |
| `lib/search.ts` | 50 (485) | – | 23 (150) | 1 (6) | Medium | `keep`: Aristotle's chapter and cross-chapter proximity (`unit: 'chapter'`, `crossChapter`, approximate-chapter notice). |
| `lib/search-url.ts` | 18 (94) | 3 (12) | 9 (22) | 2 (5) | Small | `port?`: `w=auth`. Plato's `sp`/`sn` speaker keys stay. |
| `lib/search-pages.ts` | – | – | 2 (19) | – | None | Aristotle's version is its chapter variant; Plato keeps its own. |
| `lib/chapter-pages.ts` | – | – | new file (160) | – | **Medium, risky** | Aristotle-only today; Plato needs its own unit's bounds (above). |
| `lib/result-views.ts` | 12 (298) | – | – | – | Small–medium | Clean. |
| `lib/form-panel.ts` | – | – | – | – | None | Identical. |
| `lib/english-hit.ts` | – | – | 4 (25) | – | Small, risky | Aristotle split English placement into `english-place.ts`; the new `Search.svelte` imports `englishPlace` from here. |
| `lib/english-place.ts` | – | – | new file (236) | – | **Medium, risky** | Bekker-tick placement; Plato needs a section/row version or none. |
| `lib/paired-hit.ts` | 3 (6) | – | 3 (10) | 3 (102) | **Medium, risky** | Bekker-tick pairing (above). |
| `lib/proximity-sentence.ts` | – | new file (110) | – | – | Small | Flagged only for "in the same chapter"; Plato says its own unit. |
| `lib/running-text.ts`, `.worker.ts`, `running-match.ts` | – | – | – | – | None | Identical (they came from Plato). |
| `lib/greek-keys.ts` | 2 (25) | – | – | – | Trivial | `KEY_ROWS`. |
| `lib/betacode.ts` | 1 (8) | – | 1 (1) | – | Trivial | |
| `lib/saved-searches.ts` | 7 (18) | – | – | – | Trivial | Storage key stays `plato-saved-searches.json`. |
| `lib/speakers.ts`, `sect-ticks.ts`, `speaker-colors.ts`, `inscription.ts` | – | – | – | – | None | Identical: Plato's, dead code in Aristotle. Keep Plato's. |
| `lib/corpus-tools.ts` | – | – | 1 (4) | – | None | Keep Plato's. |
| `lib/data.ts` | 2 (4) | – | 55 (866) | 2 (82) | Small | Nearly all Aristotle's reader (Bekker index, quotations). The search needs only `isChapterSection` (re-exported from `citation.ts`). |
| `lib/works.ts` | 1 (1) | 1 (7) | 198 (1,363) | 52 (504) | Small | Aristotle's registry; do not merge. Add the three exports the search needs, written for Plato. |
| `lib/citation.ts` | – | 1 (32) | 1 (4) | – | Small | `isChapterSection` and friends; Plato's citations are Stephanus. |
| `styles/b.css` | new (1,391) | | | | **Large or none** | Look ruling. Needs `.dir-b` on the page, and fonts Plato does not load (Sofia Sans, Literata, Oswald). |
| `styles/b-search.css` | new (2,237) | | | | **Large** | Copy (B look) or rewrite against Plato's tokens (own look). |
| `styles/b-guide.css` | new (154) | | | | Small | |
| `styles/global.css` | | | | | Keep | Plato's own (3,964 lines, the stoichedon design); Aristotle's is 2,454 after moving rules to `b.css`. Do not sync. |

## Corpus files the new search fetches

Checked against the 16 Nov rebuild of Plato's corpus (`build/dist`, from `scripts/build-public.mjs`).

| File | What the search uses it for | Plato builds it? |
|---|---|---|
| `<work>/search/greek_form.json`, `greek_lemma.json`, `grammar-dict.json`, `grammar-col.bin`, `meta.json` | Greek search | Yes |
| `<work>/search/english.json`, `english-<slot>.json` (`english-overlay-jowett.json`) | English search, by translation | Yes (Jowett on 11 works) |
| `<work>/search/offsets.json` | Speaker filter, and in the new search the pager, which loads it for every work in the result before page 1 | Yes, but **`chapter_bounds` is empty** in all 36 works; `turn_bounds` (speeches) is filled in dialogue works and empty in the narrated ones (Republic, …) |
| `<work>/search/running.json` | Running-text search | Yes (stage 6, since 10 Nov) |
| `search-shards/index.json`, `vocab.json`, `<stream>/<name>.json`, `accents/<name>.json` | Corpus-wide shards | Yes (stage 9) |
| `<work>/chapters.json` | The outline the results group under | **Empty (`{}`) in every work.** The search already handles this: `sectionsToChapters` (from Plato) groups by Stephanus page from `sections.json` |
| `<work>/sections.json` | Stephanus outline | Yes |
| `lemma-map/<letter>.json`, `lemma-picker/<letter>.json`, `lemmata.json` | Lemma search and picker | Yes |
| `ngrams/…` | Phrase browser links | Yes (stage 8) |
| `bekker.json` | Aristotle's Bekker jump index (palette), not the search | No, and not needed |
| `<work>/quotations.json` | Aristotle's reader, not the search | No, not needed |
| `chapterTitles` (a prop from `search.astro`) | Chapter names over results | Plato has none; pass `{}` |

A missing file can fail quietly: the search catches an `offsets.json` miss and lays the book out whole
(`Search.svelte` ~802). The baseline (`counts-base-2026-11-16.json`) is the check that it did not.
