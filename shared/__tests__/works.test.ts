import { describe, expect, it } from 'vitest';
import { WORKS, bookLabel, furtherReading, getWork, inPrintHref, isBookless, visibleTranslations, workLanding, workPath, type Work } from '../lib/works';

// A fixture multi-book Work exercises bookLabel/workPath's generic numbering
// logic without depending on a real registry entry — every Plato work carried
// so far is bookless (books: 1), so a fixture stands in for a multi-book work.
const multiBookFixture: Work = {
  id: 'FixtureMultiBook',
  title: 'Fixture Multi-Book Work',
  abbr: 'Fix.',
  author: 'Test',
  books: 10,
  bookLabels: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'],
  greekEdition: 'Test edition',
  greekSource: { short: 'Test', full: 'Test edition, full citation.' },
  translations: [{ id: 'test', name: 'Test Translator (Test, 1900)', short: 'Test', slot: 'english' }],
  blurb: 'A fixture multi-book work for exercising bookLabel/workPath generic logic.',
};

describe('works registry helpers', () => {
  it('normalizes book labels using a fixture multi-book work', () => {
    expect(bookLabel(multiBookFixture, 1)).toBe('I');
    expect(bookLabel(multiBookFixture, 99)).toBe('99'); // out of range -> falls back to the raw number
  });

  it('clamps workPath to a real registry work\'s book range', () => {
    const euthyphro = getWork('Euthyphro');
    expect(euthyphro?.books).toBe(1);
    expect(workPath('Euthyphro', 99)).toBe('/Euthyphro/book/1');
    expect(workPath('Euthyphro', -3)).toBe('/Euthyphro/book/1');
    expect(workLanding('Euthyphro')).toBe('/Euthyphro');
  });

  it('reports bookless works and visible translations', () => {
    const euthyphro = getWork('Euthyphro');
    expect(euthyphro && isBookless(euthyphro)).toBe(true);
    expect(euthyphro && visibleTranslations(euthyphro).every((t) => !t.private)).toBe(true);
    expect(WORKS.length).toBeGreaterThan(10);
  });

  it('adds runtime extra translations without mutating the registry entry', () => {
    const euthyphro = getWork('Euthyphro')!;
    (globalThis as { __ARISTOTLE_EXTRA_TRANSLATIONS__?: unknown }).__ARISTOTLE_EXTRA_TRANSLATIONS__ = {
      Euthyphro: [{ id: 'mine', name: 'Local Import', short: 'Local', slot: 'overlay' }],
    };
    expect(visibleTranslations(euthyphro).map((t) => t.id)).toContain('mine');
    delete (globalThis as { __ARISTOTLE_EXTRA_TRANSLATIONS__?: unknown }).__ARISTOTLE_EXTRA_TRANSLATIONS__;
  });

  it('creates stable in-print links from curated metadata (empty for this rollout)', () => {
    // No Plato work has curated FURTHER_READING metadata yet — the function
    // still resolves to an empty array rather than throwing.
    expect(furtherReading('Euthyphro')).toEqual([]);
    expect(inPrintHref({ kind: 'translation', cite: 'A <em>Book</em> & commentary' })).toBe(
      'https://www.google.com/search?tbm=bks&q=A%20Book%20%26%20commentary',
    );
  });
});
