// Share cards: every work has its own (public/og/<Work>.jpg, from scripts/make-og-cards.mjs),
// 1200×630 as the og:image tags declare, drawn from that work's page, and its landing and
// book pages name it. Astro components are not rendered here, so the last test reads the source.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { WORKS } from '../../../shared/lib/works';
import { inscriptionCaps } from '../../../shared/lib/inscription';
import record from '../data/og-cards.json';

const app = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cards = record as Record<string, { title: string; greek: string; opening: string; sha256: string }>;
const sha = (f: string) => createHash('sha256').update(readFileSync(resolve(app, f))).digest('hex');

function jpegSize(b: Buffer): [number, number] {
  expect(b.readUInt16BE(0)).toBe(0xffd8);
  for (let p = 2; p < b.length;) {
    if (b[p] !== 0xff) { p++; continue; }
    const m = b[p + 1];
    if (m >= 0xc0 && m <= 0xc3) return [b.readUInt16BE(p + 7), b.readUInt16BE(p + 5)];
    p += 2 + b.readUInt16BE(p + 2);
  }
  return [0, 0];
}

describe('share cards', () => {
  it('has one 1200×630 card per work and no others', () => {
    expect(WORKS.length).toBe(36);
    expect(readdirSync(resolve(app, 'public/og')).sort()).toEqual(WORKS.map(w => `${w.id}.jpg`).sort());
    for (const w of WORKS) expect(jpegSize(readFileSync(resolve(app, `public/og/${w.id}.jpg`))), w.id).toEqual([1200, 630]);
  });

  it('draws each card from its own work, as recorded when it was drawn', () => {
    expect(Object.keys(cards).sort()).toEqual(WORKS.map(w => w.id).sort());
    for (const w of WORKS) {
      expect(cards[w.id].title, w.id).toBe(w.title);
      expect(cards[w.id].greek, w.id).toBe(inscriptionCaps(w.greekTitle ?? w.title));
      // The page's opening inscription: 12 × 4 letters.
      expect([...cards[w.id].opening].length, w.id).toBe(48);
      // A card swapped with another, or redrawn without its record, has another hash.
      expect(sha(`public/og/${w.id}.jpg`), w.id).toBe(cards[w.id].sha256);
    }
    expect(new Set(Object.values(cards).map(c => c.sha256)).size).toBe(WORKS.length);
    expect(new Set(Object.values(cards).map(c => c.opening)).size).toBe(WORKS.length);
  });

  it('points the landing and book pages at the work card', () => {
    for (const f of ['src/components/Landing.astro', 'src/components/ReaderShell.astro']) {
      const s = readFileSync(resolve(app, f), 'utf8');
      expect(s, f).toContain("existsSync(`public/og/${workId}.jpg`) ? `og/${workId}.jpg` : 'og-default.png'");
      expect(s, f).toMatch(/new URL\(`\$\{base\}\/\$\{ogCard\}`, Astro\.site\)/);
      expect(s, f).toContain('<meta property="og:image" content={ogImage} />');
      expect(s, f).toContain('<meta name="twitter:image" content={ogImage} />');
    }
  });
});
