import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchPhraseVariants, VARIANT_READING_CAP } from '../lib/search';

// One segment. The phrase "h tou agaqou idea" stands at 0-3; the same formula
// under a different article stands at 10-13. Only the second is out of reach of
// an exact phrase, because its surface string differs.
const meta = [{ id: '1:508e', book: 1, column: '508e', greek_head: '', greek_tokens: '', english_head: '' }];

// h is genuinely ambiguous: the article and the relative pronoun are the same
// written word, and BOTH readings land on the same tokens. That is the case the
// union has to survive.
const lemmaIndex: Record<string, [number, number][]> = {
  o: [[0, 0], [0, 1], [0, 10], [0, 11]],
  os: [[0, 0], [0, 10]],
  agaqos: [[0, 2], [0, 12]],
  idea: [[0, 3], [0, 13]],
  eidos: [[0, 40]],
};
const lemmaMap: Record<string, Record<string, string[]>> = {
  h: { h: ['o', 'os'] },
  t: { tou: ['o'] },
  a: { agaqou: ['agaqos'] },
  i: { idea: ['idea', 'eidos'] },
};

function json(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response);
}

describe('searchPhraseVariants', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const path = String(url);
      const shard = path.match(/lemma-map\/([a-z_])\.json$/);
      if (shard) return json(lemmaMap[shard[1]] ?? {});
      if (path.endsWith('/meta.json')) return json(meta);
      if (path.endsWith('/greek_lemma.json')) return json(lemmaIndex);
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('needs at least two words and a work', async () => {
    expect((await searchPhraseVariants('h', ['V1'])).results).toHaveLength(0);
    expect((await searchPhraseVariants('h tou', [])).results).toHaveLength(0);
  });

  it('finds the inflected variant an exact phrase cannot reach', async () => {
    const { results } = await searchPhraseVariants('h tou agaqou idea', ['V2']);
    // Both the typed phrase at 0-3 and the variant at 10-13.
    expect(results[0].grkPositions).toEqual([0, 1, 2, 3, 10, 11, 12, 13]);
  });

  // The crux: two readings of the same word land on the same tokens, because
  // they are one passage under two parses. Summing them would double the count.
  it('unions the offsets of overlapping readings instead of summing them', async () => {
    const { results, productive } = await searchPhraseVariants('h tou agaqou idea', ['V3']);
    expect(productive.find((r) => r[0] === 'o')).toBeTruthy();
    expect(productive.find((r) => r[0] === 'os')).toBeTruthy();
    // Each reading matches 2 places x 4 tokens = 8; summed that would be 16.
    expect(results[0].grkPositions).toHaveLength(8);
    expect(new Set(results[0].grkPositions).size).toBe(8);
  });

  it('reports which readings actually matched, not just which were tried', async () => {
    const { readings, productive } = await searchPhraseVariants('h tou agaqou idea', ['V4']);
    expect(readings).toHaveLength(4);                      // 2 heads for h x 2 for idea
    expect(productive.map((r) => r.join(' ')).sort()).toEqual([
      'o o agaqos idea',
      'os o agaqos idea',
    ]);                                                    // the eidos readings matched nothing
  });

  it('returns nothing when a word has no known headword', async () => {
    const { results } = await searchPhraseVariants('h zzzz', ['V5']);
    expect(results).toHaveLength(0);
  });

  it('caps a runaway fan-out and says how large it was', async () => {
    const wide = Array.from({ length: 40 }, (_, i) => `l${i}`);
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const path = String(url);
      if (/lemma-map\//.test(path)) return json({ qq: wide, qr: wide });
      if (path.endsWith('/meta.json')) return json(meta);
      if (path.endsWith('/greek_lemma.json')) return json({});
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
    });
    // A letter no other test in this file has loaded: the shared shard cache
    // lives for the whole module run.
    const { readings, cappedFrom } = await searchPhraseVariants('qq qr', ['V6']);
    expect(readings.length).toBeLessThanOrEqual(VARIANT_READING_CAP);
    expect(cappedFrom).toBe(1600);      // 40 x 40, stated rather than hidden
  });
});
