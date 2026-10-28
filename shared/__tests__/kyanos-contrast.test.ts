import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The Kyanos palette's contract (redesign, 2026-10-27): every speaker colour,
// and every text colour, reads at WCAG AA (4.5:1) on BOTH grounds of its theme
// — the stone page ground and the reading ground — by day and by night. The
// values are read from global.css itself, so a later retune cannot slip a
// failing hue past this.
const SHEET = resolve(dirname(fileURLToPath(import.meta.url)), '../styles/global.css');
const css = readFileSync(SHEET, 'utf8');

// Merge every top-level `:root {…}` (light) or `:root[data-theme="dark"] {…}`
// block's custom properties, later blocks winning as in the cascade.
function tokens(selector: ':root' | ':root[data-theme="dark"]'): Record<string, string> {
  const out: Record<string, string> = {};
  const head = selector === ':root' ? /^:root\s*\{/gm : /^:root\[data-theme="dark"\]\s*\{/gm;
  for (const m of css.matchAll(head)) {
    const body = css.slice(m.index! + m[0].length, css.indexOf('}', m.index!));
    for (const d of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  }
  return out;
}

const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function luminance(hex: string): number {
  expect(hex, `not a #rrggbb colour: ${hex}`).toMatch(/^#[0-9a-f]{6}$/i);
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = { light: tokens(':root'), dark: { ...tokens(':root'), ...tokens(':root[data-theme="dark"]') } };
const SPEAKERS = Array.from({ length: 8 }, (_, i) => `--spk-${i}`);
const TEXT = ['--text', '--text-mid', '--text-light', '--accent', '--accent-2'];

describe('Kyanos palette contrast', () => {
  for (const [name, t] of Object.entries(THEMES)) {
    for (const ground of ['--page-bg', '--col-bg']) {
      for (const fg of [...SPEAKERS, ...TEXT]) {
        it(`${name}: ${fg} on ${ground} reaches 4.5:1`, () => {
          expect(t[fg], `${fg} missing`).toBeDefined();
          expect(contrast(t[fg], t[ground])).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }

  // The other pairs the design puts on screen: text on the highlights (the
  // tapped word, search hits), the inverse buttons (stone on ink, on-accent on
  // the blue), hovers, and the focus ring (3:1, a UI part). A jumped-to line's
  // rule is --accent, checked on both grounds above.
  const PAIRS: [string, string, number][] = [
    ['--text', '--greek-active', 4.5], ['--text-mid', '--greek-active', 4.5], ['--accent', '--greek-active', 4.5],
    ['--text', '--hit-bg', 4.5], ['--text', '--mark-bg', 4.5],
    ['--page-bg', '--text', 4.5], ['--on-accent', '--accent', 4.5],
    ['--accent-light', '--page-bg', 4.5], ['--accent-light', '--col-bg', 4.5],
    ['--error', '--page-bg', 4.5], ['--error', '--col-bg', 4.5],
  ];
  for (const [name, t] of Object.entries(THEMES)) {
    for (const [fg, bg, min] of PAIRS) {
      it(`${name}: ${fg} on ${bg} reaches ${min}:1`, () => {
        expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(min);
      });
    }
  }

  it('keeps slot 0 the Kyanos blue and slot 1 the red-brown', () => {
    expect(THEMES.light['--spk-0']).toBe(THEMES.light['--accent']);
    expect(THEMES.light['--spk-1']).toBe(THEMES.light['--accent-2']);
    expect(THEMES.dark['--spk-0']).toBe(THEMES.dark['--accent']);
    expect(THEMES.dark['--spk-1']).toBe(THEMES.dark['--accent-2']);
  });
});
