# Shared reader notes (moved from the root CLAUDE.md; loads when working under shared/)

- turnFlow data contract (post fix-round-1): `kind:"para"` = narrated paragraph flow
  (Republic, Apology, Charmides, Letters, Lovers); FlowTurn optional `ep` (paragraph offsets),
  `et` (embedded speeches), `sub` (stacked one-sided speeches on section-anchored rows).
  A para row for a pinned frame turn (Phaedo) carries `s`/`d` AND `et:[{o:0,…}]` — the `et`
  block is what makes the reader print the lead-in on a para-flow row.
  Types in shared/lib/data.ts; renderer in Reader.svelte flowRowsView.
