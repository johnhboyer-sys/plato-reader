# Restore

How to bring the site back with this repository, or with a built bundle, and
no access to its author's machines or accounts. `ARCHITECTURE.md` says what
the site is made of; this file is the steps. The log at the end says which of
them have been run, when, and how long they took.

## Where the copies are

| What | Where | Notes |
|---|---|---|
| Source | GitHub, `johnhboyer-sys/plato-reader` (public) | The Greek text, the translations, the pipeline, and the app are all in it |
| Source, second copy | GitLab, `johnhboyer/plato-reader` (private) | Every branch and tag but `gh-pages`, as of 2026-11-21. Only the owner can read it, so it is the owner's way back, not a stranger's |
| A built bundle | The `plato-bundle` artifact of the newest CI run on GitHub | Kept seven days; downloading one needs a GitHub login |
| The build's two outside inputs | Diogenes 4.7.2's release on GitHub, `pjheslin/diogenes` | 186 MB; pinned by sha256 in `pipeline/plato_pipeline/inputs.py` |

The source has a second copy under another company; it is private. The built
bundle and the two inputs have none yet (bundles kept as releases, a second
host, and a copy of the inputs are phase 3 of `HANDOFF-PORTABILITY.md`). So
GitHub is still the one place a stranger can restore from. The owner can also
restore the source from GitLab: clone it there and go on from "From source".

## From a bundle

A bundle is the whole site in one file. This takes minutes.

1. Unpack it and check every file:

   ```
   mkdir site && tar -xzf plato-bundle.tar.gz -C site
   (cd site && shasum -a 256 -c SHA256SUMS --quiet)
   ```

   No output and exit 0 means every file is the one the build made. On Linux,
   `sha256sum --quiet -c SHA256SUMS` does the same.

2. Serve the folder at the root of a name, over HTTPS, on any static host.
   The host must do three things: answer a folder's address
   (`/Euthyphro/book/1/`) with that folder's `index.html`; answer a missing
   page with `404.html` and status 404; and send pages, stylesheets, and
   scripts with their usual types. It must not answer every unknown address
   with the home page.

3. Check the host. The check is a script in this repository
   (`scripts/check-served.mjs`; it needs Node 22 and nothing else), so run it
   from a checkout, with the path to the unpacked folder's list:

   ```
   node scripts/check-served.mjs --origin=https://<the host> --sums=<path to>/site/SHA256SUMS
   ```

   It asks the host for every file the list names and compares the bytes.
   `--every=50` reads a sample, for a host that should not get 13,000
   requests; `--concurrency=2` for a small server.

The bundle's canonical links name `plato.johnhboyer.com`. That is right for a
mirror. A copy that is to be the site under another name is built from source
with `SITE_ORIGIN` set.

## From source

Needs git, Node 22, [uv](https://docs.astral.sh/uv/), and the network. About
ten minutes, after the clone. The old `gh-pages` history is 1.2 GB;
`--single-branch` on the clone leaves it behind.

```
git clone --single-branch https://github.com/johnhboyer-sys/plato-reader.git
cd plato-reader
(cd pipeline && uv sync)
(cd app && npm ci)
export DIOGENES_DATA="$PWD/../diogenes-data"
(cd pipeline && uv run python -m plato_pipeline.inputs fetch --dir "$DIOGENES_DATA")
npm run build:public
node scripts/make-bundle.mjs --out=../plato-bundle.tar.gz
```

`app/dist/` is then the site, and the last line packs it as a bundle after the
data has passed the deploy's data gate. For another name or a path under one,
set `SITE_ORIGIN` and `SITE_BASE` before `npm run build:public`
(`ARCHITECTURE.md`, build parameters). `build:public` runs the pipeline with
`pipeline/.venv/bin/python`, which `uv sync` makes; `PLATO_PY` names another.

If the Diogenes release is gone, any copy of `greek-analyses.txt` and
`grc.lsj.xml` with the pinned sums will do: put both in a folder, name it in
`DIOGENES_DATA`, and `(cd pipeline && uv run python -m plato_pipeline.inputs check)`
says whether they are the right files. Every install of Diogenes 4.7.2 has
them, under `dependencies/data`.

## With Docker and nothing else

```
docker build -t plato-reader .
docker run --rm -p 8080:80 plato-reader
```

The first line is the build from source inside a container; the second serves
the result at `http://localhost:8080`. Put a host that speaks HTTPS in front
of it.

## To make it the primary again

The primary is a Cloudflare Worker for the app and an R2 bucket for the data;
`docs/cloudflare.md` has the steps and `npm run deploy:cloudflare` runs them.
Both need the owner's Cloudflare account. A new owner needs their own, and a
name to point at it.

## What a restore does not bring back

- The LSJ entry in the word popup and on lemma pages comes from another site
  (Grammata). Without it the reader still shows its own headword, gloss, and
  parses; the lemma page's entry says "The dictionary entry is not available
  here."
- Translations that are not cleared for the public site are not in the
  public build, and no bundle holds them.

## Log

| Date | What was run | Result | Time |
|---|---|---|---|
| 2026-11-21 | From source, on GitHub's Linux runner (CI's `site` job, run 44960210270) | Built; the data is byte for byte what the live site served on 2026-11-20 (7,591 of 7,591 files) | 8 minutes |
| 2026-11-21 | From source, on a Mac with the Diogenes export moved out of the tree | Built; the same 7,591 of 7,591, and all 5,582 app files byte for byte | 7 minutes |
| 2026-11-21 | From a bundle made on that Mac: steps 1 and 3, the folder served by Python's test file server on the same Mac | Every file matched its sum; all 13,171 files asked for came back with the listed bytes (at `--concurrency=2`; the test server drops connections at 8). The test server has no 404 page, and step 3 said so | under a minute |

Not yet run: a restore by someone else, from a mirror alone; the Docker path
anywhere; step 2 on a real host.
