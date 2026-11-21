# Handoff — portability (Plato)

The Plato port of the portability track. The plan, John's rulings
(decisions 1 to 10), and Aristotle's worked example live in
`johnhboyer-sys/aristotle-reader`: its `HANDOFF-PORTABILITY.md` and merged
PRs #228 and #231 to #234. Read that handoff's "Goal" (the five tests),
"Decisions", and "Plan" first; this file records what the port did here,
what was decided and why, and what failed. Rewrite it as state changes.

The goal, in one line: the site builds from a clone plus checksummed inputs,
with no laptop; any static host can serve it; and copies live off GitHub and
Cloudflare.

## State (2026-11-21)

Phase 1 is on branch `claude/portability-phase1` (PR #130, not merged). Its
checks are green: CI built the whole site on Linux with no laptop, and both
that build's data and a laptop build's every file are byte for byte the live
site of 2026-11-20. Phases 2 and 3 are not started.

| Phase 1 step | State |
|---|---|
| `extract` writes `corpus/greek/`; the build reads only those | Done: 36 files, 71,700 lines, 7.25 MB. Stage 1 runs no program |
| Guard on the committed files, failing cases first | Done: every character Greek or one of 19 listed marks; braces only round a short speaker label on a numbered line; no named exception |
| The line files give stage 1 the export's spine | Done: 36 of 36 spines byte-identical (old code on the XML, new code on the line file, new code on the XML) |
| Morpheus table and LSJ pinned by checksum, folder from the environment | Done: the same two files as Aristotle's pins, byte for byte; `inputs check` runs in `build:public`; `inputs fetch` for a machine without Diogenes |
| Machine paths out of the public build | Nothing to take out: the manifests carry no `/tmp` path. They still name Diogenes.app, as the local default for `extract` and the two inputs |
| CI runs the full build and uploads it | Done: the `site` job in `ci.yml`. First run (44960210270) passed in 8 min 12 s: inputs fetched and matched their pins, 0 broken links, slugs byte-identical, 13,173 files packed with a `SHA256SUMS` |
| Same output as live (test 2) | Done. CI's Linux build: 7,591 of 7,591 data files byte for byte the snapshot's. A laptop build with the export moved off: 7,591 of 7,591 data files and 5,582 of 5,582 app files byte for byte, with no name swapped |
| Review by another model family | Done: Codex (GPT-6.1-Sol, medium), two reads. Five findings, all in `extract`'s write step: four fixed with tests first, one answered |

## Phase 1 record

**The line files.** `python -m plato_pipeline.extract --all` (in `pipeline/`,
with `TLG_DIR` set) reads the Diogenes export under the git-ignored
`build/export`, running Diogenes only when a work's XML is missing, and
writes `corpus/greek/<Work>.tsv`: three heading lines (work, edition,
columns), then one printed line per row under its Stephanus page and section.
It makes and checks every file before it writes the first, and refuses to
replace a file with a shorter one without `--allow-fewer-lines`.
`pipeline/plato_pipeline/greek_lines.py` is the format.

**Speakers' labels: where Plato differs from Aristotle.** Burnet's text
carries 13,955 speaker labels inside the lines of the 36 works
(`<label type="speaker">ΣΩ.</label>`, the dash of a reply, `ΝΕ. ΣΩ.`). Stage 1
lifts each out of the Greek and records the offset where that speech begins.
A line file that flattened the text would have lost them, so each label
stays in braces where it stood (`{ΣΩ.}`), on numbered lines only; stage 1
puts back the sentinel it always used and runs the same walk
(`_lift_speakers`, shared by both readers). The edition prints no brace, so a
brace means a label; `rows_from_xml` refuses a brace in the text and a label
whose white space would not read back. The one heading line in the corpus
(the Letters' `n="t"`) is written as plain text, as stage 1 always read it.

**The text is kept as exported, not NFC**, as in Aristotle (its phase 1
record says why: NFC would rewrite the Greek punctuation and every served
page).

**How it was proved.** (1) The spine stage 1 makes for all 36 works is byte
for byte the same three ways: the old code on the export's XML, the new code
on the line file, and the new code on the XML (71,699 spine lines, 13,955
speaker turns). (2) 22 hand-made breaks of the new guards (planted beta code,
markup, an export label, a stray brace, and each rule of the guard, stage 1,
and `extract` switched off one at a time) each fail a test; the first run
missed one (the heading's `|` strip in the line-file path had no test, since
Burnet prints no `|`), and a test was added. (3) Pipeline tests: 754 passed, 18 skipped (with a
build present); script tests 48 of 48.

**Test 2, the laptop build.** With `build/export` moved out of the tree and
`TLG_DIR` unset, `PUBLIC_DATA_ROOT=https://plato-data.johnhboyer.com npm run
build:public` ran to the end in 7 min 13 s (36 works, 5,483 pages, 0 broken of
674,185 links, `verify-rebuild` all passed, 5,345 slugs byte-identical to
live). Against `~/Developer/reader-snapshots/2026-11-20/plato/`:

- `node scripts/compare-snapshot.mjs --sums=<snapshot>/SHA256SUMS --prefix=data/
  --build=app/dist/data --live-only=docs/portability/plato-live-only-2026-11-20.list`:
  7,591 of 7,591 files byte for byte; the one live-only file is the bucket's
  key record (`_deploy/keys.json`). Plato's bucket keeps no stale file,
  unlike Aristotle's 22 shards.
- `node scripts/compare-snapshot.mjs --sums=<snapshot>/SHA256SUMS --prefix=app/
  --build=app/dist --pages=<snapshot> --svelte=shared/components
  --skip=data/,.assetsignore,_redirects`: 5,582 of 5,582 files byte for byte,
  0 names swapped. Aristotle needed 11 swaps because Svelte hashes a shared
  component's path into its class; the 52nd deploy was built in this same
  worktree folder (`intelligent-curran-f4c120`), so the classes match. A
  build in any other folder will need the swaps.
- A byte added to one data file, and a word changed in one page, each turned
  the comparison red; put back, it was green again.

No deploy has come after 2026-11-20 (DEPLOY-STATUS.md's last is the 52nd, on
2026-11-19), so the snapshot is what live serves.

**Test 1 and test 2, the Linux build.** CI run 44960210270 (`site` job): the
two inputs fetched from Diogenes's 4.7.2 release matched their pins, the full
build passed every gate, and the job uploaded 13,173 files with a
`SHA256SUMS`. Downloaded and unpacked: `verify-snapshot.mjs` read 13,173 of
13,173 files against that list, and `compare-snapshot.mjs` found 7,591 of
7,591 data files byte for byte the snapshot's. Its pages were not compared:
built with no data address, its bundles and `sw.js` differ from live's by
design, and its folder (`/home/runner/...`) gives the shared components other
class names.

**Review.** Codex (GPT-6.1-Sol, medium; the session log shows both) read the
change statically and found two gaps, both in `extract`'s write step and
both inherited from Aristotle's `extract.py`: a move into place that failed
part way left the earlier files moved, and a write that failed after it made
its temporary file left that file. Both fixed, each with a test that failed
first. It found no way the line file and the XML give different spines, no
way past the guard, and nothing in the CI job. A second read, of the fix,
found three edge cases in the put-back itself: it wrote over a file in place
(a full disk could cut it short) and one failure stopped the rest; an
interrupt between a move and its record left the move out of the undo; and
it would undo another writer's file. The first two are fixed (a put-back is a
write beside the file and a rename, temps go first, a failure is named and
the rest go on; the move is recorded before it is made, which has no test, as
it is a matter of timing). The third is answered in the docstring: `extract`
assumes it is the only writer in `corpus/greek/`. Six hand breaks of the
put-back each fail a test. Aristotle's `extract.py` still has all of these;
porting the fix back is the lead session's call.

**The two outside inputs.** `greek-analyses.txt` and `grc.lsj.xml` in this
Mac's Diogenes 4.7.2 are byte for byte the files Aristotle pinned
(sha256 `dfca7ef1…` and `af72685a…`), so `inputs.py` is Aristotle's with its
names changed.

**What is the same as Aristotle's and was not re-proved here.**
`scripts/compare-snapshot.mjs` and `scripts/verify-snapshot.mjs` are copied
from Aristotle's `main` (comments aside), with their tests.

## Decision 10 (open, John's): the Euthyphro fixture

`pipeline/tests/fixtures/stephanus/euthyphro_p2_3.xml` (9.4 KB, Euthyphro 2a
to 3e in the Diogenes export's markup) has been public in this repo since
2026-07-11; `edge_cases.xml` beside it holds made-up lines. The phase 1 guard
covers `corpus/greek/` only, so today the fixture stays as it is.

- **A. Allow short fixtures.** Keep it. Its Greek is the same text
  `corpus/greek/Euthyphro.tsv` now publishes under decision 1; what it adds is
  the export's TEI markup, not the TLG's own beta code. A test would pin the
  allowed fixtures by name and size, so no whole export could come in
  beside them.
- **B. Replace it with made-up Greek** in the same markup, and rewrite the
  tests in `test_stephanus.py` that read its real words. The old file stays
  in git history unless John rewrites history (his call).

Recommendation: A, with the pinning test.
