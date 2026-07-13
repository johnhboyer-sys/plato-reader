# Deploy status

## Current
- **2026-07-13 (12th deploy): search-results CSV keeps its links clickable** —
  app-only (0 data change; only the Search island bundle rehashed → `search/index.html` + the bundle,
  2 files). A user reported the export CSV "splits the links across the columns" in iPad Excel. The CSV
  is RFC-4180 valid — the comma-laden English snippet is double-quoted — but iPad Excel / Numbers don't
  reliably honour quoted fields, so each snippet's internal commas split the row, and since every
  snippet has a different comma count the URL landed in a *different* column per row (Greek-only exports
  were unaffected: KWIC tokens carry no commas). Fix (`Search.svelte exportCsv`): emit the **URL before
  the Snippet**, Snippet last — URLs never contain a comma, so under any parser the link sits in one
  fixed clean column and stays clickable; only the trailing snippet can spill (harmless). New order:
  `Work, Book, Chapter, Citation, Language, URL, Snippet`. Built from main `4b5b4e922` (PR #15) via
  `scripts/build-public.mjs` (Node 22.23.1, `pipeline/.venv`). gh-pages `951d05b95` → `88517454f`.
  Gates: preflight ok · 62,786 LSJ keys resolve · 5,571 pages · 429,118 links / 316,079 anchors / 0
  broken. Live-verified (URL in a fixed column, full link intact, under a quote-ignoring parse).
- **2026-07-13 (11th deploy): 10 more Jowett dialogues in turn-by-turn compare** —
  Crito, Gorgias, Meno, Laches, Ion, Cratylus, Phaedrus, Sophist, Philebus, Theaetetus added as a
  turn-aligned Jowett second voice via `align_turns.py` (93.9–99.5% row coverage; per-work reports in
  `data/<work>/align-jowett.json`). Meno needs `speaker_map` BOY→Meno's Boy. Deferred to a future
  paragraph-level (embedding) aligner: narrated/monologue works (Phaedo, Symposium, Protagoras,
  Euthydemus, Lysis, Charmides, Timaeus, Critias, Apology), turn-granularity mismatches (Statesman,
  Laws), and Parmenides (no reference speaker attribution). Data delta (10× `book-01.json` +
  `align-jowett.json`) plus the `works.ts` registry adds, which rehash the reader island bundle — so
  every work landing+reader page changed; the lemma/citation pages (which don't embed the reader) did
  not. Built from main `7ef7b8195` via `scripts/build-public.mjs` (Node 22.23.1, `pipeline/.venv`).
  gh-pages `48960e9a1` → `951d05b95`. Gates: preflight ok · 62,786 LSJ keys resolve · 5,571 pages ·
  429,118 links / 316,079 anchors / 0 broken.
- **2026-07-13 (10th deploy): search results render for Stephanus works + darker/thicker English column** —
  app/shared + one committed data delta. Two X-feedback fixes plus the first shipping of the Jowett
  Euthyphro compare. (1) **Search rendered zero results** despite showing a hit/page count ("19 pages,
  none load"): Plato ships an empty `chapters.json` (it's cited by Stephanus page+section, outline in
  `sections.json`), but `Search.svelte`'s group builder — inherited from Aristotle — only read
  `chapters.json`, so every hit was dropped while the index-derived counts still displayed. `buildGroups`
  now dispatches on citation scheme: Stephanus works group hits by Stephanus page from `sections.json`
  (header "Stephanus 18 · 18a–18e"), Bekker/Busse keep `chapters.json`. Reproduced (369 instances / 0
  groups) and verified fixed live (29 groups / 7 books). (2) **English column read thin/light next to the
  Greek** — it was coloured `--text-mid` (muted grey) while Greek inherits full `--text`, and EB Garamond
  400 is lighter than Cardo 400; now full `--text` + weight 500 (500 added to the EB Garamond font
  requests in every page head). Data delta: **Jowett Euthyphro** turn-compare (`book-01.json` +
  `align-jowett.json`) — committed in `533486a57` after the 9th deploy, so this is its first deploy; no
  other work's data changed (the 10 in-progress Jowett translations were stashed for a clean
  origin/main build). Built from main `98b56d1c5` (PR #14) via `scripts/build-public.mjs` (Node
  22.23.1, `pipeline/.venv`). gh-pages `00d157330` → `48960e9a1`. Gates: preflight ok · shared LSJ keys
  all resolve · 5,571 pages · 429,098 links / 316,079 anchors / 0 broken. Live-verified (search renders;
  English weight 500, colour parity with Greek).
- **2026-07-13 (9th deploy): mobile-landscape header cleanup + balanced portrait bar** —
  app/shared only (corpus data byte-identical to the 8th deploy; only the CSS bundle + the
  5,570 HTML pages that reference it changed, 0 data JSON). All the round's complaints traced to
  reading **in landscape on a phone**, where the viewport clears the 680px portrait breakpoint and
  inherited the full desktop header. Fix: detect a phone-shaped viewport by *height*, not width —
  `@media (orientation: landscape) and (max-height: 500px)` (a landscape phone is <~430px tall;
  tablets/desktop are ≥768px, and width can't tell them apart since a landscape phone is 740–930px
  wide). There the buttons go icon-only and the whole nav row (Stephanus jump · Books · Pages) is
  dropped — navigation lives in the Contents (☰) sidebar, which already carries the same jump +
  full outline. Portrait: restored the balanced two-row bar (a one-row experiment felt cramped) and
  added the **⌘K badge** to the Search button (Plato binds Cmd/Ctrl+K via the command palette but
  never surfaced it in the port; gives the left group weight to read as balanced — matches the
  Aristotle reader). Codex-review fixes: a short phone also ≤680px wide (iPhone SE landscape,
  667×375) matched both media queries and the portrait two-row split won on source order — added
  `.page-header`-descendant one-row overrides that win by specificity; and the ⌘K badge rewrites to
  "Ctrl K" off macOS. Desktop/tablets unchanged. Built from main `a843cc6d7` (PR #13, Codex-reviewed)
  via `scripts/build-public.mjs` (Node 22.23.1, `pipeline/.venv`). gh-pages `16344e167` → `00d157330`.
  Gates: preflight ok · shared LSJ keys all resolve · 5,570 pages · 429,096 links / 316,079 anchors /
  0 broken.
- **2026-07-12 (8th deploy): dramatis personae + turn-flow section-split merge + label/colour refinements** —
  app/shared only (corpus data byte-identical to 6th/7th). (1) **Dramatis personae** — each direct
  dialogue's landing page gets a "Speakers" cast list, every name in the same `--spk-*` hue the reader
  assigns it; shown for 24 dialogues, suppressed for the 12 framed/narrated/monologue works (their real
  cast lives in embedded narration — deferred editorial). Slot logic shared via `shared/lib/speaker-colors`
  (`assignSpeakerSlots` + whole-work `collectDisplayOrder` roster, passed into Reader by ReaderShell so a
  speaker's colour is stable across a multi-book work AND matches the cast — fixes a Codex-found Laws bk12
  divergence) (PR #11). (2) **Turn-flow section-split merge** (`speakers.ts buildFlowRows`): when one
  speaker's speech continues across a Stephanus section boundary, the Greek-bearing residual carrying a
  same-speaker folded `sub` (same printed display) now merges into that row — Greek appended, tick inline,
  sub folded as a continuation paragraph — so the Greek stays beside the English it translates (Meno 70c
  was ~8 lines off) instead of a new row with a repeated label. A differing display (rubric like "The
  Speech of Pausanias") or speaker keeps its own row; para flows untouched; no text dropped (verified all
  36 dialogue works). (3) **Redundant-label suppression** — pure unit-tested `labelSuppression()` drops a
  lead-in/sub label repeating the same display, keeps rubric headings, resets on em-dash turns (both edge
  cases were Codex findings). (4) **Speaker colours ON by default** (opt-out remembered). (5) **Mobile
  Stephanus tick centered** in Both view (was left-pinned <680px). Built from main `3d41f5d7` (PRs #11/#12,
  each Codex-reviewed — merge clean, 2 label bugs found+fixed) via `scripts/build-public.mjs` (Node
  22.23.1, `pipeline/.venv`; the deploy build was recycled mid-astro by the env after preflight+LSJ passed,
  so the astro build was re-run standalone against the validated `build/dist`). gh-pages `d7e0e147` →
  `16344e16`. Gates: preflight ok · shared LSJ keys all resolve · 5,570 pages · 429,096 links / 316,079
  anchors / 0 broken · 196 vitest · svelte-check 0.
- **2026-07-12 (7th deploy): reader features from aristotle-reader + speaker colours + companion link** —
  three merged PRs, app/shared only (corpus data byte-identical to the 6th deploy):
  (1) **Command Palette (⌘K)** — a global launcher (Stephanus page → jump, work name → open+resume,
  Greek → lemma, else → corpus search), ported from aristotle-reader and reusing Plato's own
  scheme-aware `citation.ts`; also added the `?g=`/`?e=` search handoff to Search.svelte (PR #8).
  (2) **PWA / offline** — `manifest.webmanifest` + cache-as-you-read `sw.js` + `offline.html`;
  service-worker cache namespaced under `plato-reader-` so it never wipes the sibling
  aristotle-reader's cache on the shared `github.io` origin (Codex-review fix; PR #8).
  (3) **Speaker-name colouring** — Settings ▸ Speakers ▸ "Color speaker names" (multi-speaker
  dialogues only, off by default): each speaker's NAME (English lead-in + Greek siglum, never the
  prose) gets one of eight complementary `--spk-*` hues, per-name-hashed with in-book collision
  avoidance; light + dark tuned, print neutral (PR #9). (4) **Companion link** to
  https://johnhboyer-sys.github.io/aristotle-reader/ in the home footer (PR #10). Built from main
  `5ae1ada3` via `scripts/build-public.mjs` (Node 22.23.1, `pipeline/.venv`). gh-pages
  `bebbdf41` → `d7e0e147`. Gates: preflight ok · shared LSJ keys all resolve · 5,570 pages ·
  429,096 links / 316,079 anchors / 0 broken · 175 vitest · svelte-check 0. Each PR Codex-reviewed
  (PR #8 SW findings fixed). Investigated the aristotle Endnote-sidebar port and dropped it as
  inert for Plato (no work enables footnotes; no footnote data emitted).
- **2026-07-12 (6th deploy): post-launch fix round 1** — English paragraphs restored corpus-wide
  (walker was flattening Perseus `<p>` + para-milestones; 36/36 works now carry markers);
  narrated works (Republic, Apology, Charmides, Letters, Lovers) render as paragraph-anchored
  prose flow (`turnFlow.kind:"para"`) with center-gutter ticks instead of per-section blocks;
  orphan-turn fix (empty-slice drop + column-grouped residual folding + section-anchored
  English-only groups) — blank-English rows 288/274/291/679 → 0 in Lysis/Protagoras/Euthydemus/
  Parmenides (incl. 37 phantom Ceph. rows) and 0 corpus-wide; Laws unlabeled book-openers
  paired via leadE-attach with `Ath.` labels borrowed from Bury's own display forms (8 books);
  first-baseline alignment unified (deleted .ross-prose line-height:1.75; Both-view shared
  strut; slider un-frozen); Stephanus gutter widened to 3.5rem via --seg-gap (ticks were
  centered — gutter was too narrow for 4-char tokens); collapsible one-row Pages nav
  (tablet header 211px → 149px; prompted by Timothy Kearns's tweet). Built from main
  `85c77e9e` (PRs #5/#6/#7, each Codex terra-reviewed); gh-pages `619f9dbe` → `bebbdf41`.
  Gates: preflight ok · 5,570 pages · 423,526 links / 316,079 anchors / 0 broken ·
  117 pytest / 165 vitest · turn stats byte-identical to pre-change snapshot except the
  4 intended works.
- **2026-07-11 (5th deploy): mobile Greek reflow + same-speaker residual merge** — phones keep parallel columns but Greek reflows as prose per turn (ticks re-anchored to the column, edge padding added); unpaired English continuations by the same speaker merge into their speech's row (1,888 absorbed corpus-wide). Built from 8e9c1be7.
- **2026-07-11 (4th deploy): mobile Both view back to PARALLEL columns** (John reversed the stacking — turn rows re-level at every speaker change; the within-turn gap on long speeches is accepted; Greek mobile reflow is the candidate refinement if it's ever wanted).
- **2026-07-11 (3rd deploy): home nav redesign** — "Start here" featured row (Apology, Republic, Symposium, Meno, Phaedo, Gorgias) + six thematic shelves replacing the tetralogies (John: too inside-baseball); period notes on work landing pages; built from main f25f3a8a, links 0 broken, live-verified.
- **2026-07-11 (2nd deploy): mobile turn-row stacking fix** — app-only rebuild, incremental gh-pages commit. Phones now stack each turn (Greek block → its English) instead of squeezed side-by-side columns.
- **Live at https://johnhboyer-sys.github.io/plato-reader/ since 2026-07-11** (initial publication).
- gh-pages branch, single deploy commit built from main `5f45f94` via `scripts/build-public.mjs` (Node 22.23.1, `pipeline/.venv` python — uv is absent on this machine).
- Contents: the full 36-work Thrasyllan canon, turn-flow reader (Tier 0 speaker alignment), Stephanus gutter ticks (center gutter in Both view), Aegean palette, lemma pages INCLUDED (183MB of the 510MB artifact; John approved shipping everything).
- Gates at deploy: preflight ok · shared LSJ 62,786/62,786 keys resolve (12,084 entries / 24 shards) · 5,570 pages · 423,520 links / 316,079 anchors / 0 broken · 86 pytest / 151 vitest / svelte-check 0.

## Deploy recipe (carried from aristotle-reader, adapted)
1. Deploy from **origin/main**, never local main.
2. `PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH" node scripts/build-public.mjs` — full gate; **never pipe it through tail** (masks the exit code — this bit us on the very first deploy attempt when a dangling preflight-fix commit had been dropped by a stacked-PR merge; always check `$?` directly).
3. Incremental commit on a gh-pages clone; **never re-init** the branch at this size.
4. Update this file with every deploy.

## Gotchas discovered on first deploy
- **Stacked PRs don't auto-retarget**: merging PR #1 (base main) does NOT retarget PR #2 (base = PR #1's branch); merging PR #2 then lands in the *branch*, not main. Retarget stacked PRs to main (`gh pr edit N --base main`) before merging, and verify with `git merge-base --is-ancestor <sha> origin/main` that every expected commit reached main.
- GH Pages auto-enabled on the first gh-pages push (the explicit enable API returned 409).

## Pending
- Custom domain: John's call (plato.lyceum.institute or otherwise), later.
- Post-launch refinement list: narrated-work alignment, dash-heavy dialogue tail (Parmenides/Lysis/Protagoras/Euthydemus), English-side gutter precision (Tier 1+), spuria appendix, per-letter Letters nav, Jowett overlays.
