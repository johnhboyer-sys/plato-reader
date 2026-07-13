# Handoff: port the "word sidebar uses the page margin" fix to aristotle-reader

**Written from plato-reader, 2026-07-13 (Plato's 13th deploy).** aristotle-reader is
the sister project plato-reader was bootstrapped from — same pipeline/shared/app
architecture, same reader components — so the same bug almost certainly exists there.
Do this work **in the aristotle-reader repo/session**, not from plato-reader.

---

## The bug (as reported on Plato)

Clicking a Greek word opens the LSJ/lexicon **word sidebar**. The panel is a fixed
overlay, but the reader was inset with a big `padding-right` while it was open, which
**shrank the reading text into tight columns** — even on wide screens where the panel
already sits over empty page margin. A user's words: *"the panel should take up the
margin's space, not the text's space."*

## Root cause (Plato — verify the analogue in Aristotle)

Two rules combine in `shared/styles/global.css`:

- `.reader-body` is a centred, max-width-capped box: `max-width: calc(1080px * var(--colw-scale,1)); margin: 0 auto;`
- `.reader-body.word-open` added `padding-right: calc(min(22rem,86vw) + 1rem)` **inside**
  that centred box → insets the columns unconditionally, at every width.

The class `word-open` is toggled on `.reader-body` in `shared/components/Reader.svelte`
(`class:word-open={!!popup}`), and the panel itself (`.word-sidebar`) is
`position: fixed; right:0` — i.e. it never needed the content to move on a wide screen.

## The fix (Plato's final CSS — the shape to replicate)

Replace the unconditional inset with a **margin reserve** that only engages when the
viewport can't already fit the panel in the margin:

```css
/* The word sidebar is a fixed overlay pinned to the right edge. On a wide screen it
   sits in the empty page margin beside the centred reading measure, so opening it
   must NOT reflow the text. Below ~1800px, rather than shrink the centred measure,
   reserve the panel's strip as a right margin: margin-left:auto then keeps the widest
   measure that still clears the panel, sliding the text left into the margin and only
   narrowing once the viewport genuinely can't hold both. Below 681px the sidebar is a
   bottom sheet, so this band starts there. Works for every reading mode (Greek-only,
   Both, 3-col compare) because the reserve is on .reader-body, the shared box that caps
   ALL column layouts at the same measure. */
@media (min-width: 681px) and (max-width: 1800px) {
  .reader-body.word-open {
    margin-right: calc(min(22rem, 86vw) + 1rem);
    transition: margin-right 0.22s ease;
  }
}
```

Delete the old `.reader-body.word-open { padding-right: … }` rule. Keep the mobile
(`≤680px`) bottom-sheet block as-is.

### Why a margin, not padding
`margin-right` reserves the panel strip *outside* the box; `margin-left:auto` then keeps
the box at its full measure whenever `viewport − panel ≥ measure`, and shrinks it
gracefully (never clipping, never overflowing) only when it can't fit. Padding shrinks
the interior every time regardless of available margin.

---

## What you MUST re-derive for Aristotle (do not copy the numbers blind)

1. **`.reader-body` measure.** Confirm Aristotle's `.reader-body` `max-width` (Plato =
   `1080px`). If it differs, the threshold changes.
2. **Panel width.** Confirm `.word-sidebar` width (Plato = `min(22rem, 86vw)` → 352px at
   16px root). If it differs, use Aristotle's value in the `margin-right` calc AND in the
   threshold.
3. **Threshold = measure + 2 × panelWidth.** Plato: `1080 + 2×352 = 1784`, rounded up to
   **1800px** (so the panel clears the centred box with a hair of margin). Recompute for
   Aristotle and round up similarly. This is the `max-width` in the media query.
4. **Class/element names.** Verify `.reader-body`, `.reader-body.word-open`,
   `.word-sidebar`, and the `class:word-open={!!popup}` binding all exist with these names
   (they should — shared lineage — but confirm; Aristotle may have drifted).
5. **Bottom-sheet breakpoint.** Confirm Aristotle's mobile sidebar breakpoint is also
   `680px`; adjust the `min-width: 681px` lower bound if not.

## Verify functionally (no screenshots), across ALL view/compare modes

Aristotle has the same view modes (Greek-only / English-only / Both) and the
translation-**compare** mode (2-col english-compare, 3-col Greek+2-trans) — the compare
UI actually originated in aristotle-reader. Check every mode where the panel can open
(the panel opens from a **Greek** token, so English-only view can't raise it — skip that
combo).

Use the headless setup from CLAUDE.md (playwright-core + the chromium
`chrome-headless-shell`; no desktop Chrome, so the Playwright MCP won't work). Drive a
reader page, click a `.seg-row .tok`, and assert on the **rightmost** reading column
(closest to the panel):

- **≥ threshold (e.g. 1920px):** rightmost column width unchanged before vs after opening
  the panel (no shrink).
- **all widths:** `columnRight ≤ panelLeft` (panel never covers text) and
  `document.documentElement.scrollWidth ≤ innerWidth` (no horizontal overflow).
- **below threshold (e.g. 1400px):** column narrows *gracefully* and still isn't covered.

A ready-to-adapt probe lives in this session's scratchpad as `panel-modes.mjs` (measures
the last `.seg-row .greek-col/.english-col/.ross-col` before/after a token click across
widths and modes). Reproduce its logic; point it at Aristotle's compare URL. Compare mode
is reachable via `?trans=compare&view=both` (and `&view=english` for 2-col) on a work that
has ≥2 translations.

Expected Plato results (your Aristotle numbers should show the same *pattern*):

| mode | 1920px | 1400px | covers text? | h-overflow |
|---|---|---|---|---|
| Both (2-col) | no shrink | slight shrink | never | never |
| Compare (3-col) | no shrink | slight shrink | never | never |

## Ship it (aristotle-reader's own rules apply)

Follow aristotle-reader's CLAUDE.md / DEPLOY-STATUS for its branch → PR → build → deploy
gate and review-before-commit policy. This is a one-file, app-only CSS change (0 data
change); its deploy rebuilds only the CSS bundle + the HTML pages that reference it.

## Reference: the Plato change

- Commit `93af609a0` (fix) + `fed7fef0d` (comment) on plato-reader `main` (PR #16).
- File: `shared/styles/global.css`, the `.reader-body.word-open` rule.
- Deployed as Plato's 13th deploy; see `DEPLOY-STATUS.md`.
