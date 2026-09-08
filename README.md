# The Plato Reader

A static site for reading the complete works of Plato with the original Greek
and a public-domain English translation side by side, cited by Stephanus page
and section (`34b`) and nothing finer — no line numbers are shown.

Live at <https://johnhboyer-sys.github.io/plato-reader/> (GitHub Pages project
site, base path `/plato-reader`). Launched 2026-07-11; the deploy ledger is
`DEPLOY-STATUS.md`.

## What the site contains

- **Corpus**: the 36-work Thrasyllan canon (TLG works 001–036), from Euthyphro
  to the Letters, grouped on the home page into six thematic shelves. Disputed
  works carry a "Dubious" badge (`shared/lib/works.ts`, `authenticity`).
- **Greek**: TLG 0059 (Burnet's OCT text), exported from Diogenes in verse mode.
  TLG text is licensed and never committed; the pipeline reads a local export.
- **English**: the Loeb-era translations (Fowler, Lamb, Bury, Shorey) as encoded
  in Perseus's canonical-greekLit TEI, vendored under `sources/perseus-eng/` at a
  pinned commit. The translations are US public domain by publication date; the
  Perseus TEI markup is CC BY-SA 4.0. See `sources/INVENTORY.md`.
- **Compare view**: Jowett (1892) as a turn-aligned second translation for 11
  dialogues (`sources/jowett-*/`), aligned onto the Loeb's speaker turns.
- **Reader**: one row per speaker turn (or per Burnet paragraph in the narrated
  works), Stephanus gutter ticks, per-work section outline.
- **Word popups**: Morpheus morphology for every Greek token; the LSJ entry is
  served by the grammata widget (`https://grammata.pages.dev/t8/lookup.js`),
  not rendered here.
- **Lemma pages** (`/lemma/<slug>/`): a corpus-wide concordance per headword.
- **Search**: Greek by lemma or surface form, English full text, a grammar
  (morphology-signature) filter, and a corpus-wide recurrent-phrase index
  (`/phrases`).

## Repository layout

| Path | Contents |
|---|---|
| `pipeline/` | Python package `plato_pipeline`: stages 1–7 per work, stage 8 corpus-wide, plus `align_turns.py`, `preflight.py`, `verify_shared_lsj.py`. Tests in `pipeline/tests/`. |
| `shared/` | The reader core (Svelte components, `lib/works.ts` registry, data/search libs, global CSS), imported by `app/` via the `@shared` alias. Tests in `shared/__tests__/`. |
| `app/` | The Astro site. `app/public/data` is a symlink to `build/dist`. `app/scripts/` builds the lemma pages and the LSJ-heads manifest. |
| `scripts/` | `build-public.mjs` (the canonical full build), `check-links.mjs` (deploy gate), `verify-shared-imports.mjs`. |
| `manifests/` | One YAML per work, driving the pipeline. `Euthyphro.yaml` is the annotated pilot. |
| `sources/` | Vendored Perseus TEI (`perseus-eng/`, `perseus-grc/`), Jowett plain texts with `align.json` configs, and `INVENTORY.md`. |
| `docs/` | Handoffs, the Diogenes `-y` patch, the registry draft, verification notes. |
| `build/` | Pipeline output (gitignored; TLG-derived). |

## Requirements

- Node 22 (`app/` and `shared/`; `engines` pins `>=22.12 <24`).
- Python 3.9+ with `lxml` and `pyyaml` (`pipeline/pyproject.toml`). CI uses
  `uv`; locally the checked-in `pipeline/.venv` is what `build-public.mjs` runs
  (override with `PLATO_PY`).
- A local TLG corpus and Diogenes, only to build data. The export recipe is in
  `CLAUDE.md` (Build gotchas).

## Tests

These are the exact commands `.github/workflows/ci.yml` runs.

```sh
cd app && npm ci && npm test            # vitest; then: node scripts/verify-shared-imports.mjs (from repo root)
cd shared && npm ci && npm test && npm run check   # vitest + svelte-check
cd pipeline && uv sync
uv run python -m plato_pipeline.preflight tests/fixtures/preflight/valid/data tests/fixtures/preflight/valid/manifests
uv run --with pytest pytest
```

CI cannot run the corpus build (the TLG is machine-local), so link integrity
and data checks run in the pre-deploy build below.

## Build order

`scripts/build-public.mjs` (`npm run build:public` at the repo root) is the
canonical order. It does, in sequence:

1. `python -m plato_pipeline all --work <W> --public` for every manifest
   (stages 1–7, per work; `--public` uses `<W>-public.yaml` when one exists).
2. `python -m plato_pipeline stage8` — the one corpus-wide stage (phrase index
   and lemma map). It is **not** part of `all`.
3. `python -m plato_pipeline.align_turns --config sources/<dir>/align.json` for
   each Jowett overlay. Also outside `all`, and it must run after it: `all`
   rewrites `build/dist/<work>/` and discards the `alt` payload.
4. `plato_pipeline.preflight build/dist manifests`, then `verify_shared_lsj`.
5. `cd app && PUBLIC_SHOW_PRIVATE=0 npm run build` (lemma pages, LSJ heads,
   Astro), then `node scripts/check-links.mjs app/dist`.

A single work can be rebuilt with step 1 alone, but steps 2 and 3 must then be
rerun by hand or the phrase index and compare view ship empty.

## Further reading

- `CLAUDE.md` — hard rules, deploy and build gotchas.
- `DEPLOY-STATUS.md` — every deploy, and the deploy recipe.
- `ADDING-A-WORK.md` — the per-work recipe: sources, manifest, pipeline gates,
  registry entry, verification.
- `sources/INVENTORY.md` — provenance, pinned SHAs and licences of every source.

## MIT Licence

Copyright © 2026 John Boyer

Permission is hereby granted, free of charge, to any person obtaining a copy of this software to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
