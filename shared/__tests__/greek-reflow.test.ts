import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The defect this guards (Republic V, reported 2026-08-18): the Both-view Greek
// reflow shipped inside `@media (max-width: 680px)`, so every window wider than
// a phone kept the OCT's hard line breaks. An OCT line is ~57 characters and the
// Both-view Greek column holds fewer, so half the lines wrapped to an orphan
// word — 944 of Republic V's 1,413 lines at a 746px window — and the English
// column sat under ~19,000px of blank slack waiting for the Greek to catch up.
// A width-scoped reflow is therefore the bug itself, not an implementation
// detail: assert the rule's scope, since no DOM test here can measure layout.
// happy-dom leaves import.meta.url schemeless, so resolve off the run root —
// `shared/` under this package's own vitest, the repo root under the app's.
const sheet = ['styles/global.css', 'shared/styles/global.css']
  .map((rel) => resolve(process.cwd(), rel))
  .find(existsSync);
const css = readFileSync(sheet as string, 'utf8');
// Comments in this sheet quote selectors and @media conditions, so strip them
// before scanning structure (keep length-neutral padding out of it — the scan
// only needs the brace/at-rule skeleton).
const code = css.replace(/\/\*[\s\S]*?\*\//g, '');

const REFLOW = '.reader-body.stephanus.view-both .turn-flow .greek-col .greek-line { display: inline;';

// The innermost @media conditions wrapping `needle`, outermost first. Counts
// braces from the top of the sheet — global.css nests media queries one deep.
function enclosingMedia(needle: string): string[] {
  const at = code.indexOf(needle);
  expect(at, `rule not found: ${needle}`).toBeGreaterThan(-1);
  const open: string[] = [];
  const re = /@media([^{]*)\{|\{|\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) && m.index < at) {
    if (m[0] === '}') open.pop();
    else open.push(m[1] ? m[1].trim() : '');
  }
  return open.filter(Boolean);
}

describe('Both-view Greek reflow', () => {
  it('applies at every viewport width (no width-scoped media query)', () => {
    const media = enclosingMedia(REFLOW);
    expect(media.some((q) => /width/.test(q))).toBe(false);
  });

  it('is screen-only, so print keeps one OCT line per printed line', () => {
    expect(enclosingMedia(REFLOW)).toEqual(['screen']);
  });

  it('separates the reflowed lines with a space', () => {
    expect(css).toContain(
      '.reader-body.stephanus.view-both .turn-flow .greek-col .greek-line::after { content: " "; }',
    );
  });

  it('is scoped to lineless works, so a line-cited sheet cannot inherit it', () => {
    // Shared machinery: in a Bekker or verse work the line IS the citation
    // unit, and reflowing it would dissolve the citation.
    expect(css).toContain('.reader-body.stephanus.view-both .turn-flow .greek-col .greek-line { display: inline;');
  });

  it('positions the Greek column, so the section ticks keep a containing block', () => {
    expect(css).toContain('.reader-body.view-both .turn-flow .greek-col { position: relative; }');
  });
});
