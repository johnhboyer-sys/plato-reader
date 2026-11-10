import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The search results print with their citations and texts, without the
// controls. The test environment prints nothing, so this reads the rules:
// the @media print block of the global stylesheet.
const CSS = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../styles/global.css'), 'utf-8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
function printBlock(): string {
  const start = CSS.indexOf('@media print');
  let depth = 0;
  for (let i = CSS.indexOf('{', start); i < CSS.length; i++) {
    if (CSS[i] === '{') depth++;
    else if (CSS[i] === '}' && --depth === 0) return CSS.slice(start, i + 1).replace(/\s+/g, ' ');
  }
  throw new Error('unclosed @media print');
}
const rules = [...printBlock().matchAll(/([^{}]*)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }));
const hidden = rules.filter(r => /display:\s*none/.test(r.body)).flatMap(r => r.sel.split(',').map(s => s.trim()));

describe('printing the search results', () => {
  it('hides the controls', () => {
    for (const sel of ['.search-form', '.search-page .sx-row', '.search-page .pager', '.search-page .export-btn', '.search-page .inst-more', '.search-page .group-head .caret']) {
      expect(hidden).toContain(sel);
    }
  });

  it('keeps the text: no citation, Greek, English or label is hidden', () => {
    for (const sel of hidden) expect(sel).not.toMatch(/inst-ref|inst-snippet|inst-pair|sx-tr|book-header|group-label|\.lab\b|\.cite\b/);
  });

  it('marks a hit without a background, and keeps an instance on one page', () => {
    const mark = rules.find(r => /\bmark\b/.test(r.sel) && /search-page/.test(r.sel));
    expect(mark?.body).toMatch(/background:\s*none/);
    expect(mark?.body).toMatch(/text-decoration:\s*underline|font-weight/);
    expect(rules.some(r => r.sel.includes('.instance') && /break-inside:\s*avoid/.test(r.body))).toBe(true);
  });
});
