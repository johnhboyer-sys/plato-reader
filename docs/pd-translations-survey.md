# Survey: hostable English translations of Plato beyond the site's current set

Compiled 2026-10-28. Research only. Copyright judgment is the owner's call; this file gathers evidence and does not rule.
US copyright law only. Not a legal opinion.

## 0. How the evidence was gathered (and its limits)

- **Renewals 1950-1991:** NYPL `cce-renewals` TSV files (github.com/NYPL/cce-renewals, derived from the Catalog of Copyright Entries; 1978+ from the Copyright Office database). I grepped full text for Plato titles and for each translator's name. A negative result means "no renewal row found in this dataset". It is not proof, because the data is transcribed from OCR and the Stanford Copyright Renewal Database (the usual check) blocked automated access with a JavaScript challenge. **Re-check every "PD if unrenewed" item by hand in the Stanford database before relying on it.**
- **Registrations 1928-1963:** NYPL `catalog_of_copyright_entries_project` XML (Books, Part 1). Coverage is uneven after 1945, and I pulled only part of the post-1945 files.
- **Foreign (UK) first publication 1931-1963:** these may carry restored US copyright under the URAA (17 U.S.C. 104A) whether or not anyone renewed. Restored works last 95 years from first publication. A UK work first published in 1930 or earlier is PD in the US now; one published in 1931 becomes PD on 2027-01-01. I flag these and do not rule.
- archive.org "open" status is not a US-status signal: many open scans come from the Digital Library of India (`in.ernet.dli.*`, `dli.*`), which reflects Indian law only. The `licenseurl` "Public Domain Mark" on an archive.org item is the uploader's label, not evidence.
- Links were checked by fetching archive.org `/metadata/<id>`, Gutenberg pages and text files, the HathiTrust bib API, Wikisource's API and the Open Plato site. Anything I could not fetch is marked UNVERIFIED.
- "Stephanus numbers" column: I checked OCR or text for marginal Stephanus references. OCR rarely preserves margin numbers, so "none detected" means none found by grep, not proven absent. Page numbers were separated from Stephanus numbers by eye on samples.

## 1. Headline findings

1. **Every one of the 36 works has at least one clearly-PD (pre-1931) alternative English translation**, because the Bohn set (Cary / Davis / Burges, 1848-54) and the Sydenham/Taylor set (1804) are complete. Neither carries Stephanus numbers in the text I could inspect (Bohn uses Stallbaum section numbers, `§`). Alignment would need a section-to-Stephanus map or paragraph matching, as for Loeb.
2. **Best digital quality:** Project Gutenberg's new Distributed Proofreaders transcriptions of Bohn Vol. 1 (#78618, May 2026) and Vol. 2 (#79398, Aug 2026, updated 2026-10-24). They cover 12 works with proofread text. Vols 3-6 (Burges) are not yet on Gutenberg as of this check (UNVERIFIED that none are in progress); archive.org raw OCR exists.
3. **Only open-licence modern text found:** the Open Plato Project's *Alcibiades* (Alcibiades I), CC BY-SA 4.0, with Stephanus numbering on Greek and English. A free-to-read, all-rights-reserved translation (Horan) exists and is not hostable.
4. **"PD if unrenewed" cases needing owner judgment:** Lane Cooper 1938 (Phaedrus, Ion, Gorgias, Symposium, plus passages from the Republic and Laws) and Glenn Morrow's *Plato's Epistles* 1962 (weaker evidence). HathiTrust currently lists Cooper 1938 as in copyright (search-only), so look at that before relying on my renewal search.
5. **UK-first 1931-63 translations are the large "in copyright probably" group** (Cornford, A. E. Taylor's Laws, Hackforth, Harward's *Epistles*, Bluck). They are rejected below on URAA grounds, with the caveat that this is a flag, not a ruling.
6. Not found: A. E. Taylor's *Timaeus and Critias* (Methuen, 1929), which would be PD in the US now. I found only his 1928 *Commentary*. Michael Joyce's *Symposium* (Everyman, 1935) could not be located or checked.

## 2. Best new candidate per work

Key: **Q** = text quality (P = proofread digital text, O = raw OCR scan only, T = HathiTrust full view / scan, no clean text). **S** = Stephanus numbers present in the digital text. Status "PD" means first published 1930 or earlier (US), so the only judgment left is the owner's usual sanity check.

| # | Work | Best candidate (translator, year) | US status | Where | Q | S | Note |
|---|------|-----------------------------------|-----------|-------|---|---|------|
| 1 | Euthyphro | Cary (Bohn Vol 1), 1849 | PD | Gutenberg #78618 | P | no (Stallbaum §) | Also Church 1880s (F. J. Church, *Trial and Death of Socrates*): archive.org `trialdeathofsocr00plat_1` (1920 ed.), O |
| 2 | Apology | Cary (Bohn Vol 1), 1849 | PD | Gutenberg #78618; also #13726 (Cary, Apology/Crito/Phaedo) | P | no | Church is the readable alternative (O) |
| 3 | Crito | Cary (Bohn Vol 1), 1849 | PD | Gutenberg #78618, #13726 | P | no | As above |
| 4 | Phaedo | Cary (Bohn Vol 1), 1849 | PD | Gutenberg #78618, #13726 | P | no | Church; Cope (1875); Archer-Hind is Greek text, rejected |
| 5 | Cratylus | Burges (Bohn Vol 3), 1850 | PD | archive.org `WorksOfPlatoV3`, `theworksofplato03platiala` | O | no | Taylor 1804 also |
| 6 | Theaetetus | Cary (Bohn Vol 1), 1849 | PD | Gutenberg #78618 | P | no | Dyde 1899 (Glasgow), archive.org `theaetetustransl00plat`, O |
| 7 | Sophist | Burges (Bohn Vol 3), 1850 | PD | archive.org `WorksOfPlatoV3` | O | no | Mackay 1868 also (Wikisource scan list) |
| 8 | Statesman | Burges (Bohn Vol 3), 1850 | PD | archive.org `WorksOfPlatoV3` | O | no | Taylor 1804 also |
| 9 | Symposium | Burges "The Banquet" (Bohn Vol 3), 1850; Shelley "The Banquet" (1840 posth., Richards ed. 1895) | PD | `WorksOfPlatoV3`; Shelley: `banquetofplato00platiala` | O | no | Shelley is the literary choice; Taylor 1804 also |
| 10 | Parmenides | Burges (Bohn Vol 3), 1850 | PD | `WorksOfPlatoV3` | O | no | Taylor 1804 also |
| 11 | Philebus | Burges (Bohn Vol 4), 1851-54 | PD | `WorksOfPlatoV4` | O | no | Paley 1873 (`philebusplato00platuoft`) is a translation with notes (O); Poste/Badham are Greek editions, rejected |
| 12 | Phaedrus | Cary (Bohn Vol 1), 1849 | PD | Gutenberg #78618 | P | no | J. Wright 1888 (Macmillan), archive.org `phaedruslysisan00wriggoog` (text file not fetched; UNVERIFIED) |
| 13 | Alcibiades I | **Open Plato Project (several translators + R. Blondell), CC BY-SA 4.0** | Open licence | openplato.org | P | **yes (103a-135e)** | Only open-licence modern text found. Bohn Vol 4/6 (Burges) and Taylor 1804 as PD fallback |
| 14 | Alcibiades II | Taylor 1804 / Burges (Bohn, UNVERIFIED which volume) | PD | archive.org `vol2worksofplato00plat` etc. | O | no | Authenticity doubtful; low priority |
| 15 | Hipparchus | Burges (Bohn Vol 4) | PD | `WorksOfPlatoV4` | O | no | |
| 16 | Lovers (Rival Lovers) | Burges "The Rivals" (Bohn Vol 4), 1851 | PD | `WorksOfPlatoV4` | O | no | Sydenham 1804 also |
| 17 | Theages | Burges (Bohn Vol 4) | PD | `WorksOfPlatoV4` | O | no | |
| 18 | Charmides | Burges (Bohn Vol 4), 1851 | PD | `WorksOfPlatoV4` | O | no | Whewell 1859; Wright (189-) |
| 19 | Laches | Burges (Bohn Vol 4), 1851 | PD | `WorksOfPlatoV4` | O | no | Lloyd 1891; Whewell |
| 20 | Lysis | Cary (Bohn Vol 1), 1849 | PD | Gutenberg #78618 | P | no | Wright 1888 |
| 21 | Euthydemus | Burges (Bohn Vol 3), 1850 | PD | `WorksOfPlatoV3` | O | no | Gifford 1905 (Wikisource lists; not fetched) |
| 22 | Protagoras | Cary (Bohn Vol 1), 1849 | PD | Gutenberg #78618 | P | no | Wright 1888; "A Day in Athens with Socrates" 1883 is excerpts only |
| 23 | Gorgias | Cary (Bohn Vol 1), 1849 | PD | Gutenberg #78618 | P | no | Cope 1864 literal translation, archive.org `bub_gb_H50hsgIss64C` (O; refers to Stephanus pages in notes). Cooper 1938 is the PD-if-unrenewed option |
| 24 | Meno | Burges (Bohn Vol 3), 1850 | PD | `WorksOfPlatoV3` | O | no | Mackay 1868, Stock 1887, Broughton 1891 (Wikisource scan list) |
| 25 | Hippias Major | Burges (Bohn Vol 4) (UNVERIFIED: not found in the Vol 4 contents I grepped; Wikisource lists only Lesser Hippias for Burges) | PD | `WorksOfPlatoV4` | O | no | Check before relying |
| 26 | Hippias Minor | Burges "Lesser Hippias" (Bohn Vol 4), 1851 | PD | `WorksOfPlatoV4` | O | no | Sydenham 1804 also |
| 27 | Ion | Burges (Bohn Vol 4), 1851 | PD | `WorksOfPlatoV4` | O | no | Shelley's *Ion* (1840 posth.); Cooper 1938 |
| 28 | Menexenus | Burges (Bohn Vol 4), 1851 | PD | `WorksOfPlatoV4` | O | no | Shelley; Graves 1883 |
| 29 | Clitophon | Burges "Clitopho" (Bohn Vol 4) | PD | `WorksOfPlatoV4` | O | no | |
| 30 | Republic | Davis (Bohn Vol 2), 1854 | PD | **Gutenberg #79398** | P | no | Also Davies & Vaughan 1852 (`bub_gb_AqhXAAAAcAAJ`, O) and Lindsay (Everyman, 1907; rev. 1923, `therepublicofpla00platuoft`, O) |
| 31 | Timaeus | Davis (Bohn Vol 2), 1854 | PD | **Gutenberg #79398** | P | no | Taylor 1804; A. E. Taylor 1929 not located |
| 32 | Critias | Davis (Bohn Vol 2), 1854 | PD | **Gutenberg #79398** | P | no | |
| 33 | Minos | Burges (Bohn Vol 4) | PD | `WorksOfPlatoV4` | O | no | |
| 34 | Laws | Burges (Bohn Vol 5), 1852 | PD | `WorksOfPlatoV5` | O | no | Taylor's 1934 Everyman is probably restored copyright; do not use |
| 35 | Epinomis | Harward, *The Epinomis of Plato*, Oxford 1928 | PD (pre-1931) | HathiTrust `uiug.30112058525004` (Full view, rights code `pdus`) | T | UNVERIFIED | Burges (Bohn Vol 6) also, O. Harward's is the modern, scholarly one |
| 36 | Letters | Post, *Thirteen Epistles of Plato*, Oxford 1925 | PD (1925) | archive.org `thirteenepistles0000plat` (open) | O | UNVERIFIED (has a "Table of References") | Burges "Epistles" (Bohn Vol 4) also |

## 3. Per-work and per-translator detail

### 3.1 The two complete sets

**Bohn's Classical Library, "The Works of Plato: a new and literal version, chiefly from the text of Stallbaum", 6 vols, London, H. G. Bohn, 1848-54.**
Translators: Henry Cary (Vol 1), Henry Davis (Vol 2), George Burges (Vols 3-6). All died before 1870.
- **Vol 1 (Cary, 1849):** Apology, Crito, Phaedo, Gorgias, Protagoras, Phaedrus, Theaetetus, Euthyphron, Lysis. Verified from the Gutenberg contents list. **Gutenberg #78618**, released 2026-05-06, produced by Distributed Proofreaders from HathiTrust images. Italics as `_x_`. Verified: text fetched, 1.16 MB.
- **Vol 2 (Davis, 1854):** Republic (ten books), Timaeus, Critias. **Gutenberg #79398**, released 2026-08-18, updated 2026-10-24. Verified by fetching.
- **Vol 3 (Burges, 1850):** Meno, Euthydemus, Sophist, Statesman, Cratylus, Parmenides, The Banquet. The Banquet, Cratylus and Parmenides were seen in the OCR table of contents. archive.org: `WorksOfPlatoV3`, `theworksofplato03platiala` (this OCR has garbled opening pages), `dli.bengal.10689.2687`. Raw OCR.
- **Vol 4 (Burges, 1851-54):** Philebus, Menexenus, Ion, Theages, The Rivals, Hipparchus, Minos, Clitopho, The Epistles confirmed in the OCR contents; Wikisource also lists Charmides, Laches, Lesser Hippias there. archive.org: `WorksOfPlatoV4`. Raw OCR.
- **Vol 5 (Burges, 1852):** Laws. archive.org: `WorksOfPlatoV5`.
- **Vol 6 (Burges, 1854):** Epinomis, plus the spurious dialogues (Axiochus, On Justice, Demodocus, Sisyphus). archive.org: `WorksOfPlatoV6`, `worksofplatonewl06platiala`. The OCR also shows a table listing Theages, Rivals, Hipparchus, Philebus, Minos, Charmides, Alcibiades I, Lysis and Laches, which I did not resolve (possibly an index to an earlier volume's contents).
- Gutenberg had no Vols 3-6 in my search (search by title for "works of Plato" found only #78618 and #79398). Distributed Proofreaders appears to be working through the set; ask them or check again before building an OCR pipeline.
- **Stephanus:** none in the Gutenberg text of Vols 1-2. Bohn marks sections with Stallbaum numbers (`§ 21-39`, shown as summary notes in the introductions). The Republic text has book headings only. Alignment needs a section-to-Stephanus table.
- **Quality caveat:** "new and literal", stiff Victorian English, with Stallbaum's text. Footnotes are in the Gutenberg text.

**Sydenham & Taylor, "The Works of Plato, viz. his fifty-five dialogues and twelve epistles", 5 vols, London, T. Taylor, 1804.**
Nine dialogues by Floyer Sydenham (d. 1787), the rest by Thomas Taylor (d. 1835). Complete.
- archive.org: `vol2worksofplato00plat` (OCR fetched, 1.9 MB, long-s "f" misreads, e.g. "facrificing"), `vol5worksofplato00plat`, and matching vol 3-4 items (Wikisource names `Vol3worksofplato00plat`, `Vol4worksofplato00plat`). Raw OCR, poor because of the long s. No Stephanus numbers found by grep. Wikisource has partial transcription pages ("Works of Plato his first fifty-five dialogues/Volume 2" etc.); completeness UNVERIFIED.
- Taylor's English is idiosyncratic, with a Neoplatonic slant; usable as a historical comparison, not a reader's first choice.
- Also: Rolleston's 1892 revision of Taylor/Sydenham (Apology, Crito, Phaedo) appears in Wikisource's scan lists; not fetched.

### 3.2 Individual PD translations worth knowing (pre-1931)

- **Davies & Vaughan, *The Republic of Plato*, Cambridge, Macmillan, 1852.** archive.org `bub_gb_AqhXAAAAcAAJ` (Google Books scan, open). Raw OCR; no Stephanus. The clearest nineteenth-century Republic; Gutenberg lists none.
- **A. D. Lindsay, *The Republic of Plato*, Everyman (Dent), 1907; revised reprints 1908, 1920, 1923.** archive.org `therepublicofpla00platuoft` (1923 reprint, open). Raw OCR (0.9 MB). Number marks found are page numbers, not Stephanus. US status: PD (1923 at the latest). The reprints contain revisions; use the text the scan shows.
- **F. J. Church, *The Trial and Death of Socrates* (Euthyphron, Apology, Crito, Phaedo), Macmillan, 1880; many reprints.** archive.org `trialdeathofsocr00plat_1` (1920 printing), `india.history.resource.110823` (1898). Open. Raw OCR. Stephanus not detected. Church d. 1900. A clear, readable alternative to Jowett for four works. Note: the 1941 Lane Cooper book that reprints Whewell is a different, renewed book (section 5).
- **Whewell, *The Platonic Dialogues for English Readers*, Cambridge/London, Macmillan, 1859-61, 3 vols.** archive.org: `platonicdialogu00whewgoog` through `...06whewgoog`, `Platonic-Dialogs-1859-Whewell`, `Platonic-Dialogs-1860-Whewell-v2`. Wikisource lists Whewell versions for Apology, Charmides, Crito, Euthydemus, Euthyphro, Gorgias, Ion, Laches, Lesser Hippias, Lysis, Menexenus, Meno, Rival Lovers, Phaedo and others. It is a free paraphrase with commentary, not a literal translation. Raw OCR.
- **J. Wright, *The Phaedrus, Lysis, and Protagoras of Plato: a new and literal translation*, Macmillan, 1888** (Golden Treasury ed. 1909 `phaedruslysispro0000unse`; 1916 `dli.ministry.05159`). archive.org `phaedruslysisan00wriggoog` metadata exists; text download returned an error (170 bytes), so UNVERIFIED.
- **Edward Meredith Cope, *Plato's Gorgias, literally translated*, Cambridge, 1864 (and 1883).** archive.org `bub_gb_H50hsgIss64C`, `cu31924028975767`. Open. Raw OCR. The notes use Stephanus page refs ("Rep. IX. 583 B"), so the apparatus is Stephanus-keyed; text numbering UNVERIFIED.
- **S. W. Dyde, *Theaetetus*, Glasgow, Maclehose, 1899.** archive.org `theaetetustransl00plat`. Open. Text download failed (170 bytes); UNVERIFIED quality.
- **F. A. Paley, *The Philebus of Plato, translated with brief explanatory notes*, London, Bell, 1873.** archive.org `philebusplato00platuoft`. Open. Raw OCR; no Stephanus.
- **Percy Bysshe Shelley, *The Banquet of Plato* (written 1818; first published 1840), also *Ion* and part of *Menexenus*.** archive.org `banquetofplato00platiala` (Chicago, 1895 ed., Bruce Rogers design). Open. Raw OCR (0.15 MB). Stephanus not present. The strongest literary alternative for Symposium.
- **J. Harward, *The Epinomis of Plato*, Oxford, 1928.** HathiTrust Full view (`uiug.30112058525004`, rights `pdus`, record 103530216, verified by API). Scan only; I did not fetch an OCR text. Best modern-scholarly Epinomis.
- **L. A. Post, *Thirteen Epistles of Plato*, Oxford, Clarendon, 1925.** archive.org `thirteenepistles0000plat` (Rollins College copy, not restricted); also `dli.ministry.06685`, `dli.ernet.247526`. US status: published 1925. Raw OCR, 262 KB; a "Table of References" exists, so Stephanus keying is likely but UNVERIFIED.
- **E. B. England, *The Laws of Plato* (Manchester UP, 1921):** Greek text and commentary, not a translation. Rejected.
- **R. D. Archer-Hind, *The Timaeus of Plato*, 1888; *Phaedo*:** Greek text with English notes, no translation. Rejected. (`timaeusofplato00platiala`.)
- **J. A. Stewart, *The Myths of Plato*, 1905:** partial (myths only), PD. Marginal use.
- **Other Wikisource-listed PD translators** (scan links only; not fetched or checked): C. S. Stanford 1835 (Apology, Crito, Phaedo), Georgiana Chatterton 1862 (selections), R. W. Mackay 1868 (Sophistes, Meno), G. H. Wells 1881-84 (Euthydemus, Euthyphro), C. E. Graves 1883, T. R. Mills 1899, Paul Elmer More 1899 (Apology/Crito/Phaedo), C. H. Keene 1895, George Stock 1887-1909, F. M. Stawell 1910, C. L. Marson 1912, Josiah Wright (189-), E. H. Gifford 1905 (Euthydemus), A. Lloyd 1891 (Laches), R. Broughton 1891 (Meno), J. Gibson 1892 (Laches, Euthyphro), E. B. England 1921 (Laws, Greek ed.). All pre-1931, so US PD on date; text quality unchecked.
- **Wikisource note:** its translation list pages (e.g. `Apology (Plato)`, `Crito`, `Meno`, `Phaedo`) are mostly lists of scans; Jowett and a few others are transcribed. I did not confirm a proofread, complete non-Jowett transcription for any work. The Author:Plato page lists transcription volumes only for Dacier 1701, Taylor/Sydenham 1804, Cary/Davis/Burges, Whewell and Jowett; none is marked complete.

### 3.3 Modern open and free-to-read

- **Open Plato Project, *Alcibiades* (Alcibiades I).** openplato.org. Fetched. Scholarly translation by Marc Gasser-Wingate, Emily Kress, Patricia Marechal, Katy Meadows and Evan Rodriguez; "first-read" translation by Ruby Blondell. Greek from Burnet. Quote: the edition "is licensed under a Creative Commons Attribution-ShareAlike 4.0 License (CC BY-SA)"; display code is MIT. Stephanus-marked Greek and English (103a-135e). SA means derivatives (including alignment into the site's data) need the same licence and attribution; flag for the owner. No ND, no NC.
- **David Horan's translation of the complete Plato (Platonic Foundation, platonicfoundation.org).** "33 dialogues have now been translated" (Aug 2025 update), read free online. Footer: "© 2026 Platonic Foundation. All rights reserved." No licence granted. **Not hostable.**
- **Cathal Woods and Ryan Pack (Virginia Wesleyan University): Euthyphro, "Socrates' Defense" (Apology), Crito, Phaedo death scene.** The Stoa blog (blog.stoa.org/archives/728) says they are "free to all under a creative commons license" with no variant named. The listed PDF URLs (facultystaff.vwc.edu/~rwoods/docs/…) did not resolve from here (DNS error), and a Wayback attempt returned nothing. **UNVERIFIED**: licence variant (NC? ND?) and whether the files still exist. This is a vague-licence-statement case and needs the licence read from the PDF. Covers Euthyphro, Apology, Crito, and only a fragment of Phaedo.
- **Tsouna, *Plato's Charmides* (Cambridge, CC BY-NC-ND 4.0) and McAleer, *Plato's Republic: An Introduction* (Open Book Publishers, CC BY 4.0):** commentary, not translations. Not candidates.
- I searched Open Textbook Library, LibreTexts, Sacred-Texts, Internet Classics Archive (Jowett only) and Open Book Publishers only through general web search. I did not open them one by one: **UNVERIFIED gap.** No new open-licence Plato translation turned up apart from the Open Plato Alcibiades and the Woods set. Ian Johnston (VIU): searches found no Plato translation by him (his translations are of other authors; his Plato items are lecture notes). Bernard Suzanne's "Plato and his dialogues" site: not checked (UNVERIFIED).

## 4. "PD if unrenewed" and flagged cases (owner's judgment)

| Item | Works | First pub | Evidence | Digital text |
|------|-------|-----------|----------|--------------|
| **Lane Cooper, *Phaedrus, Ion, Gorgias, and Symposium, with passages from the Republic and Laws*, OUP New York/London, 1938** | Phaedrus, Ion, Gorgias, Symposium (+ Rep., Laws passages) | 1938, US-registered A114688, 17 Feb 1938, claimant Lane Cooper (NYPL CCE registrations, 1938 volume). Published in the US, so a renewal was required in 1965-66. | **PD if unrenewed: no renewal found.** The renewal files (1965 and 1966) have rows for neighbouring registrations of 17 Feb 1938 (e.g. A115026, A115032, AA383040) but none for A114688, and no row naming this Plato title. Cooper's estate (Chase Manhattan Bank) did renew his 1941 *Plato on the Trial and Death of Socrates* (R444360, 27 Sep 1968), so the 1938 omission could be a gap in the dataset. **Counter-signal:** HathiTrust lists two copies (Michigan, Indiana) as "ic / Limited (search-only)". Stanford database not checked (blocked). | archive.org `platophaedrusion0000lane` and `phaedrusiongorgi0000plat`: **lending library only** (access-restricted), so no downloadable OCR. HathiTrust search-only. A clean text would need the owner's own scan. |
| **Glenn R. Morrow, *Plato's Epistles*, Bobbs-Merrill (Library of Liberal Arts), 1962** | Letters | 1962 | Renewal would fall in 1990. No row in the NYPL 1989-91 data for Morrow or this title. Registration not located (1962 files not fully pulled). Weak evidence: the 1989-91 files are database exports and my title/author filter may miss it. | archive.org `platosepistles` (open; uploader's Public Domain Mark; not evidence). |
| **Hackforth, *Plato's Examination of Pleasure* (Philebus), Cambridge UP / Liberal Arts Press (Bobbs-Merrill), 1945** | Philebus | UK/US editions the same year | First published abroad as well as in the US; URAA restoration likely. No US registration found in my partial 1945 files. Hackforth d. 1957, so UK term still ran in 1996. | archive.org lending only (`platosexaminatio00hack`; HathiTrust search-only). |
| **Michael Joyce, *Symposium* (Everyman, Dent/Dutton), 1935** | Symposium | 1935 | **UNVERIFIED.** No renewal found for it in the data, and no registration located. Could not find the scan. | Not found. |

## 5. Rejected / in copyright (so nobody re-researches them)

| Translation | Works | Reason |
|-------------|-------|--------|
| F. M. Cornford, *Republic* (OUP, 1941); *Plato's Cosmology/Timaeus* (1937); *Plato and Parmenides* (1939); *Plato's Theory of Knowledge* (Theaetetus, Sophist; 1935) | Republic, Timaeus, Parmenides, Theaetetus, Sophist | UK first publication; Cornford d. 1943, so UK protection ran past 1996: URAA restored copyright likely (term 95 years from publication: 2030 to 2036). No renewal found, but a restored work does not need one. archive.org copies exist (some open from the Digital Library of India: `in.ernet.dli.2015.48564`; `plato-and-parmenides-francis-mc-donald-cornford` has a "Public Domain Mark" that is the uploader's label). Not a US-PD signal. |
| A. E. Taylor, *The Laws of Plato* (Dent/Everyman, 1934) | Laws | UK first publication, Taylor d. 1945: URAA restoration likely, protected to 2029. Open on archive.org (`lawsofplato01plat_0`, DLI copy), which reflects India, not US. |
| A. E. Taylor, *Timaeus and Critias* (Methuen, 1929) | Timaeus, Critias | Would be PD in the US now (published 1929), but **I did not find a scan.** Not rejected; listed under gaps. |
| Hackforth, *Plato's Phaedo* (CUP, 1955) | Phaedo | UK first publication; URAA flag. Lending only. |
| R. S. Bluck, *Plato's Phaedo* (Routledge, 1955) | Phaedo | UK first publication; ad interim registration found (AI0-5324, 1955); URAA flag. |
| J. Harward, *The Platonic Epistles* (CUP, 1932) | Letters | UK first publication 1932; Harward's death date not checked: URAA flag, UNVERIFIED. (His 1928 *Epinomis* is PD and is listed above.) |
| W. H. D. Rouse, *Great Dialogues of Plato* (New American Library, 1956) | Apology, Crito, Phaedo, Symposium, Meno, Republic (selection) | US published; **renewed**: 1984-11-26, A229393 (NYPL renewals 1984 data). In copyright. |
| Lane Cooper, *Plato on the Trial and Death of Socrates* (Cornell UP, 1941) | Euthyphro, Apology, Crito, Phaedo | **Renewed**: R444360, 27 Sep 1968, claimant Chase Manhattan Bank (executor). In copyright. (The text builds on Whewell's, which is PD; the new matter and Cooper's translation are the renewed part.) |
| Martin Ostwald, *Plato's Statesman* (Liberal Arts, 1957) | Statesman | **Renewed**: RE271882, 23 Dec 1985. In copyright. |
| I. A. Richards, *The Republic of Plato: a new version founded on Basic English* (1942) | Republic | **Renewed**: R461327, 12 May 1969. In copyright. |
| Walter Hamilton (Penguin, 1951/1960) and Penguin/Hutchinson/Hackett/Oxford modern translations (Waterfield, Lee, Grube, Reeve, Saunders, Cooper's *Complete Works*, Lombardo, Rowe, etc.) | Various | Post-1963 US automatic renewal, or modern copyright. Not checked item by item. |
| Jowett, Loomis, Edman, Demos, Ballou, Buchanan editions | Various | Jowett's text is PD (and hosted for 11 works). The editorial matter in 1927-61 US reprints was renewed; use the Gutenberg Jowett instead. |
| Thomas Taylor, *Timaeus and Critias* (Taliaferro reprint, 1944) | Timaeus, Critias | Taylor's text is PD; the 1944 foreword was renewed (R538920, 31 Oct 1972) and the reprint adds nothing the site needs. |
| David Horan (Platonic Foundation) | 33 dialogues | "© 2026 Platonic Foundation. All rights reserved." Read free, no licence. |
| Tsouna, *Plato's Charmides* (CC BY-NC-ND) and McAleer (CC BY) | Charmides, Republic | Commentary, not translation. |
| Archer-Hind (*Timaeus*, *Phaedo*), E. B. England (*Laws*), Badham and Poste (*Philebus*), Rettig and Dyer Greek editions | various | Greek text with English notes, not translations. |

## 6. Gaps (not done or not confirmed)

- Stanford Copyright Renewal Database could not be queried (JavaScript block); every "no renewal found" rests on the NYPL transcription of the CCE and should be re-checked there.
- Registrations after 1945 were checked only partially; HathiTrust rights for the 1931-63 candidates beyond Cooper, Hackforth and the Epinomis were not queried.
- Gutenberg: the Gutendex API refused or timed out on many queries; I could not enumerate every Plato ebook. Gutenberg's author-93 list showed Jowett versions, Cary's Apology/Crito/Phaedo (#13726) and the new Bohn Vols 1-2. Translations of Plato by other hands could exist on Gutenberg and be missing here.
- Alcibiades I/II and Hippias Major contents of Bohn Vols 3-6 not resolved; Wikisource-listed minor translators (Stawell, Marson, Gifford, Stock, Mackay, etc.) not fetched; Wright 1888 and Dyde 1899 OCR text downloads failed.
- Stephanus presence only inferred by grep on OCR; margin numbers are often dropped by OCR, so "not detected" is weak. Davies & Vaughan and Taylor 1804 may carry margin references the OCR missed.
- A. E. Taylor *Timaeus and Critias* 1929 and Michael Joyce *Symposium* 1935: no scan found.
- Woods/Pack Creative Commons licence variant and file availability unconfirmed.
- Bernard Suzanne's site, Open Textbook Library, LibreTexts, Sacred-Texts, Perseus's non-Loeb translators: not individually checked.
