import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The footer's row of links to the other readers. John, 2026-11-10: the search
// page does not need it. Astro components are not rendered here, so these read
// the source.
const src = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(join(src, path), 'utf-8');
const astro = (dir: string): string[] => readdirSync(join(src, dir), { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? astro(join(dir, e.name)) : e.name.endsWith('.astro') ? [join(dir, e.name)] : []);

describe('SiteFooter', () => {
  it('prints the other readers unless a page asks it not to', () => {
    const footer = read('components/SiteFooter.astro');
    expect(footer).toMatch(/const \{ sisters = true \} = Astro\.props;/);
    expect(footer).toMatch(/\{sisters && \(\s*<div class="foot-sisters">/);
    expect(footer.match(/class="foot-sibling"/g)).toHaveLength(3);
  });

  it('is asked not to on the search page, and only there', () => {
    const without = [...astro('pages'), ...astro('components')].filter(f => /<SiteFooter\s+sisters=\{false\}\s*\/>/.test(read(f)));
    expect(without).toEqual(['pages/search.astro']);
    expect(read('pages/search.astro')).not.toMatch(/<SiteFooter\s*\/>/);
  });
});
