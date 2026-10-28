# Open items after the 45th deploy (2026-10-28)

Where to pick up. Live site is main `b38243d129` (gh-pages `7cf2b741ae`); see DEPLOY-STATUS.md.

## Print editions section (waiting on John)
- Research: `docs/print-editions-research.md` (per-work Greek texts, translations we host, modern
  translations, Hackett and other repackaged volumes in §4). A Grok check of 30 sampled lines found 8
  faults (e.g. the *Last Days of Socrates* ISBN belongs to Rowe's 2010 translation, not
  Tredennick/Tarrant), so every displayed link, ISBN, translator and year must be re-verified.
- Placement (John): bottom of each work's landing page only; no homepage list.
- Mechanism: fill `FURTHER_READING` in `shared/lib/works.ts` (empty today; Landing.astro already renders
  an "In print" section from it) and add a Greek-text kind.
- Open question: list every edition per work, or a short curated list?

## Public-domain / CC translations
- Survey: `docs/pd-translations-survey.md`. Copyright calls are John's (US law only), e.g. Lane Cooper
  1938 and Morrow 1962; also whether to pursue Bohn translations.

## Ast's Lexicon Platonicum
- John emailed Rusten (jsr5@cornell.edu) 2026-10-28 for permission and the export, or else OK to draw
  from the lexeis.org API; a matching request to Ethan Della Rocca (ehd35@cornell.edu, Rusten cc'd) was
  drafted. Yes → show Ast's articles on lemma pages, citations linked into the reader. No → own OCR of
  the 1835–38 scans, Lexeis' text used only to flag OCR errors, citations re-aligned via our concordance.
- Lemma policy (John): Ast's headwords decide fold vs own page. Open: ~450 of our pages have no Ast
  headword because Ast folds them (εἶπον/ἐρῶ under λέγω, ἄλλως under ἄλλος, regular superlatives).

## Lexicon
- Morpheus heads some Attic names in Ionic form (Καλλίης, Περικλέης); their pages show the Ionic head.
- Blank glosses (~27%, mostly proper names) remain.
