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
