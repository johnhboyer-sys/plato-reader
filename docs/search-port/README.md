# Search port groundwork (16 Nov 2026)

Groundwork for porting aristotle-reader's new search (its PR #195, plan in its `HANDOFF-SEARCH-PORT.md`).
No code is ported here; the port waits for Aristotle's counting PR and John's two rulings.

| File | What it is |
|---|---|
| `diff-map.md` | File-by-file map of Plato's `shared/` against Aristotle's `origin/main`: what to port, what to keep, what to merge by hand, the B styles, the corpus files the new search fetches. Read first. |
| `diff-map-hunks.md` | Every hunk, sorted port / port? / keep / both. Written by `diff-map.py`. |
| `diff-map.py` | `python3 docs/search-port/diff-map.py <aristotle checkout at origin/main>` |
| `search-counts.mjs` | The baseline: 15 searches run on a served build, recording total, pages, the bar's text, and page 1's rows. Adapted from Aristotle's `app/scripts/search-counts.mjs`. |
| `counts-base-2026-11-16.json` | Its output on today's build. Run twice; identical. |
| `unit-counts.py`, `unit-counts.json` | Counts under each candidate counting unit (Stephanus section, page, reader row, book) for John's ruling. |

Rulings page for John (counting unit, and the B look against Plato's): https://claude.ai/artifact/Q2ovWWx2KsqpMawjkfYP4R

## The baseline

- Built from main `c2634c9ac7` with `scripts/build-public.mjs` in a worktree with its own `build/` clone: all
  gates passed (preflight, shared LSJ, 0 broken links of 674,182, verify-rebuild against live).
- Served with a small Node static server. Python's `http.server` drops connections under the search's
  parallel fetches and gives counts that change from run to run; do not use it.
- If the cached Playwright build does not match its Chromium, set `CHROMIUM_PATH` to the headless shell in
  `~/Library/Caches/ms-playwright/chromium_headless_shell-*/`.
- Today's English totals count every translation (Loeb and, on 11 works, Jowett): "virtue" is 821
  instances, of which 514 are the Loeb's. Aristotle's counting PR changes this on purpose.
- The only 404 while searching is `data/lemma-map/v.json` (no Greek lemma folds to a "v"; the page asks
  when an English word is typed). It is harmless and predates the port.
