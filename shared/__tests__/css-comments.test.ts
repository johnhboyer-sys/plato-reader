import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The defect this guards (found 2026-09-17, in the sheet since 2026-08-31): a
// comment that named the grammata class prefixes as ".t8-*/.gt8-*" closed
// itself at that "*/". The rest of the sentence became the head of the next
// selector, so browsers dropped the whole .grammata-mount rule and the
// dictionary entry never got our theme tokens. esbuild only warned; Lightning
// CSS (Vite 8, Astro 7) fails the build on it.
const SHEET = resolve(dirname(fileURLToPath(import.meta.url)), '../styles/global.css');

// A scanner that knows where it stands. A regex cannot do this job: it lets an
// unterminated comment through, and it cannot tell a real "*/" from one that is
// string content (`content: "*/"`). Both matter here -- an early close is the
// defect, and a quoted "*/" would be a false alarm.
function scan(css: string) {
  let code = '';
  const unterminated: string[] = [];
  const strays: number[] = [];
  let i = 0;
  while (i < css.length) {
    const pair = css.slice(i, i + 2);
    if (pair === '/*') {
      const end = css.indexOf('*/', i + 2);
      if (end === -1) {
        unterminated.push(css.slice(i, i + 48));
        break;
      }
      i = end + 2;
      continue;
    }
    if (pair === '*/') {
      // Reached outside any comment: whatever opened it closed early.
      strays.push(i);
      code += pair;
      i += 2;
      continue;
    }
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== ch) j += css[j] === '\\' ? 2 : 1;
      code += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    code += ch;
    i += 1;
  }
  return { code, unterminated, strays };
}

const css = readFileSync(SHEET, 'utf8');
const { code, unterminated, strays } = scan(css);

function where(offset: number) {
  const line = css.slice(0, offset).split('\n').length;
  return `line ${line}: ${css.slice(Math.max(0, offset - 60), offset + 10).split('\n').pop()}`;
}

describe('global.css comments', () => {
  it('every comment terminates', () => {
    expect(unterminated).toEqual([]);
  });

  it('no comment closes early', () => {
    expect(strays.map(where)).toEqual([]);
  });

  it('the grammata tokens sit under a selector a browser accepts', () => {
    const rule = code.match(/([^{}]*)\{([^{}]*--grammata-fg:[^{}]*)\}/);
    expect(rule?.[1].trim()).toBe('.grammata-mount');
    // The whole styling contract, not just the one property we matched on.
    for (const token of ['greek', 'fg', 'muted', 'border', 'accent']) {
      expect(rule?.[2]).toContain(`--grammata-${token}:`);
    }
  });
});
