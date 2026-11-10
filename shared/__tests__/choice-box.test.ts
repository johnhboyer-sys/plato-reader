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
const style = SEARCH.slice(SEARCH.lastIndexOf('<style'));

describe('the search page\'s choice boxes', () => {
  const boxes = ['.ck input', '.combo-check input', '.mode-group input'];

  it('give a chosen box no child, so it keeps the baseline of an empty one', () => {
    for (const box of boxes) {
      expect(style, box).not.toMatch(new RegExp(`${box.replace('.', '\\.')}:checked::(before|after)`));
    }
  });

  it('paint the chosen mark as a background on the box itself', () => {
    const rule = /([^{}]*)\{([^{}]*)\}/g;
    const chosen = [...style.matchAll(rule)]
      .filter(m => !m[1].includes('::') && boxes.every(box => m[1].includes(`${box}:checked`)));
    expect(chosen).toHaveLength(1);
    expect(chosen[0][2]).toMatch(/background:[^;]*var\(--accent\)/);
  });
});
