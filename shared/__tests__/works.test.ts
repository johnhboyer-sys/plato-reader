import { describe, expect, it } from 'vitest';
import { SHELVES, START_HERE, WORKS, bookLabel, furtherReading, getWork, inPrintHref, isBookless, partOutline, stephanusOrder, visibleTranslations, workLanding, workPath, type Work } from '../lib/works';

// A fixture multi-book Work exercises bookLabel/workPath's generic numbering
// logic without depending on a real registry entry, so the assertions stay
// valid whatever labels the Republic or Laws entries carry.
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

describe('home-page thematic shelves (SHELVES)', () => {
  const shelfIds = SHELVES.flatMap((s) => s.works.map((w) => w.id).filter((id): id is string => Boolean(id)));

  it('carries every work in WORKS exactly once across the six shelves', () => {
    expect(SHELVES.length).toBe(6);
    // Every real work appears exactly once.
    for (const w of WORKS) {
      const count = shelfIds.filter((id) => id === w.id).length;
      expect(count, `${w.id} should appear in exactly one shelf, found ${count}`).toBe(1);
    }
    // No stray/unknown ids and no duplicates overall.
    expect(shelfIds.length).toBe(WORKS.length);
    expect(new Set(shelfIds).size).toBe(shelfIds.length);
    for (const id of shelfIds) expect(getWork(id)).toBeDefined();
  });

  it('never surfaces the retired "Tetralogy" grouping name in user-facing shelf/work data', () => {
    const haystacks = [
      ...SHELVES.map((s) => s.title),
      ...SHELVES.map((s) => s.numeral),
      ...WORKS.map((w) => w.title),
      ...WORKS.map((w) => w.blurb),
    ];
    for (const s of haystacks) expect(s).not.toMatch(/tetralogy/i);
  });
});

describe('"Start here" featured strip (START_HERE)', () => {
  it('lists exactly the curated six, in order, each resolving to a real work', () => {
    expect(START_HERE).toEqual(['Apology', 'Republic', 'Symposium', 'Meno', 'Phaedo', 'Gorgias']);
    for (const id of START_HERE) expect(getWork(id), `${id} should be a real WORKS entry`).toBeDefined();
  });
});

describe('traditional dating (Work.period)', () => {
  it('only uses period on works that have a settled traditional chronology', () => {
    const disputedOrLetters = new Set(
      WORKS.filter((w) => w.authenticity === 'dubious' || w.authenticity === 'spurious' || w.id === 'Letters')
        .map((w) => w.id),
    );
    for (const w of WORKS) {
      if (w.period) expect(['early', 'middle', 'late']).toContain(w.period);
    }
    // Phaedo is a clear middle-period sanity check for the landing-page line.
    expect(getWork('Phaedo')?.period).toBe('middle');
    // Sanity: the disputed/Letters set and the period-bearing set are disjoint,
    // aside from HippiasMajor (dubious authorship, but a settled early date).
    for (const id of disputedOrLetters) {
      if (id === 'HippiasMajor') continue;
      expect(getWork(id)?.period).toBeUndefined();
    }
  });
});

describe('named parts of a single-book work (Work.parts)', () => {
  it('lists the thirteen Letters in reading order, each opening later than the last', () => {
    const letters = getWork('Letters')!.parts!;
    expect(letters).toHaveLength(13);
    expect(letters.map((p) => p.label)).toEqual([
      'Letter I', 'Letter II', 'Letter III', 'Letter IV', 'Letter V', 'Letter VI', 'Letter VII',
      'Letter VIII', 'Letter IX', 'Letter X', 'Letter XI', 'Letter XII', 'Letter XIII',
    ]);
    for (let i = 1; i < letters.length; i++) {
      expect(stephanusOrder(letters[i].start)).toBeGreaterThan(stephanusOrder(letters[i - 1].start));
    }
    // No other work declares parts: the Letters are the one continuous work
    // whose print tradition divides it below the book.
    expect(WORKS.filter((w) => w.parts).map((w) => w.id)).toEqual(['Letters']);
  });

  it('orders Stephanus tokens by page then letter', () => {
    expect(stephanusOrder('358d')).toBeGreaterThan(stephanusOrder('358c'));
    expect(stephanusOrder('359a')).toBeGreaterThan(stephanusOrder('358e'));
    expect(stephanusOrder('358')).toBeLessThan(stephanusOrder('358a'));
    expect(stephanusOrder('nonsense')).toBeNaN();
  });

  it('groups the outline under each part, with shared pages listed once', () => {
    const work: Work = {
      ...multiBookFixture,
      books: 1, bookLabels: ['1'],
      parts: [
        { label: 'Letter IX', start: '357d' },
        { label: 'Letter X', start: '358c' },
        { label: 'Letter XI', start: '358d' },
        { label: 'Letter XII', start: '359c' },
      ],
    };
    const cols = ['357d', '357e', '358a', '358b', '358c', '358d', '358e', '359a', '359b', '359c', '359d', '360a'];
    const sections = cols.map((column) => ({ column, page: Number(column.slice(0, -1)) }));
    const parts = partOutline(work, sections);
    expect(parts.map((p) => [p.label, p.start, p.end])).toEqual([
      ['Letter IX', '357d', '358b'],
      ['Letter X', '358c', '358c'],
      ['Letter XI', '358d', '359b'],
      ['Letter XII', '359c', '360a'],
    ]);
    // Page 358 begins inside Letter IX (358a), so it is listed there; Letters X
    // and XI both open on page 358 and get no second 358 entry of their own.
    expect(parts[0].pages).toEqual([{ page: 358, column: '358a' }]);
    expect(parts[1].pages).toEqual([]);
    expect(parts[2].pages).toEqual([{ page: 359, column: '359a' }]);
    expect(parts[3].pages).toEqual([{ page: 360, column: '360a' }]);
    // A work without parts has no part outline.
    expect(partOutline(multiBookFixture, sections)).toEqual([]);
  });
});
