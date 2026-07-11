# Deploy status

## Current
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
