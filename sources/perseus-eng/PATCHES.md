# Perseus TEI patches

These source repairs add omitted English Stephanus section milestones, and
restore words the TEI drops from the printed Loeb.  Greek incipits were checked
against `build/export/Diogenes-Resources/xml/tlg/`.

## Symposium — `181b`

- Greek incipit: `δημός ἐστι καὶ ἐξεργάζεται ὅτι ἂν τύχῃ·`
- English sentence preceded: “Now the Love that belongs to the Popular Aphrodite is in very truth popular and does his work at haphazard: this is the Love we see in the meaner sort of men; who, in the first place, love women as well as boys; secondly, where they love, they are set on the body more than the soul; and thirdly, they choose the most witless people they can find, since they look merely to the accomplishment and care not if the manner be noble or no.”

```diff
-<milestone ed="P" unit="para"/>Now the Love that belongs to the Popular Aphrodite …
+<milestone ed="P" unit="para"/><milestone unit="section" resp="Stephanus" n="181b"/>Now the Love that belongs to the Popular Aphrodite …
```

## Protagoras — `332c`

- Greek incipit: `βραδέως;`
- English sentence preceded: “slowly?” (the final word of “And whatever with swiftness, swiftly, and whatever with slowness, slowly?”)

```diff
-<milestone ed="P" unit="para"/>And whatever with swiftness, swiftly, and whatever with slowness, slowly ?
+<milestone ed="P" unit="para"/>And whatever with swiftness, swiftly, and whatever with slowness, <milestone unit="section" n="332c"/>slowly ?
```

## Hippias Major — `302d`

- Greek incipit: `ἀμφότεραί τ' εἰσὶ καλαὶ καὶ ἑκατέρα, ἆρα καὶ ὃ ποιεῖ αὐτὰς`
- English sentence preceded: “does not that which makes them beautiful belong to both and to each?”

```diff
-<milestone unit="section" resp="Stephanus" n="302e"/> does not that which makes them beautiful belong to both and to each?
+<milestone unit="section" resp="Stephanus" n="302d"/> does not that which makes them beautiful belong to both and to each?
```

## Ion — `539d`

- Greek incipit: `αὐτὸς δὲ κλάγξας πέτετο πνοιῇς ἀνέμοιο.`
- English sentence preceded: “and then with a cry flew off on the wafting winds.”

```diff
-… and dropped it down in the midst of the throng; and then with a cry flew off on the wafting winds.
+… and dropped it down in the midst of the throng; <milestone unit="section" resp="Stephanus" n="539d"/>and then with a cry flew off on the wafting winds.
```

## Cratylus — `391b`–`391c` (dropped text)

- Perseus drops Fowler's words from "They are the sophists," to "who reject the
  Truth", so the English ran "They are the sophists, of Protagoras altogether,
  should desire …" and lost Hermogenes' reply (the Greek's `ΕΡΜ.` at
  `Ἄτοπος μεντἂν εἴη μου`).
- Restored from Fowler, Plato VI (Loeb, 1926), p. 33, checked against the page
  image (archive.org `bwb_C0-AUM-874_6`, leaf n46) in the sister repo
  classical-philosophy-reader (`sources/perseus-plato/corrections.json`).
- Greek incipit of `391c`: `σου Καλλίας πολλὰ τελέσας χρήματα` — the milestone
  moves from after "the sophists," to before "Callias".
- Hermogenes' reply becomes its own `<said>`, so it is a real speaker turn; the
  Loeb note on *Truth* stays on its first occurrence, now in his reply.

```diff
-… by paying them money.  They are the sophists,
-<milestone n="391c" unit="section" resp="Stephanus"/><note anchored="true" resp="Loeb"><title>Truth</title> was the title of a book written by Protagoras.</note> of Protagoras altogether, …
+… by paying them money.  They are the sophists, from whom your brother
+<milestone n="391c" unit="section" resp="Stephanus"/>Callias got his reputation for wisdom by paying them a good deal of money.  But since you have not the control of your inheritance, you ought to beg and beseech your brother to teach you the correctness which he learned of Protagoras about such matters.</said></p>
+
+<p><said who="#Hermogenes"><label>Hermogenes.</label> It would be an absurd request for me, Socrates, if I, who reject the <title>Truth</title><note anchored="true" resp="Loeb"><title>Truth</title> was the title of a book written by Protagoras.</note> of Protagoras altogether, …
```

## Cratylus — `398c` (editorial note: lines the translator leaves out)

- Not a Perseus drop. Fowler's Greek (Plato VI, Loeb, 1926, p. 56) prints
  `ΣΩ. Οὐκ οἶσθα ὅτι ἡμίθεοι οἱ ἥρωες; ΕΡΜ. Τί οὖν;`, but his English (p. 57)
  goes from "What do you mean?" straight to "Why, they were all born" (archive.org
  `bwb_C0-AUM-874_6`, OCR text layer, checked 2026-09-29).
- The two Greek turns pair with no English and fold into Hermogenes' row, so a
  bracketed editorial note there says the omission is Fowler's (John, 2026-09-29).
  It sits inside his `<said>`, so it opens no turn.

```diff
-<p><said who="#Hermogenes"><label>Hermogenes.</label> What do you mean?
+<p><said who="#Hermogenes"><label>Hermogenes.</label> What do you mean? [Fowler does not translate the two lines that follow in the Greek: Socrates’ <foreign xml:lang="grc">Οὐκ οἶσθα ὅτι ἡμίθεοι οἱ ἥρωες;</foreign> and Hermogenes’ <foreign xml:lang="grc">Τί οὖν;</foreign>]
 <milestone n="398d" unit="section" resp="Stephanus"/></said></p>
```

## Gorgias — `506c`–`507b` (dash turns, markup only)

- Socrates argues both sides at 506c–507b, and Burnet prints each imagined
  question and answer as a dash turn (26 of them, often mid-line). Lamb's
  English runs them together as plain sentences inside Socrates' speeches, so
  none of the Greek dashes had an English turn to pair with and the passage
  read as two long rows.
- Each question or answer is now its own unlabelled `<said who="-">` (stage 1
  reads that as a null-speaker dash turn), split at the sentence that renders
  the Greek dash: 20 in the speech from "Give ear, then;" to "…do instruct
  me.", 6 in the speech from "I say, then," (the last runs to the speech's end).
- The Perseus page-break reopening at 507 (`<said who="#Socrates"
  rend="merge">`) becomes the first of those dash turns.
- The 506d, 506e and 507/507a milestones move from inside the split point to
  just before the new `<said>`, so no turn opens empty at a section's end.
- **No English character changes:** every chunk's text and notes are identical
  before and after (404 chunks compared).

```diff
-<said who="#Socrates"><label>Soc.</label> <p>Give ear, then; … Are the pleasant and the good the same thing?  Not the same, as Callicles and I agreed.  Is the pleasant thing …
+<said who="#Socrates"><label>Soc.</label> <p>Give ear, then; … Are the pleasant and the good the same thing?</p></said>
+
+<said who="-"><p>Not the same, as Callicles and I agreed.</p></said>
+
+<said who="-"><p>Is the pleasant thing …
```

## Laws X — `893b`–`894b` (dash turns, markup only)

- The same device as Gorgias 506c: the Athenian puts the questions and gives
  the answers himself, and Burnet prints each as a dash turn (10, from
  «Τὰ μὲν κινεῖταί που, φήσω» at 893b to the one that runs on to «πλήν γε, ὦ
  φίλοι, δυοῖν;» at 894b). Bury renders them as `<q type="spoken">` quotations
  inside the Athenian's speech.
- Each is now its own unlabelled `<said who="-">`, split where Bury's quotation
  begins; his framing words stay with the quotation they open ("My answer will
  be," with «φήσω», "we will say," with «φήσομεν»).
- The Perseus page-break reopening at 894 (`<said who="#Athenian" rend="merge">`,
  "Further, things increase…" to "…save only two?") becomes the last dash turn,
  as the Greek has it.
- **No English character changes:** every chunk's text and notes are identical
  before and after (1,591 chunks compared).

## Hippias Major — `295e` (two speakers in one said)

- Perseus runs Socrates' question into Hippias' reply: "It is.Soc, Then are we
  right in saying that the useful rather than everything else is beautiful?"
  Split into the Hippias and Socrates turns the Loeb prints (Plato VI, 1926).

```diff
-<said who="#Hippias"><label>Hipp.</label> <p>It is.Soc, Then are we right in saying …</p></said>
+<said who="#Hippias"><label>Hipp.</label> <p>It is.</p></said>
+
+<said who="#Socrates"><label>Soc.</label> <p>Then are we right in saying …</p></said>
```

## `rend="unpaired"`: a translator's turn the OCT has no turn for

Our own markup, not Perseus's. stage1 treats it like a page-break reopening: the
turn never pairs with a Greek turn and folds into the row before it. Without it,
an extra English exchange lets the pairing run an exchange off until the
English next falls short. No English text changes.

- **Hippias Major 294a.** Burnet brackets πότερα and runs Hippias' reply on;
  Fowler follows Apelt (his note: "the arrangement given above is due to
  Apelt"), printing Socrates' "Which?" and Hippias' "That which makes them appear
  beautiful". Both marked. Fowler also folds 297a5–7 (three Greek turns) into
  one Socrates turn; with 294a marked, the pairing skips two Greek turns there.
- **Laws IV 718c.** Burnet's Athenian asks himself ἔστιν δὲ δὴ τὰ τοιαῦτα ἐν
  τίνι μάλιστα σχήματι κείμενα; and answers in the same speech; Bury gives the
  question to Clinias ("What is the special form …?") and the answer to a new
  Athenian turn. Both marked; 714d–718d had paired an exchange early.

```diff
-<said who="#Socrates"><label>Soc.</label> <p>Which?</p></said>
+<said who="#Socrates" rend="unpaired"><label>Soc.</label> <p>Which?</p></said>
-<said who="#Hippias"><label>Hipp.</label> <p>That which makes them appear beautiful; …
+<said who="#Hippias" rend="unpaired"><label>Hipp.</label> <p>That which makes them appear beautiful; …
-<p><said who="#Clinias"><label>Clin.</label> What is the special form …
+<p><said who="#Clinias" rend="unpaired"><label>Clin.</label> What is the special form …
-<p><said who="#Athenian"><label>Ath.</label> It is by no means easy to embrace them all …
+<p><said who="#Athenian" rend="unpaired"><label>Ath.</label> It is by no means easy to embrace them all …
```
