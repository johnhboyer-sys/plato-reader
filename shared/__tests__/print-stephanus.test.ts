import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The defect this guards (reported 2026-08-21): printing the English-only view
// produced pages with NO Stephanus numbers at all. The section tokens are
// margin markers positioned OUTSIDE their column box (.sect-num right-anchored
// past the prose edge, .eng-tick and the Greek-only .sect-tick at left:-2.6rem);
// on screen they land in the slack of the centred column (max-width:42rem +
// margin:0 auto), and the print sheet drops exactly that slack
// (max-width:none; margin:0) so every token fell off the printable page and was
// silently clipped — a printed dialogue carried no citation whatsoever.
// The fix pads the flow in print instead of moving the markers, so each token
// keeps the line it marks. No DOM test here can measure layout (happy-dom has
// none), so — as in greek-reflow.test.ts — assert the rule's scope and the one
// numeric invariant that matters: the gutter is never narrower than the
// overhang it has to hold.
const sheet = ['styles/global.css', 'shared/styles/global.css']
  .map((rel) => resolve(process.cwd(), rel))
  .find(existsSync);
const css = readFileSync(sheet as string, 'utf8');
// Comments quote selectors and lengths, so scan the code, not the prose.
const code = css.replace(/\/\*[\s\S]*?\*\//g, '');

const GUTTER_TOKEN = '.reader-body.stephanus { --sect-gutter:';
const ENGLISH_GUTTER = '.reader-body.stephanus.view-english .turn-flow {';
const GREEK_GUTTER = '.reader-body.stephanus.view-greek .turn-flow { padding-left:';

// The innermost @media conditions wrapping `needle`, outermost first.
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

// The declaration block of the first rule whose selector list contains `sel`.
function declsOf(sel: string): string {
  const at = code.indexOf(sel);
  expect(at, `rule not found: ${sel}`).toBeGreaterThan(-1);
  const open = code.indexOf('{', at);
  return code.slice(open + 1, code.indexOf('}', open));
}

/** rem lengths in a declaration, e.g. "-2.6rem" -> 2.6 */
function rems(decl: string): number[] {
  return [...decl.matchAll(/-?([\d.]+)rem/g)].map((m) => Math.abs(parseFloat(m[1])));
}

/** The fixed floor of a `max(<length>, calc(...))` gutter, in rem. */
function maxFloor(decl: string): number {
  const m = decl.match(/max\(\s*([\d.]+)rem/);
  expect(m, `no max() floor in: ${decl.trim()}`).not.toBeNull();
  return parseFloat((m as RegExpMatchArray)[1]);
}

describe('Stephanus tokens in the single-column print views', () => {
  it('gives the English-only flow a print gutter', () => {
    expect(enclosingMedia(ENGLISH_GUTTER)).toEqual(['print']);
  });

  it('gives the Greek-only flow a print gutter', () => {
    expect(enclosingMedia(GREEK_GUTTER)).toEqual(['print']);
  });

  it('scopes both gutters to Stephanus works', () => {
    // Shared machinery: a Bekker work's English gutter lives INSIDE
    // .overlay-prose's own padding (.bk-num is left:0 within it), so it already
    // prints correctly and must not be indented a second time.
    for (const sel of [ENGLISH_GUTTER, GREEK_GUTTER]) {
      expect(sel.startsWith('.reader-body.stephanus')).toBe(true);
    }
  });

  it('never lets the gutter fall short of the fixed .eng-tick overhang', () => {
    // .eng-tick hangs at left:-2.6rem in a rem-sized face, so it does not
    // shrink with the Text-size slider: the gutter's FLOOR — max()'s first
    // argument, the branch that wins at the small end of the slider — has to be
    // at least that wide.
    const overhang = Math.max(...rems(declsOf('.reader-body.view-english .turn-flow .eng-tick {')));
    const floor = maxFloor(declsOf(GUTTER_TOKEN));
    expect(floor).toBeGreaterThanOrEqual(overhang);
  });

  it('never lets the Greek gutter fall short of its tick overhang', () => {
    const overhang = Math.max(
      ...rems(declsOf('.reader-body.view-greek .turn-flow .sect-tick {')),
    );
    const gutter = Math.min(...rems(declsOf(GREEK_GUTTER)));
    expect(gutter).toBeGreaterThanOrEqual(overhang);
  });

  it('scales the English gutter with the Text-size slider', () => {
    // .sect-num is em-relative (font-size: 0.66em), so at the slider's 140%
    // stop a fixed gutter starves it and the token clips at the page edge —
    // the same starvation the mobile screen rule already guards against.
    const decl = declsOf(GUTTER_TOKEN);
    expect(decl).toMatch(/max\(/);
    expect(decl).toContain('--fs-english');
    // Both consumers read the one measured width, so they cannot drift apart.
    expect(declsOf(ENGLISH_GUTTER)).toContain('var(--sect-gutter)');
  });

  it('widens the compare gutter so the second column\'s tokens clear the first', () => {
    const sel = '.reader-body.stephanus.trans-compare.view-english .seg-row {';
    expect(enclosingMedia(sel)).toEqual(['print']);
    expect(declsOf(sel)).toContain('var(--sect-gutter)');
  });

  it('prints the tokens in ink rather than the theme\'s muted grey', () => {
    // --text-light is a pale grey under the dark theme and would wash out on
    // white stock; the pinned rules must outrank the screen ones, which are all
    // .turn-flow-qualified (and .hl, which survives a click until mouseleave).
    const pin = declsOf('.turn-flow .sect-tick, .turn-flow .sect-num, .turn-flow .sect-letter,');
    expect(pin).toContain('#7a7264');
    expect(code).toContain('.turn-flow .sect-tick.hl, .turn-flow .sect-letter.hl { color: #7a7264; }');
  });
});
