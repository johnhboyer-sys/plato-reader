# Perseus TEI milestone patches

These source repairs add omitted English Stephanus section milestones.  Greek
incipits were checked against `build/export/Diogenes-Resources/xml/tlg/`.

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
