# Adding a work to the corpus

The site is registry-driven: a new work is a manifest, vendored sources, one
registry entry, and a shelf assignment. No component code changes. Every step
below is derived from the code cited beside it; where the code contradicts the
obvious expectation, the recipe says so.

The 36-work canon is complete, so in practice this recipe covers (a) a new
work outside the canon (the Phase-2 appendix — Definitions, Spuria; see
`docs/registry-draft.md`) and (b) rebuilding or re-sourcing an existing one.
Slug convention: readable CamelCase, equal to the manifest stem, URL path and
data directory (`Euthyphro`, `Alcibiades1`, `HippiasMajor`).

## 1. Greek: the TLG export

Do not run the export from the pipeline. `stage1_greek.run_export`
(`pipeline/plato_pipeline/stage1_greek.py`) shells out to Diogenes'
`xml-export.pl -y` with a `TLG_DIR` env var, and on the installed Diogenes 4.5
both are inert (no `-y` flag, no `TLG_DIR` support). It short-circuits when
`build/export/Diogenes-Resources/xml/tlg/tlg0059NNN.xml` already exists, so
produce that file first with the verified recipe in `CLAUDE.md` (Build gotchas,
"TLG export recipe"), passing `-o build/export` (repo root). The recipe exports
the whole author: all 41 `tlg0059*.xml` files land at once, and every canon work
is already there if you have built any of them.

Confirm the shape stage 1 parses (`_parse_flat_stephanus`): `<div
type="Stephanus-page" n="2">` containing `<div type="section" n="a">` containing
`<l n="1">`, with speaker turns as inline `<label type="speaker">ΕΥΘ.</label>`.
`sources/INVENTORY.md` tabulates span, section count and label count per work.

## 2. English: vendor the Perseus TEI

Fetch `data/tlg0059/tlgNNN/tlg0059.tlgNNN.perseus-eng2.xml` from
`PerseusDL/canonical-greekLit` **at the pinned commit
`3bd56262e3f3fed7cfdeab11ff37f69f0758eaf3`** (not `master`) into
`sources/perseus-eng/`. Then:

- append its digest to `sources/perseus-eng/SHA256SUMS` (`shasum -a 256`);
- add the work to the tables in `sources/INVENTORY.md` (translator, year, span);
- if the TEI omits a Stephanus section milestone the Greek has, patch the TEI
  and record the patch in `sources/perseus-eng/PATCHES.md` (four works needed
  this; the file shows the format). Stage 1 will otherwise report the section
  as `unmatched` and stage 2 fails `alignment`.

The Perseus text is CC BY-SA 4.0 markup over a US-public-domain translation
(`sources/INVENTORY.md`, "English"). A translation that is not US-PD cannot go
on the site (`CLAUDE.md`, Copyright).

For a **narrated** work (no `<label type="speaker">` in the TLG — Apology,
Republic, Charmides, Lovers, Letters) also vendor the Greek TEI
`tlg0059.tlgNNN.perseus-grc2.xml` from the same commit into
`sources/perseus-grc/` and update its `SHA256SUMS`. It is used for paragraph
positions only (`stage1_greek_paras.py`); the displayed Greek stays the TLG.

## 3. Write `manifests/<Slug>.yaml`

Copy `manifests/Euthyphro.yaml` (annotated pilot) or `manifests/Republic.yaml`
(multi-book, paragraph spine). Fields, with the code that reads each:

- `work.id` (= slug), `title`, `author`, `tlg_author: "0059"`, `tlg_work: "NNN"`,
  `greek_edition` — `config.py` `Manifest.work_id`; `stage1_greek.exported_xml_path`
  composes the export filename from `tlg_author`+`tlg_work`.
- `citation: { scheme: stephanus, hideLineNumbers: true }` — `scheme.py
  for_manifest`; every stephanus branch in stages 1, 2 and 7 dispatches on it.
- `speakers.sigla`: Greek siglum → canonical English name (`"ΣΩ.": "Socrates"`).
  Read by `turns.greek_speaker`. **Hard gate**: stage 7 aborts on any non-dash
  siglum not in this map (`stage7_emit.run`, "Roster gate"), naming the
  segments. A narrated work uses `speakers: {}`; a bare `—` needs no entry.
  Optional `speakers.who_aliases` maps Perseus `@who` spellings onto the same
  canonical names (`"Ἀθηναῖος": "Athenian"` in Laws; `"Cephalos": "Cephalus"` in
  Parmenides) and `speakers.nested: inner` pairs reported-speech turns inside a
  narrated frame (Protagoras, Euthydemus, Lysis, Parmenides) —
  `stage1_stephanus_english.speaker_config`.
- `english.primary`: `id`, `name` (shown as the translation label), `model:
  perseus_stephanus`, `file: "perseus-eng/tlg0059.tlgNNN.perseus-eng2.xml"`.
  `file` may be omitted — `_tei_path` derives the same name from `tlg_work`.
  Only `model: perseus_stephanus` takes the Stephanus path in `__main__._stage1`.
- `books`: `[{ n, start, end }]`. For stephanus, start/end are compared at
  (page, letter) only (`config.py book_for_column`); a line suffix (`"2a1"`) is
  tolerated and ignored. One book for a single dialogue. Multi-book works give
  the canonical page-initial boundary of each book; the English walker compares
  each `<div subtype="book">`'s first section with `books[].start` and only
  logs a warning on mismatch (`stage1_stephanus_english.py`, `_verify_start`),
  so read stage 1's log — stage 2 `book_partition` is the hard check.
- `expected_section_gaps`: list of `{ after: "17e", next: "19a" }` for
  verified edition gaps (`stage2_validate.validate`, section 1b). Currently `[]`
  in all 36 manifests; undeclared gaps are reported as info, not failures.
- `section_spine: { count, sha256 }` — the frozen fingerprint of the observed
  spine. Computed in `stage2_validate.validate` (1c) as the number of distinct
  section columns in reading order and
  `sha256(",".join(columns))` over the same list (`"2a,2b,2c,…"`). To obtain
  it: run `stage1` then `stage2` with the field absent; stage 2 fails, and
  `build/stage2/validation_report.json` `checks.section_spine.got` holds the
  values. Check first/last column and the `section_order.gaps` list against
  `sources/INVENTORY.md` before pasting them in. From then on any change to the
  export's section inventory fails the build and names the
  `first_diverging_token`.
- `greek.paragraphs` (narrated works only): `file:
  "perseus-grc/tlg0059.tlgNNN.perseus-grc2.xml"` and optionally `spine: true`.
  Without `spine`, Burnet's marks snap the English-paragraph rows' Greek starts
  (`turns.build_para_flow`); with `spine: true` each Burnet paragraph is a row
  and the English is cut to it (`para_align.py`), gated at 97 % matched
  (`stage7_emit.SPINE_MIN_RATE`). Republic is the only `spine: true` work: Lamb
  already paragraphs per turn, Shorey does not.
- `sources`: `tlg_dir_env`, `tlg_dir_default`, `diogenes_server`,
  `diogenes_data` — copy verbatim. Preflight requires the block
  (`preflight._validate_manifest_schema`); stages 4–5 read `diogenes_data` for
  the Morpheus/LSJ data.

## 4. Run the pipeline and read the gates

```sh
cd pipeline && .venv/bin/python -m plato_pipeline all --work <Slug>
```

`all` = stages 1–7 for ONE work (`__main__._STAGES`). Always pass `--work`; the
default is the Aristotle leftover `EN`. Worktree agents: use the main
checkout's `.venv` and symlink its `build/` (`CLAUDE.md`).

- **stage1** prints `english chunks=N (…) unmatched=K english_only=M`, then for
  narrated works `greek paragraphs: X/Y located (missed=…, spillover=…)`, then
  `stage1 (greek+english, stephanus): segments= pages= lines= speakers=
  unassigned=`. `unmatched>0`: a Greek section with no English chunk — a
  missing Perseus milestone (patch the TEI, step 2). `unassigned>0`: a section
  outside every `books` range — fix the table. A drop in `located/marks` means
  the grc donor and the TLG spine drifted (fold/elision handling in
  `stage1_greek_paras._fold`); unlocated marks fall back to an estimate.
- **stage2** prints one `name=ok|FAIL` per check and `overall: PASS|FAIL`, and
  exits non-zero on FAIL. Report: `build/stage2/validation_report.{json,md}`.
  Checks and their meaning for stephanus (`stage2_validate.validate`):
  `columns` (monotonic; expected = observed), `section_order` (strictly
  increasing — a repeated or out-of-order token is an export defect),
  `section_spine` (count, hash, first and last column vs the manifest — see
  step 3), `book_partition` (books ordered, non-overlapping, every section in
  exactly one), `line_gaps` (always ok: Stephanus line numbers are editorial),
  `alignment` (no unmatched or English-only sections unless listed in
  `alignment_allow_unmatched`), `length_ratio`, `proper_names`, `sigla`
  (informational).
- **stage3** prints `tokens= sigla_strips= key_failures=` and the first ten
  failures. A key failure is a token Beta Code cannot key; it is excluded from
  search and phrases (`stage8_ngrams` docstring). Expect zero or a handful.
- **stage4 / stage5** print their `summary.json`: morphology coverage and LSJ
  entries kept. Blank glosses for proper names are known and unfixed
  (`CLAUDE.md`).
- **stage6** raises `ValueError` if the offsets or grammar consistency checks
  fail (`check_offsets`, `check_grammar` in `stage2_validate.py`, run from
  stage 6). Report: `build/stage6/grammar_report.json`.
- **stage7** prints `turn_reconciliation (global): paired/greek_turns=P/G (x%)
  e_turns= residual g= e=`. A low pairing rate on a dramatic dialogue usually
  means a siglum or `who_aliases` mismatch (names must be equal strings) or a
  `nested` policy that does not match how the OCT marks the inner turns. Hard
  failures (`RuntimeError`, before `build/dist/<work>/` is touched): unmapped
  sigla (step 3) and, with `spine: true`, `para_spine` below 97 % — the per-mark
  report is `build/stage7/para-align-<Slug>.json`. Output:
  `build/dist/<Slug>/` with `manifest.json`, `book-NN.json` (segments plus
  `turnFlow`), `analyses.json`, `sections.json`, an empty `chapters.json` (kept
  for preflight and the reader), `columns.json`, `search/`, and LSJ entries
  merged into the shared `build/dist/lsj/`.

## 5. After `all`: the two steps it does not do

Both are corpus-level and live outside `all` (`__main__._CORPUS_STAGES`;
`scripts/build-public.mjs` is the canonical order):

```sh
.venv/bin/python -m plato_pipeline stage8
.venv/bin/python -m plato_pipeline.align_turns --config ../sources/jowett-<work>/align.json   # each overlay
```

`stage8` merges every work's `build/ngrams/<work>.json` into
`build/dist/ngrams/` and `build/dist/lemma-map/`; without it `/phrases` has no
data. `align_turns` writes `alt[<id>]` into each `turnFlow` turn of
`build/dist/<work>/book-NN.json`. Stage 7 deletes and recreates that directory
(`stage7_emit.run`, `shutil.rmtree(out_dir)`), so re-running `all` for a work
silently blanks its compare column until the aligner is run again. Nothing
fails loudly; a blank Jowett column is the only symptom.

## 6. Optional: a Jowett compare overlay

Only for dramatic dialogues with clean `SPEAKER:` turns; narrated works are
deferred (`sources/INVENTORY.md`, "Additional public-domain translations").

1. `sources/jowett-<work>/pg<N>.txt` — the Project Gutenberg plain text.
2. `sources/jowett-<work>/align.json` (`align_turns.run`, `parse_new_turns`):
   `work` (slug), `trans_id` (`"jowett"`), `name`, `short`, `source` (the txt
   filename), `source_url`, `start_after` (a string on the line before the
   dialogue body, e.g. `"PERSONS OF THE DIALOGUE"`; the parser raises if it is
   absent), `end_marker` (`"*** END OF THE PROJECT GUTENBERG"`), and
   `speaker_map`: Gutenberg `LABEL` → the canonical name the reference
   `turnFlow` uses. Unmapped labels fall back to Title-case, so `SOCRATES`
   works with `{}`; `BOY` → `"Meno's Boy"` does not.
3. Run the aligner (step 5). It prints `matched/ref_turns`, and warns on a
   recurring dropped label — that is a real speaker missing from
   `speaker_map`. Report: `build/dist/<work>/align-jowett.json`; the inventory
   table records coverage.
4. Registry: add `{ id: 'jowett', name, short, slot: 'overlay' }` to the work's
   `translations` (step 7). `id` must equal `trans_id`.
5. `scripts/build-public.mjs` picks up every `sources/*/align.json` itself.

## 7. Register the work: `shared/lib/works.ts`

Add one `Work` to `WORKS`, in Thrasyllan (TLG-number) order. Fields (interface
`Work`): `id` (= slug), `title`, `greekTitle`, `abbr`, `author: 'Plato'`,
`books`, `bookLabels` (`['1']` for a single dialogue; Roman numerals for
Republic/Laws), `greekEdition` (same string as the manifest), `greekSource:
{ short, full }` (drives both attribution strips), `translations`
(`{ id, name, short, slot: 'english' }` for the Loeb, matching
`english.primary.id`/`name`), `citation: { scheme: 'stephanus',
hideLineNumbers: true }`, `blurb`, and optionally `period` (`early|middle|late`
— omitted for dubious/spurious works and the Letters, except HippiasMajor) and
`authenticity: 'dubious' | 'spurious'` (absent = genuine; labels in
`docs/registry-draft.md`).

Then add `{ id: '<Slug>' }` to exactly one entry of `SHELVES`.
`shared/__tests__/works.test.ts` enforces: six shelves, every `WORKS` id in
exactly one shelf, no unknown ids, no "tetralogy" in user-facing strings, and
`period` only on works with settled chronology. Routing (`app/src/pages/[work]/…`),
the home page, the work switcher and search read `WORKS`; nothing else to edit.

## 8. Verify

```sh
cd pipeline && .venv/bin/python -m pytest tests            # CI: uv run --with pytest pytest
cd shared && npm test && npm run check
cd app && npm test && PUBLIC_SHOW_PRIVATE=0 npm run build   # lemma pages, lsj-heads, astro
node scripts/check-links.mjs app/dist                       # 0 broken, from repo root
cd pipeline && .venv/bin/python -m plato_pipeline.preflight ../build/dist ../manifests
cd pipeline && .venv/bin/python -m plato_pipeline.verify_shared_lsj
```

Or run `node scripts/build-public.mjs` from a clean checkout, which does all of
the above in the canonical order (it rebuilds every work; never pipe it through
`tail`). `check-links` hard-codes `BASE = '/plato-reader'`; keep it in step with
`app/astro.config.mjs` and `app/public/robots.txt`.

Lemma slugs: `app/scripts/build-lemmata.mjs` assigns homograph suffixes (`-2`)
in frequency order over the whole corpus, so a new work can rename an existing
slug and break inbound `/lemma/<slug>/` links. Diff the built
`app/public/data/lemmata/_index.json` against the live
`…/plato-reader/data/lemmata/_index.json`: additions are expected; any
changed or removed slug needs a look. For a gloss-only change the two must be
byte-identical (`CLAUDE.md`).

Read a page of the new work in the built site (functional check, not a
screenshot): turn rows pair, the section outline lists every column, a word
popup opens, the compare toggle shows Jowett if configured.

## 9. Deploy

John's call, from `origin/main`, following the "Deploy recipe" section of
`DEPLOY-STATUS.md` (incremental commit on a disposable `gh-pages` clone), and
add the entry to that file. Summarize and wait for the go-ahead first.
