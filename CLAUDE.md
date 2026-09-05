# Plato Reader

Static Astro site, parallel Greek/English complete works of Plato. Repo lives at ~/Developer/plato-reader (kept out of iCloud). Node 22 required.
Sister project to ~/Developer/aristotle-reader — same pipeline/shared/app architecture; consult that repo's CLAUDE.md and docs for shared-machinery background, but do not edit that repo from here.
Will be live on GH Pages as a project site at `/plato-reader`; custom-domain plan TBD.

## Hard rules
- Greek source is TLG (corpus code 0059). Never propose swapping to another edition or re-raise this.
- Citation scheme is Stephanus page + section (e.g. `34b`) — no Bekker-style line numbers, no line numbers user-facing.
- Before committing on the main working branch: summarize the work and wait for John's go-ahead.
  EXCEPTION — worktrees auto-clean: in a worktree, commit early and often without asking; push to a claude/ branch promptly. The review gate applies at PR time instead.
- Deploying data is John's call. Never deploy without explicit go-ahead.
- Verify functionally, not with screenshots. Screenshots only when John is on remote-control and asks for them.
- Copyright: for website, free/public-domain translations only, judged by US copyright rules only. (archive.org "NOT_IN_COPYRIGHT" can mean Canada-only — verify US status.)

## Deploy gotchas
- Deploy from origin/main, not local main.
- GH Pages deploys must be an incremental commit on a gh-pages clone; never run app and dist builds concurrently.
- GH Pages incident? Push a fresh empty commit.
- Base path is `/plato-reader` (see app/astro.config.mjs) — keep it in sync with robots.txt, sitemap, and scripts/check-links.mjs.

## Build gotchas
- **TLG export recipe (verified 2026-07-11):** the installed Diogenes.app is v4.5 (post-wipe iCloud restore) — its xml-export.pl has NO `-y` verse-mode flag, and neither the script nor Base.pm reads a `TLG_DIR` env var (that part of the aristotle recipe was inert; the corpus path came from Diogenes prefs, which no longer exist post-wipe). Working recipe:
  1. Copy `/Applications/Diogenes.app/Contents/server/xml-export.pl` somewhere writable and apply `docs/diogenes-xml-export-y.patch` (adds `-y`/`-Y`, the only relevant 4.5→4.7 delta; also copy `tei_all.rnc` next to it).
  2. Create a scratch config dir containing `diogenes.prefs` with one line: `tlg_dir "/Users/johnboyer/Documents/CLAUDE CODE ARISTOTLE PROJECT/TLG Files/TLG"`.
  3. Run: `Diogenes_Config_Dir=<scratch-config> PATH=/usr/bin:/bin perl -I /Applications/Diogenes.app/Contents/server -I /Applications/Diogenes.app/Contents/dependencies/CPAN xml-export-local-y.pl -c tlg -n 0059 -y -o <outdir>` → `<outdir>/Diogenes-Resources/xml/tlg/tlg0059NNN.xml` (41 files).
  Never modify /Applications/Diogenes.app itself (its dependencies/data carries the stage4/5 morphology data).
- Multi-work workflows: rebuild stage1 per-work first.
- Narrated works (Republic, Apology, Charmides, Letters, Lovers, and in spine mode Phaedo,
  Symposium, Timaeus, Critias, Menexenus, Epinomis, Clitophon) cut their rows on Burnet's
  own paragraph marks, imported as POSITIONS ONLY from a vendored Perseus Greek TEI
  (`sources/perseus-grc`, declared per manifest under `greek.paragraphs`). The displayed Greek
  is still the TLG spine — this is not an edition swap. stage1 prints
  `greek paragraphs: X/Y located`; a drop in that ratio means the donor and spine drifted
  apart (fold/elision handling), and unlocated marks fall back to a proportional estimate.
  SPINE mode (`greek.paragraphs.spine`; Republic plus the seven above): a row per Burnet mark,
  the English cut by `para_align` per section, stage7 gating at 97% matched (3 misses of grace
  for the small works) and writing `build/stage7/para-align-<work>.json`. A spine-mode work's
  Greek labels (Phaedo's ΕΧ./ΦΑΙΔ. frame, Timaeus' hand-offs) are not marks: they pair with the
  translation's `<said>` turns and pin labelled rows inside the spine (`turns.build_para_flow`);
  Perseus' page-break `<said rend="merge">` labels pair with nothing and are dropped, while a
  rubric label no turn prints (Lamb's "The Speech of Pausanias") stays as an `et` heading.
  `para_align` keys attribution cues on a name table — Republic's cast folded, the others
  case-sensitive (Κρίτων vs κριτῶν) — extend it when a new spine-mode work is added. Left on
  the dialogue flow on purpose: Lysis/Parmenides/Protagoras/Euthydemus (OCT dash turns) and the
  Jowett-overlay dialogues (the compare column is aligned to dialogue-flow turns).
- `plato_pipeline all` is stages 1–7, PER WORK. Two things it does not do, and a
  full-corpus rebuild silently ships broken without them (verified 2026-07-29):
  `stage8` is the one corpus-wide stage — it merges every work's `build/ngrams`
  into the shared phrase index, so `/phrases` has no data behind it otherwise;
  and `align_turns.py` is a POST-stage7 step whose `alt` overlay payload `all`
  DESTROYS, blanking compare mode for all 11 Jowett works. After the last work:
  run `stage8` once, then the aligner per `sources/jowett-*/align.json`. The
  canonical order lives in `scripts/build-public.mjs` — follow it, and note that
  a blank compare column is the only symptom, so nothing fails loudly.
- astro-favicons is incompatible with a subpath base — don't retry; hand-roll if needed.
- Perseus TEI marks English paragraphs TWO ways, mixed per work: `<p>` elements AND
  `<milestone unit="para"/>`. stage1_stephanus_english captures both (sentinel `\x01`, like
  the `\x00` turn sentinel). Bury's Laws leaves each book's opening speech UNLABELED — it
  lands in leadE and is re-attached to the head Greek turn with a display borrowed from the
  work's observed speaker map (turns.speaker_displays).
- turnFlow data contract (post fix-round-1): `kind:"para"` = narrated paragraph flow
  (Republic, Apology, Charmides, Letters, Lovers); FlowTurn optional `ep` (paragraph offsets),
  `et` (embedded speeches), `sub` (stacked one-sided speeches on section-anchored rows).
  A para row for a pinned frame turn (Phaedo) carries `s`/`d` AND `et:[{o:0,…}]` — the `et`
  block is what makes the reader print the lead-in on a para-flow row.
  Types in shared/lib/data.ts; renderer in Reader.svelte flowRowsView.
- Word-popup glosses: Diogenes' `greek-analyses.txt` ships Perseus shortdefs that keep only
  the FIRST italic run of LSJ sense A, so they arrive truncated (πολιτικός "of, for",
  ἐπιμελέομαι "take"). stage5 `derive_short_def` rejoins the run and stage7 `merge_short_def`
  swaps it in only when the shipped gloss is a word-boundary prefix. Two guards must survive
  any edit: reject a def ending on a bare article (the governed noun is untagged Greek), and
  reject — never slice — a def over 100 chars. Blank glosses (~27%, mostly proper names) are
  still unfixed.
- The gloss rewrite MUST run after `filter_parses`, not inside the comprehension that builds
  the parses (stage7 `resolve_parses`): that filter spots a spurious reading by its gloss
  duplicating a resolved sibling's, and those are Morpheus glosses — rewriting first keeps the
  junk reading, which can become the primary analysis and shift lemma slugs. Any change to
  gloss/parse emission: diff the built `app/public/data/lemmata/_index.json` slug set against
  the live site's; a gloss-only change must leave it byte-identical.
- Worktree agents running the pipeline: use the MAIN checkout's `pipeline/.venv` python
  (absolute path) with cwd = worktree/pipeline, and symlink the main `build/` into the
  worktree. NOTE `.gitignore` needs both `build` and `build/` — the dir-only pattern misses
  the symlink and one got committed once.
- Codex agent runs cannot write `.git` metadata (sandbox) — Codex implements, orchestrator
  commits/pushes.
- Headless browser for functional verification: playwright-core (npm) + the chromium
  headless shell already in `~/Library/Caches/ms-playwright/chromium_headless_shell-*/
  chrome-headless-shell-mac-arm64/chrome-headless-shell` (no Google Chrome installed; the
  playwright MCP server expects desktop Chrome and fails).

## Working with John
Philosophy professor, competent Greek. Explain architecture decisions; check in at milestones, not every step.
This repo was bootstrapped from aristotle-reader on 2026-07-11 by copying pipeline/shared/app/scripts and renaming the pipeline package `aristotle_pipeline` → `plato_pipeline`. The site LAUNCHED 2026-07-11 (full 36-work canon, Stephanus scheme, turn-flow reader) and fix round 1 shipped 2026-07-12 (6th deploy) — see DEPLOY-STATUS.md for the ledger. `shared/lib/works.ts` still uses the Aristotle-style registry shape (works, no dedicated dialogue registry).
