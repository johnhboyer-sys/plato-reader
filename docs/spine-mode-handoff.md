# Handoff: verify PR #40 (spine mode for Phaedo + six works) on the laptop

**Written from a remote session, 2026-09-05.** The remote container had no TLG export
and no `build/`, so everything below was checked against a stand-in Greek spine cut
from each Perseus donor's own text, with the real English walker, mark locator,
pairing and flow builder, and WITHOUT the gloss bridge (stages 3–5). The laptop
session's job: build the seven works for real, read the reports, run the Republic
gold test, then the cross-family review, then merge. No deploy until John says so.

PR: https://github.com/johnhboyer-sys/plato-reader/pull/40
Branch: `claude/phaedo-speaker-turns-mm21pm` (two commits, `f7e2c26` and `b559830`).
CI green (app, shared, pipeline). No review comments as of the handoff.

---

## What the branch does

Seven works now run in the Republic's SPINE mode (`greek.paragraphs.spine` in the
manifest): a row per Burnet paragraph mark, the English cut per section by
`para_align`. The new part is that these works ALSO carry TLG speaker labels — a frame
dialogue or hand-offs — which the Republic did not:

| Work | Donor marks | TLG labels | Shape |
|---|---|---|---|
| Phaedo | 592 | 34 | Echecrates/Phaedo frame; narration between |
| Symposium | 236 | 5 | Apollodorus/companion frame; narrated banquet |
| Timaeus | 53 | 41 | opening conversation, then one discourse |
| Critias | 12 | 5 | one account |
| Menexenus | 10 | 33 | the funeral oration |
| Epinomis | 15 | 28 | the Athenian's expositions |
| Clitophon | 2 | 4 | Cleitophon's speech |

Before this, stage7 saw the labels, took each work for a dialogue, and set the
narration as page- or speech-sized rows.

Mechanism (all in `pipeline/plato_pipeline/`):

- `turns.build_para_flow` — in spine mode, Greek labels pair with the translation's
  `<said>` turns by name (`pair_book`) and each pair PINS a row: Greek at the label,
  English at the paired turn, `s`/`d` set, plus an `et` block at offset 0 (that block is
  what makes the reader print a lead-in on a para-flow row; `kind:"para"` rows never
  printed one before). Marks between two pins are matched only within that stretch.
  Unpaired Greek labels are matched like marks and labelled from `speaker_displays`.
  Unpaired English `<said>` events are dropped when they are page-break continuations
  (no label, or a label some paired turn prints) and kept as embedded `et` headings
  when they are rubrics (Lamb's "The Speech of Pausanias").
- `turns.build_para_flow` — DEFERRAL. A mark left unmatched within 200 chars of its
  section's end (`para_align.DEFER_MAX_GREEK`) re-enters the NEXT section's pass ahead
  of that section's own marks, at a negative offset. Lamb's milestones mostly lead
  Burnet's breaks (Shorey's lag them), so Diotima's replies at 202d had their English
  past the milestone. Offering the next chunk's head directly was tried first and
  stole from the next section's openings (Phaedo lost seven matches).
- `stage7_emit` — prefers the mark spine over the dialogue flow whenever a book has
  marks; `build_turn_flow` still runs for its stats and the roster gate. The 97% gate
  now forgives up to `SPINE_GRACE = 3` unmatched marks.
- `stage1_greek_paras.parse_marks` — strips `<label>` text and a window-cut tag from a
  mark's probe; raw window widened 400 → 1200 (`_PROBE_WINDOW`). Perseus reopens a
  labelled `<said rend="merge">` at every page break, and a two-word reply at a page
  end ("πάνυ γε.") carried "ΦΑΙΔ." as its second word and never located. The five
  earlier donors have no `<label>` at all, so their located marks cannot move.
- `para_align` — `NAMES_CASED`: the seven casts, matched case-sensitively on
  `fold_cased` (Κρίτων vs κριτῶν "of the judges"); `_EN_NAME` extended to match;
  `_GK_THIRD` gains φάναι/εἰπεῖν (Symposium's reported speech); replies gain ἀνάγκη ↔
  "Necessarily" and ἥκιστα ↔ "anything but".

Vendored: six new Perseus Greek donors under `sources/perseus-grc/` (positions only,
same pinned commit `3bd5626…`, `SHA256SUMS` updated). Manifests: `greek.paragraphs`
block added to the seven. Docs: `sources/INVENTORY.md`, `CLAUDE.md` build gotchas.

Left on the dialogue flow on purpose: Lysis, Parmenides, Protagoras, Euthydemus (the
OCT labels their narration with dash turns the dialogue flow already pairs — the
"dash-heavy tail" is its own problem), and the Jowett-overlay dialogues (Phaedrus,
Gorgias, Crito: few marks, and `align_turns` aligns the compare column to
dialogue-flow turns).

## Offline numbers (lower bound — no gloss bridge)

| Work | Located | Matched | Pinned |
|---|---|---|---|
| Phaedo | 592/592 | 590 | 34/34 |
| Symposium | 236/236 | 234 | 5/5 |
| Timaeus | 53/53 | 53 | 41/41 |
| Critias | 12/12 | 12 | 5/5 |
| Menexenus | 10/10 | 10 | 33/33 |
| Epinomis | 15/15 | 15 | 28/28 |
| Clitophon | 2/2 | 2 | 4/4 |

Pipeline suite: 252 passed, 18 skipped (the Republic gold set needs a build).

---

## Do this, in order

1. **Fetch and check out** in the MAIN checkout (`~/Developer/plato-reader`):
   `git fetch origin claude/phaedo-speaker-turns-mm21pm && git checkout claude/phaedo-speaker-turns-mm21pm`.
   Confirm the Phaedo export exists so stage1 skips Diogenes:
   `ls build/export/Diogenes-Resources/xml/tlg/tlg0059004.xml` (adjust to
   `stage1_greek.exported_xml_path`). If `build/` is gone, the TLG export recipe in
   CLAUDE.md comes first (all 41 works in one run).

2. **Build the seven** from `pipeline/` with the main venv:
   `python -m plato_pipeline all Phaedo` (then Symposium, Timaeus, Critias, Menexenus,
   Epinomis, Clitophon). Per work, capture two lines:
   - stage1 `greek paragraphs: X/Y located` — expect Y = the donor mark count above and
     X close to it. A drop means the donor and the TLG spine drifted (fold/elision);
     check `stage1_greek_paras._fold` and `_APOS` before anything else.
   - stage7 `para_spine: matched/marks (rate)` — the gate is 97% or ≤3 misses. The
     report is written BEFORE the gate, so a failing run still leaves it.
   Record both in `sources/INVENTORY.md` ("Located marks" paragraph and the
   spine-mode line) and commit on the branch.

3. **Read the reports** `build/stage7/para-align-<work>.json`. Each entry is
   `{book, c, greek (40 chars), english (40 chars or null)}`. Spot-check where the
   stand-in drifted by a sentence without glosses; the real gloss bridge should settle
   these, and if it doesn't, that is the finding:
   - Phaedo 60a ("καὶ ἐκείνην μὲν ἀπῆγόν" should open "And some of Crito's people"),
     89d, 117e–118a ("ἤδη οὖν σχεδόν τι" should open "The chill had now reached").
   - Symposium 174b, 177d ("οὐδείς σοι, ὦ Ἐρυξίμαχε" should open "No one, Eryximachus"),
     202d, 205a.
   - Menexenus 249d opened lowercase ("the Milesian.") on the stand-in — the carry
     should have taken "There you have, Menexenus".
   Also confirm no row lost its label: every frame turn is a row with `s`/`d` and
   `et:[{o:0,…}]` in `build/dist/<work>/book-01.json`.

4. **Run the pipeline tests with the Republic build present**:
   `python -m plato_pipeline all Republic` if `build/` doesn't already hold it, then
   `pytest -q`. `tests/test_para_align.py::test_gold_section_cuts_where_the_hand_check_says`
   and `test_the_known_misses_still_land_inside_the_right_turn` are the guard: deferral,
   the case-sensitive names, φάναι/εἰπεῖν, and the ἀνάγκη/"anything but" replies all
   touch Republic scoring. Deferral in particular can newly match some of the
   Republic's 88 previously unmatched marks (more rows), and could move 337c. If a
   gold section moves, the report says where; the fix is in `para_align` weights or
   `DEFER_MAX_GREEK`, not in the gold set.

5. **Reader check, functionally** (headless chromium per CLAUDE.md, or `npm run dev`):
   open Phaedo 57a–60a (frame rows labelled Echecrates./Phaedo., then unlabelled
   narrated rows), 88c and 102a (frame re-entries), 118a; Symposium 172a–174a and
   179b–189a (rubric headings "The Speech of …" render as `et` blocks, not as row
   lead-ins); Timaeus 27b–27d (Tim. hand-off, then paragraphs of the discourse).
   Speaker colours: `collectDisplayOrder` already reads `et` displays, so the cast
   list and Greek-column colouring need no app change — confirm on Phaedo.

6. **Cross-family review** (John's usual: Grok or another family, static passes).
   Points worth their attention:
   - Deferral vs pins and the carry bound (`after`): a deferred mark can't chain across
     two sections (`deferred = []` on every skip), and the pin intervals only see
     English between their pins.
   - An emptied pin interval (pin English drifted into a neighbouring chunk) merges
     its marks; confirm the merge never yields a Greek-only row.
   - The rubric rule: an unpaired English label is kept iff no paired turn prints it.
     Edge case: a real speaker who appears only in unpaired events would print as a
     heading.
   - `SPINE_GRACE = 3` flat — should it scale with mark count?
   - Whether `_GK_THIRD` gaining φάναι/εἰπεῖν can mis-cue a Republic paragraph.

7. **Merge** when 2–6 are clean; update `DEPLOY-STATUS.md` only when it deploys. After
   merge, remember the corpus-rebuild order in CLAUDE.md: `all` per work, then `stage8`
   once, then the Jowett aligner — none of the seven has a Jowett overlay, but a full
   rebuild still needs both.

## Scratch harness (if you want the offline check locally)

Not committed. It built a stand-in spine by splitting each donor's own text into
~44-char lines per section, dropping labels inside `rend="merge"` saids to mimic the
TLG's label count, then ran `stage1_greek_paras.locate`, `parse_english` and
`build_para_flow(…, spine=True, sigla=…, displays=…)`. The real build supersedes it;
rebuild it only if a work regresses and you need to bisect donor vs TLG.
