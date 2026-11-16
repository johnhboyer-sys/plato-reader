# Search port: what differs, file by file

Plato's `shared/` against aristotle-reader `origin/main` at `35a0ea89b6`, measured on the evening of 16 Nov
2026. That main holds the redesign (#195), the chapter counting (#197), the and | and/or | or switch (#198),
the Back fix (#199), the nested works list (#200), pages by rows (#201, ruling D) and the English phrase
list (#202, ruling C). Earlier runs that day were against `eae145a3f1` (redesign only) and `1f91dd389a`
(through #200). The plan is aristotle-reader's `HANDOFF-SEARCH-PORT.md`. Nothing here is ported yet. The
hunk-by-hunk list is [`diff-map-hunks.md`](diff-map-hunks.md), written by [`diff-map.py`](diff-map.py)
(`python3 docs/search-port/diff-map.py ~/Developer/aristotle-reader`: it reads only committed files, through
`git show origin/main:…`). This is the run the port starts from.

## What #197–#202 changed for the port

- **The join reads and | and/or | or (#198).** "and/or" is the inclusive or (`op=or`); "or" is the
  exclusive or (`op=xor`): sections where one language has hits and the other none (`chapterOnly` in
  `chapter-pages.ts`). Old links are settled: a link with Greek and English and no `op` still means "and"
  (John: keep old links), every link written now names its `op`, and a new search opens on "and/or".
- **Counting needs a new corpus file per work, `search/eng-chapters.json` (#197).** Aristotle's stage 6
  writes `{slot: {seg_idx: [[word_pos, chapter], …]}}`: where each chapter begins in each translation's
  words, so an English hit is put in its chapter before any book is fetched (`loadEngChapters` in
  `search.ts`). For Plato the unit is the section, and a section is a segment, so every entry is the
  segment's own start: `[[0, "<column>"]]` per segment per slot. Stage 6 must write it, along with
  `chapter_bounds` (above). Both are pipeline changes, so the port needs a data rebuild, and the deploy is
  John's call.
- **`chapter-pages.ts` grew from 160 to 276 lines** and is now `both`: it holds the counting itself
  (`chapterPlaces`, `chapterJoin`, `chapterOnly`, `paginatePlaces`, `measure`). It is the heart of the port.
- **`Search.svelte`'s `port?` hunks doubled** (21 → 42, 545 → 823 lines): most of the new counting code
  names chapters. Port it with "section" in place of "chapter" in the words the reader sees.
- **The nested works list (#200)** replaces the separate Translations list; it is plain `port` in
  `Search.svelte` and `b-search.css`.
- **Pages by rows (#201):** exactly N rows a page, and the 100-a-page view as citations with a summary.
  Plain `port` in `Search.svelte` (+539 lines across #201–#202) and `b-search.css` (now 2,293 lines).
- **The English phrase list (#202):** the three-word runs round the English hits, offered to set aside
  (Exclude only). A new file, `lib/phrase-list.ts` (79 lines, needs only `englishWords`, which Plato's
  `search.ts` already exports), plus a small `search-url.ts` key. A clean port.

## Rulings the port follows

- **Look (John, 16 Nov):** Aristotle's compact layout, run on Plato's existing CSS and fonts (`global.css`,
  `fonts.css`). B's tokens point at Plato's variables; B's sizes and spacing are kept. The mock's overlay is
  `plato-look-mock.css`. Do not copy `b.css` or `b-search.css` as they are.
- **Phone default (John, 13 Nov):** Both.
- **Join default (John, 16 Nov, for every reader):** the Greek–English join opens on the inclusive "or",
  labelled "and/or" ("it naturally suggests they can do greek only or english only OR both"); "and" stays on
  offer, and #198 adds the exclusive "or". Settled in aristotle-reader #198: a link with no `op` keeps
  meaning "and", as Plato's `search-url.ts` already reads it; every new link names its `op`.
- **Counting unit (John, 16 Nov): the Stephanus section** (70a, 70b…), where Aristotle counts chapters. "And"
  is both terms anywhere in the same section. Options and counts are on the rulings page,
  https://claude.ai/artifact/Q2ovWWx2KsqpMawjkfYP4R; Aristotle's counting PR (#197) merged 16 Nov.
  - A section is a search segment (`offsets.json` `segments`, one per column), so its bounds are already in
    the index: `seg_base_offset`. Either stage 6 writes them as `chapter_bounds` (named by column), or
    `chapter-pages.ts` reads segments directly. Today `chapter_bounds` is empty in all 36 works, and the
    pager then lays out whole books.
  - Measured (Loeb English only): ἀρετή + virtue gives 336 sections with both; ψυχή + soul 775; δικαιοσύνη +
    justice 190 (`unit-counts.json`).
  - John's condition: exact Stephanus starts in every translation. The Loeb's come from its own marginal
    letters (Perseus TEI section milestones), but at 3–4% of sections with the Greek word the English
    partner sits a few words over the boundary (ἀρετή 13 of 475, ψυχή 25 of 875, δικαιοσύνη 9 of 208).
    Jowett's letters are inferred by our matcher (~92%, PR #84). Open: fix those boundaries, or let "and"
    reach one neighbouring section.

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

- **About 3,400 changed lines to port, almost all in five files**: `Search.svelte` (271 clean hunks, 2,834
  lines), `search.ts` (51, 487), `result-views.ts` (13, 296), `search-url.ts` (26, 113), plus the new
  `proximity-sentence.ts` (110) and `phrase-list.ts` (79). Smaller clean ports: `greek-keys.ts`, `betacode.ts`, `saved-searches.ts`,
  `SavedSearches.svelte`, `form-panel.ts`. Another ~1,000 lines are `port?` (51 hunks, 811 of them in
  `Search.svelte`): new, but they speak of chapters.
- **Plus the B styles, about 3,800 lines Plato lacks entirely**: `b.css` (1,391), `b-search.css` (2,293),
  `b-guide.css` (154). The new `Search.svelte` drops its own 1,158-line `<style>` block for 140 lines and
  leans on `b-search.css`. If John keeps Plato's look, `b-search.css` has to be rewritten against Plato's
  tokens instead of copied: the largest single job in the port.
- **37 hand merges** (`both`): 25 in `Search.svelte` (967 lines, much of it the style block), 3 in
  `paired-hit.ts`, 2 each in `search-url.ts` and `data.ts`, 1 each in `search.ts`, `search-pages.ts` and
  `chapter-pages.ts` (the whole file), and 52 in `works.ts` that the search does not need (see below).
- **Riskiest files:**
  1. **`chapter-pages.ts`** (Aristotle-only, 276 lines: the counting and the pager). It puts every hit in
     its chapter, read from `offsets.json` `chapter_bounds` (Greek) and `eng-chapters.json` (English), and
     cuts pages between chapters. **Plato's `chapter_bounds` is empty in all 36 works and it has no
     `eng-chapters.json`**: the file then puts each hit in its book. Ported as is: Meno's every ἀρετή hit on
     one page, a Republic book per page, and the bar counting books. Stage 6 must write both files, with the
     section as the unit, before this works.
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
     | `lib/chapter-pages` | the file (`chapterPlaces`, `chapterJoin`, `chapterOnly`, `paginatePlaces`, `measure`, and types) | `Search.svelte` |
     | `lib/proximity-sentence` | the file | `Search.svelte` |
     | `lib/phrase-list` | the file | `Search.svelte` |
     | `lib/english-hit` | `englishPlace`, `overlayPieces` | `Search.svelte`, `paired-hit.ts` |
     | `lib/paired-hit` | `bekkerEnglish`, `pairContext`, `pairEnglishWindow`, `pairGreekWindow` | `Search.svelte` |
     | `lib/result-views` | `formKey`, `ownGrammar`, `paradigmOf`, `searchKind`, `viewsOffered` | `Search.svelte` |
     | `lib/search` | `COMBO_TERMS_MAX`, `ComboGroup`, `comboGroups`, `EngChapters`, `loadEngChapters`, `englishIndexSlot` | `Search.svelte`, `search-url.ts`, `proximity-sentence.ts`, `chapter-pages.ts` |
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
| `components/Search.svelte` | 271 (2,834) | 44 (811) | 29 (79) | 25 (967) | **Large** | The form (sheets on a phone, the In: row, Proximity menu), the and | and/or | or switch, the nested works list, pages by rows, the phrase list, result bar, views, CSV. `keep` hunks are Bekker/chapter labels over Plato's Stephanus. New prop `chapterTitles` (Plato passes `{}`). |
| `components/SavedSearches.svelte` | 1 (2) | – | – | – | Trivial | |
| `lib/search.ts` | 51 (487) | 2 (14) | 23 (150) | 1 (6) | Medium | `keep`: Aristotle's chapter and cross-chapter proximity (`unit: 'chapter'`, `crossChapter`, approximate-chapter notice). New: `loadEngChapters`, `englishIndexSlot`. |
| `lib/search-url.ts` | 26 (113) | 3 (12) | 9 (22) | 2 (5) | Small | `port?`: `w=auth`. New: `op=xor`; a missing `op` still reads "and". Plato's `sp`/`sn` speaker keys stay. |
| `lib/search-pages.ts` | – | – | 1 (13) | 1 (6) | Small | Aristotle's version is its chapter variant; `chapter-pages.ts` re-exports `hitCount` and `engHitCount` from it. |
| `lib/chapter-pages.ts` | – | – | – | new file (276) | **Large, risky** | The counting and the pager. Needs `chapter_bounds` and `eng-chapters.json` with the section as the unit (above). |
| `lib/result-views.ts` | 13 (296) | – | – | – | Small–medium | Clean. |
| `lib/form-panel.ts` | 1 (2) | – | – | – | Trivial | |
| `lib/english-hit.ts` | – | – | 4 (25) | – | Small, risky | Aristotle split English placement into `english-place.ts`; the new `Search.svelte` imports `englishPlace` from here. |
| `lib/english-place.ts` | – | – | new file (236) | – | **Medium, risky** | Bekker-tick placement; Plato needs a section/row version or none. |
| `lib/paired-hit.ts` | 3 (6) | – | 3 (10) | 3 (102) | **Medium, risky** | Bekker-tick pairing (above). |
| `lib/phrase-list.ts` | new file (79) | – | – | – | Small | The English phrase list (#202). Not in `diff-map.py`'s file list; counted by hand. |
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
| `styles/b-search.css` | new (2,293) | | | | **Large** | Copy (B look) or rewrite against Plato's tokens (own look). |
| `styles/b-guide.css` | new (154) | | | | Small | |
| `styles/global.css` | | | | | Keep | Plato's own (3,964 lines, the stoichedon design); Aristotle's is 2,454 after moving rules to `b.css`. Do not sync. |

## Corpus files the new search fetches

Checked against the 16 Nov rebuild of Plato's corpus (`build/dist`, from `scripts/build-public.mjs`).

| File | What the search uses it for | Plato builds it? |
|---|---|---|
| `<work>/search/greek_form.json`, `greek_lemma.json`, `grammar-dict.json`, `grammar-col.bin`, `meta.json` | Greek search | Yes |
| `<work>/search/english.json`, `english-<slot>.json` (`english-overlay-jowett.json`) | English search, by translation | Yes (Jowett on 11 works) |
| `<work>/search/offsets.json` | Speaker filter, and in the new search the pager, which loads it for every work in the result before page 1 | Yes, but **`chapter_bounds` is empty** in all 36 works; `turn_bounds` (speeches) is filled in dialogue works and empty in the narrated ones (Republic, …) |
| `<work>/search/eng-chapters.json` | Where each section starts in each translation's words, so an English hit is counted in its section before any book is fetched (#197) | **No.** Stage 6 must write it: one `[[0, "<column>"]]` per segment per slot |
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
