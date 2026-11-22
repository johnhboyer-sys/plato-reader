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

## State (2026-11-22)

Phases 1, 2, and 3 are on `main`. John said "merge" on 2026-11-21; PRs #130
(phase 1), #131 (phase 2), #132 (phase 3), and #133 (the `extract` put-back
fix) were merged in that order within 30 seconds (main at `54326c2271`, its
tree identical to the last checked branch, `3d8b79d0e6`). Two sessions merged
at once: this one merged #130 and the lead session the other three; they
stacked in order. On the merged commit, CI passed (both guards, the full
Linux build with 0 broken links, the bundle's three gates on 7,591 data
files, test 3 at 5 of 5 visits) and the image served 13,171 of 13,172 files
with their bytes.

Nothing is deployed. The GitLab mirror is live since 2026-11-21: Plato's own
deploy key is on the GitLab project, and `mirror.yml` pushes every branch and
tag there on each push (see "Plato's deploy key" in the phase 3 record).
`release.yml` runs first at
the next deploy, whose script now tags it. Decision 10 is ruled (A: the
fixture stays, pinned). Still open: the bundle on two candidate hosts
(decision 6), the licence (decision 3; none added), and a restore by someone
else from a mirror alone (test 5).

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

| Phase 2 step | State |
|---|---|
| Build parameters for origin, base path, and the Grammata address | Done: `SITE_ORIGIN`, `SITE_BASE` (`scripts/site-params.mjs`, read by the Astro config and the link check), `PUBLIC_GRAMMATA_LOOKUP`; `robots.txt` and `offline.html` written by the build. Unset, 5,582 of 5,582 app files are byte for byte the snapshot's |
| A build at a test base path passes the link check | Done: `/mirror/` at another origin, 5,483 pages, 674,185 links, 0 broken. The check now fails a root-relative link that leaves out the base; that found `offline.html`'s stylesheet link, now written with the base |
| Fonts self-hosted | Already so; test 3 proves it (no font host asked for, and a planted Google stylesheet link fails it) |
| No outside calls (test 3) | Green at `/` and at `/mirror/`, on the Mac and on Linux in CI: 5 of 5 visits, one outside host asked for (Grammata, allowed) |
| The mirror bundle | Done: `scripts/make-bundle.mjs`, 13,172 files, 820 MB, 128 MB packed, three gates on 7,591 data files |
| `check-served.mjs` | Done (Aristotle's, unchanged); used by the image workflow and the restore drill |
| `Dockerfile`, Caddy, image workflow | Done; first run green: the container answered 13,171 of 13,172 files with their bytes (the dot file left out) |
| `ARCHITECTURE.md`, `RESTORE.md` | Written; `RESTORE.md`'s log records each path run |
| Review by another model family | Done: Codex (GPT-6.1-Sol, medium), two reads; seven findings, all fixed |
| The bundle on two candidate hosts | Waits on John (decision 6, accounts), as for Aristotle |

| Phase 3 step | State |
|---|---|
| Push the repo to a second git host | Done: `scripts/mirror-git.mjs` (Aristotle's, unchanged), run by `mirror.yml` with Plato's deploy key since 2026-11-21 |
| Check a git mirror | Done: `scripts/mirror-check.mjs`, run for real against `git@gitlab.com:johnhboyer/plato-reader.git` (below) |
| The deploy tags its commit | Written: `npm run deploy:cloudflare` tags `deploy/<date>` after the Worker deploy succeeds and pushes the tag; `--no-tag` holds it back. Not yet run in a real deploy |
| A release for each deploy tag | Written: `.github/workflows/release.yml`, the shared `site-bundle` action, then the bundle's data held to `plato-data.johnhboyer.com`, then `gh release create`. Runs first at the next deploy after this merges; about 126 MB public each time |
| `mirror.yml`: git on every push, the check weekly | The git job is live: its first run (44972051403, a rerun for `432e1381f9`) found 35 of 35 refs matching after the push; the first run started by a real push is quoted below. Before the key, both jobs were skipped (run 44965299916). Not yet seen: the weekly check job, a tag push |
| `check-mirrors.mjs` and `mirrors.json` | Done: `mirrors.json` names the GitLab mirror; the check runs and fails truly (below) |
| Review by another model family | Done: Codex (GPT-6.1-Sol, medium); one finding, fixed with a test first |

## Phase 3 record

**What was ported.** `scripts/mirror-git.mjs`, `scripts/mirror-check.mjs`,
`scripts/check-mirrors.mjs`, their tests, `.github/actions/mirror-key`,
`.github/mirror_known_hosts`, and `.github/workflows/mirror.yml` are
Aristotle's merged files unchanged, so they carry the fixes Codex's three
reviews forced there (Aristotle's phase 3 record lists them: `--no-force`
could not take `main` off the never-forced list; a remote-helper address
with a password was refused and not printed; an address starting with `-`
refused; a tag whose push failed removed locally; an untracked file counted
as an unclean tree; a `--source` with a password not printed; one mirror's
throw no longer hides the others; a list behind a byte-order mark refused; a
mirror could not send its list's address to another host; the checkout's
token not sent beside the mirror job's; host keys never read from the
runner's global file; an empty key no longer stops the check job).
`release.yml` and `mirrors.json` are renamed for Plato. The deploy tag
(`tagPlan`, `tagCommits`, `tagDeploy`, and the lines in `main()`) is ported
by hunk into Plato's own `deploy-cloudflare.mjs`, whose gates differ.

**Checks.** Script tests 180 of 180 (65 of them the phase 3 scripts' and the
tag's). Four hand breaks of the ported tag code (an unclean tree tagged, a
failed push leaving its tag, a second tag at one commit, an annotated tag
read as its own object) each fail a test.

`mirror-check.mjs` against the GitLab mirror (read with the account key the
lead session made for phase 0):

```
FAIL git@gitlab.com:johnhboyer/plato-reader.git: 30 of 32 refs match; 1 skipped (refs/heads/gh-pages)
  missing on the mirror: refs/heads/claude/portability-phase1
  missing on the mirror: refs/heads/claude/portability-phase2
```

That is the truth: the mirror is the lead session's copy of 2026-11-21, and
these two branches came after it; nothing keeps it current until
`mirror.yml` has its key. With those two skipped:
`ok …: 30 of 30 refs match; 3 skipped (…); history: 605 commits, whole`.
`check-mirrors.mjs --source=https://github.com/johnhboyer-sys/plato-reader.git`
reads `mirrors.json` and fails the same way (`FAIL 0 of 1 mirrors whole and
current`, the two branches named, history not checked because the refs do
not match).

**Review.** Codex (GPT-6.1-Sol, medium) read the port statically and found
one thing, in Plato's deploy script: the tag's guard asked `git status
--porcelain` for untracked files, which a `status.showUntrackedFiles=no`
setting hides, so a deploy with an untracked page could be tagged at a commit
that lacks it. The guard is now `uncleanFiles()`, which asks for
`--untracked-files=all`; its test sets that config and plants a page, and
fails with the flag taken out (and with `normal`, which names only the
folder). Aristotle's script asks the same way; porting the fix back is the
lead session's call. It found nothing else: no return or throw between the
Worker deploy and the tag step, the dry run never tags, the release's
`--part=data` check matches how Plato's bucket names its keys, and the git
job skips while `MIRROR_GIT_URL` is unset.

**Plato's deploy key (2026-11-21).** A key made for this repo's workflow
alone (ed25519, fingerprint `SHA256:APlUVBfEj4TWBheyDuvCrzpwAUwyaIcAaM5lnv/G2Vc`,
titled "plato-reader mirror, GitHub Actions, 2026-11-21" on GitLab), made by
the lead session. John added the public half to the GitLab project
`johnhboyer/plato-reader` with write access, and to `main`'s "Allowed to push
and merge" list; force push to `main` stays off. The lead session tested it
(it reads `plato-reader` and GitLab refuses it on `aristotle-reader`), put the
private half in the secret `MIRROR_GIT_SSH_KEY` and the address
`git@gitlab.com:johnhboyer/plato-reader.git` in the variable
`MIRROR_GIT_URL`, and deleted the local pair, so the private half is in the
secret and nowhere else.

The git job runs on a push alone, so its first run was a rerun of the
skipped Mirror run for `432e1381f9` (run 44972051403): `ok
git@gitlab.com:johnhboyer/plato-reader.git: 35 of 35 refs match the source
after the push; 1 left out (refs/heads/gh-pages)`. That push moved GitLab's
protected `main`. `mirror-check.mjs` after it: `35 of 35 refs match; 1
skipped (refs/heads/gh-pages); history: 628 commits, whole`. The first run
started by a real push, the push of this record's branch: FIRST_PUSH_RUN.
Not yet seen for Plato: the weekly check job, a tag push, and the release
workflow.

## Phase 2 record

**Parameters.** As in Aristotle: `scripts/site-params.mjs` checks `SITE_ORIGIN`
(a bare origin) and `SITE_BASE` (a path with a slash at each end), and both
`app/astro.config.mjs` and `scripts/check-links.mjs` read it. `robots.txt` is
an endpoint (`app/src/pages/robots.txt.ts`). `PUBLIC_GRAMMATA_LOOKUP` is read
in place in `WordPopup.svelte` and `LemmaPage.astro`, with the old address as
its default; `shared/__tests__/grammata-address.test.ts` holds both to one
form. Plato's own differences: `check-links.mjs` ran its check on import, so
it now runs only as a script (real paths compared, so a run through a link
still checks); and `offline.html`, which `sw.js` serves at whatever address
failed, named `/fonts/fonts.css` from the root, so it is now an endpoint
(`app/src/pages/offline.html.ts`) that writes the base into that one link,
byte for byte the old file at `/`.

How it was checked: built with only the live data address set, the app is
5,582 of 5,582 files byte for byte the snapshot's, the generated `robots.txt`
and `offline.html` among them (run twice, before and after the review's
fixes). Built with `SITE_BASE=/mirror/ SITE_ORIGIN=https://mirror.example.org`,
`SITE_BASE=/mirror/ node scripts/check-links.mjs app/dist` finds 0 broken of
674,185 links, and the canonical link, the card image, `robots.txt`, and the
sitemap name the new origin and base. The same build checked with no base
fails (it lists every link as broken and runs out of memory; exit 134).

**The bundle.** `scripts/make-bundle.mjs` is Aristotle's, with Plato's gates:
Plato keeps no gated translation, so in place of Aristotle's leak checks it
runs `verify-rebuild.mjs` on the data (a warning fails it here), a check that
the lemma index lists slugs and each has its file, and a check that every
JSON file parses. Every data file is summed before the gates read the folder,
and every later read must match. It leaves out `CNAME`. The real run:
`ok …: 13172 files, 819839145 bytes, packed to 127877083; left out CNAME; 3
gates passed on 7591 data files (verify-rebuild, lemma pages, JSON); unpacked
and read back against SHA256SUMS`. One lemma file taken away: refused
(`lemma pages: 1 slug has no file, first: arete`); `verify-rebuild` alone had
passed it.

**No outside calls (test 3).** `scripts/check-no-outside-calls.mjs` is
Aristotle's method with Plato's five visits: `Euthyphro/book/1/` (5,000
visible Greek and 5,000 English letters), a word popup (a Greek headword, a
gloss, and a parse), a search for λόγος (a hit linking to a page of this
build), `lemma/logos/` (headword, gloss, works, and the LSJ mount's text
changed from "Loading…"), and the work page again under the service worker.
Plato's reader offers no other typefaces, so Aristotle's sixth visit has no
counterpart. One addition: a named list of expected 404s
(`EXPECTED_MISSING`), holding `data/lemma-map/v.json`, the digamma shard,
which search asks for and reads a 404 for by design (DEPLOY-STATUS.md, 48th
deploy); a listed path the build holds is refused, and `--expect-missing=`
replaces the list. Results: `ok app/dist at /: 5 of 5 visits, 246 requests
to the site (0 not found, 1 expected), 1 outside host asked for, it allowed
(grammata.pages.dev x1); control seen`, and at `/mirror/` the same with 250
requests. A planted Google stylesheet link and a removed data file each
turned it red. Its 16 browser fixtures pass here; CI runs the real check in
the `site` job.

**Fonts.** Self-hosted before this work (Gentium Book Plus and Geologica, four
subsets). The scan Aristotle's record asked for, over every built page and
data file: no font file covers a few characters, which fall back to a system
face, as on live today. Outside the LSJ shards (which the website never
reads; they serve the desktop lexicon), they appear on two pages: Republic 3
(U+23D1, a metrical breve) and Republic 8 (U+0313, a combining comma above).
Also the `↗` and `▾` marks on most pages (U+2197, U+25BE), which are icons.
Nothing was changed; adding subsets is a change to served files and John's
call.

**CI and the image.** CI's `site` job now runs the shared action
`.github/actions/site-bundle` (inputs, build, bundle, test 3), as Aristotle's
does. On the first phase 2 commit (runs 44963158189 and 44963158127): the
site job passed in 8 min 28 s (`2 gates passed on 7591 data files`, as the
gates then were; test 3 `5 of 5 visits, 250 requests`), and the image built
and `check-served.mjs` found `13171 of 13172 listed files asked for, 1 dot
file left out; each answered 200 with the listed bytes; 5481 folder addresses
serve their index`, in 9 min 21 s.

**Restore drill.** From a bundle made on the Mac: unpacked and `shasum -c`
clean in 7 seconds; served by Python's test server, `check-served.mjs` read
13,171 files with their bytes and failed only on that server's missing 404
page. Logged in `RESTORE.md`.

**Review.** Codex (GPT-6.1-Sol, medium) read phase 2 statically and found six
things: `make-bundle` handed `verify-rebuild` a relative path it resolves from
the repo root; `verify-rebuild` read the folder before sums were taken; a
missing or empty lemma index passed; the link check passed a root-relative
link that left out the base (which found the `offline.html` link); the popup
visit took a gloss or a parse alone; a doc command lacked its arguments. All
fixed, the code ones with a test that failed first. A second read of the
fixes found one more doc command short of its live-only list; fixed. It found
nothing in the Dockerfile, Caddy, the workflows, the parameters' defaults, or
the expected-404 matching.

**Known and left.** As in Aristotle: saved searches keep whole paths, base
included, in the browser's storage, so a saved search does not follow a site
to another base. The footer links to the sibling readers by name.

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
put-back each fail a test. The lead session ported the fix back to Aristotle,
and Codex's read of that port found two more gaps, which this copy had too: a
temp or `.back` file that could not be removed raised inside the cleanup,
stopping the later put-backs and hiding the first error. Fixed on
`claude/portability-extract-cleanup` (stacked on phase 3) as Aristotle has it:
each removal is caught and named on stderr, and the first error is raised;
two tests failed first, and four hand breaks each fail them.

**The two outside inputs.** `greek-analyses.txt` and `grc.lsj.xml` in this
Mac's Diogenes 4.7.2 are byte for byte the files Aristotle pinned
(sha256 `dfca7ef1…` and `af72685a…`), so `inputs.py` is Aristotle's with its
names changed.

**What is the same as Aristotle's and was not re-proved here.**
`scripts/compare-snapshot.mjs` and `scripts/verify-snapshot.mjs` are copied
from Aristotle's `main` (comments aside), with their tests.

## Decision 10 (ruled A by John, 2026-11-21): the Euthyphro fixture

`pipeline/tests/fixtures/stephanus/euthyphro_p2_3.xml` (9,369 bytes, Euthyphro
2a to 3e in the Diogenes export's markup) has been public in this repo since
2026-07-11. John chose A: keep it, pinned. Its Greek is the text
`corpus/greek/Euthyphro.tsv` now publishes under decision 1; what it adds is
the export's TEI markup, not the TLG's own beta code.

The pin is `pipeline/tests/test_corpus_greek.py`
(`test_no_tracked_file_is_export_shaped_but_the_pinned_fixture`). It reads
every tracked file (679 today), as UTF-8 and, when a file holds a NUL, as
UTF-16 both ways, and fails on: a file named like an export
(`tlgNNNNNNN.xml`); the sentence an export's header opens with; more than 30
numbered line or line-break elements (`<l n="1">`, `<l n='1a'>`,
`<lb n="1"/>`) in any file but the fixture, or more than 80 in all of them
together (53 today: the tests' made-up Greek and doc examples); and the
fixture at any bytes but its pinned size and sha256 (77 lines). Planted cases
fail it first; nine hand breaks (a byte added to the fixture, a 40-line
export planted and tracked, each rule switched off, the old narrow pattern,
the hash unpinned) each fail a test.

Codex (GPT-6.1-Sol, medium) read the first version and found four gaps, now
closed: other line markup, a UTF-16 copy, an export split across many small
files, and no planted change that kept the fixture's size (the hash's own
test). Out of reach of a text scan, and said in the test: a compressed,
encrypted, or otherwise encoded copy, a submodule's files, and untracked
files. Beta code outside `corpus/greek/` is not looked for: the pipeline
keeps beta-code lookup keys of its own. The other choice, made-up Greek in
place of the fixture, was not taken; the old file stays in history either
way.
