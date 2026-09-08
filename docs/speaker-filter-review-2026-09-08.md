# PR #42 on the laptop — review and fixes, 2026-09-08

Replaces `docs/local-handoff-2026-09-08.md`, the remote session's checklist for PRs #40 and
#42. PR #40 is merged (`64811f74e`) and deployed (30th deploy, gh-pages `49db872f9`); its
half of that checklist is history and lives in `docs/spine-mode-handoff.md`. This is the record
for #42: what the real corpus showed, what the cross-model review found, and what changed.

## Verified on the real corpus (branch head `1f542c366`)

shared 412 tests, svelte-check 0 errors, `verify-shared-imports` 0 broken, app tests; public
Astro build 5,573 pages, `check-links` 0 broken (5,574 / 440,193 / 316,111);
`verify-rebuild.mjs --live-slugs <live index>` passes (phrase index 36 works, 11 Jowett
overlays present, slug set byte-identical). Letters: 13 groups on the landing page with the
right spans, 13 `<details>` groups in the Contents outline, every page anchor resolving to an
emitted section. Search, ἀρετή: 611 instances unfiltered, 193 *only Socrates*, 246 *anyone but
Socrates*. CSV export: Speaker column before a still-absolute URL, 193 rows.

## Review

Grok 4.6, a static read of the code diff: SHIP WITH FIXES, seven findings with triggers. The
orchestrator's functional pass added three. The one that mattered:

**The filter attributed every word of a reported dialogue to its narrator.** It reads
`turn_bounds`, and for the Phaedo those are the 34 Echecrates/Phaedo frame turns; for the
Symposium the 5 Apollodorus/Companion turns. *Only Socrates* returned nothing from either
work, and *anyone but Socrates* returned Socrates at Phaedo 82b labelled "Phaedo". The note
under the results named five narrated works and neither of these. The Socrates-narrated
dialogues with the OCT's dash turns had the same shape from the other side: Parmenides
1027/1027 turns unlabelled, Lysis 297/297, Euthydemus 351/415, Protagoras 292/314, so
"ἀρετή in Socrates' mouth only" silently missed all of the Protagoras.

The rest: a nameless chip (2,003 null-speaker dash turns across six works aggregated into a
chip showing only its count, and ticked, filtering nothing); the "left out" note under-reporting,
because a work whose every turn is unlabelled still had a non-empty speaker list; a phrase kept
on its first word but labelling its tail with the next turn's speaker; `verify-rebuild.mjs` never
called by the build it exists to guard; seven letters opening mid-section in Bury's TEI (310b,
315a, 321c, 322c, 323d, 357d, 359c — Perseus repeats the milestone on both sides of the
`<div>`), so the shared section lists under the later letter; and, accepted as design, "all
words" with several names being per term rather than per speaker, English hits being
section-level, the frozen note's race with a roster reload, and the CSV's new column.

## Fixed on the branch

- `works.ts`: a `narrator` field on the six reported dialogues (Phaedo, Symposium, Parmenides,
  Lysis, Euthydemus, Protagoras). `search.ts` `attributable()` gates all three filtered engines
  on it as well as on empty `turn_bounds`; the roster returns no cast for such a work and names
  the narrator; the note and the panel say "reported by a narrator — the text labels the frame,
  not the speeches inside it — and left out", apart from the works with no labels at all. The
  Advanced page's "Who is speaking" section gets the same sentence and no longer counts them
  as labelled.
- The roster skips unlabelled turns, so there is no nameless chip, and a work whose every turn
  is unlabelled reads as having no cast and is named as left out.
- A phrase's words all carry the speaker of its first word, in `search()` and
  `searchPhraseVariants()`.
- `scripts/build-public.mjs` runs `verify-rebuild.mjs --live-slugs` after the link check.
- Tests: roster skips null speakers; a narrated work is left out under both modes and searches
  unfiltered as before; the phrase-across-a-break label in both engines; the registry's
  narrator set; the panel's chip count and note.

Not changed: the Letters section straddle (a shared section can list under one letter only; the
page-sharing rule the registry documents already says so), the multi-name "all words"
semantics, the section-level English rule, the CSV column order.

## Still open, unchanged from the remote session's list

Deducing who says what inside the reported dialogues, so the filter can admit them (John, 2026-09-08: "exclude narrated works FOR NOW; later we deduce who says what in those"); Jowett overlays for the narrated works, which wait on a paragraph-level aligner; ~27% blank glosses
are named "proper name" where capitalised, not filled; custom domain and the Search Console
token are TODO comments in `index.astro` and `ReaderShell.astro`.
