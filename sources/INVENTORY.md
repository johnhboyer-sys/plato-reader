# Source inventory — The Plato Reader

## Greek: TLG 0059 Diogenes export (verse mode)

Export recipe: see CLAUDE.md (Diogenes 4.5 lacks `-y`; apply docs/diogenes-xml-export-y.patch to a COPY of xml-export.pl, run with a scratch `Diogenes_Config_Dir` containing `diogenes.prefs` → `tlg_dir`).
Edition: Burnet, Platonis Opera (OCT, 1900–07), per export sourceDesc.
Structure (uniform across works 001–038): `<div type="Stephanus-page" n="2">` → `<div type="section" n="a">` → `<l n="1">` (lines restart per section); speaker turns = `<label type="speaker">ΕΥΘ.</label>` inline at turn-start lines; trailing-`-` hyphenation; stray `<pb/>`.
Works with NO speaker labels are the narrated/monologue works (Apology, Republic, Charmides, Amatores, Letters, Definitions...) — edition-faithful.

| TLG work | Title | Stephanus span | pages | sections | speaker labels | odd letters |
|---|---|---|---|---|---|---|
| 0059001 | Euthyphro | 2–16 | 15 | 70 | 232 |  |
| 0059002 | Apologia Socratis | 17–42 | 26 | 125 | 0 |  |
| 0059003 | Crito | 43–54 | 12 | 59 | 95 |  |
| 0059004 | Phaedo | 57–118 | 62 | 303 | 34 |  |
| 0059005 | Cratylus | 383–440 | 58 | 286 | 761 |  |
| 0059006 | Theaetetus | 142–210 | 69 | 343 | 1019 |  |
| 0059007 | Sophista | 216–268 | 53 | 262 | 1176 |  |
| 0059008 | Politicus | 257–311 | 55 | 272 | 891 |  |
| 0059009 | Parmenides | 126–166 | 41 | 201 | 1027 |  |
| 0059010 | Philebus | 11–67 | 57 | 282 | 1140 |  |
| 0059011 | Symposium | 172–223 | 52 | 257 | 5 |  |
| 0059012 | Phaedrus | 227–279 | 53 | 261 | 374 |  |
| 0059013 | Alcibiades i [Sp.] | 103–135 | 33 | 162 | 903 |  |
| 0059014 | Alcibiades ii [Sp.] | 138–151 | 14 | 67 | 181 |  |
| 0059015 | Hipparchus [Sp.] | 225–232 | 8 | 37 | 161 |  |
| 0059016 | Amatores [Sp.] | 132–139 | 8 | 35 | 0 |  |
| 0059017 | Theages [Sp.] | 121–131 | 11 | 50 | 135 |  |
| 0059018 | Charmides | 153–176 | 24 | 118 | 0 |  |
| 0059019 | Laches | 178–201 | 24 | 115 | 254 |  |
| 0059020 | Lysis | 203–223 | 21 | 99 | 297 |  |
| 0059021 | Euthydemus | 271–307 | 37 | 182 | 415 |  |
| 0059022 | Protagoras | 309–362 | 54 | 265 | 314 |  |
| 0059023 | Gorgias | 447–527 | 81 | 404 | 1107 |  |
| 0059024 | Meno | 70–100 | 31 | 151 | 566 |  |
| 0059025 | Hippias major [Dub.] | 281–304 | 24 | 119 | 357 |  |
| 0059026 | Hippias minor | 363–376 | 14 | 67 | 229 |  |
| 0059027 | Ion | 530–542 | 13 | 61 | 171 |  |
| 0059028 | Menexenus | 234–249 | 16 | 78 | 33 |  |
| 0059029 | Clitophon [Dub.] | 406–410 | 5 | 21 | 4 |  |
| 0059030 | Respublica | 327–621 | 278 | 1355 | 0 |  |
| 0059031 | Timaeus | 17–92 | 76 | 364 | 41 |  |
| 0059032 | Critias | 106–121 | 16 | 76 | 5 |  |
| 0059033 | Minos [Sp.] | 313–321 | 9 | 42 | 191 |  |
| 0059034 | Leges | 624–969 | 327 | 1591 | 1809 |  |
| 0059035 | Epinomis [Dub.] (fort. auctore Philippo Opuntio) | 973–992 | 20 | 99 | 28 |  |
| 0059036 | Epistulae [Dub.] | 309–363 | 55 | 273 | 0 |  |
| 0059037 | Definitiones [Sp.] | 411–416 | 6 | 26 | 0 |  |
| 0059038 | Spuria | 372–372 | 44 | 198 | 573 | a,bis |
| 0059039 | Epigrammata | [Book 5] | 5 | 0 | 0 |  |
| 0059040 | Fragmenta tragica | [Fragment 1?] | 3 | 0 | 0 |  |
| 0059041 | Epigrammata | [Epigram 1] | 33 | 0 | 0 |  |

## English: Perseus canonical-greekLit (pinned)

Pinned commit: `3bd56262e3f3fed7cfdeab11ff37f69f0758eaf3` (github.com/PerseusDL/canonical-greekLit, master, committed 2026-07-09T18:31:05Z by Alison Babeu — "tlg0007-deleting extra encoding statement"). All 36 files fetched from this exact SHA (not `master`), so re-running the download later reproduces byte-identical files even after upstream moves on.

Source: `data/tlg0059/tlg<NNN>/tlg0059.tlg<NNN>.perseus-eng2.xml`, tlg001–tlg036. All 36 resolved on the first try as `perseus-eng2` — no work needed the `perseus-eng1` fallback, and no 404s.

License: repo README (at the pinned SHA) states "Unless otherwise indicated, all contents of this repository are licensed under a Creative Commons Attribution-ShareAlike 4.0 International License" — confirmed CC BY-SA 4.0 as expected, with Tufts holding overall PDL copyright and a duty to contribute back modifications. This is a share-alike, attribution-required license (NOT public domain) — different obligations than the Bekker/OCT Greek side; the underlying Loeb-era English **translations themselves** (Fowler/Lamb/Bury/Shorey, 1914–1937) are separately US-public-domain by publication date, but the **Perseus TEI encoding/markup** is CC BY-SA 4.0 and requires attribution + share-alike if redistributed/modified.

Per-file SHA256: `sources/perseus-eng/SHA256SUMS` (generated via `shasum -a 256 tlg0059.tlg*.xml`).

Sanity gate: Republic sections = 1355 (exact match to Greek), Laws sections = 1591 (exact match to Greek). **No work's English section-milestone count differs from the Greek count by >5%** — largest deltas are Letters (280 English vs 273 Greek sections, +2.6%, from page-split section divs at letter boundaries — see notes) and Ion (60 vs 61, −1.6%); everything else is within ±1 section (rounding/edge-of-work noise) or exact.

| TLG work | Translator (year) | section milestones | page milestones | resp="Stephanus"? | first section token | sp/speaker | notes |
|---|---|---|---|---|---|---|---|
| 0059001 | Harold North Fowler (1914) | 70 | 15 | yes (70/70) | `2a` | none — inline text | matches Greek (70) |
| 0059002 | Harold North Fowler (1914) | 125 | 26 | yes (125/125) | `17a` | none — inline text | matches Greek (125) |
| 0059003 | Harold North Fowler (1914) | 59 | 12 | yes (59/59) | `43a` | none — inline text | matches Greek (59) |
| 0059004 | Harold North Fowler (1914) | 303 | 62 | yes (303/303) | `57a` | none — inline text | matches Greek (303) |
| 0059005 | Harold North Fowler (1926) | 286 | 58 | yes (286/286) | `383a` | none — inline text | matches Greek (286) |
| 0059006 | Harold North Fowler (1921) | 344 | 69 | 343/344 — 1 missing | `142a` | none — inline text | Greek 343; +1 from a non-Stephanus marker `<milestone unit="section" n="imbedded dialogue"/>` (structural, not a locus — walker must special-case non-numeric `n`) |
| 0059007 | Harold North Fowler (1921) | 262 | 53 | yes (262/262) | `216a` | none — inline text | matches Greek (262) |
| 0059008 | Harold North Fowler (1925) | 272 | 55 | yes (272/272) | `257a` | none — inline text | matches Greek (272) |
| 0059009 | Harold North Fowler (1926) | 201 | 41 | yes (201/201) | `126a` | none — inline text | matches Greek (201) |
| 0059010 | Harold North Fowler (1925) | 282 | 57 | yes (282/282) | `11a` | none — inline text | matches Greek (282) |
| 0059011 | Walter Rangeley Maitland Lamb (1925) | 256 | 52 | yes (256/256) | `172a` | none — inline text | Greek 257, −1 (0.4%) |
| 0059012 | Harold North Fowler (1914) | 261 | 53 | yes (261/261) | `227a` | none — inline text | matches Greek (261) |
| 0059013 | Walter Rangeley Maitland Lamb (1927) | 162 | 33 | yes (162/162) | `103a` | none — inline text | matches Greek (162) |
| 0059014 | Walter Rangeley Maitland Lamb (1927) | 67 | 14 | 66/67 — 1 missing | `138a` | none — inline text | one `n="138b"` section milestone lacks `resp="Stephanus"` (stray, no other irregularity); matches Greek (67) |
| 0059015 | Walter Rangeley Maitland Lamb (1927) | 37 | 8 | yes (37/37) | `225a` | none — inline text | matches Greek (37) |
| 0059016 | Walter Rangeley Maitland Lamb (1927) | 35 | 8 | yes (35/35) | `132a` | none — inline text | matches Greek (35) |
| 0059017 | Walter Rangeley Maitland Lamb (1927) | 50 | 11 | yes (50/50) | `121a` | none — inline text | matches Greek (50) |
| 0059018 | Walter Rangeley Maitland Lamb (1927) | 118 | 24 | yes (118/118) | `153a` | none — inline text | matches Greek (118) |
| 0059019 | Walter Rangeley Maitland Lamb (1924) | 115 | 24 | yes (115/115) | `178a` | none — inline text | matches Greek (115) |
| 0059020 | Walter Rangeley Maitland Lamb (1925) | 99 | 21 | yes (99/99) | `203a` | none — inline text | matches Greek (99) |
| 0059021 | Walter Rangeley Maitland Lamb (1924) | 182 | 37 | yes (182/182) | `271a` | none — inline text | matches Greek (182) |
| 0059022 | Walter Rangeley Maitland Lamb (1924) | 264 | 54 | **no — 0/264, resp attr absent entirely** | `309a` | none — inline text | Greek 265, −1 (0.4%); like Letters, this file's section milestones carry no `resp` attribute at all (order also differs: `n` before `unit`) |
| 0059023 | Walter Rangeley Maitland Lamb (1925) | 404 | 81 | yes (404/404) | `447a` | none — inline text | matches Greek (404) |
| 0059024 | Walter Rangeley Maitland Lamb (1924) | 151 | 31 | yes (151/151) | `70a` | none — inline text | matches Greek (151) |
| 0059025 | Harold North Fowler (1926) | 119 | 24 | yes (119/119) | `281a` | none — inline text | matches Greek (119) |
| 0059026 | Harold North Fowler (1926) | 67 | 14 | yes (67/67) | `363a` | none — inline text | matches Greek (67) |
| 0059027 | "William" Rangeley Maitland Lamb (1925) | 60 | 13 | yes (60/60) | `530a` | none — inline text | Greek 61, −1 (1.6%); translator name is misspelled "William" (not "Walter") in BOTH titleStmt and sourceDesc of this one file — real translator is W.R.M. Lamb, same as tlg011/013–024 |
| 0059028 | Robert Gregg Bury (1929) | 78 | 16 | yes (78/78) | `234a` | none — inline text | matches Greek (78) |
| 0059029 | Robert Gregg Bury (1929) | 21 | 5 | yes (21/21) | `406a` | none — inline text | matches Greek (21) |
| 0059030 | Paul Shorey (1935–37) | 1355 | 278 | yes (1355/1355) | `327a` | none — inline text | **matches Greek exactly (1355) — sanity gate passed.** `<div type="textpart" subtype="book" n="1"…10">` wraps `<div type="textpart" subtype="section" resp="perseus" n="327"…>` (page-numbered divs, 278 of them, 10 books) |
| 0059031 | Robert Gregg Bury (1929) | 364 | 76 | yes (364/364) | `17a` | none — inline text | matches Greek (364) |
| 0059032 | Robert Gregg Bury (1929) | 76 | 16 | yes (76/76) | `106a` | none — inline text | matches Greek (76) |
| 0059033 | Walter Rangeley Maitland Lamb (1927) | 42 | 9 | yes (42/42) | `313a` | none — inline text | matches Greek (42) |
| 0059034 | Robert Gregg Bury (1926) | 1591 | 327 | yes (1591/1591) | `624a` | none — inline text | **matches Greek exactly (1591) — sanity gate passed.** Same book/section div nesting as Republic (12 books). Header quirk: `</sourceDesc\n    >` (whitespace before `>`) broke a naive regex during analysis — valid XML, just worth knowing for any hand-rolled TEI scraper |
| 0059035 | Walter Rangeley Maitland Lamb (1927) | 99 | 20 | yes (99/99) | `973a` | none — inline text | matches Greek (99) |
| 0059036 | R. G. Bury / Robert Gregg Bury (1929) | 280 | 55 | **no — 0/280, resp attr absent entirely** | `309a` | none — inline text | Greek 273, +7 (2.6%) — as expected from earlier research, Letters' milestones are **resp-less** (`<milestone n="309a" unit="section"/>`, no `resp` attr at all, and attribute order is `n` before `unit`, opposite of the majority-file order). Div structure: `<div type="textpart" subtype="letter" n="1"…13">` wraps `<div type="textpart" subtype="section" resp="perseus" n="309"…>`; some page numbers get 2–3 separate section-divs because a letter boundary splits mid-page (e.g. `n="358"` appears 3×) — this is the source of the +7 section-milestone surplus vs. the Greek page-boundary count |

**Milestone-grammar summary for the walker:**
- Attribute order is **not stable** across files: most files write `n="…" unit="section" resp="Stephanus"`, but Protagoras (022) and Letters (036) write `unit="section" n="…"` / `n="…" unit="section"` with no `resp` at all — a walker must parse attributes order-independently, not assume a fixed sequence.
- `resp="Stephanus"` is present on nearly every section milestone (34/36 works, minus one stray each in Theaetetus and Alcibiades ii) but is **entirely absent** in Protagoras and Letters — do not treat `resp` as a reliable universal marker of "this is a real Stephanus locus"; use presence of a valid `n` token instead, and special-case the one literal non-numeric token (`n="imbedded dialogue"` in Theaetetus).
- `<div type="textpart" subtype="section" resp="perseus" n="…">` divs (page-level container, `resp="perseus"` — a different resp value, meaning "Perseus's own div boundary" not "Stephanus's page/section boundary") wrap the milestones inside Republic, Laws, and Letters, additionally nested one level under `subtype="book"` (Republic/Laws, 10/12 books) or `subtype="letter"` (Letters, 13 letters). The other 33 works have **no** book/letter-level div — just a flat sequence of page-level `subtype="section"` divs.
- No file uses `<sp>` or `<speaker>` elements anywhere in the corpus (0/36) — unlike the TLG Greek side's `<label type="speaker">`, Perseus's English encodes speaker turns as **plain inline text** at the start of each `<p>` (e.g. `<p>Euthyphro. What strange thing has happened…`), so building a dialogue-turn UI from the English requires text-pattern speaker detection, not element-based extraction, or aligning turn boundaries from the Greek side instead.

## Copyright decisions (John, 2026-07-11)

- **Republic = Shorey (Loeb 1930/1935-37) is the public translation**, grey-area accepted on the Perseus/Tufts public-hosting cover (same standard as MIT-hosted Fyfe Poetics 1932 on the Aristotle site; MIT hosts Jowett, not Shorey — verified). Jowett = optional secondary overlay later.
- All 36 canon works therefore use the vendored Perseus TEI as primary English.

## Additional public-domain translations (compare view)

Alternate translations shown beside the Loeb in the reader's turn-by-turn compare view. Each is US-public-domain by publication date (pre-1930), sourced from a plain-text digitisation, and declares itself with a `sources/<dir>/align.json` config. They carry **no** Stephanus of their own: the post-stage7 turn aligner (`pipeline/plato_pipeline/align_turns.py`) pairs each one's speaker turns to the work's already-emitted reference `turnFlow` (English↔English, Needleman–Wunsch over the speaker-label sequences, lexical-cosine scored, gap-zip for equal-count divergences), and the alternate inherits the Stephanus anchor of the reference turn it matches (written back as `FlowTurn.alt[<id>]` in `build/dist/<work>/book-NN.json`; an `align-<id>.json` report lands beside it).

All aligned translations here are **Benjamin Jowett (3rd ed., 1892)**, from Project Gutenberg. Coverage = reference turns that received a Jowett slice (the rest render an em-dash on the Jowett side). Only clean-turn **dramatic** dialogues are included; narrated/monologue works (Apology, Phaedo, Symposium, Charmides, Lysis, Protagoras, Euthydemus, Timaeus, Critias, Parmenides), and works where Jowett's turn granularity diverges sharply from the Loeb (Statesman, Laws), are **deferred** to a later paragraph-level (embedding) aligner — the turn matcher would leave too many rows blank.

| Work | id | Gutenberg | file | Coverage |
|---|---|---|---|---|
| Euthyphro | `jowett` | [#1642](https://www.gutenberg.org/ebooks/1642) | `pg1642.txt` | 232/233 (99%) |
| Crito | `jowett` | [#1657](https://www.gutenberg.org/ebooks/1657) | `pg1657.txt` | 95/101 (94%) |
| Laches | `jowett` | [#1584](https://www.gutenberg.org/ebooks/1584) | `pg1584.txt` | 253/263 (96%) |
| Ion | `jowett` | [#1635](https://www.gutenberg.org/ebooks/1635) | `pg1635.txt` | 171/174 (98%) |
| Meno | `jowett` | [#1643](https://www.gutenberg.org/ebooks/1643) | `pg1643.txt` | 561/568 (99%) — `speaker_map` BOY→Meno's Boy |
| Gorgias | `jowett` | [#1672](https://www.gutenberg.org/ebooks/1672) | `pg1672.txt` | 1078/1105 (98%) |
| Cratylus | `jowett` | [#1616](https://www.gutenberg.org/ebooks/1616) | `pg1616.txt` | 758/769 (99%) |
| Phaedrus | `jowett` | [#1636](https://www.gutenberg.org/ebooks/1636) | `pg1636.txt` | 371/395 (94%) |
| Theaetetus | `jowett` | [#1726](https://www.gutenberg.org/ebooks/1726) | `pg1726.txt` | 1007/1027 (98%) |
| Sophist | `jowett` | [#1735](https://www.gutenberg.org/ebooks/1735) | `pg1735.txt` | 1169/1178 (99%) |
| Philebus | `jowett` | [#1744](https://www.gutenberg.org/ebooks/1744) | `pg1744.txt` | 1135/1141 (99%) |
