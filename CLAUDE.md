# Plato Reader

Static Astro site, parallel Greek/English complete works of Plato. Repo lives at ~/Developer/plato-reader (kept out of iCloud). Node 22 required.
Sister project to ~/Developer/aristotle-reader — same pipeline/shared/app architecture; consult that repo's CLAUDE.md and docs for shared-machinery background, but do not edit that repo from here.
Live on GitHub Pages at the root of https://plato.johnhboyer.com (John, 2026-10-21); Cloudflare holds only the DNS record (CNAME `plato` → johnhboyer-sys.github.io, DNS only). Old github.io/plato-reader/ URLs redirect there.

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
- Base path is `/` at plato.johnhboyer.com (see app/astro.config.mjs and app/public/CNAME) — keep it in sync with robots.txt, sitemap, scripts/check-links.mjs and the `--live-slugs` URL in scripts/build-public.mjs.

## Build gotchas
- TLG export (Diogenes 4.7.2 recipe): the `tlg-export` skill (`.claude/skills/tlg-export/SKILL.md`).
- Multi-work workflows: rebuild stage1 per-work first.
- Narrated/spine-mode rows, Perseus TEI paragraphs, dialogue-flow pin drift, popup glosses: `pipeline/CLAUDE.md`. turnFlow data contract: `shared/CLAUDE.md`.
- `plato_pipeline all` is stages 1–7, PER WORK. Two things it does not do, and a
  full-corpus rebuild silently ships broken without them (verified 2026-07-29):
  `stage8` is the one corpus-wide stage — it merges every work's `build/ngrams`
  into the shared phrase index, so `/phrases` has no data behind it otherwise;
  and `align_turns.py` is a POST-stage7 step whose `alt` overlay payload `all`
  DESTROYS, blanking compare mode for all 11 Jowett works. After the last work:
  run `stage8` once, then the aligner per `sources/jowett-*/align.json`, then `stage9`. The
  canonical order lives in `scripts/build-public.mjs` — follow it, and note that
  a blank compare column is the only symptom, so nothing fails loudly. The aligner also writes
  each work's Jowett search index (`search/english-overlay-jowett.json`), and `stage9` builds
  the corpus search shards from every per-work index, so it must run after the aligner or
  Jowett is unsearchable. After any rebuild run
  `node scripts/verify-rebuild.mjs` (add `--live-slugs <live _index.json URL>` before a deploy):
  it fails on a missing stage8 output, a wiped `alt` payload, missing or stale search shards,
  a Jowett work without its index, a removed lemma slug, and an
  unexpected row-count change against a `--baseline` snapshot.
- astro-favicons is incompatible with a subpath base — don't retry; hand-roll if needed.
- Worktree agents running the pipeline: use the MAIN checkout's `pipeline/.venv` python
  (absolute path) with cwd = worktree/pipeline, and give the worktree its OWN build:
  `cp -Rc <main>/build build` (an APFS copy-on-write clone — near-zero space, and the disk
  runs ~96% full, so never a plain copy). Never symlink the main `build/`: two sessions
  sharing one build overwrote each other mid-verify (2026-09-29). The main checkout's
  `build/` is for the deploy build only. NOTE `.gitignore` needs both `build` and `build/`
  — the dir-only pattern misses a symlink, and one got committed once.
- Parallel sessions: main, the main checkout and gh-pages have one writer at a time — message
  the other session and wait for its ack before merging, deploying or building there. Claim
  your works/files at task start. PATCHES.md, SHA256SUMS and test_stephanus_english.py take
  appends from every source fix, so whoever merges second rebases and keeps both sides.
- Codex agent runs cannot write `.git` metadata (sandbox) — Codex implements, orchestrator
  commits/pushes.
- Headless browser for functional verification: playwright-core (npm) + the chromium
  headless shell already in `~/Library/Caches/ms-playwright/chromium_headless_shell-*/
  chrome-headless-shell-mac-arm64/chrome-headless-shell` (no Google Chrome installed; the
  playwright MCP server expects desktop Chrome and fails).

## Working with John
Philosophy professor, competent Greek. Explain architecture decisions; check in at milestones, not every step.
This repo was bootstrapped from aristotle-reader on 2026-07-11 by copying pipeline/shared/app/scripts and renaming the pipeline package `aristotle_pipeline` → `plato_pipeline`. The site LAUNCHED 2026-07-11 (full 36-work canon, Stephanus scheme, turn-flow reader) and fix round 1 shipped 2026-07-12 (6th deploy) — see DEPLOY-STATUS.md for the ledger. `shared/lib/works.ts` still uses the Aristotle-style registry shape (works, no dedicated dialogue registry).
