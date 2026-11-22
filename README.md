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
- **Greek**: TLG 0059 (Burnet's OCT text), committed as one line-level file per
  work in `corpus/greek/` (see its README). The build reads those files; it does
  not run Diogenes and needs no TLG. Making them afresh is a local step
  (`python -m plato_pipeline.extract --all`) on a machine with Diogenes and the
  TLG, whose own files and the Diogenes export are never committed.
- **English**: the Loeb-era translations (Fowler, Lamb, Bury, Shorey) as encoded
  in Perseus's canonical-greekLit TEI, vendored under `sources/perseus-eng/` at a
  pinned commit. The translations are US public domain by publication date; the
  Perseus TEI markup is CC BY-SA 4.0. See `sources/INVENTORY.md`.
- **Compare view**: Jowett (1892) as a turn-aligned second translation for 11
  dialogues (`sources/jowett-*/`), aligned onto the Loeb's speaker turns, and
  for the Republic, aligned paragraph by paragraph onto Burnet's rows.
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
| `corpus/greek/` | The committed Greek, one line-level file per work. |
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
- The Morpheus table and the LSJ (`greek-analyses.txt`, `grc.lsj.xml`), shipped
  with [Diogenes 4.7.2](https://d.iogen.es). The build reads them from the folder
  `DIOGENES_DATA` names, else from each manifest's `sources.diogenes_data` (the
  path inside Diogenes.app on a Mac), and checks both by checksum first
  (`python -m plato_pipeline.inputs check`). On a machine without Diogenes,
  `python -m plato_pipeline.inputs fetch --dir <folder>` downloads Diogenes's own
  4.7.2 release and takes the two files out of it, each held to its pin.
- A local TLG corpus and Diogenes, only to make `corpus/greek/` afresh. The
  export recipe is the `tlg-export` skill.

## Tests

These are the exact commands `.github/workflows/ci.yml` runs.

```sh
cd app && npm ci && npm test            # vitest; then: node scripts/verify-shared-imports.mjs (from repo root)
cd shared && npm ci && npm test && npm run check   # vitest + svelte-check
cd pipeline && uv sync
uv run python -m plato_pipeline.preflight tests/fixtures/preflight/valid/data tests/fixtures/preflight/valid/manifests
uv run --with pytest pytest
```

CI's `site` job also runs the whole build (`npm run build:public`) from a
clean checkout: the Greek from `corpus/greek/`, the Morpheus table and the LSJ
fetched by checksum (`python -m plato_pipeline.inputs fetch`). It uploads the
built site with a `SHA256SUMS`. The repo-level scripts' tests run as
`npm run test:scripts`.

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
