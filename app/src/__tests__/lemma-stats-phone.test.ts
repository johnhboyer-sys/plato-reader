import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The lemma statistics table on a 390px phone (John, 2026-11-11): five columns
// in 350px with no sideways scroll. Each row's rate bar leaves the rate cell
// for a thin full-width line under the row, the headers wrap, the cells pad
// less. The headless check (.ls-wrap scrollWidth <= clientWidth at 390px) is
// the layout proof; this pins the markup and the rules that make it.
const here = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(resolve(here, '../components/LemmaPage.astro'), 'utf-8');
const CSS = readFileSync(resolve(here, '../../../shared/styles/global.css'), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');

// Every rule inside every @media block whose query is exactly `query`.
function mediaRules(query: string): Map<string, string> {
  const out = new Map<string, string>();
  let at = 0;
  for (;;) {
    const i = CSS.indexOf(`@media ${query} {`, at);
    if (i === -1) return out;
    let depth = 0, j = CSS.indexOf('{', i);
    const start = j + 1;
    for (; j < CSS.length; j++) {
      if (CSS[j] === '{') depth++;
      else if (CSS[j] === '}' && --depth === 0) break;
    }
    for (const m of CSS.slice(start, j).matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      for (const sel of m[1].split(',')) out.set(sel.trim(), (out.get(sel.trim()) ?? '') + m[2]);
    }
    at = j;
  }
}

describe('Lemma statistics on a phone', () => {
  it('gives each work row and each book row a bar row under it, aria-hidden, spanning all five columns', () => {
    const workBar = /<\/tr>\s*<tr class="ls-barrow" aria-hidden="true"><td colspan="5"><span class="ls-bar" style=\{w\(r\.rate\)\}><\/span><\/td><\/tr>/;
    const bookBar = /<\/tr>\s*<tr class="ls-book ls-barrow" data-of=\{r\.work\} hidden aria-hidden="true"><td colspan="5"><span class="ls-bar" style=\{w\(b\.rate\)\}><\/span><\/td><\/tr>/;
    expect(PAGE).toMatch(workBar);
    expect(PAGE).toMatch(bookBar);
    // The rate cell keeps its bar for wider screens, on the same scale.
    expect(PAGE.match(/<td class="ls-rate">\{f2\((r|b)\.rate\)\}<span class="ls-bar" aria-hidden="true" style=\{w\(\1\.rate\)\}><\/span><\/td>/g)).toHaveLength(2);
    expect(PAGE).toMatch(/<th scope="col">Actual ÷ expected<\/th>/);
    expect(PAGE).toMatch(/<th scope="col">Per 1,000 words<\/th>/);
  });

  it('hides the bar rows above 480px, and at 480px swaps the in-cell bar for them', () => {
    expect(CSS).toMatch(/(^| )\.ls-barrow \{ display: none; \}/);
    const phone = mediaRules('(max-width: 480px)');
    expect(phone.get('.ls-rate .ls-bar')).toMatch(/display: none/);
    expect(phone.get('.ls-barrow:not([hidden])')).toMatch(/display: table-row/);
    expect(phone.get('.ls-barrow .ls-bar')).toMatch(/width: calc\(var\(--w, 0\) \* 100%\)/);
    expect(phone.get('.ls-table th')).toMatch(/padding: 0\.375rem 0\.25rem/);
    expect(phone.get('.ls-table td')).toMatch(/padding: 0\.375rem 0\.25rem/);
    // Smaller, less tracked headers: each wraps to two lines, no word broken.
    expect(phone.get('.ls-table thead th')).toMatch(/font-size: 0\.625rem; letter-spacing: 0\.08em/);
  });
});
