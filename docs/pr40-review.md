# PR #40 review — spine mode for Phaedo and six more narrated works

Reviewed 2026-09-07 against `origin/claude/phaedo-speaker-turns-mm21pm` (checkout at
`scratchpad/pr40`), diffed against `main`. Pipeline suite on the PR checkout: 252 passed,
18 skipped (the Republic gold set needs a build). Every finding below was reproduced by
executing the PR's own `build_para_flow` / `para_align` on small fixtures, or by measuring
the vendored donors; items I could not confirm are labelled *suspected*.

## Verdict: SHIP WITH FIXES

One real logic hole in the new deferral (a mark before a pinned frame turn can be deferred
past that turn and take the next section's opening English), and two cue-table changes that
alter Republic scoring for 44 marks while the PR claims the Republic build is unchanged and
the gold tests that would prove it are skipped in CI. Both are small, local fixes; a patched
copy passes the suite and cures the reproductions. The rest is low-severity or design.

---

## Findings

### HIGH-1 — Deferral is not bounded by pins: a mark before a pinned turn is deferred past it

`pipeline/plato_pipeline/turns.py:1063` (`if len(gtext) - o <= para_align.DEFER_MAX_GREEK:`).

The deferral test is "unmatched and within 200 chars of the section end". It does not ask
whether a pinned turn follows the mark in the same section. A pin bounds the English of every
mark before it (the stretch partition at lines 997–1010 enforces this for the section's own
pass), so a mark before a pin can never have its English in the next section — yet once
deferred it re-enters the next section's pass at a negative offset, ahead of that section's
own first mark, and competes for the chunk's opening English.

Trigger: a Burnet mark whose English the translator ran into the previous sentence (no
candidate between the row before and the pinned turn's English), sitting within 200 Greek
chars of the section end, followed in the section by a frame label (Phaedo 88c/102a shape,
Timaeus hand-offs), where the next section opens with English the deferred mark's cues like.

What breaks (reproduction `scratchpad/repro/repro_defer_steal2.py` on the PR code):

```
{'c': '2a', 'n': 3, 'o': 0} Echecrates 'What?'
{'c': '2a', 'n': 4, 'o': 0} Phaedo     'Why? Certainly, said Simmias.'     <- pinned row swallowed 2b's opening
{'c': '2b', 'n': 6, 'o': 0} None       'What then? said he.'               <- 2b's first mark (n=5) has no row
report M2: greek 'πάνυ γε, ἔφη ὁ Σιμμίας. τί; διὰ τί;'  english 'Certainly, said Simmias. What then? said'
```

Three consequences: (a) the deferred mark (Greek before ΕΧ.) is matched to English after
ΦΑΙΔ.'s turn — an order inversion; (b) its row sorts after the pin row and the monotone merge
folds it into the pinned frame turn, so the frame row prints the stolen English; (c) the next
section's own first mark, the real owner of that English, is displaced (here merged away) —
and the report counts the deferred mark as *matched*, so the gate sees a success.

Fix (verified in a patched copy: all four DEFECT checks turn False, suite green):

```python
# turns.py, just before `for i, o in enumerate(offs):` (line ~1047)
            # Only a mark in the section's LAST stretch — no pinned turn after it —
            # may be deferred: a pin bounds the English of every mark before it.
            defer_from = g_bounds[-2]
...
                if chosen is None:
                    if o >= defer_from and len(gtext) - o <= para_align.DEFER_MAX_GREEK:
```

Proposed test (`pipeline/tests/test_turns.py`, after the spine/pin tests):

```python
def test_para_flow_spine_never_defers_a_mark_past_a_pinned_turn():
    # A mark BEFORE a frame re-entry, unmatched in its own stretch, must merge
    # into the row before it — its English cannot lie beyond the pinned turn.
    segs = [_gseg("2a", 1, ["ἀλλὰ σχεδὸν μέν τι ᾔδη, ἔφη ὁ Κρίτων, καὶ πλείω δὴ τούτων ἔλεγεν.",
                            "πάνυ γε, ἔφη ὁ Σιμμίας.", "τί;", "διὰ τί;"]),
            _gseg("2b", 5, ["πάνυ γε, ἔφη.", "τί οὖν; ἦ δ' ὅς."])]
    segs[0]["speakers"] = [{"line": 3, "offset": 0, "label": "ΕΧ."},
                           {"line": 4, "offset": 0, "label": "ΦΑΙΔ."}]
    marks = [{"c": "2a", "n": 1, "o": 0}, {"c": "2a", "n": 2, "o": 0},
             {"c": "2b", "n": 5, "o": 0}, {"c": "2b", "n": 6, "o": 0}]
    e_a = "I was pretty sure, said Crito, and he said more, and Simmias agreed. What? Why?"
    e_b = "Certainly, said Simmias. What then? said he."
    chunks = [_pchunk("2a", e_a, turns_=[
                  {"offset": e_a.index("What"), "speaker": "Echecrates", "display": "Echecrates."},
                  {"offset": e_a.index("Why"), "speaker": "Phaedo", "display": "Phaedo."}]),
              _pchunk("2b", e_b, speeches=_quoted(e_b, "Certainly,", "What then?"))]
    flow, stats = turns.build_para_flow(segs, chunks, greek_paras=marks, spine=True,
                                        sigla=_PHAEDO_SIGLA)
    by_g = {(r["g"]["c"], r["g"]["n"]): r for r in flow["turns"]}
    assert by_g[("2a", 4)]["e"] == "Why?"                       # the frame row keeps its own turn
    assert by_g[("2b", 5)]["e"] == "Certainly, said Simmias."   # 2b's own mark owns its opening
    assert stats["spine_report"][1]["english"] is None          # the run-in mark is a gap, not a match
```

### MEDIUM-2 — `_GK_THIRD` gaining bare `φαναι|ειπειν` mis-cues 9 Republic paragraphs

`pipeline/plato_pipeline/para_align.py:431`.

The PR adds the infinitives as third-person attribution cues for the Symposium's reported
speech. Bare `εἰπεῖν` is overwhelmingly *not* an attribution in Plato ("ὡς ἔπος εἰπεῖν",
"ἔχεις εἰπεῖν", "διὰ βραχέων εἰπεῖν"). Measured on the vendored Republic donor (all 4234
paragraph heads, first 80 chars, excluding heads that already carried a first- or third-person
cue): **10 Republic marks newly read as third-person; 9 of the 10 are not attributions**
(the one genuine case is 617d "τὸν μὲν προφήτην οὕτως εἰπεῖν"). Phaedo: 1 newly cued, not an
attribution ("ψυχὴν ἁρμονίαν τινὰ φάναι εἶναι").

Scoring effect, main vs PR (`scratchpad/repro/repro_cue.py`) for Republic 403a
"μείζω δέ τινα καὶ ὀξυτέραν ἔχεις εἰπεῖν ἡδονὴν…;":

| candidate | main | PR40 |
|---|---|---|
| its own English "Can you name a greater or keener pleasure…" (no attribution) | 0.00 | −0.10 |
| the *next* turn "I cannot, he said, nor yet any more insane." | 0.00 | +0.35 |

A 0.45 swing toward the following turn, on a mark whose lexical signal is one clause. Whether
any of the nine picks flips can only be settled by the Republic gold run, which is skipped
here — so the PR's "Republic build is unchanged" is an untested claim on this axis, not a
guarantee. (The cased-name table, by contrast, IS inert for the Republic: zero
`NAMES_CASED` hits across all 4234 heads.)

Fix — cue the infinitive only where it is an attribution. Measured on the donors: Symposium
65 → 64 of the PR's hits kept (the one dropped is "βούλομαι πρῶτον μὲν εἰπεῖν ὡς χρή με
εἰπεῖν", correctly), Republic 10 → 1 (the genuine 617d), Phaedo 1 → 0, Timaeus 1 → 1:

```python
_GK_THIRD = re.compile(
    r"εφη|η δ'\s?ος|εφατο|ελεξεν"
    # The infinitive only as an attribution: with an accusative subject (φάναι τὸν
    # Ἀγάθωνα, εἰπεῖν οὖν τὸν Ἐρυξίμαχον, τὸν οὖν Σωκράτη εἰπεῖν) or parenthetical
    # (ἀληθῆ λέγεις, φάναι. / ναί, εἰπεῖν.). Bare εἰπεῖν is "ὡς ἔπος εἰπεῖν",
    # "ἔχεις εἰπεῖν" — nine Republic paragraphs, none of them attributions.
    r"|(?:φαναι|ειπειν)(?:\s\S+){0,2}\sτ[οη]ν\b"
    r"|\bτ[οη]ν\s(?:\S+\s){0,3}(?:φαναι|ειπειν)"
    r"|εφη φαναι|\bφαναι[,.;··]|,\sειπειν[,.;··]")
```

The PR's own tests (`φάναι τὸν Ἀγάθωνα`, `εἰπεῖν οὖν τὸν Ἐρυξίμαχον`) pass under it.

Proposed test (`pipeline/tests/test_para_align.py`):

```python
def test_a_bare_infinitive_is_not_an_attribution():
    assert para_align._greek_cue("ἡ μὲν δὴ κατάστασις ὡς ἔπος εἰπεῖν αὕτη.")[0] is None
    assert para_align._greek_cue("μείζω δέ τινα καὶ ὀξυτέραν ἔχεις εἰπεῖν ἡδονὴν;")[0] is None
    assert para_align._greek_cue("ναί, εἰπεῖν.")[0] == "third"
    assert para_align._greek_cue("πάνυ γε, φάναι.")[0] == "third"
```

### MEDIUM-3 — the new ἀνάγκη reply entry rescores 34 Republic marks; "Assuredly" is not a listed rendering

`pipeline/plato_pipeline/para_align.py:500–502`.

34 Republic paragraphs are short "Ἀνάγκη(, ἔφη…)" replies (measured on the donor). Before the
PR they took no reply score; now every candidate scores +0.60 if it opens with a listed
rendering and −0.15 otherwise. Shorey's Republic uses "Assuredly" as a sentence-initial
reply 25 times; it is not in the list ("Necessarily" 16, "Of necessity" 8, "Inevitably" 9,
"It must" 4 are). Where Shorey rendered ἀνάγκη "Assuredly" the correct candidate now takes
−0.15 while any neighbouring "Yes…"/"Certainly…" candidate takes +0.60. Verified only at
the cue level (`cue_score("ἀνάγκη, ἔφη.", "Assuredly, he said.")` = 0.20 vs 0.95 for "Yes,
said he"); which of the 34 are affected needs the build. *Suspected regression; the Republic
gold run must confirm.* Suggested mitigation: add `"assuredly"`, `"it is inevitable"`,
`"that is inevitable"` to the renderings. (`ἥκιστα ↔ "anything but"` is a pure HIT addition
and cannot turn a correct match into a miss.)

### LOW-4 — the report's and the deferred mark's paragraph text runs through the pinned turns' Greek

`pipeline/plato_pipeline/turns.py:1050` (`end = offs[i + 1] if i + 1 < len(offs) else len(gtext)`).

`end` is the next *mark*, ignoring pins, so the last mark before a pin is reported — and, when
deferred, *scored* — with the frame turn's Greek appended. In the HIGH-1 reproduction the
report shows `greek: 'πάνυ γε, ἔφη ὁ Σιμμίας. τί; διὰ τί;'`; on real text the frame turn's
"ὦ Φαίδων" would put "Phaedo" into the deferred mark's gloss bag. The stretch loop at line
1017 already bounds `end` by `g_hi`; mirror it here:

```python
                end = offs[i + 1] if i + 1 < len(offs) else len(gtext)
                end = min(end, next((b for b in g_bounds[1:] if b > o), len(gtext)))
```

### LOW-5 — a Burnet mark coinciding with a pinned label counts as an unmatched mark

`turns.py:941` (`stats["spine_marks"] = len(greek_paras or [])`) vs `:891` (`turn_at` drops the
coincident mark from `marks_by_col`, so it never enters the report). Reproduction
(`repro_coincident.py`): two marks, one at ΦΑΙΔ.'s position → `matched 1 / 2`, i.e. the pin
is booked as a miss toward the 97% gate. Latent, not live: in all seven donors every
`<milestone unit="para"/>` adjacent to a `<label>` is inside a `rend="merge"` page-break
reopening the TLG has no label for (Phaedo 25/25, Timaeus 4/4, Epinomis 3/3, Critias 1/1,
Menexenus 1/1), so no real label coincides with a mark today. Fix — count what the report
enumerates: `stats["spine_marks"] = sum(len(v) for v in marks_by_col.values())`.
Test: the coincident fixture above asserting `spine_marks == spine_matched == 1`.

### LOW-6 — a pinned `<said>` with no English after it emits a row with `e == ""`

`turns.py:969–975` add the pin row unconditionally; the merge at `:1090–1102` only protects
the *previous* row's slice. Reproduction (`repro_endpin.py`): an English turn event at
`len(text)` → `(3, None, '')` — a Greek row with an empty English slice, which breaks the
para-row contract (`_assert_flow_invariants` fails; the reader prints the "—" missing marker).
Needs an empty trailing `<said>` in the walker output, which `build_turn_flow` guards against
(`e_dropped_empty`) but `build_para_flow` does not. *Unlikely in the seven works; reproduced
in unit only.* Fix after the merge loop:

```python
        while len(merged) > 1 and not text[merged[-1]["paras"][0]:].strip():
            merged[-2]["paras"].extend(merged.pop()["paras"])
```

### LOW-7 — stage7 silently falls back to the dialogue flow for a spine book with < 2 located marks

`pipeline/plato_pipeline/stage7_emit.py:464–480`. `build_para_flow` returns `None` when
`signal < 2`; the new branch then falls to `elif flow:` and the book is emitted as a dialogue
flow with no line in the log and no entry in the spine report or gate. Clitophon has exactly
2 donor marks, so a single unlocated mark flips its whole mode unannounced. Suggest printing
a `para_spine: book N fell back to the dialogue flow (marks=…)` line, or raising when
`spine_on and book_marks` yields no para flow.

### DESIGN-8 — `SPINE_GRACE = 3` is a flat allowance that swallows small works whole

`stage7_emit.py:36, 532–533`. With the grace, Clitophon passes at 0/2 (0%), Critias at 9/12
(75%), Menexenus at 7/10. Recommendation: scale it, e.g.
`grace = min(SPINE_GRACE, spine_marks // 4)` (Clitophon 0, Critias 3, Menexenus 2,
Epinomis 3, Timaeus 3), or keep the flat grace but add an absolute floor
`spine_matched * 2 >= spine_marks`.

---

## The four review points

**1. Deferral vs pins and the carry bound.** The carry bound is sound: `after` is taken
from `last_cut` *before* this column's pins are appended (`:963`), `last_cut` only ever
grows (`max`, `:974`, `:1030`, `:1069`), and pins raise it to their English, so a deferred
mark's carry candidates lie strictly after the last emitted row start. No chaining: `deferred`
is reset on every processed or skipped column (`:953`, `:976`, `:1032`) and a deferred mark
that fails again is not re-deferred. Deferred marks in the next section are correctly confined
to the stretch before that section's first pin (`lead` only when `k == 0`, `e_hi = e_bounds[1]`).
The hole is on the *source* side: deferral is not restricted to the stretch after the
section's last pin — HIGH-1.

**2. Empty pin intervals.** Confirmed never a Greek-only row. Two fixtures
(`repro_empty_interval.py`): adjacent ΕΧ./ΦΑΙΔ. pins with a mark between and no English
candidate between their turns → the mark is a gap and simply absent from `out`, its Greek
rides under the pin row before it; a pin whose English drifted into the previous chunk →
three of three marks matched, every slice non-empty. Unmatched marks never create rows, and
the merge condition `not text[prev:this].strip()` guards every non-final slice. The only
empty-slice path is the final row when the pin's English is at end of text — LOW-6.

**3. The rubric rule's edge case.** The rule's premises hold on the actual English donors.
Symposium: `Ap.` (4) and `Comp.` (2) pair with the five TLG labels; the ten rubric headings
("The Speech of Pausanias", "Alcibiades' praise of Socrates", …) have no paired twin and are
kept; the 51 `who="#Apollodorus" rend="merge"` and the `direct="false" rend="merge"`
speeches (Socrates 11, Alcibiades 7, Pausanias 5, …) carry no label and are dropped. Phaedo:
76 `Phaedo.` + 17 `Echecrates.` labels against 34 TLG labels; `_lcs_pairs` takes the
*earliest* consistent match, so the real turn always pairs and the page-break continuations
(same display) are dropped. Timaeus/Critias/Menexenus/Epinomis/Clitophon labels are all
plain sigla with a Greek counterpart. The author's edge case — a real speaker whose every
event is unpaired printing as a heading — requires pairing to fail wholesale for that
speaker, which happens only when a manifest siglum value differs from the English `who`
name; the roster gate catches unmapped sigla, not that. A cheap guard: warn when
`turn_pins < len(g_turns)` by more than a handful. One cosmetic side effect worth knowing:
rubric strings now enter `collectDisplayOrder` (`shared/lib/speaker-colors.ts:30–46`, reads
`et[].d`) and receive palette colours like speakers.

**4. Gate grace.** Should scale — DESIGN-8.

---

## Checked and clean

- **Five pre-existing para works.** `parse_marks` on the five old donors (tlg002/016/018/030/036)
  produces byte-identical (section, probe) lists under the PR (4863 probes, 0 differ); none
  of those files contains a `<label>`, so `_LABEL` and the `<[^>]*>?` cut-tag rule are inert
  there. Apology, Charmides, Letters, Lovers have `spine` unset: stage7 skips the new branch
  and takes the unchanged `else` path (`build_para_flow(spine=False)`), never touching
  `para_align`. Republic: `collect_greek_turns` returns `[]` (no TLG labels) so `ev_kept = ev`,
  no pins, `marks_by_col` as before; `test_para_flow_spine_without_greek_labels_is_unchanged`
  covers it and the stage7 call passes identical arguments plus `sigla`/`displays`.
  `NAMES_CASED`: zero hits across all 4234 Republic heads. The residual Republic exposure is
  the cue table only (MEDIUM-2, MEDIUM-3), and only the gold run can close it.
- **Stretch partition.** `pin_g` sorted on Greek; `e_bounds` monotone because `pair_book` is
  monotone in both indices; the open pin's own start is excluded (`c.offset > e_lo` for
  `k > 0`), the closing pin's excluded (`< e_hi`); the first stretch keeps the carry and the
  `start` candidate. Marks at a pin's exact Greek offset are dropped from `idxs` by design.
- **Deferred feature offsets.** Negative `offset` yields the right `share` in `_windows`
  (the deferred paragraph does run to the next section's first mark) and a small negative
  `gfrac`; `reaches_back` is True for it, which is a legitimate second look at the previous
  chunk's tail strictly after `last_cut`. No off-by-one of consequence (the join space is
  uncounted on the Greek side, harmless).
- **Page-break-continuation drop.** `ev_kept` feeds only `et`; the English prose is untouched,
  so no translation text is deleted — only a repeated label.
- **Probe stripping.** `_LABEL` removes `<label …>…</label>` elements only (the Greek donors'
  labels carry no attributes and only speaker sigla); a window-cut tag is dropped whole;
  widening to 1200 changes no probe in the old donors.
- **Cased-name collisions.** "Κριτων" (Crito) vs "Κριτοβουλ" vs "Κριτι" (Critias) are
  prefix-disjoint after `fold_cased`; "Φαιδων"/"Φαιδρ" likewise. `_EN_NAME`'s
  `crito|…|critobulus` and `phaedo|…|phaedrus` alternations are safe because the trailing
  `\b` forces backtracking to the longer name. The `clinias` alternative is inert: Lamb's
  Epinomis writes "Cleinias" (21 occurrences), matching the Greek-side `Cleinias`.
- **Seed-row/pin merge.** Fowler's Phaedo opens with `<said who="#Echecrates">` at 57a
  offset 0, so the seed row and the ΕΧ. pin share key and English offset and the `turn`
  transfer rule fires; the row is labelled.
- **Reader contract.** A para row with `et[0].o == 0` renders through `etBlocks` →
  `buildEnglishTurnBlocks`, which drops the empty lead and prints one labelled block; the
  `!paraFlow` guard keeps the row-level lead-in from printing a second time; `d` colours the
  Greek column via `data-spk`. No app change needed, as the PR says.
- **Tests.** PR checkout: 252 passed, 18 skipped. Patched copy (HIGH-1, LOW-4, LOW-5, LOW-6,
  MEDIUM-2 fixes applied): 236 passed with `test_ocr_postprocess.py` and
  `test_stage1_refactor.py` ignored (they import helper scripts by repo-relative path the
  scratch copy lacks) and 4 `test_preflight` failures that are `FileNotFoundError` on the
  copied tree's cwd — environmental, not code.

## Not verifiable here

The Republic gold tests (`test_gold_section_cuts_where_the_hand_check_says`,
`test_the_known_misses_still_land_inside_the_right_turn`) and the seven real builds need the
TLG export and `build/`. MEDIUM-2 and MEDIUM-3 are the two changes that can move Republic
picks; run the gold set on the laptop before merging, with or without the regex tightening.
