# P6b rollout — bookless-works batch build

Ran `pipeline && .venv/bin/python -m plato_pipeline all --work <Slug>` for all 32
bookless works from docs/registry-draft.md (everything except Republic/Laws/
Letters, which need multi-book logic, and Euthyphro, already piloted). All 36
Greek TLG exports were already cached in `build/export/`, so no Diogenes
subprocess ran; stage4/5 read the vendored `greek-analyses.txt`/`grc.lsj.xml`
directly.

**28 of 32 PASSED stage2 end-to-end (stage7 emitted); 4 FAILED** on the
alignment check, each with exactly one unmatched Greek segment (a Perseus
milestone gap) — not chased further per the timebox instruction.

## Results table

| Slug | TLG | Segments | Speakers | Stage2 | Token match | Stage7 |
|---|---|---|---|---|---|---|
| Apology | 002 | 125 | 0 | PASS | 0.9992 | emitted |
| Crito | 003 | 59 | 95 | PASS | 0.9993 | emitted |
| Phaedo | 004 | 303 | 34 | PASS | 0.9991 | emitted |
| Cratylus | 005 | 286 | 761 | PASS | 0.9967 | emitted |
| Theaetetus | 006 | 343 | 1019 | PASS | 0.9996 | emitted |
| Sophist | 007 | 262 | 1176 | PASS | 0.9997 | emitted |
| Statesman | 008 | 272 | 891 | PASS | 0.9995 | emitted |
| Parmenides | 009 | 201 | 1027 | PASS | 1.0 | emitted |
| Philebus | 010 | 282 | 1140 | PASS | 0.9976 | emitted |
| Symposium | 011 | 257 | 5 | **FAIL** (alignment) | — | not emitted |
| Phaedrus | 012 | 261 | 374 | PASS | 0.9987 | emitted |
| Alcibiades1 | 013 | 162 | 903 | PASS | 0.9992 | emitted |
| Alcibiades2 | 014 | 67 | 181 | PASS | 1.0 | emitted |
| Hipparchus | 015 | 37 | 161 | PASS | 0.9991 | emitted |
| Lovers | 016 | 35 | 0 | PASS | 1.0 | emitted |
| Theages | 017 | 50 | 135 | PASS | 0.9968 | emitted |
| Charmides | 018 | 118 | 0 | PASS | 0.9993 | emitted |
| Laches | 019 | 115 | 254 | PASS | 0.9997 | emitted |
| Lysis | 020 | 99 | 297 | PASS | 0.9968 | emitted |
| Euthydemus | 021 | 182 | 415 | PASS | 0.9997 | emitted |
| Protagoras | 022 | 265 | 314 | **FAIL** (alignment) | — | not emitted |
| Gorgias | 023 | 404 | 1107 | PASS | 0.9995 | emitted |
| Meno | 024 | 151 | 566 | PASS | 0.9997 | emitted |
| HippiasMajor | 025 | 119 | 357 | **FAIL** (alignment) | — | not emitted |
| HippiasMinor | 026 | 67 | 229 | PASS | 0.9998 | emitted |
| Ion | 027 | 61 | 171 | **FAIL** (alignment) | — | not emitted |
| Menexenus | 028 | 78 | 33 | PASS | 0.9996 | emitted |
| Clitophon | 029 | 21 | 4 | PASS | 0.9994 | emitted |
| Timaeus | 031 | 364 | 41 | PASS | 0.9989 | emitted |
| Critias | 032 | 76 | 5 | PASS | 0.9984 | emitted |
| Minos | 033 | 42 | 191 | PASS | 0.9979 | emitted |
| Epinomis | 035 | 99 | 28 | PASS | 0.9997 | emitted |

Plus **Euthyphro** (piloted earlier, unchanged): segments=70, speakers=232,
PASS, 100% morphology.

**Totals: 29 works PASSED and are in `build/dist/` (28 new + Euthyphro); 4
FAILED and are excluded.**

## Failures verbatim

All four fail stage2's `alignment` check with `unmatched=1` — one Greek
Stephanus segment Perseus's English milestones don't cover. Confirmed via
`build/stage1/alignment.json` after a stage1-only rerun of each:

- **Symposium** (011): unmatched Greek segment `1:181b`. Matches
  sources/INVENTORY.md's noted −1 section-milestone deficit (256 English vs
  257 Greek).
- **Protagoras** (022): unmatched Greek segment `1:332c`. Matches INVENTORY's
  note that this file's section milestones carry no `resp` attribute at all
  (264 English vs 265 Greek).
- **HippiasMajor** (025): unmatched Greek segment `1:302d`. Not previously
  flagged in INVENTORY (its resp-count column read 119/119) — a real gap
  the coarser resp-attribute audit didn't catch, same shape as the other three.
- **Ion** (027): unmatched Greek segment `1:539d`. Matches INVENTORY's noted
  −1 section-milestone deficit (60 English vs 61 Greek) and the misspelled
  "William" R. M. Lamb translator-name quirk in that file's header.

None of these are pipeline bugs to chase now — each is a genuine Perseus TEI
milestone gap in the vendored English source. Fixing would mean hand-patching
the Perseus XML or writing a fuzzy-alignment fallback for exactly one
segment per work; parked per the timebox instruction. These four stay OUT of
the registry until a future pass addresses the gap (report only, not fixed).

## Stage3 tokenizer sigla notes (non-blocking)

Apology and Timaeus each surfaced 5 stage3 "key_failures" — quotation-mark/
punctuation characters (’, comma, period, semicolon) glued onto a Greek token
in Perseus's Greek-in-quotes spans; Cratylus surfaced 2 (a hyphenated
compound split across a lemma boundary). These do not fail stage2 (which
already ran and passed before stage3) and do not block stage7 emission —
token_match_rate stays ≥0.996 in all three. Left as-is per the "don't
rabbit-hole into parser fixes" instruction; a future pass could teach the
stage3 tokenizer to strip trailing quotation-adjacent punctuation.
