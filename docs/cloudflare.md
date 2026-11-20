# Cloudflare hosting

The plan (John, 2026-11-19): move the site off GitHub Pages, as
aristotle-reader moved the same day (its PRs #222 and #223, its
`docs/cloudflare.md`). The app goes on a Cloudflare Worker and the corpus
data goes on R2, joined by a build-time data root.

## What runs where

| Part | Where | Size |
|---|---|---|
| App (pages, `_astro`, og cards, fonts, icons, `sw.js`) | Worker `plato-reader`, static assets only, no script (`app/wrangler.jsonc`) | about 5,600 files, 530 MB |
| Corpus data (`data/`) | R2 bucket `plato-reader-data`, keys without the `data/` prefix | about 7,600 objects, 300 MB |
| Data address | `https://plato-data.johnhboyer.com` (R2 custom domain; John attaches it at cutover) | |
| Preview | `https://plato-reader.johnhboyer.workers.dev` | |
| Test data address | `https://pub-64c212d1195d468da22799ff352bc91f.r2.dev` (r2.dev: rate-limited; turn off after cutover) | |

The Worker's limit is 20,000 files a version; the app alone is about 5,600.
The data could fit too, but goes to R2 as Aristotle's does, so the two sites
deploy the same way.

The data root is baked in at build time through `PUBLIC_DATA_ROOT`
(`shared/lib/data.ts`, `shared/lib/search.ts`; every client data fetch goes
through them, the phrase browser's offsets now included). The desktop
override `globalThis.__ARISTOTLE_DATA_ROOT__` still wins. With the variable
unset the build is the GitHub Pages build, unchanged. With it set,
`app/scripts/postbuild-data-root.mjs` writes the root into `dist/sw.js`, so
offline reading caches R2 data, writes `dist/.assetsignore` so
`wrangler deploy` leaves `dist/data` out, and writes `dist/_redirects` so
`/data/*` on the site's address answers 302 to the data root. That keeps a
tab or service worker still running a pre-cutover bundle working, and outside
links to data files (Codex's review, 2026-11-19).

## Free-tier check (2026-11-19)

R2 before this move: `aristotle-reader-data` 459 MB,
`classical-philosophy-reader-data` 548 MB, and `grammata-packs` 85 MB, about
1.1 GB of the 10 GB-month free storage. Plato adds about 300 MB. The upload
costs about 7,600 writes against 1 million free a month. Reads are free up to
10 million a month, and egress is always free. Workers static-asset requests
are free and unlimited; the Worker runs no script.

## Build and deploy

From the repo root, on Node 22, with `build/dist` holding the corpus (for an
app-only rebuild, a copy of live's data):

1. Build: `cd app && PUBLIC_SHOW_PRIVATE=0 PUBLIC_DATA_ROOT=https://plato-data.johnhboyer.com npm run build`
   (or `PUBLIC_DATA_ROOT=… npm run build:public` for a full rebuild).
   The last line should read `postbuild-data-root: sw.js, .assetsignore and _redirects written for …`.
2. Rehearse: `npm run deploy:cloudflare:dry`. It refuses a build without the
   data address, checks the page count against the live sitemap (90% floor),
   runs the link check (0 broken) and `scripts/verify-rebuild.mjs` with
   `--live-slugs` read from the data address, then reads every data file's
   ETag from R2 and lists what would upload.
3. Deploy: `npm run deploy:cloudflare`. It uploads only the data files whose
   MD5 differs from R2's ETag (wrangler `r2 bulk put`, `max-age=600` as
   GitHub Pages sent), reads them back, then runs `wrangler deploy` from `app/`.
   It never deletes from R2: a file the build lacks stays and is listed as
   kept. Wrangler cannot list a bucket, so the bucket keeps a record of every
   key the script has uploaded, `_deploy/keys.json`, written before each
   upload; upload data only through the script, or the record goes stale.
   The script refuses a bucket with no record. A new bucket gets an empty one
   first: `echo '[]' > keys.json` and
   `npx wrangler@4 r2 object put plato-reader-data/_deploy/keys.json --remote --file keys.json --ct 'application/json; charset=utf-8' --cc no-cache`
   (done 2026-11-19). Every HEAD carries a fresh `?readback=` query, so the
   data hostname's cache never stands in for R2's own headers. Cloudflare's API limit holds uploads
   to about 1,100 files per 5 minutes, so a full corpus upload takes about 35
   minutes.
4. Check (optional, while gh-pages is still the record of live):
   `node scripts/compare-live.mjs --app=<worker url> --data=<data address>`
   fetches every file in the gh-pages tree from Cloudflare (4 at a time) and
   compares its hash with the tree's, plus a sample of 40 from live itself.

How the script's gates differ from Aristotle's. Aristotle's gates are those of
its `npm run deploy`: a leak check for gated translations, gated translation
slots, held works, search indexes and search shards, plus refusals for a
`/bonitz/` page and an uncommitted `sources/lemma-slugs.json`. Plato has no
`npm run deploy`; its deploy gates are the link check and
`verify-rebuild.mjs` (stage8 phrase index, Jowett `alt` payloads, search
shards and indexes, Jowett search indexes, and no lemma slug lost). So the
script runs those two, reads the live slugs from the data address (the
site's own `/data/` is gone after cutover), and drops the Aristotle-only
checks. Aristotle also ran its gates over the files kept in the bucket;
`verify-rebuild.mjs` reads a folder, so here kept files are only listed. The
script says so when the source is not on `origin/main` (CLAUDE.md: deploy
from origin/main) but does not refuse, so a branch can go to the preview.

`scripts/build-public.mjs` now reads the live slugs from
`https://plato-data.johnhboyer.com/lemmata/_index.json`; before the data
address exists that fetch misses and the check only warns.

Bucket CORS is in `deploy/r2-cors.json`: GET and HEAD from
`https://plato.johnhboyer.com` and the preview origin. Apply it with
`npx wrangler@4 r2 bucket cors set plato-reader-data --file deploy/r2-cors.json`.

The data is overwritten in place, not swapped in one step: between the
upload and the Worker deploy, or for good if the Worker deploy fails, the old
app reads the new data. Aristotle's doc records the open question and the
folder-per-release alternative; the answer there applies here.

## Cutover checklist (John's to do or approve)

1. **Merge the PR.** Then attach the data hostname: R2 → `plato-reader-data`
   → Settings → Custom Domains → `plato-data.johnhboyer.com`. Cloudflare
   creates the DNS record. The bucket CORS already allows
   `https://plato.johnhboyer.com`.
2. **Switch the site's DNS.** Delete the DNS-only CNAME
   `plato → johnhboyer-sys.github.io`, then attach `plato.johnhboyer.com` to
   the Worker (Workers → `plato-reader` → Settings → Domains). Cloudflare
   refuses the custom domain while the old record exists, so expect a few
   minutes of errors between the two steps. HSTS and Always Use HTTPS are on;
   check `https://plato.johnhboyer.com/` answers before leaving it.
3. **GitHub Pages.** Remove the custom domain in the repo's Settings → Pages,
   then unpublish. The old `johnhboyer-sys.github.io/plato-reader/` redirect
   stops then. Leave the gh-pages branch in place as the record.
4. **Then (agent, approved 2026-11-19):** add the route
   `{ "pattern": "plato.johnhboyer.com", "custom_domain": true }` to
   `app/wrangler.jsonc`, build current `main` with
   `PUBLIC_DATA_ROOT=https://plato-data.johnhboyer.com`, run
   `npm run deploy:cloudflare`, and check live: `/`, a dialogue, the word
   popup, `/search/`, a lemma page, with data from the data hostname, and
   `lemma-accents.json` served.
5. **After.** Turn off the r2.dev address
   (`npx wrangler@4 r2 bucket dev-url disable plato-reader-data`) and, if
   wanted, the workers.dev preview (`"workers_dev": false`). Update CLAUDE.md
   and DEPLOY-STATUS.md: the gh-pages push is retired, and this file's recipe
   replaces it.

Two small differences from GitHub Pages: a missing trailing slash redirects
with 307, not 301, and `/data/...` on the site's own address answers 302 to
the data address instead of the file.

Visitors' service workers update themselves: the origin stays the same, and
the new `sw.js` caches R2 data. Their old cached `/data/` copies stay in the
cache unused until the cache version is next bumped.
