# corpus/greek

The Greek text the site is built from: one file per work, one printed line of
the edition per row. The build reads these files for every work's Greek. This
folder holds them and this page, and nothing more.

## Format

UTF-8, tab-separated, one row per printed line, in reading order.

```
# work: Euthyphro
# edition: Burnet, Platonis Opera vol. 1 (OCT, 1900)
# columns: Stephanus-page	section	n	text
2	a	1	{ΕΥΘ.} Τί νεώτερον, ὦ Σώκρατες, γέγονεν, ὅτι σὺ τὰς ἐν
```

- The `# columns:` line names the fields: the Stephanus page (`2`), the
  section letter (`a`), the line's number within the section, and the line.
- `n` is the line's number as printed, or `t` for the heading of a letter.
- The text is the line as the edition prints it, with runs of white space made
  one space. Hyphens at line ends, editors' brackets, daggers, and Greek
  punctuation are kept; `pipeline/plato_pipeline/stage1_greek.py` parses them.
- A speaker's label (`ΣΩ.`, `ΕΥΘ.`, or the dash that opens a reply) stands in
  braces where the edition prints it. Stage 1 takes it out of the text and
  records where that speaker's words begin.

## Editions

Each file's second line names its edition, taken from the work's manifest
(`manifests/<Work>.yaml`, `work.greek_edition`).

## Licence

Not yet stated. The plan names CC0 1.0 for these files; the licence is the
repository owner's to add.

## Making the files

`python -m plato_pipeline.extract --all` (in `pipeline/`) writes them from the
digital source texts, on a machine that holds those. The source's own files
are never committed to this repository.
`pipeline/tests/test_corpus_greek.py` checks every file here on each test run:
every letter of every line must be Greek.
