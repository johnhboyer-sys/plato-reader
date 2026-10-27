import { describe, expect, it } from 'vitest';
import type { SearchResult } from '../lib/search';
import { engHitCount, hitCount, paginate, stephanusPage } from '../lib/search-pages';

const r = (work: string, book: number, column: string, grk: number, eng: number[][] = []): SearchResult => ({
  work,
  meta: { id: `${book}:${column}`, book, column },
  grkMatch: grk > 0,
  engMatch: eng.length > 0,
  ...(eng.length ? { engHits: eng.map((positions, i) => ({ translation: i ? 'jowett' : 'lamb', positions })) } : {}),
  grkPositions: Array.from({ length: grk }, (_, i) => i),
});
const ids = (pages: SearchResult[][]) => pages.map(p => p.map(x => `${x.work} ${x.meta.column}`));

describe('counting hits', () => {
  it('counts each Greek word and each English word in each translation', () => {
    expect(hitCount(r('Meno', 1, '70a', 2, [[1, 4], [3]]))).toBe(5);
    expect(hitCount(r('Meno', 1, '70a', 0, [[]]))).toBe(1);   // a bare * is one hit
    expect(engHitCount({ translation: 'lamb', positions: [] })).toBe(1);
  });

  it('reads the Stephanus page off a section', () => {
    expect(stephanusPage('70a')).toBe(70);
    expect(stephanusPage('327e')).toBe(327);
  });
});

describe('paginate', () => {
  it('breaks only between Stephanus pages, never inside one', () => {
    const pages = paginate([
      r('Meno', 1, '70a', 2), r('Meno', 1, '70e', 2),   // page 70: 4 hits
      r('Meno', 1, '71a', 3),                            // page 71: 3 hits
    ], 4);
    expect(ids(pages)).toEqual([['Meno 70a', 'Meno 70e'], ['Meno 71a']]);
  });

  it('puts small pages together, and lets one big page stand alone', () => {
    const pages = paginate([
      r('Meno', 1, '70a', 1), r('Meno', 1, '71a', 1), r('Meno', 1, '72a', 9), r('Meno', 1, '73a', 1),
    ], 4);
    expect(ids(pages)).toEqual([['Meno 70a', 'Meno 71a'], ['Meno 72a'], ['Meno 73a']]);
  });

  it('counts English hits toward page size', () => {
    const pages = paginate([r('Meno', 1, '70a', 0, [[1, 2], [5]]), r('Meno', 1, '71a', 1)], 3);
    expect(ids(pages)).toEqual([['Meno 70a'], ['Meno 71a']]);
  });

  it('runs pages in corpus order: work, then book, then page', () => {
    // Crito precedes Meno in the tetralogies; Republic II follows Republic I.
    const pages = paginate([
      r('Meno', 1, '70a', 1), r('Republic', 2, '357a', 1), r('Crito', 1, '43a', 1), r('Republic', 1, '354a', 1),
    ], 1);
    expect(ids(pages)).toEqual([['Crito 43a'], ['Meno 70a'], ['Republic 354a'], ['Republic 357a']]);
  });

  it('makes no pages of no results', () => {
    expect(paginate([], 40)).toEqual([]);
  });
});
