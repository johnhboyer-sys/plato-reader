import { describe, expect, it } from 'vitest';
import type { Offsets, SearchResult } from '../lib/search';
import { chapterJoin, chapterOnly, chapterPlaces, measure } from '../lib/chapter-pages';

// In Plato a "chapter" is a Stephanus section. One book of Meno, two 100-token
// sections; offsets.chapter_bounds holds one bound per section, named by its
// column, so a section starts a chapter and no chapter starts inside one. A
// match that runs on past its section's last word (a position of 100 or more
// in 70a) counts in the next section. The English words of a section all
// belong to it: eng-chapters.json is empty.
const offsets: Offsets = {
  token_count: 200,
  seg_base_offset: [0, 100],
  segments: ['70a', '70b'].map(column => ({ book: 1, column, line_runs: [[1, 100]] })),
  book_bounds: [{ book: 1, start: 0 }],
  turn_bounds: [],
  chapter_bounds: [
    { book: 1, chapter: '70a', start: 0, accuracy: 'exact' },
    { book: 1, chapter: '70b', start: 100, accuracy: 'exact' },
  ],
};
const places = chapterPlaces(new Map([['Meno', offsets]]), new Map([['Meno', {}]]));
const res = (column: string, grk: number[], eng?: number[], extra: Partial<SearchResult> = {}): SearchResult => ({
  work: 'Meno', meta: { id: `1:${column}`, book: 1, column },
  grkMatch: grk.length > 0, engMatch: !!eng, grkPositions: grk,
  ...(eng ? { engHits: [{ translation: 'lamb', positions: eng }] } : {}), ...extra,
});

describe('chapterJoin: both terms anywhere in one section', () => {
  it('keeps a section with both, wherever in it they fall, and drops one with only one', () => {
    // 70a: Greek alone. 70b: English word 5 and Greek 10.
    const results = [res('70a', [4]), res('70b', [10], [5])];
    const out = chapterJoin(results, places);
    expect(out).toHaveLength(1);
    expect(out[0].meta.column).toBe('70b');
    expect(out[0].grkPositions).toEqual([10]);
    expect(measure(out, places)).toMatchObject({ chapters: 1, both: 1, grkHits: 1, engHits: 1 });
  });

  it('keeps a window whole or not at all, by the section of its first word', () => {
    // Windows [98,99] (70a) and [100,101] (70b, by word 100) of one result
    // of 70a; only 70b has English. The first must not survive.
    const r = res('70a', [98, 99, 100, 101], undefined, { windows: [[98, 99], [100, 101]] });
    const out = chapterJoin([r, res('70b', [], [3])], places);
    expect(out).toHaveLength(2);
    expect(out[0].windows).toEqual([[100, 101]]);
    expect(out[0].grkPositions).toEqual([100, 101]);
  });

  it('drops a match with no translation named when its own section has no Greek', () => {
    // engMatch with no engHits stands at the head of its section, 70b, which
    // holds no Greek here; the Greek of 70a has no English.
    const out = chapterJoin([res('70a', [4]), res('70b', [], undefined, { engMatch: true })], places);
    expect(out).toEqual([]);
  });

  it('keeps a match with no translation named when its section has Greek', () => {
    const out = chapterJoin([res('70b', [10], undefined, { engMatch: true })], places);
    expect(out).toHaveLength(1);
    expect(out[0].engMatch).toBe(true);
  });

  it('counts the English words of a section in that section, whichever translation holds them', () => {
    // Words 2 and 3 are both 70b's; Jowett's are counted in 70b too.
    const jowett: SearchResult = { ...res('70b', [], [2, 3]), engHits: [{ translation: 'lamb', positions: [2, 3] }, { translation: 'jowett', positions: [7] }] };
    expect(measure([jowett], places)).toMatchObject({ chapters: 1, engOnly: 1, engHits: 3 });
    expect(measure([res('70a', [], [2]), res('70b', [], [3])], places)).toMatchObject({ chapters: 2, engOnly: 2, engHits: 2 });
  });
});

describe('chapterOnly: one language and not both (the exclusive or)', () => {
  it('keeps the sections with one language and drops those with both', () => {
    // 70a: Greek alone. 70b: Greek 10 with English words 1 and 5.
    const results = [res('70a', [4]), res('70b', [10], [1, 5])];
    const out = chapterOnly(results, places);
    expect(out.map(r => r.meta.column)).toEqual(['70a']);
  });

  it('keeps a Greek-only section and an English-only one, each with its own hits', () => {
    // 70a: Greek at 4 only. 70b: English at word 5 only.
    const results = [res('70a', [4]), res('70b', [], [5])];
    const out = chapterOnly(results, places);
    expect(out.map(r => r.meta.column)).toEqual(['70a', '70b']);
    expect(measure(out, places)).toMatchObject({ chapters: 2, both: 0, grkOnly: 1, engOnly: 1, grkHits: 1, engHits: 1 });
  });

  it('cuts a result that runs on into the next section to the half with one language', () => {
    // 70a: Greek 98 (70a) and Greek 100 (70b); English word 5 (70a). 70a has
    // both; 70b has Greek alone.
    const [out] = chapterOnly([res('70a', [98, 100], [5])], places);
    expect(out.grkPositions).toEqual([100]);
    expect(out.engMatch).toBe(false);
  });
});
