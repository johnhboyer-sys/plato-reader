# Architecture

How the site is made, what it needs, and what it calls. Written so that someone
with this repository and no access to its author's machines or accounts can
build the site and serve it. State and plans for the work that made this
possible are in `HANDOFF-PORTABILITY.md`; how to bring the site back from a
bundle or from source is `RESTORE.md`.

## The site is static

Every page is a file. There is no server code, no database, and no account
system. A host needs to do one thing: serve a folder of files over HTTPS, with
`index.html` for a folder and `404.html` for a missing page.

A build has two parts:

| Part | Folder in a build | Size | What it is |
|---|---|---|---|
| App | `app/dist/` less `data/` | about 5,600 files, 530 MB | Pages, scripts, styles, fonts, share cards, the service worker |
| Corpus data | `app/dist/data/` | about 7,600 files, 290 MB | Per-work JSON: Greek and English by book, alignments, lemmas, search shards, LSJ entries |

The app fetches data as the reader moves. Where it fetches from is a build
parameter (below), so the two parts can sit on one host or on two.

## From sources to a site

```
corpus/greek/*.tsv        Greek text, one printed line per row (committed)
sources/                  English translations, Burnet's paragraph marks (committed)
manifests/*.yaml          one per work: editions, books, speakers, how to build it
greek-analyses.txt        Morpheus parse table   } not committed; pinned by
grc.lsj.xml               LSJ lexicon            } sha256, from Diogenes 4.7.2
        │
        ▼  pipeline/ (Python): stages 1–7 per work, stage 8, the Jowett
        │  aligner, stage 9, and their gates (scripts/build-public.mjs)
build/dist/               corpus data
        │
        ▼  app/ (Astro and Svelte, Node 22), with shared/ compiled in
app/dist/                 the site
```

- **Greek text.** `corpus/greek/` holds every work's Greek as plain line files;
  its README gives the format. The build reads them and runs no outside
  program. Making them afresh (`python -m plato_pipeline.extract --all`) is a
  separate step for a machine that holds the digital source texts.
- **Two outside inputs.** The Morpheus table and the LSJ XML are not in the
  repository. `python -m plato_pipeline.inputs check` (in `pipeline/`) checks
  the copies it finds against pinned sizes and sha256 sums; the folder is named
  by `DIOGENES_DATA`. On a machine without Diogenes,
  `python -m plato_pipeline.inputs fetch --dir <folder>` downloads the
  Diogenes 4.7.2 release (186 MB, pinned by sha256), takes the two files out
  of it, and holds each to its pin.
- **Full build.** `npm run build:public` at the root runs the pipeline for every
  work, the corpus-wide stages, the gates, the app build, and the link check.
  About seven minutes on a laptop, eight on GitHub's Linux runner.
- **App-only build.** `PUBLIC_SHOW_PRIVATE=0 npm run build` in `app/`, when
  `build/dist/` is already there. About a minute.
- **`shared/`** is the reader core this site has in common with its sibling
  readers. It is copied between the repositories, not linked.

## Build parameters

All are read at build time. Unset, each gives the primary site's build.

| Variable | Default | What it sets |
|---|---|---|
| `SITE_ORIGIN` | `https://plato.johnhboyer.com` | The origin in canonical links, share cards, `robots.txt`, and the sitemap |
| `SITE_BASE` | `/` | The path the site is served under, such as `/plato/` |
| `PUBLIC_DATA_ROOT` | unset | Where the app fetches corpus data. Unset: `<base>/data` on the site's own origin. Set: an absolute URL on another host |
| `PUBLIC_GRAMMATA_LOOKUP` | Grammata's `lookup.js` | The address of the dictionary lookup script (see outside calls) |
| `PUBLIC_SHOW_PRIVATE` | unset | Must be unset or `0` for anything that leaves the machine; `build:public` forces `0` |
| `DIOGENES_DATA` | each manifest's path | The folder that holds the two outside inputs |

`scripts/site-params.mjs` reads the first two for the Astro config and for the
link check alike, and refuses a value that is not an origin or a base path.

## What runs where today

| Piece | Where | Notes |
|---|---|---|
| App | A Cloudflare Worker serving static assets, at `plato.johnhboyer.com` | `npm run deploy:cloudflare`; `docs/cloudflare.md` |
| Corpus data | A Cloudflare R2 bucket, at `plato-data.johnhboyer.com` | The build sets `PUBLIC_DATA_ROOT` to it |
| Source | GitHub, `johnhboyer-sys/plato-reader` | A private copy on GitLab, `johnhboyer/plato-reader` |

The split matches Aristotle's, whose site is too large for one Worker version
(20,000 files); Plato's whole site is about 13,200 files and would fit. It is
a choice of this host, not of the site. The site was on GitHub Pages until
2026-11-19; the `gh-pages` branch now holds only a redirect.

## A copy any host can serve

Build with `PUBLIC_DATA_ROOT` unset and the data sits beside the app, so one
folder is the whole site. `scripts/make-bundle.mjs` packs that folder as one
`.tar.gz`:

- without `CNAME`, which belongs to the primary's name;
- with a `SHA256SUMS` that names every file, so a copy can be checked with
  `shasum -a 256 -c SHA256SUMS`;
- only after the data has passed the deploy's data gate
  (`scripts/verify-rebuild.mjs`) and every JSON file parses.

Unpacked at a web root, the bundle is the site. Its canonical links name the
primary, so a mirror does not compete with it in search results.

The `Dockerfile` at the root is the same thing in one command: its first stage
is the full build with its tools pinned, and its second serves the unpacked
bundle with Caddy on port 80.

## Outside calls a visitor's browser makes

| Host | For | State |
|---|---|---|
| The data host | Corpus data, when `PUBLIC_DATA_ROOT` is set | None in a same-origin build |
| None, for fonts | Web fonts | The site serves its own: `app/public/fonts/`, Gentium Book Plus and Geologica, each with its Open Font License text |
| Grammata (`PUBLIC_GRAMMATA_LOOKUP`) | The LSJ entry in the word popup ("Show LSJ definition") and on lemma pages | Stays, by a ruling of 2026-08-29. With it refused, the popup still shows its own headword, gloss, and parses; the lemma page's entry says "The dictionary entry is not available here." |

Links to Lexeis (Ast's lexicon), the sibling readers, and the support page are
plain links a reader follows. There are no analytics and no trackers.

## Checks

| Check | Command | What it proves |
|---|---|---|
| Pipeline tests | `cd pipeline && uv run --with pytest pytest -q` | The stages, and that every character of every committed Greek line is Greek or a listed mark |
| Script tests | `npm run test:scripts` | The build, deploy, snapshot, and bundle scripts |
| App and shared tests | `cd app && npm test`; `cd shared && npm test` | The reader's code |
| Link check | `node scripts/check-links.mjs app/dist` | No broken link or anchor in a built site, at any base path (`SITE_BASE`) |
| Data gate | `node scripts/verify-rebuild.mjs` | The phrase index, the Jowett compare columns, the search shards and indexes, and (with `--live-slugs`) no lemma page lost |
| No outside calls | `node scripts/check-no-outside-calls.mjs` | In a browser whose every request passes a recorder that forwards nothing, the built site shows a work page, a word popup, a search, a lemma page, and the work page under its service worker, and asks for no host off its allowed list. Needs Playwright and its Chromium |
| A host serves the bundle | `node scripts/check-served.mjs --origin=<host> --sums=<SHA256SUMS>` | A running host answers every file the bundle's list names with the listed bytes, a folder's address with its index, and a missing page with 404 and the 404 page |
| Same output | `node scripts/compare-snapshot.mjs` | A build matches a dated snapshot of the live site: data byte for byte, pages byte for byte once the names a checkout's folder changes are swapped |

Two builds of one commit in two folders differ in a few class names and bundle
file names: Svelte hashes a component's absolute path into its style class when
the component lives outside `app/`. `compare-snapshot.mjs` computes the
expected names and accepts those swaps and no others.
