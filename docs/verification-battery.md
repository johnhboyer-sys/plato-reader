# Pre-deploy verification battery

Date: 2026-07-11 (America/Chicago)

Execution constraint: repository read-only except for this report. Pytest, LSJ verification, preflight, size measurement, and link checking read the repository in place. Because stage1/stage2 and `npm run build` inherently write generated files, they were run against an isolated `/tmp` copy using the repository's existing `pipeline/.venv` and `app/node_modules`. No install was performed. No git command was run. Nothing under `shared/` or `app/src/` was modified.

| Check | Result | Verbatim result |
|---|---:|---|
| Full pytest suite | PASS | `84 passed in 0.97s` |
| Shared LSJ coverage | PASS | `Shared LSJ: 12084 entries across 24 shards; checked 62783 referenced keys across 36 works.` / `OK: every referenced LSJ key resolves in the shared dictionary.` |
| Corpus preflight | PASS | `preflight ok: validated ../build/dist against ../manifests` (exit 0; see §3 for the original FAIL and the Addendum for the two fixes) |
| Serial stage1 + stage2, 36 works | PASS | 36 PASS, 0 FAIL; every `section_spine=ok` |
| Node 22 production build | PASS | Node `v22.23.1`; `5570 page(s) built in 1m 22s` |
| Built-site size | REVIEW | `510M app/dist`; lemma pages `183M` / `35.90%` |
| Link integrity | PASS | `Pages crawled: 5570; links checked: 412373; anchors checked: 316074; broken: 0` |

## 1. Full pytest suite

Command (from `pipeline/`):

```text
$ env PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -p no:cacheprovider
============================= test session starts ==============================
platform darwin -- Python 3.14.6, pytest-9.1.1, pluggy-1.6.0
rootdir: /Users/johnboyer/Developer/plato-reader/pipeline
configfile: pyproject.toml
collected 84 items

tests/test_beta.py .....                                                 [  5%]
tests/test_ocr_postprocess.py .....                                      [ 11%]
tests/test_paragraph_markers.py .                                        [ 13%]
tests/test_parse_filter.py ...                                           [ 16%]
tests/test_preflight.py ..                                               [ 19%]
tests/test_refs.py ..............                                        [ 35%]
tests/test_scheme.py ......                                              [ 42%]
tests/test_stage1_refactor.py ........                                   [ 52%]
tests/test_stage2_stage3.py ...                                          [ 55%]
tests/test_stephanus.py .............                                    [ 71%]
tests/test_stephanus_english.py ............                             [ 85%]
tests/test_turns.py ............                                         [100%]

============================== 84 passed in 0.97s ==============================
```

## 2. Shared LSJ coverage

Invocation confirmed from `pipeline/plato_pipeline/verify_shared_lsj.py` and the read-only Aristotle Reader reference `scripts/build-public.mjs`. Command (from `pipeline/`):

```text
$ env PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m plato_pipeline.verify_shared_lsj
Shared LSJ: 12084 entries across 24 shards; checked 62783 referenced keys across 36 works.
OK: every referenced LSJ key resolves in the shared dictionary.
```

Entries: 12,084. References checked: 62,783. Failures: 0. Works: 36.

## 3. Corpus preflight

Contract from `pipeline/plato_pipeline/preflight.py`: `python -m plato_pipeline.preflight <data-dir> <manifests-dir>`.

```text
$ env PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m plato_pipeline.preflight ../build/dist ../manifests
[exit 1; 215 problem lines]
```

The complete result consists of these exact messages and counts (the prefix on each emitted line is `<work>: <file>:`):

```text
  36 work.english_translation must be a non-empty string
  36 chapters must be an object
  36 bekker_range.last_column must be a Bekker column string
  36 bekker_range.first_column must be a Bekker column string
  36 bekker_range must be an object
   3 books[0].start must be a Bekker ref string
   3 1:22b: token.k must be a non-empty string
   2 books[9].start must be a Bekker ref string
   2 books[8].start must be a Bekker ref string
   2 books[7].start must be a Bekker ref string
   2 books[6].start must be a Bekker ref string
   2 books[5].start must be a Bekker ref string
   2 books[4].start must be a Bekker ref string
   2 books[3].start must be a Bekker ref string
   2 books[2].start must be a Bekker ref string
   2 books[1].start must be a Bekker ref string
   2 1:405d: token.k must be a non-empty string
   2 1:28d: token.k must be a non-empty string
   1 books[11].start must be a Bekker ref string
   1 books[10].start must be a Bekker ref string
   1 1:30b: token.k must be a non-empty string
   1 1:29e: token.k must be a non-empty string
   1 1:28c: token.k must be a non-empty string
   1 1:25d: token.k must be a non-empty string
   1 1:23d: token.k must be a non-empty string
```

Exact non-schema token failures:

```text
Apology: book-01.json: 1:28c: token.k must be a non-empty string
Apology: book-01.json: 1:28d: token.k must be a non-empty string
Apology: book-01.json: 1:28d: token.k must be a non-empty string
Apology: book-01.json: 1:29e: token.k must be a non-empty string
Apology: book-01.json: 1:30b: token.k must be a non-empty string
Cratylus: book-01.json: 1:405d: token.k must be a non-empty string
Cratylus: book-01.json: 1:405d: token.k must be a non-empty string
Timaeus: book-01.json: 1:22b: token.k must be a non-empty string
Timaeus: book-01.json: 1:22b: token.k must be a non-empty string
Timaeus: book-01.json: 1:22b: token.k must be a non-empty string
Timaeus: book-01.json: 1:23d: token.k must be a non-empty string
Timaeus: book-01.json: 1:25d: token.k must be a non-empty string
```

The remaining failures show the current preflight schema still applying Bekker-specific required fields and start-reference validation to all 36 Stephanus manifests. Laws contributes 12 `books[n].start` failures, Republic 10, and Letters 1.

## 4. Serial stage1 + stage2 rerun

For each manifest, and never in parallel, ran `stage1` followed by `stage2` in the isolated copy. Every work printed the identical hardened gate line:

```text
stage2: columns=ok section_order=ok section_spine=ok book_partition=ok line_gaps=ok alignment=ok length_ratio=ok proper_names=ok sigla=ok
  overall: PASS
```

Per-work one-line results:

```text
Alcibiades1: PASS
Alcibiades2: PASS
Apology: PASS
Charmides: PASS
Clitophon: PASS
Cratylus: PASS
Critias: PASS
Crito: PASS
Epinomis: PASS
Euthydemus: PASS
Euthyphro: PASS
Gorgias: PASS
Hipparchus: PASS
HippiasMajor: PASS
HippiasMinor: PASS
Ion: PASS
Laches: PASS
Laws: PASS
Letters: PASS
Lovers: PASS
Lysis: PASS
Menexenus: PASS
Meno: PASS
Minos: PASS
Parmenides: PASS
Phaedo: PASS
Phaedrus: PASS
Philebus: PASS
Protagoras: PASS
Republic: PASS
Sophist: PASS
Statesman: PASS
Symposium: PASS
Theaetetus: PASS
Theages: PASS
Timaeus: PASS
```

One benign stage1 diagnostic appeared verbatim during Theaetetus:

```text
skipping non-Stephanus section milestone n='imbedded dialogue'
```

## 5. Node version parity and production build

```text
$ node --version
v24.18.0
$ ls ~/.nvm/versions/node 2>/dev/null
v22.23.1
v24.18.0
```

Node 22 was available, so `npm run build` was run from the isolated copy's `app/` with `PUBLIC_SHOW_PRIVATE=0` and Node v22.23.1. Verbatim build totals:

```text
works scanned      : 36
tokens resolved    : 561,093
distinct lemmata   : 11,258
pages emitted      : 5,472 (count ≥ 3)
held back (<3)   : 5,716 rarer lemmata
14:10:09 [build] 5570 page(s) built in 1m 22s
14:10:09 [build] Complete!
```

Result: PASS, 5,570 total pages. The build emitted one warning:

```text
14:08:49 [WARN] [vite] "fly" and "fade" are imported from external module "svelte/transition" but never used in "../shared/components/WordPopup.svelte" and "../shared/components/Reader.svelte".
```

## 6. Built-site size

```text
$ du -sh app/dist
510M app/dist
$ du -sh app/dist/* | sort -rh | head -12
183M app/dist/lemma
177M app/dist/data
 27M app/dist/Laws
 22M app/dist/Republic
7.1M app/dist/Gorgias
6.2M app/dist/Theaetetus
5.7M app/dist/Timaeus
5.2M app/dist/Phaedo
5.1M app/dist/Philebus
4.9M app/dist/Statesman
4.9M app/dist/Cratylus
4.8M app/dist/Sophist
$ du -sh build/dist
177M build/dist
$ du -sh app/dist/lemma
183M app/dist/lemma
lemma share: 187540 KiB / 522328 KiB = 35.90%
```

Deploy decision note: lemma pages are 183M, 35.90% of `app/dist`, and account for 5,472 of 5,570 generated pages. John's open call on shipping lemma pages in the first deploy materially affects both artifact size and page count.

## 7. Link integrity

Exact invocation confirmed in `scripts/build-public.mjs`:

```text
$ node scripts/check-links.mjs app/dist
Pages crawled: 5570; links checked: 412373; anchors checked: 316074; broken: 0
```

Result: PASS.

## Addendum (2026-07-11) — preflight fixes

The corpus preflight FAIL recorded in §3 (215 problems) has been resolved. The
215 fell into two classes, fixed independently. §3 above is left intact as the
record of the original finding.

### Fix 1 — scheme-dispatched manifest schema (203 problems)

`pipeline/plato_pipeline/preflight.py` was applying Bekker-manifest schema rules
to every work, including the 36 Stephanus manifests, which do not carry those
fields. `_validate_manifest_schema` now dispatches on the citation scheme
(`scheme.bekker_native`), exactly as stage1/stage2 already do, splitting into
`_validate_bekker_manifest_schema` and `_validate_section_manifest_schema` over
a shared `_validate_books_schema`. Rules changed for section (Stephanus) works:

- `work.english_translation` is no longer required (Bekker-only; Stephanus names
  the translation in the `english.primary` block).
- `bekker_range` and `chapters` objects are no longer required (Stephanus cites
  by section token and gets outline nav from `sections.json`, not a chapter
  div); if a section manifest does declare `bekker_range`, its `first_column` /
  `last_column` are validated as section tokens.
- `books[].start` / `books[].end` are validated as section tokens (a bare column
  `327a` or a full ref `2a1`, via `column_prefix_key`) instead of full Bekker
  refs, and ordered at (page, letter) granularity.
- `english.primary` (`id` / `name` / `model` / `file`) and the `section_spine`
  fingerprint (`count` int, 64-char `sha256`) are now required for section works.

Bekker rules are unchanged (guarded, not deleted): the two Bekker preflight
fixtures still pass. New pytest cases: a real Stephanus manifest
(Euthyphro / Republic) passes the schema; a broken one (bad section token,
deleted `section_spine`) fails. Suite: 84 → 86 passing.

### Fix 2 — empty token keys at quotation and morpheme edges (12 problems)

The 12 `token.k must be a non-empty string` failures were real data defects in
the stage-3 tokenizer's edge cleaner. Root cause: `’` (U+2019) is deliberately
kept by the edge strip because it doubles as the elision apostrophe (δ’, κατ’).
When it instead *closed* a quotation, the word's own trailing punctuation was
trapped between the word and the quote and never stripped — a comma / stop /
Greek question mark stuck to the word, which `to_beta_key` then could not
transliterate, so the token was emitted with no `k`:

- Apology 28c/28d/29e/30b — Homer quoted with `,’ .’ ;’` (and one opening `’Αὐτίκα`);
- Timaeus 22b(×3)/23d/25d — the Egyptian priest quoted with `.’ ;’ ,’`;
- Cratylus 405d(×2) — the meta-linguistic morphemes `"ὁμο-"` / `"ἀ-"` Socrates
  names, whose trailing hyphen (U+002D) was likewise un-transliterable.

Fix at the source (`stage3_tokenize.py`), never in emitted JSON: `_clean` now
peels a trailing apostrophe that is a closing quote — one NOT sitting directly
after a Greek *letter* (an elision apostrophe always follows the letter it
elides) — and re-strips the punctuation it exposed; the hyphen-minus was added
to the edge-punctuation set. The Greek-letter test guards against U+037E GREEK
QUESTION MARK and U+0387 GREEK ANO TELEIA, which are named "GREEK …" but are
punctuation (category Po) and NFD-decompose to `;` / `·`. Leading apostrophes are
untouched, preserving the 50 legitimate aphaeresis forms (`'κείνως`, `'θέλειν`)
and the existing opening-quote keys (`’Πῶς`, `’Ὦ`). Apology / Cratylus / Timaeus
were rebuilt serially (`pipeline all --work …`): stage2 PASS, stage3
`key_failures=0`, and every affected genuine word now carries a resolving key;
the residual non-words (the `ὁμο` / `ἀ` prefixes, the quote-opening `’Αὐτίκα`)
render with a non-empty key as before.

### Re-verification

```text
$ env PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -p no:cacheprovider
============================== 86 passed in 0.39s ==============================

$ env PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m plato_pipeline.preflight ../build/dist ../manifests
preflight ok: validated ../build/dist against ../manifests
```

Corpus preflight: exit 0, zero problems.
