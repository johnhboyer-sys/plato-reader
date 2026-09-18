import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The defect this guards (found 2026-09-17, in the sheet since 2026-08-31): a
// comment that named the grammata class prefixes as ".t8-*/.gt8-*" closed
// itself at that "*/". The rest of the sentence became the head of the next
// selector, so browsers dropped the whole .grammata-mount rule and the
// dictionary entry never got our theme tokens. esbuild only warned; Lightning
// CSS (Vite 8, Astro 7) fails the build on it.
const sheet = ['styles/global.css', 'shared/styles/global.css']
  .map((rel) => resolve(process.cwd(), rel))
  .find(existsSync);
const css = readFileSync(sheet as string, 'utf8');
const code = css.replace(/\/\*[\s\S]*?\*\//g, '');

describe('global.css comments', () => {
  it('no comment closes early', () => {
    // With every comment stripped, a leftover "*/" is the true end of a comment
    // that an earlier "*/" inside its prose cut short.
    expect(code).not.toContain('*/');
  });

  it('the grammata tokens sit under a selector a browser accepts', () => {
    const rule = code.match(/([^{}]*)\{[^{}]*--grammata-fg:/);
    expect(rule?.[1].trim()).toBe('.grammata-mount');
  });
});
