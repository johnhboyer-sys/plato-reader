# Handoff: the whole TLG search plan, built in Plato

Written 2026-11-09 by the aristotle-reader search session, for the plato-reader session that is building paired hits (`docs/search-paired-hits-handoff.md`). **Start this only after the paired-hits PR is open.** Every PR below edits `shared/components/Search.svelte`, so they go strictly one at a time. Each one branches from `origin/main` after the one before it has merged.

John, 2026-11-09: "I want it to take the whole plan." Plato builds the plan now, and Aristotle (waiting on its redesign) and Homer port from Plato afterwards.

## Read first

1. The plan and the TLG analysis behind it: `git -C ~/Developer/aristotle-reader show origin/main:docs/search-update/tlg-comparison.md`. Section 1 says what TLG does; section 4 is the plan. This handoff maps section 4 onto Plato. Where the two differ, this handoff wins: it was written against Plato's code.
2. Plato's CLAUDE.md, whose rules apply:
   - commit freely in a worktree, and push `claude/` branches;
   - check behaviour, not screenshots;
   - no deploys without John;
   - Stephanus citations only, with no user-facing line numbers.

## John's rulings that bind this work

| # | Ruling (2026-11-09) | What it means here |
|---|---|---|
| 1 | Textual (character) search: yes | PR 9 below. |
| 2 | Part-of-speech search: yes, pipeline work included | PR 5. Take the word class only from real data (see PR 5). Plato's own comment at `Search.svelte:394-396` forbids inferring it from other features, and that still holds. |
| 3 | Grammar-only search: **allowed when something narrows it** | Search.svelte:387-392 refuses a grammar-only query today. Change that refusal in PR 5, as set out there. |
| 4 | Saved searches stay in the browser, no accounts | PR 8. |
| 5 | Middle Liddell: not now | It waits for a full grammata t8 version. Out of scope. |
| 6 | Every upgrade is ported to the other readers | Each PR ends with a port note for aristotle-reader and homer. |
| 7 | Under a Greek hit, the English comes from the translator chip in use, else the reference translation | Paired hits (already in hand). Any later view that shows paired English follows the same rule. |

## Plato features every PR must respect

These come from an audit of Plato's code (HEAD `83880eaa11`). Check them again before each PR, since the code moves.

- **Speaker filter.**
  - Code: `Search.svelte:752-880`, `search.ts:572-690`; URL params `sp` and `sn`; frozen in `searchCtx.speaker`.
  - Every count a PR adds must be counted **after** the speaker filter, or the control must visibly ignore it:
    - form list, facets, sort by frequency;
    - "where else", statistics, vocabulary, compare works;
    - print, saved searches.
  - Write a test with the filter on for each new count.
- **Combo window unit `turn`.**
  - `WindowUnit = 'words' | 'line' | 'turn'` (`search.ts:1369`), plus `crossTurn`.
  - Under a speaker filter, every term in the window must be spoken by a wanted speaker (`search.ts:1371-1384`).
  - NOT (PR 4) must define how it meets both rules.
- **Jowett and other turn-aligned translations.** Any English text a PR shows goes through `translationTexts(seg, t, turnsOf(...))` (`english-hit.ts:44`), never `seg.english` alone.
- **Stephanus citations** go through `formatCite`, `formatLocValue` and `groupUnitLabel`.
  - Hits group as Work › Book › Stephanus page.
  - Pages break only at whole Stephanus pages (`search-pages.ts:28-55`).
  - Many works are bookless (`isBookless`).
- **Highlight on jump**: `hlt=<column>:<pos,…>` (`Search.svelte:1156-1160`). New highlighting must keep it working.
- **URL holds the whole state** (`search-url.ts`). Every new control gets a parameter, written only when not the default, with a round-trip test.
- **Query path:** stage 9 shards (`search-shards/<stream>/<xx>.json`), with the per-work files as the fallback. A new data file needs a stage that writes it, a line in `scripts/build-public.mjs`, and a check in `scripts/verify-rebuild.mjs` that fails when it is missing. Write that failing case first.
- **Styles** go in the global stylesheet, not a component's `<style>`. Check the built page.
- **No explainer text** in results: labels, citations, counts and the texts only.
- **The phone in landscape is a real reader** (a reader with low vision): controls at least 40×40 px; never shrink type.

## The PRs, in order

Every PR meets the gates at the end of this file. Each "Build" list is the minimum; do not add features the list does not name.

### PR 1. Form panel: what the result is made of

TLG's sidebar list ("λόγος (11319) / λογος (340)" with checkboxes), but without a new request.

- **Build:**
  - Beside the results, list every Greek surface form found, with its count (after the speaker filter) and a checkbox, plus *Deselect all* and *Apply*. Unticked forms drop from the hits and from every count on the page.
  - When a typed form maps to several lemmata (`lemma-map`), group the forms under each headword.
  - URL param: `xf=` (the excluded forms, folded keys, comma-separated).
- **Where:** a pure `shared/lib/form-panel.ts` (forms and counts from the result set), with Search.svelte drawing it.
- **Tests:**
  - counts equal the hits shown;
  - excluding a form removes exactly its hits;
  - speaker filter on;
  - `xf` round trip.

### PR 2. Views and grammar facets

- **Build:**
  - View switch: *By Stephanus page* (today's) · *By form* · *By work* · *Grammar*.
  - Grammar view groups hits by form, prints each form's readings from `grammar-dict.json` (`sigs`), and offers facet checkboxes built from **the categories present in the result**.
  - Facets read `grammar-col.bin` per token. A token passes when any of its readings matches, which is the same rule as `oneOf` today. Show "one of N readings" where it is ambiguous.
  - Facets survive a change of view (TLG resets them; don't).
  - URL: `v=` (view) and `gf=` (facets, `cat.val` comma-separated, the same syntax as combo `g:` slots).
- **Tests:**
  - every view shows the same hits;
  - facet counts equal the hits shown;
  - an ambiguous token passes on any reading;
  - facets kept across views;
  - speaker filter on.

### PR 3. Reading the results

1. **Click any Greek word in a hit** to open the existing `WordPopup` card beside the results. It is mounted only by `Reader.svelte` today.
   - Load each hit work's `analyses.json` lazily, on first click.
   - `greekKwic` must emit tokens as buttons. They need 40×40 hit areas on touch, and the `<mark>` stays.
2. **Context:** a control for 1 line / 3 lines / the whole section (URL `cx=`), plus an inline *more* on each hit that expands it in place. No modal.
   - Greek is fixed at 8 tokens each side today (`GRK_WINDOW`, line 1453), English at 140 characters (`english-hit.ts:54`). Replace both with the control.
3. **Sort:** Stephanus order (the default) / by work / by form / by form frequency (URL `so=`).
4. **Page size:** 20, 40 (the default) or 100, plus a citations-only list for big results (URL `ps=`).
   - Page breaks stay at whole Stephanus pages (`search-pages.ts`).
   - Citations-only still breaks there, and simply prints more per page.
5. **Proximity highlight:**
   - In combo hits, shade the span from the first term to the last and mark every term, not only the anchor. Today `greekKwic(seg,[pos])` marks the anchor alone (line 1188).
   - Take the term positions from the result, as `hlt` does.
6. **Print:** a print stylesheet for the results in the global stylesheet. The `@media print` block at `global.css:3279` covers the reader only. Results print with their citations, without controls.

- **Tests:**
  - a click opens the card for that token's analyses;
  - each context setting;
  - each sort is stable and keeps Stephanus order inside its groups;
  - page size and citations-only;
  - every combo term is marked;
  - URL round trips.

### PR 4. Full wildcards, and NOT

**Wildcards.** Today only `*` and `?` work (`compilePattern`, `search.ts:187-232`), and a leading `*` is stripped, so Greek has no suffix search.

- **Data:** stage 6 (or stage 9) writes a form-vocabulary file: every distinct folded form. That is 46,389 forms, about 534 KiB as raw JSON; measure it gzipped.
  - Load it only when a pattern needs it: a leading wildcard, an anchor, or a class.
  - Add it to `build-public.mjs` and to `verify-rebuild.mjs`, with the missing-file case failing first.
- **Syntax:** `^` and `$` (word start and end), `[…]`, `[^…]`, `|`, `( )`, `?` (one letter, as now), `*` (any run, as now), `+` (one or more of the item before), and `.` (any one letter).
- **The leading-`*` conflict:**
  - In Greek script, a leading `*` is a wildcard, because Greek script needs no capital marker. So `*ικος` finds words ending -ικος.
  - In Beta Code, a leading `*` stays the capital marker, as now and as `liveGreek` (`betacode.ts:100-195`) treats it. Beta Code writes a suffix search as `.*ikos$`.
  - Update the "How to type Greek" help modal (`Search.svelte:2188-2232`) to match.
- **Matching:** match the pattern over the vocabulary, then look the matched forms up in the shards as now.

**NOT.**
- Add `'not'` to `SlotRelation` (`search.ts:1356`): a NOT slot must not occur within the window.
- Under a speaker filter, a NOT term excludes a hit whoever says the excluded word. State that in a code comment and test it.
- URL: the relation letter `n` on a `c=` slot.

- **Tests:**
  - every syntax element, positive and negative;
  - a Greek suffix search;
  - the Beta-versus-Greek leading-`*` rule;
  - NOT with words, line and turn units, with and without the speaker filter;
  - URL round trips.

### PR 5. Grammar search on its own, and part of speech

**Grammar alone (ruling 3).**
- A query made only of grammar terms runs when at least one of these narrows it:
  - a work selection smaller than all works;
  - an active speaker filter;
  - a NOT or near term in the combo.
- With none of them, the Search button stays enabled. On press, it shows the narrowing controls instead of results; no sentence of explanation.
- Update the comment at `Search.svelte:387-392` to the new rule, with the date and John's ruling.
- Tests: each narrower lets the query through; no narrower blocks it; the counts are right.

**Part of speech (ruling 2).**
1. **Find a real source first.** Check, in order:
   - (a) the Morpheus analyses Diogenes ships (`/Applications/Diogenes.app/Contents/dependencies/data`; read only, never modify the app), for an explicit POS code per analysis;
   - (b) the LSJ headword's word class, per lemma;
   - (c) Morpheus's existing `marker` values.
2. **Report coverage** (the share of tokens given a POS by a real source) before building. If no source covers at least 95% of analysed tokens, **stop and report to the orchestrator.** Do not infer from other features.
3. **Then:**
   - the stage-4/6 pipeline adds a `pos` category to `grammar-dict.json` (noun, verb, adjective, article, pronoun, plus the existing `marker` classes);
   - `verify-rebuild.mjs` checks it is present;
   - the combo and facet grids gain *Part of speech*;
   - the article is lemma ὁ, read from the analysis's lemma, which is data, not inference.
4. **Tests:**
   - pipeline: POS on known tokens, and an unanalysed token has none;
   - UI: a POS term and a POS facet.

### PR 6. Input

1. **Lemma suggestions in the main Greek box** (`#grk-input`, ~line 1731).
   - Reuse the `lemma-picker/` data and ranking from the Single-lemma panel (`Search.svelte:584-640`): headword, count and gloss, commonest first.
   - Show the dictionary form with its genitive and article where the lemma data already holds them. Do not build new data for this.
   - Picking a suggestion sets the lemma search, as the Single-lemma panel does.
   - Keyboard: arrows, Enter, Esc.
   - The list must not fight `liveGreek`'s caret handling (`Search.svelte:1595-1632`).
2. **Transliteration.**
   - Accept conventional transliteration as well as Beta Code: th→θ, ph→φ, ch/kh→χ, ps→ψ, rh→ρ, ē→η, ō→ω, a leading h→rough breathing, y→υ in diphthongs, and ou.
   - It is a fixed table in `shared/lib/`, applied before folding, and printed in the help modal.
   - It must not change any query that works today: `logos` and `texnh` stay Beta Code. Write the clash cases as tests first, and stop and report any query whose meaning would change.
3. **On-screen polytonic keyboard.**
   - Turn the help modal's chart into a keyboard: letters, both breathings, three accents, diaeresis, iota subscript, backspace, space.
   - It types into the Greek box through the same path as `liveGreek`.
   - Keys at least 40×40 px; usable on a phone in landscape.
4. **Case-sensitive switch.** A post-filter like the accent filter, comparing `tok.t` case. URL `cs=1`.
   - Port the accent-filter fixes from the paired-hits PR first, and give the case filter the same Beta Code conversion.

- **Tests:** suggestions and their keys; every transliteration rule and the clash cases; keyboard input; case on and off.

### PR 7. Corpus tools

1. **"Where else" from the reader.**
   - Select 2–5 words in the Greek, and offer *Where else* (by form or by lemma) in the reader's existing selection handling (`Reader.svelte:1381-1408`).
   - Answer from the existing n-gram index (`fetchNgramShard` and `fetchNgramOccurrences`, `data.ts:584-618`). It is used only by Phrases today.
   - Results link to each occurrence.
2. **Compare two works** (a new page beside `/phrases`).
   - Pick two works and list the n-grams they share, by form or lemma, side by side with citations, from the n-gram occurrence data.
   - Commonest-word filtering as Phrases does for English.
   - It needs no new pipeline data. If it turns out to, stop and size it first.
3. **Lemma statistics** on the lemma page (`app/src/components/LemmaPage.astro`).
   - Rate per 1,000 words by work and by book, with actual against expected counts.
   - Per work: the lemmata most over- and under-represented against the rest of Plato, and lemmata found only in that work.
   - Compute them at build time from the data already there; add a stage only if needed, with a `verify-rebuild` check.
4. **Vocabulary per work:** a lemma list with counts, expandable to forms, each linked to a search. One page per work, or a section on the work page; follow the site's existing work-page pattern.

- **Tests:**
  - the n-gram lookup for a known phrase;
  - shared n-grams for a known pair of works;
  - statistics that sum to the lemma's total;
  - the vocabulary list against the form index.

### PR 8. Saved searches (ruling 4)

- **Store:** each search's URL, which already holds everything, including `sp` and `sn`, plus a name, a note and the date. Keep them in `localStorage`, every read and write wrapped in try/catch, so a blocked store hides the panel and never breaks search.
- **Controls:** Save on the results; a list panel with Open, Rename, Note, Delete and Copy link; Export and Import as a JSON file.
- **Label:** one short label on the panel saying the list is kept in this browser.
- **Tests:**
  - save, open, rename, delete;
  - export then import;
  - a blocked store;
  - a saved search with a speaker filter reopens with it.

### PR 9. Textual search (ruling 1)

- **Data:** a per-work Greek running-text file, built at stage 6.
  - It holds the folded text, with an offset map back to segment, line and token for citations, highlighting and the speaker filter.
  - Raw Greek text is 6.2 MiB across the corpus; a folded Latin-letter file is smaller. **Measure it, and report the per-work and total gzipped size before building the client.**
  - Add it to `build-public.mjs` and `verify-rebuild.mjs`.
- **Client:**
  - A *Running text* search type beside the word index.
  - Regex over the folded text, which may cross word boundaries.
  - A switch for punctuation; diacritics follow the accent switch.
  - It loads works on demand, with a progress line.
  - It respects the work selection and the speaker filter (`speakerAt` on the match's token).
  - Results render as normal hits.
- **Tests:**
  - a match across a word boundary;
  - a match inside a word;
  - punctuation on and off;
  - citation and `hlt` correct for a mid-word match;
  - speaker filter on;
  - a work whose file fails to load is reported, not silently skipped.

## Gates for every PR

1. **Tests that fail first.**
   - Each new test fails before its change. Prove it once per PR by reverting the change.
   - A test of rendered output must fail when nothing renders. Use the settle pattern from the paired-hits PR.
2. `cd shared && npm test` and `npm run check` are clean; `node scripts/verify-shared-imports.mjs` reports 0 broken.
3. **Pipeline PRs (4, 5, 9 and perhaps 7):**
   - the pipeline tests pass;
   - a full rebuild in the canonical order (`scripts/build-public.mjs`) passes `node scripts/verify-rebuild.mjs`;
   - the new data's size is reported in the PR.
4. **Functional check on the dev server** (`npm run dev` in `app/`), per Plato's CLAUDE.md:
   - read the page text, not screenshots;
   - include a Republic search, a Jowett-overlay work, Timaeus, and a speaker-filtered search.
5. **Cross-family review:** Codex, `--model gpt-6.1-sol --effort medium`, findings only, on the diff. Fix every blocker and should-fix, or write in the PR why not.
6. **The PR description** lists the URL parameters it adds and ends with a **port note**: hunks, new files and data stages for aristotle-reader (Bekker, no speaker filter, no turn flow) and homer.
7. **Report to the orchestrator session (aristotle-reader search)** after each PR:
   - the PR link and the test counts;
   - each new test's failing-first proof;
   - Codex's findings and what you did with each;
   - any stop-and-report item.

   **Merging (John, 2026-11-09: "Yes, merge when green"):** merge a PR yourself once both hold:
   - every CI check on its latest commit has passed;
   - the Codex review is done, with every blocker and should-fix fixed or answered in the PR.

   Use a merge commit, as the repo does. Then start the next PR from the new `origin/main`. Deploying stays John's call.

## Stop and report, don't guess

- **PR 5:** no real POS source covers at least 95% of tokens.
- **PR 6:** a transliteration rule would change the meaning of a query that works today.
- **PR 9:** the running-text data is too big to ship as planned.
- **Any PR:** Plato's code contradicts this handoff in a way that changes the design.
- **Any PR:** a feature cannot respect the speaker filter.
