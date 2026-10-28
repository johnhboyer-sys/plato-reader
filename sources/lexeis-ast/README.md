# Lexeis: Ast's *Lexicon Platonicum* headwords

`headwords.json` lists the 10,588 headwords of Friedrich Ast's *Lexicon Platonicum* (1835–38) as Lexeis shows them (<https://lexeis.org/plato/>, Cornell; directed by Jeffrey Rusten). It was harvested on 2026-10-27 from the site's own A–Ω word lists. It holds headwords only: no definitions, short glosses or citations.

The list exists so that `scripts/build-lexeis-ast.mjs` can write `app/lexeis-ast.json`, which lets each lemma page link to the word's entry on lexeis.org. To refresh the list from the live site and rebuild the table, run `node scripts/build-lexeis-ast.mjs --harvest`. Neither the site build nor the reader ever contacts lexeis.org.

Lexeis publishes no licence for its data, so we link to it and copy none of its text (`docs/ast-lexicon-platonicum-research.md`).
