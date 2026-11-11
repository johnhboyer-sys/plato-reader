# Pipeline gotchas (moved from the root CLAUDE.md; loads when working under pipeline/)

- Narrated works (Republic, Apology, Charmides, Letters, Lovers, and in spine mode Phaedo,
  Symposium, Timaeus, Critias, Menexenus, Epinomis, Clitophon) cut their rows on Burnet's
  own paragraph marks, imported as POSITIONS ONLY from a vendored Perseus Greek TEI
  (`sources/perseus-grc`, declared per manifest under `greek.paragraphs`). The displayed Greek
  is still the TLG spine — this is not an edition swap. stage1 prints
  `greek paragraphs: X/Y located`; a drop in that ratio means the donor and spine drifted
  apart (fold/elision handling), and unlocated marks fall back to a proportional estimate.
  SPINE mode (`greek.paragraphs.spine`; Republic plus the seven above): a row per Burnet mark,
  the English cut by `para_align` per section, stage7 gating at 97% matched (3 misses of grace
  for the small works) and writing `build/stage7/para-align-<work>.json`. A spine-mode work's
  Greek labels (Phaedo's ΕΧ./ΦΑΙΔ. frame, Timaeus' hand-offs) are not marks: they pair with the
  translation's `<said>` turns and pin labelled rows inside the spine (`turns.build_para_flow`);
  Perseus' page-break `<said rend="merge">` labels pair with nothing and are dropped, while a
  rubric label no turn prints (Lamb's "The Speech of Pausanias") stays as an `et` heading.
  `para_align` keys attribution cues on a name table — Republic's cast folded, the others
  case-sensitive (Κρίτων vs κριτῶν) — extend it when a new spine-mode work is added. Left on
  the dialogue flow on purpose: Lysis/Parmenides/Protagoras/Euthydemus (OCT dash turns) and the
  Jowett-overlay dialogues (the compare column is aligned to dialogue-flow turns).
- Dialogue-flow pins drift silently: the speakers still match when a whole exchange slips.
  Perseus reopens a speech over a page division as a new `<said>` (`rend="merge"`, misspelt
  `"merge "`/`resp="merge"`, or unmarked at a page div); stage1 flags it `merge` and
  `pair_book` never pairs it (fixed 2026-09-29; Alcibiades I, Cratylus, Philebus, Laws 6/8/11
  had run 2–3 turns off for hundreds of turns). Name ties go to the nearer Stephanus section.
  To audit, lay each turn's English beside the Greek line at its `g` pin.
- Perseus TEI marks English paragraphs TWO ways, mixed per work: `<p>` elements AND
  `<milestone unit="para"/>`. stage1_stephanus_english captures both (sentinel `\x01`, like
  the `\x00` turn sentinel). Bury's Laws leaves each book's opening speech UNLABELED — it
  lands in leadE and is re-attached to the head Greek turn with a display borrowed from the
  work's observed speaker map (turns.speaker_displays).
- Word-popup glosses: Diogenes' `greek-analyses.txt` ships Perseus shortdefs that keep only
  the FIRST italic run of LSJ sense A, so they arrive truncated (πολιτικός "of, for",
  ἐπιμελέομαι "take"). stage5 `derive_short_def` rejoins the run and stage7 `merge_short_def`
  swaps it in only when the shipped gloss is a word-boundary prefix. Two guards must survive
  any edit: reject a def ending on a bare article (the governed noun is untagged Greek), and
  reject — never slice — a def over 100 chars. Blank glosses (~27%, mostly proper names) are
  still unfixed.
- The gloss rewrite MUST run after `filter_parses`, not inside the comprehension that builds
  the parses (stage7 `resolve_parses`): that filter spots a spurious reading by its gloss
  duplicating a resolved sibling's, and those are Morpheus glosses — rewriting first keeps the
  junk reading, which can become the primary analysis and shift lemma slugs. Any change to
  gloss/parse emission: diff the built `app/public/data/lemmata/_index.json` slug set against
  the live site's; a gloss-only change must leave it byte-identical.
