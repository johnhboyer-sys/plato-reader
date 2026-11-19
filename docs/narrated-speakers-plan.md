# Speakers in the narrated works — plan

Status: proposal, 2026-11-16. Nothing built, nothing run against the API yet.

## The problem

In the narrated works the Greek prints no speaker sigla, so the build has no speaker for
most rows and the search speaker filter (PR #42) leaves these works out.

| Work | Rows with no speaker | Shape |
|---|---|---|
| Republic | 4,222 of 4,222 | one row per Burnet paragraph |
| Phaedo | 591 of 625 | ΕΧ./ΦΑΙΔ. frame, then Phaedo narrates |
| Symposium | 236 of 241 | Apollodorus retells Aristodemus; long speeches |
| Parmenides | 545 rows, 843 dash turns, all unnamed | three-deep frame |
| Euthydemus | 112 rows, 435 dash turns | Crito frame, Socrates narrates |
| Protagoras | 116 rows, 249 dash turns | friend frame, Socrates narrates |
| Lysis | 82 rows, 228 dash turns | Socrates narrates |
| Charmides | 91 of 91 | Socrates narrates; a row often holds several exchanges |
| Lovers | 33 of 33 | Socrates narrates |

Greek cues alone will not do it. In the Republic, 830 rows carry a first-person inquit
(ἦν δ᾽ ἐγώ, ἔφην), 1,245 a third-person one (ἔφη, ἦ δ᾽ ὅς), and 1,670 carry no cue at
all. And ἔφη says only "not Socrates", not whether it is Glaucon or Adeimantus. Telling
who speaks takes a reader who follows the scene, so a model does the reading and code
checks it.

## What the model produces

The basic unit is a *voice segment*: a stretch of Greek, from a quoted start word to the
next segment's start, with a speaker and a kind.

```json
{ "row": "R1-0003", "words": "Ὦ Σώκρατες, δοκεῖτέ", "speaker": "polemarchus",
  "kind": "speech", "within": null }
```

- `kind` is `speech` (a character's own words), `narration` (the narrator telling the
  story), or `reported` (a voice quoted inside someone else's speech, as Diotima's
  words inside Socrates' speech in the Symposium).
- `within` names the reporting speaker for `reported` (Diotima → `socrates`).
- Short inquits (ἦν δ᾽ ἐγώ, ἔφη) stay inside the speech they interrupt. Only real
  storytelling becomes a `narration` segment. That keeps the output small and the
  anchors stable.
- Speakers are ids from a per-work cast list (`socrates`, `glaucon`, …), each with the
  display form the reader already uses for dialogue works ("Soc.", "Glauc.").

The model quotes the Greek words at each start; it never counts tokens. A script finds
each quote in the row's Greek (accents and case folded), in order, and turns it into a
position `{c, n, o}`. A quote that does not resolve exactly once is an error, not a
guess.

This records everything any later display or search choice needs, so the rulings below
change how the data is used, not what is collected.

## Where it lives

The model run is a one-time authoring step, not part of the build. Its output, after
checks and review, is committed as `sources/speakers/<Work>.json`: an editorial layer
beside `sources/perseus-grc`, keyed to TLG positions plus the quoted words (so a
re-export that shifts offsets is caught, not silently misapplied). The build reads that
file deterministically:

- `turns.build_para_flow` stamps each row (and each dash `sub`) with its speakers.
- stage6 emits `turn_bounds` from the segments, so the search speaker filter can take
  these works back in (lifting PR #42's exclusion).
- The reader gets an optional speaker label, designed in its own mockup round.

## The run

### Step A — cast sheets (one request per work, John reviews)

Opus reads the whole English of one work (the Republic's is about 200k tokens, inside
the 1M window) and writes a short sheet: the frame levels and narrator, the cast with
Greek name forms, and a scene map by Stephanus range (who is present, who answers).
Republic I, for example: Cephalus 328b–331d, Polemarchus 331d–336a, Thrasymachus
336b–354c; Books II–X, Glaucon and Adeimantus by turns. Each sheet is about a page and is
the place John's knowledge enters most cheaply. Nine requests.

### Step B — labelling (Message Batches, two passes)

A script cuts each work into windows of about 8k Greek tokens (roughly two to three
Stephanus pages), always at a row boundary. Each request carries:

- system: the instructions, the output schema, and the work's cast sheet (cached, since
  every window of a work shares it);
- user: the page before the window as context only ("do not label"), then the window's
  rows, each with its id, Stephanus reference, Greek (dashes kept), and the row's English.

Output is JSON through `output_config.format`, model `claude-opus-5-5`, adaptive
thinking, effort `high`. Pass 2 repeats the run with windows shifted by half a window,
so every row is read once near a window's start and once near its middle, where the
scene is clearest.

About 140 windows per pass across the nine works.

### Step C — checks (code, no model)

1. Every quote resolves exactly once, in order; the first segment of a row starts at the
   row's start; in dash works every dash starts a segment.
2. Every speaker is in the cast and present in that scene per the sheet.
3. Cue rules flag, never decide: a first-person inquit (ἦν δ᾽ ἐγώ, ἔφην) in a segment
   whose speaker is not the narrator; a vocative ὦ + name inside that name's own
   segment; ἔφη inside a narrator segment.
4. In two-person stretches, two segments in a row by the same speaker are flagged.
5. Pass 1 against pass 2: every disagreement is listed.
6. Against Perseus: the English TEI tags 1,300-odd speeches with `<said who=…>` (544
   Protagoras, 289 Euthydemus, 239 Lysis, 98 Symposium, 93 Phaedo, 41 Parmenides,
   24 Charmides). These tag the *opening* speaker of a span that can run on into the
   reply and the narration, so they check a segment's start, nothing more. The
   Republic's 4,902 `<q type="spoken">` spans carry no names but give the number of
   speeches per row, which the segment count should match. The model never sees these
   tags, so they stay a fair test.

### Step D — adjudication (a small third batch)

Each disagreement or flagged segment goes back to Opus with both readings, the flag that
fired, and two pages of context either way, asking for a choice and a one-line reason
quoting the Greek cue. What still disagrees after that goes to John.

### Step E — John's review, and the ship gate

A review page (Greek, English, proposed speaker, accept or correct) holding (a) every
residual case from D and (b) a stratified random sample of about 150 accepted rows
across all nine works. The gate: the sample shows at least 98% correct, or the failure
pattern is fixed and the affected works rerun. Corrections go into the committed file
by hand, recorded like any other source patch.

A caveat on independence: passes 1 and 2 and the adjudicator are all Opus, so their
agreement is not proof. The independent checks are the code rules, the Perseus tags,
and John's sample. If Codex has room after its weekly reset (Nov 19) a GPT pass over the
sample is a cheap second-family check.

## Cost and time

Measured: Republic Book I's Greek is 55,938 characters and 57,002 tokens (polytonic
Greek runs about one token per character); its English is 70,295 characters and 22,281
tokens. Across the nine works that is about 1.1M Greek and 0.4M English tokens.

| Step | Estimate at batch prices ($2 in / $10 out per M) |
|---|---|
| A cast sheets | about $5 |
| B pass 1 | about $4 input, $10–20 output (thinking is the unknown) |
| B pass 2 | the same |
| D adjudication | about $5 |
| Total | roughly $40–70 |

Most batches finish within an hour. The thinking volume is a guess; the pilot measures it.

## Pilot first

Before the full run: Charmides (small, rows holding several exchanges), Republic I
(Cephalus, Polemarchus, Thrasymachus), and Lysis (dash turns, 239 Perseus tags). About
$3–5. It tests the prompt, the quote matcher, and the checks, and reports agreement with
Perseus and between passes, so the full run's cost and error rate are measured, not
guessed.

## Pilot results (2026-11-16)

Scripts: `scripts/speakers/` (extract, cast, label, check, adjudicate, review); outputs
under `build/speakers-pilot/` (TLG-derived, never committed). Review page:
https://claude.ai/artifact/S1ZxQCt9tkCW619QgSTjKo

| | Charmides | Lysis | Republic I |
|---|---|---|---|
| Rows | 91 | 92 | 490 |
| Voices marked | 390 | 426 | 518 |
| Words the two passes agree on | 99.6% | 100% | 99.7% |
| Rows sent to adjudication | 26 | 17 | 18 |

- Cost: $5.52 at batch prices (passes $4.23, adjudication $1.29), plus about $1 for the
  three cast sheets. Prompt caching never hit inside the batch (all writes, no reads).
- Every quoted start resolved. The matcher must choose a row's anchors together, in
  order, preferring a capitalised word at a sentence start: a greedy first match put
  Charmides' answer Ταχύ on the lower-case ταχύ inside Socrates' question.
- Gaps: no joint voice for ἐφάτην (both boys at once), and quoted poets missing from the
  cast sheets. Both are cast-sheet fixes.
- The Lysis English is one turn out of step with the Greek in places (a defect of the
  current build, visible on the site), which is the source of both Perseus misses.
- Extrapolated to the nine works (1.1M Greek characters, about 7.6× the pilot's 144k):
  roughly $50, inside the earlier $40–70 estimate.
- The committed speaker file should not carry quoted Greek (the repo never commits
  TLG-derived text): store positions plus a short hash of the folded words as the drift
  check.

## John's rulings (2026-11-16)

1. **Narration is its own choice.** The speaker filter gets a "Narrator" chip; a
   character's name means only what he says in the scene.
2. **Quoted voices belong to the quoted voice.** Diotima's lines count as Diotima's;
   `within` keeps who quoted her for a possible later option.
3. **Scope is eleven:** the nine works plus the Apology's exchange with Meletus
   (24c–28a) and the Aspasia speech in the Menexenus (236d–249c).
4. **Joint answers carry both names** ("Lys. & Men.") and count for each speaker in
   search. Cast sheets get joint ids (e.g. `lysis+menexenus`) wherever a dual or plural
   verb marks a shared answer.

Reader display (old item 4 below) still waits for its mockup round.

## John's rulings (2026-11-17)

5. **The narrator's reports are not the narrator's words.** For search on "Socrates", what
   he reports others saying does not count as his. Three layers: the frame (live), the
   narrated dialogue (Thrasymachus in Socrates' narration counts as Thrasymachus), and
   voices recounted inside a speech (Sophocles in Cephalus, Er, Aspasia). The third layer
   carries the quoted name but is kept apart from the second, e.g. behind an "include
   recounted voices" option. The `reported` kind and `within` already record this.
6. **Diotima is the exception:** her lines count as hers, like a live speaker's, not as a
   recounted voice.
7. **Triage review by row shape.** Rows with one voice are the easy win and get tagged and
   accepted first; rows that mix voices (Socrates reports a remark and answers it in the
   same paragraph) are reviewed one by one. Pilot shape:

   | | One voice | Socrates + one other | Several others |
   |---|---|---|---|
   | Charmides (91) | 10 (3 adjudicated) | 74 (18) | 7 (5) |
   | Lysis (92) | 15 (4) | 70 (9) | 7 (4) |
   | Republic I (490) | 477 (14) | 9 (2) | 4 (2) |

   So the easy class is almost all of the Republic and little of Charmides and Lysis.
   Even one-voice rows can be wrong about *which* speaker (14 Republic rows went to
   adjudication), so the easy class still gets a sampled check, not a free pass.

## Error audit of the pilot (2026-11-17)

Every row the passes disagreed on or a check flagged (62 rows) was read. The passes
disagreed on 7 rows; the other 55 went to adjudication on flags alone, and 51 of those
flags were false alarms. Error classes and the fix for each:

| Class | Pilot cases | Fix |
|---|---|---|
| Bare lead-in (Καὶ ὁ Γλαύκων,) split off or folded in by turns | Rep 328a1, 328b2; Charm 176a6 | prompt: fold into the speech |
| Verb of saying with no words (Οὐκ ἔφη, Συνέφη) as speech or narration | Rep 346c1 | prompt: narration |
| Self-naming inquit misread (ἐγώ, ὁ Πολέμαρχος → Socrates) | Rep 331d8 | prompt: a name in the inquit settles it |
| Where a quoted voice starts or ends (καὶ ὅς before Sophocles; Pindar's start; Socrates resuming after the Thracian) | Rep 329a1, 330d4; Charm 156c7 | prompt: quote starts at the quoted words, ends at the return to the reporter's voice |
| Imagined speakers labelled inconsistently | Charm 165c3, 165d3; Lysis (antilogikoi) | new kind `imagined`, credited to whoever imagines them |
| Joint answer (ἐφάτην) forced onto one boy | Lysis, 3 rows | cast sheets get joint ids; prompt requires them |
| Quoted poets missing from the cast (Solon, Homer, Hesiod) | Lysis, 3 rows | cast prompt lists every quoted poet |
| ¶ flag on narration running across paragraphs | 10 false alarms | check skips narration (1 flag left, a real case) |

No case of the main class we feared, Glaucon taken for Adeimantus or a turn slipped
by one, turned up in Book I; the full Republic (Books II–X) is where that gets tested.

## Test run (2026-11-17): Republic I–II and Phaedo

Fixed prompt, run folder `build/speakers-test` (`SPEAKERS_RUN=speakers-test`). Cost $6.48
at batch prices plus about $1 for the two cast sheets. Review page:
https://claude.ai/artifact/M3q1kYJ4hhnJxRNprR5CER

- Pass agreement: Republic 99.9% of words (805 of 808 rows), Phaedo 100% (623 of 625).
  All disagreements were about where a lead-in ends, none about who speaks.
- All seven pilot errors are fixed in the new Book I labels.
- Hackett running heads (`scripts/speakers/hackett.py`, never shown to the model): 24 of
  26 spreads agree; the two others are expected (bit parts left out of the head;
  Glaucon's long speech).
- Address check: of 76 turns where Socrates names whom he addresses, 68 are answered
  by that person, and the other 8 are correct readings.
- Extraction bug found and fixed: Burnet's unspaced dash (τρίχας—Αὔριον) glued a
  speech's first word to the word before it; three Phaedo speeches failed to anchor.

Open: imagined speakers ("someone might say", the Muses in Rep 8). Proposed: credit
them to whoever imagines them. Step A's cast sheets will list every recounted and
imagined voice per work with its Stephanus range, for John to rule on.

**First pass done 2026-11-16: see `narrated-speakers-scholarship.md`.** The question: the scholarship on whether
speech Socrates reports as narrator should be read as his own voice (his paraphrase or
shaping of what others said) or as evidence of the others' own words. This bears on
rulings 1 and 2, that is, on how narration and reported voices are attributed in search
and on the page. The data keeps both readings either way: every segment records
its narrator level and, for a reported voice, who quotes it.

## Rulings that were needed (kept for the record)

None block the pilot, since the data records all of it.

1. **Narration in search.** Does "Socrates" in the speaker filter include the
   Republic's narration and inquits, or is narration its own "Narrator" choice?
   Proposed: its own choice. It barely matters in the Republic, but in Phaedo and the
   Symposium the frames and narration are large.
2. **Reported voices.** Do Diotima's words count as Diotima's, as Socrates', or both?
   Proposed: Diotima by default, with `within` letting a "Socrates, including what he
   reports" option exist later.
3. **Scope.** The nine works above. Add Apology's exchange with Meletus (24c–28a)?
   Menexenus' Aspasia speech?
4. **Reader display.** Labels on every row, or only where the speaker changes; off or on
   by default; how to label a Charmides row that holds four exchanges. A mockup round,
   per the usual order: options, labelled mockups, then build.

## Practical notes

- The `ANTHROPIC_API_KEY` exported in the shell is rejected as invalid. The `ant` login
  profile works (it ran the token counts above); whether it can submit batches is
  untested. A working API key may be needed.
- The pipeline venv has no `anthropic` package. The labelling scripts live outside the
  build (`scripts/speakers/`) with their own small environment, so the build itself gains
  no dependency.
