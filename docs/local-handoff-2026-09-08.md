# Local handoff — two open PRs, 2026-09-08

Written from the remote session of 2026-09-07 (evening). Nothing is deployed and
nothing is merged. Both PRs are green on CI. This is what only the laptop can
check, and what is still yours to decide.

The remote container has **no TLG export and no real `build/dist`**, so every
data claim below is either from a fixture, from the vendored donors, or from a
synthetic stand-in corpus — never from the real build. Where that matters it
says so.

---

## PR #42 — speaker filter, Letters nav, rebuild check

Branch `claude/weekly-usage-catchup-3ckkma`. **App-only: no rebuild needed.**

### What it is

- **Spoken by** — hold a search to one voice (*ἀρετή in Socrates' mouth only*,
  or anywhere but). Needs no new artifact: stage 6 already writes `turn_bounds`
  into `offsets.json`, so the speaker of a token is one binary search away.
- **Per-letter navigation for the Letters** — 13 openings in the Contents
  outline and on the landing page. Off the Pending list.
- **`scripts/verify-rebuild.mjs`** — fails on the two silent rebuild failures.
- **Word popup** — a blank gloss on a capitalised lemma reads *proper name*.
- **Docs** — README and ADDING-A-WORK rewritten; `DEPLOY-STATUS.md`
  de-duplicated (commit `6b3bfb2` had appended a stale copy of the whole file,
  so everything from the 26th deploy back appeared twice; halves diffed as
  identical apart from one header before deleting).

### Run locally

```sh
cd shared && npm ci && npm test && npm run check     # 412 tests, svelte-check 0
cd ../app  && npm ci && npm test
cd .. && node scripts/verify-shared-imports.mjs
```

Then, against the **real** corpus:

```sh
cd app && PUBLIC_SHOW_PRIVATE=0 npm run build
cd .. && node scripts/check-links.mjs app/dist
node scripts/verify-rebuild.mjs \
  --live-slugs https://johnhboyer-sys.github.io/plato-reader/data/lemmata/_index.json
```

The last one is new. On a corpus you have not rebuilt it should report the slug
set byte-identical and every compare overlay present. If it reports a wiped
`alt` payload or a missing stage8 output, that is a real state you were
previously shipping blind — not a bug in the script.

### What the remote session could NOT verify

The Astro build ran against a **synthetic** 36-work corpus, so it checked
**shape, never content**. Worth eyeballing on the real data:

1. **A Letters page** — `/Letters/book/1`. Open Contents: 13 groups, all
   expanded, spans reading `309a–310a`, `310b–314e`, … Then the landing page
   `/Letters`: the same 13 with `?loc=` links.
2. **One filtered search** — `/search`, Greek `areth`, open *Spoken by*, pick
   *Only these speakers* → Socrates → Search. Check the per-hit speaker labels
   look right against the text, and that the note under the results names any
   narrated works left out.
3. **The CSV** — export a filtered search and confirm the Speaker column sits
   before the URL and the link is still clickable (the iPad Excel fix from the
   12th deploy).

### Two bugs the review of this branch caught

Both are already fixed on the branch; flagging them because they are the kind a
reviewer should re-check rather than take on trust.

- **Mine.** Under *all words* with a filter I kept a section if **any one** term
  survived — so Socrates saying ἀρετή and Callicles saying δικαιοσύνη would be
  reported as a pairing he made. The filter now works in the structure each mode
  is defined over (`greekGroups` in `shared/lib/search.ts`).
- **Pre-existing.** The command palette's rows were `<button>`s inside their own
  `role="option"` — invalid ARIA and a stray tab stop in an
  `aria-activedescendant` listbox. The row is the control now
  (`shared/components/CommandPalette.svelte`).

---

## PR #40 — spine mode, seven narrated works

Branch `claude/phaedo-speaker-turns-mm21pm`. **Not mine originally**; the remote
session reviewed it, pushed fixes, and got CI green. Full review with
reproductions is `docs/pr40-review.md` (it rides along on PR #42's branch, not
this one).

### What was fixed on it

- **HIGH** — deferral was not bounded by pinned frame turns, so a mark before a
  pin could be deferred past it and take the **next** section's opening English.
  The monotone merge then hid the inversion by folding the row into the frame
  turn, and the report counted the mark as **matched**, so the gate saw a
  success. Two lines; with no pins it is a no-op.
- **MEDIUM** — bare φάναι/εἰπεῖν as a third-person cue misfired on 9 of 10
  Republic paragraphs ("ὡς ἔπος εἰπεῖν", "ἔχεις εἰπεῖν"). Now cues only as a
  real attribution: Symposium keeps 64/65 hits, Republic 10 → 1, Phaedo 1 → 0.
- **MEDIUM** — Shorey answers ἀνάγκη with "Assuredly" 25 times and it was not a
  listed rendering, so the correct candidate was scored **down** while a
  neighbouring "Yes…" was scored up. Added.
- **LOW ×3** and a diagnostic: a book locating under two marks fell back to the
  dialogue flow with nothing in the log. Clitophon has exactly two donor marks,
  so one unlocated mark flips its whole mode. It says so now.

### The CI failure was not the fix

The first push turned pipeline red. Reproduced under CI's Python 3.9 rather than
guessed: PR #40 was cut **before** PR #41 merged, and #41 (the 29th deploy) made
`build_para_flow` drop embedded turns with no label. PR #40 has a test asserting
an *unlabelled* turn still yields an `et` marker. CI tests the **merge**, so they
collide. Main's rule is the deployed one and wins — main was merged in and the
test rewritten around a labelled turn, plus the converse. 259 passed, 18 skipped.

### Its own pre-merge checklist still stands

The 18 skips are the **Republic gold set**, and they skip for a reason you can
remove:

```
SKIPPED [16] tests/test_para_align.py:575: no build/stage1/greek_spine.json
             — build the Republic (stage1) to run the gold set
```

So, in order:

```sh
cd pipeline
.venv/bin/python -m plato_pipeline stage1 --work Republic   # unskips the gold set
.venv/bin/python -m pytest                                  # expect 277, 0 skipped bar pandoc
```

The gold set is the guard on exactly what these fixes touch (deferral scoring
and the cue table), so it is the single most valuable thing to run.

Then the seven works:

```sh
for W in Phaedo Symposium Timaeus Critias Menexenus Epinomis Clitophon; do
  .venv/bin/python -m plato_pipeline all --work $W
done
```

Note each stage1 `greek paragraphs: X/Y located` and stage7 `para_spine` line
into `sources/INVENTORY.md`. Watch for the new
`para_spine: book N fell back to the dialogue flow` line — if Clitophon prints
it, that is the diagnostic doing its job.

Read `build/stage7/para-align-<work>.json` for the places the stand-in drifted:
**Phaedo 60a, 89d, 117e–118a; Symposium 174b, 177d, 202d.**

---

## Decisions that are yours

1. **`SPINE_GRACE` is a flat 3** (`stage7_emit.py:36`). On the reviewer's
   stand-in numbers Clitophon passes at **0/2** and Critias at 9/12. This is your
   own review point 4. Options: scale it (`min(3, marks // 4)` → Clitophon 0,
   Critias 3), add a 50% floor, or leave it. **Deliberately not changed** — only
   the real build's numbers should settle it, and changing it could block your
   rebuild.
2. **Merge order.** #40 touches the pipeline, #42 is app-only; they do not
   overlap, so either order works. #42 has no dependency on #40.
3. **The `/phrases` and compare-column checks** in `verify-rebuild.mjs` may fail
   on your current tree if a past `all` run wiped an `alt` payload. If so, the
   fix is `align_turns.py` per `sources/jowett-*/align.json`, not the script.

---

## Still open, unchanged

- **Jowett overlays for the narrated works.** The remote session proved
  Gutenberg is reachable (the session proxy blocks it; a remote sandbox does
  not) but did **not** vendor anything: the blocker was never the texts, it is
  that no paragraph-level aligner exists for narrated works. Fetching them
  changes nothing until that is built.
- **~27% blank glosses** — the *proper name* label covers most of them by
  naming the blank, not by filling it. Still no gloss for those lemmata.
- **Custom domain** and the **Google Search Console token** (two TODO comments
  in `app/src/pages/index.astro` and `ReaderShell.astro`).
- **Cross-family review** was two fresh Claude subagents, not Codex or Grok. The
  OpenAI connection was never completed.
