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
- TLG_DIR="/Users/johnboyer/Documents/CLAUDE CODE ARISTOTLE PROJECT/TLG Files/TLG"; run Diogenes xml-export.pl directly with `-n 0059` to pre-populate build/export — the pipeline's stripped-PATH subprocess dies (exit 25). (Same gotcha as aristotle-reader, different TLG author code.)
- Multi-work workflows: rebuild stage1 per-work first.
- astro-favicons is incompatible with a subpath base — don't retry; hand-roll if needed.

## Working with John
Philosophy professor, competent Greek. Explain architecture decisions; check in at milestones, not every step.
This repo was bootstrapped from aristotle-reader on 2026-07-11 by copying pipeline/shared/app/scripts and renaming the pipeline package `aristotle_pipeline` → `plato_pipeline`. Phase 1/2 (Stephanus pagination, the dialogue registry replacing `shared/lib/works.ts`, dropping remaining Aristotle-specific content strings) has not started yet — don't assume it's done.
