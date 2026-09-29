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
