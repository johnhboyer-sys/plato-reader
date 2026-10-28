# Ast's *Lexicon Platonicum* on Lexeis — research for the Plato Reader

Research only, 2026-10-27. Nothing built, merged or deployed.

## What it is

The lexicon John means is **Friedrich Ast, *Lexicon Platonicum sive vocum Platonicarum index* (3 vols., Leipzig 1835–38)**, as digitized by **Lexeis**. Lexeis is a Cornell project directed by **Jeffrey Rusten** (Professor Emeritus of Classics), with Ethan Della Rocca and paid student teams.

- Site: <https://lexeis.org/plato/> ("A Lexicon to Plato", an Angular app). Project home: <https://lexeis.org/>; about page: <https://lexeis.org/about.php>.
- Logeion links to it. Its API returns a `Plato-Ast` link for each word, e.g. `https://lexeis.org/plato/#/entry/ἀρετή` (checked against `anastrophe.uchicago.edu/logeion-api/detail?w=ἀρετή`).
- Dates: Cornell Library's DCAPS digitization grant in 2019 ([Cornell announcement](https://as.cornell.edu/index%2ephp/news/five-projects-awarded-2019-digitization-grants)). The Lexeis home page says Ast "is posted"; a screencast dates from June 2022. Student work went on through the summers of 2024, 2025 and 2026.
- Lineage: it follows Lexeis' Thucydides lexicon (Bétant, 2018). Bonitz's *Index Aristotelicus* and Wüst's Aristophanes are in progress. The Bonitz work bears on aristotle-reader.
- Other candidates I ruled out: Radice's *Lexicon I: Plato* (Milan 2003, CD-ROM; not Cornell, not free) and "Digital Plato" (Leipzig, a reception project, not a lexicon). Only Lexeis matches "Cornell professor, digitized a few years back".

## 1. Licence of the digitized data (US rules) — flag for John

- **No licence, terms of use or copyright notice** appears on lexeis.org: not on the home, about or next-steps pages, and not in the app bundle.
- **No public data release.** The site's backend has a `downloadLexiconExport.php`, but only logged-in contributors can use it. The open code repo, [storey/lexeis-public](https://github.com/storey/lexeis-public), is **GPL-3.0** and covers only the code and the *Thucydides* data. A 2025 student repo, [ayan-kohli/lexeis-scripts](https://github.com/ayan-kohli/lexeis-scripts), calls the Plato data a "**private** Plato lexicon dataset".
- My reading of US law (not legal advice): the 1835 text is public domain. A faithful transcription adds no new copyright (*Feist*; *Bridgeman v. Corel*). Lexeis' re-mapping of Ast's section letters onto Burnet's is factual and also unprotected. Two parts may be protected:
  - the ~8,900 new **English short definitions**. Most are uncopyrightable short phrases ("to heal"), but some are longer, and I could not find where they come from;
  - any new English articles. In my sample every entry was still Ast's (`oldLongDefinition: true`, author "No User").
- **In practice:** pulling 10,000 entries from an undocumented API with no licence is legally defensible in the US but bad form toward a working colleague's project. **This is John's call.** My advice is to ask Rusten for the export and an explicit licence (CC BY, or at least written permission) before shipping any Ast text. A plain hyperlink, as Logeion uses, needs no permission.

## 2. Format and coverage

- **Encoding:** JSON from a PHP API (`/plato/api/getEntry.php`, POST `{"searchQuery": "<Greek lemma>"}`). Each entry carries:
  - `token`, the Unicode Greek headword. Homographs carry a digit (`ἀργός2`); Attic ττ is filed under σσ (`διαλλάττω` → `διαλλάσσω`).
  - `shortDef`, in English.
  - `fullDefinition`, a nested sense tree (I / A / B…) of Ast's Latin. Each sense has a `refList` of `{ref:"Resp.444.d", refLink:"Resp/444/d", note:"<Greek quotation>"}`.
  - also part of speech, semantic group, frequency, and the full occurrence list (Dik/Perseus tagging, not Ast).
- **Keys** are Unicode Greek, not Beta Code. They convert cleanly with our `plato_pipeline/beta.py::to_beta_key`; only 1 of 10,588 failed (`νῦν δή`).
- **Citations** are Stephanus page + section, with Perseus-style work abbreviations (`Resp`, `Leg`, `Phdr`, `Alc1`, `Ep`, …). Lexeis has **re-aligned Ast's section letters to the modern Burnet sections**. Against the 1835 print: Prm. 144 B → `144.c`, Soph. 256 D → `256.e`, Phil. 47 B → `47.a`, Legg. 960 C → `960.d`. All four now equal our concordance's sections exactly. Refs carry no book number (`Resp.444.d`), so Republic, Laws and Letters need a page→book table, which our lemma data already holds.
- **Size:** 10,588 lemmas, harvested from the site's own A–Ω word lists in 285 throttled requests. 8,929 (84%) have an English short definition. In a stratified sample of 39 matched lemmas, 38 had a full Ast article; the exception was ἵππιος. The `fullDefinition` averages ~3.5 KB of JSON per entry, so the whole lexicon is roughly 35–60 MB raw.
- **Accuracy:**
  - **Citations: 828 of 890 (93%)** in the sample land on a section where our concordance has the same lemma in the same work. 13 more are one section off. Most of the 49 misses come from different lemma conventions, not wrong refs:
    - μετιέναι filed by us under another μέτειμι;
    - οὐδ' εἷς under εἷς rather than μηδείς;
    - forms of τυγχάνω;
    - ἐκπλαγῆναι under ἐκπλήττω.
    25 refs point to spuria the site does not carry (Eryx., Ax., Dem., Ti. Locr.).
  - **Latin definitions:** clean in everything I read.
  - **Greek quotations (`note`):** these carry visible OCR residue. I checked print p. 219 (vol. I) line by line against the archive.org scan (`lexiconplatonicu01astfuoft`, leaf 233) for ἀπελευθερόω, ἀπενιαύτησις, ἀπενιαυτέω, ἀπέραντος and ἀπεργάζομαι (~55 citations). Every citation is present. About 1 Greek quotation in 4–5 has a fault:
    - a dropped or misplaced accent (`ἀπελευθερωσαντος`, `παντα`, `τοῦτὸ`);
    - a misread letter (`ἐπιοτημη` for ἐπιστήμη, `νεωςρίκους` for νεωσοίκους);
    - a word split at the print line break (`ἀπεργάζε σθον`).
    The other 34 sampled entries show the same pattern (`γόσημα`, `μηὸ`, `βλάβερος`).
  - **Parsing artefacts:** Ast's misprint "915. B. A:" became an empty ref, and διαλλάσσω's sense tree nests A under the wrong numeral. One short definition is plainly wrong: ζῆτα = "vau".

## 3. Fit with this repo

- **Coverage of the site's 5,345 lemma keys** (live `_index.json`):
  - 4,840 (90.6%) match an Ast headword exactly, after stripping homograph digits, `^`/`_` quantity marks and capital `*`;
  - 50 more (0.9%) match only once accents are ignored;
  - **455 (8.5%) find nothing.** 31 of those are proper names. The rest are lemma conventions: εἶπον, ἐρῶ and εἶδον filed under λέγω/ὁράω; superlatives under the positive; adverbs (ἄλλως, πάντως) under adjectives; ζάω/ζῶ.
  - Weighted toward common words the match rate is higher: 97% of the top 100, 94–95% of the top 500–2,000.
- **Links into the reader:** these are mechanical. Map the 36 Lexeis abbreviations to `works.ts` ids, add a page→book table for Republic, Laws and Letters, then link to `/{Work}/book/{n}/#{page}{sec}`. `ReaderShell.astro` already resolves a bare `#514a` hash. Refs to spuria not on the site stay as plain text.
- **Where it would show** (a sketch, not built):
  - **Lemma page** (`app/src/components/LemmaPage.astro`): a new numbered section after "Dictionary entry · LSJ", headed "Ast, *Lexicon Platonicum*" with a tag `Latin · 1835`. It would show the sense tree with the Latin glosses, each citation a Stephanus link into the reader with its Greek quotation, and the same clamp/"Read the full entry ▾" pattern as the LSJ box. A credit line would read "Digitized by Lexeis (Cornell), J. Rusten" plus a link to the entry on lexeis.org. The data would be built into a per-lemma shard at build time, never fetched from lexeis.org at run time: the API is undocumented, unversioned and student-maintained.
  - **Word popup** (`shared/components/WordPopup.svelte`): at most a one-line "Ast →" link to the lemma page's section. Latin articles are too long for the popup.

## 4. Effort, risks, recommendation

| Option | What | Effort | Licence needed |
|---|---|---|---|
| A. Link out | "Ast's *Lexicon Platonicum* ↗" on each lemma page, as Logeion does; a committed key→Lexeis-token table | ~½ day | None (a hyperlink) |
| B. Inline | The full article on the lemma page, citations linked into the reader | 3–5 days (import, abbreviation and page→book map, renderer, OCR caveat, attribution page) | Yes: an export plus permission from Rusten |

**Risks:**
- OCR faults in the Greek quotations, which John would see at once;
- the Latin-only definitions limit the audience;
- the data is still being edited upstream, with no releases or versions;
- 8.5% of keys miss through lemma conventions; a small alias table would recover most of them;
- the source of the English short definitions is unknown, so don't use them to fill our blank popup glosses without asking;
- adding ~35–60 MB of site data.

**Recommendation:** do **A** now, since it needs no licence and gives 91% coverage. In parallel, John writes to Rusten (jsr5@cornell.edu) asking for the Plato export and a licence. Do **B** only once a licence is in hand. Raise the Bonitz *Index Aristotelicus* with Rusten in the same letter for aristotle-reader. The Lexeis fix to Ast's section letters is the main prize: their citations already line up with our Burnet sections.

## Sources

- Lexeis home / about / next steps: <https://lexeis.org/>, <https://lexeis.org/about.php>, <https://lexeis.org/nextSteps.php>
- Plato lexicon: <https://lexeis.org/plato/>; example entry: <https://lexeis.org/plato/#/entry/ἀρετή>
- Cornell Classics, Lexeis: <https://classics.cornell.edu/lexeis>
- 2019 grant: <https://as.cornell.edu/index%2ephp/news/five-projects-awarded-2019-digitization-grants>
- Code: <https://github.com/storey/lexeis-public> (GPL-3.0, Thucydides only); <https://github.com/ayan-kohli/lexeis-scripts>; <https://github.com/mihikamukherjee16-sudo/Lexeis> (Bonitz pipeline)
- Print scans: <https://archive.org/details/lexiconplatonicu01astfuoft> (vol. I, 1835; vols. II–III at `…u02astfuoft`, `…u03astfuoft`)
- Site lemma keys: <https://plato.johnhboyer.com/data/lemmata/_index.json>

Method notes: the harvested lemma lists, the 39-entry sample and the scripts are kept outside the repo, in the session scratchpad. Nothing was run from downloaded data.
