import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Compare works sits in a hidden tab. client:visible waited for the picker to
// scroll into view, so /phrases#compare on a short screen (844×390) opened
// dead. client:idle hydrates once the page settles; the component fetches
// nothing until two works are picked, so the page stays light.
const page = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../pages/phrases.astro'), 'utf-8');

describe('/phrases: Compare works', () => {
  it('hydrates without waiting to be scrolled into view', () => {
    expect(page).toMatch(/<CompareWorks client:idle /);
    expect(page).not.toMatch(/client:visible/);
  });
});
