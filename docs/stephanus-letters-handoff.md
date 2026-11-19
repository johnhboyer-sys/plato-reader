# Handoff: English Stephanus letters checked against the Greek

Status 2026-11-19: John is marking the review page. Nothing in the source has changed yet.

## The problem

The Stephanus page and section letters in the English column come from Perseus
`<milestone unit="section" resp="Stephanus">` tags in
`sources/perseus-eng/tlg0059.tlgNNN.perseus-eng2.xml`. The pipeline never checks them
against the Greek. Perseus often snaps a milestone to a paragraph start or a printed
line break, so the letter can sit a sentence or more from where the Greek section
begins (checked by hand: Laws 910d, Republic 463c). A reader without Greek has no way
to notice. The rows themselves are fine; only the letter inside the English is off.

## What was run

| Step | Script (`scripts/stephanus-letters/`) | Result |
|---|---|---|
| Length test | `lentest.py` | 119 section pairs whose English/Greek length ratio is off; 9 of 10 sampled were real errors |
| Small test | `place.py` | $0.48; every answer quote found exactly once; hand checks right (Protagoras 353a, Alcibiades I 133b, Philebus 49a, Hippias Major 287e, Laws 910d, Republic 463c and 534a, Lysis 215e); the control Euthyphro 10e was a real error the length test missed |
| Full run | `place_batch.py submit/fetch` | all 8,516 boundaries in the corpus; Opus 5.5, adaptive thinking, effort high, Batch API; $54.80; 0 failures |
| Pick moves | `tiers.py` | 440 candidate moves → 107 confident (≥ 80 chars), 120 doubtful (≥ 80 chars), 213 small (< 80 chars) |
| Cross-check | Grok, blind | the 107 confident moves, places labelled P/Q at random; agrees with Opus on 106. The one disagreement (Laws 719e → 720a) goes to Opus: ἐπ' ends 719e and governs ἄλλον … νόμον |
| Review page | `page.py` (+ `page.head.html`) | https://claude.ai/artifact/MWf8uPwqnLm4CZzXHHu3Eo |

How Opus places a letter: it sees the Greek of section A, the Greek of section B, and
the English of both run together with no mark, and returns the first English words of
B (`{english_start, confident, note}` via a JSON schema). It cannot copy the current
placement because it never sees it.

Auth for the API scripts: `env -u ANTHROPIC_API_KEY uv run --no-project --with anthropic python -I <script>`
(the OAuth profile). Build ONE client and share it across threads; one client per
thread made parallel token refreshes fail with `invalid_grant`.

## The run folder

Everything runs from `build/stephanus-letters/` (git-ignored: it holds TLG Greek, so
it never gets committed). Key files there:

- `pairs.json`: inputs at submit, `{cid, work, a, b, ga, gb, ea, eb}` per boundary.
- `results.json`: Opus's answers per `cid`.
- `moves2.json`, `tiers.json`: from `tiers.py`.
- `grok-items-{1,2,3}.md`, `grok-key.json` (P/Q → NOW/NEW), `grok-verdicts-{1,2,3}.jsonl`.
- `page.head.html`: `page.py` reads it from the current folder.
- `review.html`: the published page.

`page.py` needs a FULL-corpus `app/public/data` (all 36 works) for the Greek word
popups; the main checkout often holds a partial build. Set `STEPHANUS_DATA` to one.
The default points at the worktree `intelligent-curran-f4c120`; if that worktree is
gone, build or copy a full data folder first (`cp -Rc`, never a plain copy).

## The review page

Cards show the end of A's Greek and the start of B's (click any word for lemma, gloss,
and parse), and the English with a dashed tag where the letter sits now and a blue tag
where Opus would put it. Doubtful moves come first, then the confident ones with
Grok's verdict. John marks each card: `new` (Opus is right), `now` (current is right),
or `other` (neither, with a note saying where). Marks live in the artifact's db,
collection `marks`, keyed by `cid`, `{verdict, note, ref, group}`.

Read them with ArtifactData `list` on the artifact URL, collection `marks`.
At handoff: 22 of 227 marked, 21 `new`, 1 `other` (Critias 116a: one word later, at
"ran round"). John's verdict so far: Opus places letters as a translator would, even
where the translation reorders words or interleaves sections.

## What's left

1. When John says he has finished, tally the marks.
2. Patch the milestones in `sources/perseus-eng/*.xml`: move each `new` to Opus's
   place and each `other` to John's note, leave `now` alone. One milestone per letter,
   so where a translator splits a section the letter goes where the section's Greek
   opening is rendered. Add the `sources/perseus-eng/PATCHES.md` and `SHA256SUMS`
   entries every source fix takes.
3. The 213 small moves (< 80 chars) stay as they are unless John says otherwise.
4. Rebuild the works touched (`stage1_stephanus_english.py` reads the Perseus English,
   so `plato_pipeline all` per work, then stage8, the Jowett aligner, and stage9 in
   `scripts/build-public.mjs` order), run `node scripts/verify-rebuild.mjs`,
   and check functionally that each moved letter renders at its new place.
5. Branch or PR, cross-family review of the patch, then John's go before merge.
   Deploying is his call.
