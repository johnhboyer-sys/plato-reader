import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The defect this guards (John, 2026-11-09; in the page since the 2026-10-27
// redesign): in the speaker filter, the chosen box of "Anyone / Only these
// speakers / Anyone but these" sat 3.5px below the other two. The row aligns
// its options by baseline, and the chosen box drew its blue square as a
// ::before child. A box with a child takes its baseline from the child, an
// empty box from its own bottom edge, so the two could not sit level. The
// test environment lays nothing out, so this reads the rule itself: the mark
// must be painted on the box, not put inside it.
const SEARCH = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../components/Search.svelte'), 'utf-8');
// Whitespace collapsed: a selector may break across lines.
const style = SEARCH.slice(SEARCH.lastIndexOf('<style')).replace(/\s+/g, ' ');

describe('the search page\'s choice boxes', () => {
  const boxes = ['.ck input', '.combo-check input', '.mode-group input'];

  it('give a chosen box no child, so it keeps the baseline of an empty one', () => {
    // No box on this page draws its mark as a child, however it is selected.
    expect(style).not.toMatch(/input\s*:checked\s*::?(before|after)/);
  });

  it('paint the chosen mark as a background on the box itself', () => {
    const rule = /([^{}]*)\{([^{}]*)\}/g;
    const chosen = [...style.matchAll(rule)]
      .filter(m => !m[1].includes('::') && boxes.every(box => m[1].includes(`${box}:checked`)));
    expect(chosen).toHaveLength(1);
    expect(chosen[0][2]).toMatch(/background:[^;]*var\(--accent\)/);
  });
});

// John, 2026-11-09: in the Forms row the headwords sat below the forms. The
// row aligned by baseline, and a form's label took its baseline from its tick
// box, the first thing in it, not from its word. Centred, the headword and
// the forms (one font, one size) share a line.
describe("the search page's Forms row", () => {
  it('centres its items, as the Grammar row does', () => {
    const rule = /([^{}]*)\{([^{}]*)\}/g;
    const rows = [...style.matchAll(rule)].filter(m => /(^|[\s,}])\.sx-forms\s*$/.test(m[1].trim()) || /\.sx-forms\s*,/.test(m[1]));
    expect(rows.some(m => /align-items:\s*center/.test(m[2]))).toBe(true);
  });
});

// A proximity hit shades the stretch from its first term to its last. The
// shade and a mark are one colour on this page, so inside the shade a term
// needs more than its background to stand out.
describe('a proximity hit', () => {
  it('marks its terms with more than the shade they stand in', () => {
    const rule = /([^{}]*)\{([^{}]*)\}/g;
    const inShade = [...style.matchAll(rule)].filter(m => /\.prox\)?\s+:?(global\()?mark/.test(m[1]) || /\.prox mark/.test(m[1]));
    expect(inShade).toHaveLength(1);
    expect(inShade[0][2]).toMatch(/box-shadow|text-decoration|border-bottom/);
  });
});
