import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WhereElse from '../components/WhereElse.svelte';

// ἡ ψυχή by dictionary word: the lemma map reads ἡ six ways and ψυχή three,
// eighteen readings, of which these stand in the lemma index (real rows from
// build/dist/ngrams/lemma, cut to their first Phaedo and Republic offsets).
// By these cut rows εἰμί ψυχή is the commonest, ὁ ψυχή (the primary analysis
// of both words in the Phaedo) second.
const shards: Record<string, Record<string, unknown>> = {
  'lemma/o': { 'o yuxh': [2, 555, 1453.7, 32, 1], 'os yuxh': [2, 8, -3.9, 7] },
  'lemma/e': { 'eimi yuxh': [2, 24, -11.8, 8] },
  'lemma/h': { 'h yuxh': [2, 12, 2.9, 9] },
};
const occ: Record<string, Record<string, Record<string, number[]>>> = {
  'lemma/o-2': {
    'o yuxh': { Phaedo: [2486, 14, 11], Republic: [1180, 5031] },
    'os yuxh': { Phaedo: [17749] },
  },
  'lemma/e-2': { 'eimi yuxh': { Phaedo: [8261, 25, 105, 2932, 1191, 610, 820, 4161], Republic: [74853, 9451, 591] } },
  'lemma/h-2': { 'h yuxh': { Phaedo: [12842, 634], Republic: [9158] } },
};
const lemmaMap: Record<string, Record<string, string[]>> = {
  h: { h: ['eimi', 'h', 'hmi', 'ihmi', 'o', 'os'] },
  y: { yuxh: ['yuxazw', 'yuxh', 'yuxw'] },
  e: { en: ['eimi', 'eis', 'en', 'ihmi'] },
};
// The Phaedo's primary analyses of ἡ and ψυχή (build/dist/Phaedo/analyses.json).
const analyses = {
  'h(': [{ lemma: 'o(', gloss: 'the', parse: 'fem nom/voc sg', lsj: ['o(1'] }],
  'yuxh/': [{ lemma: 'yuxh/', gloss: 'life', parse: 'fem nom/voc sg', lsj: ['yu_xh/'] }],
};

vi.mock('../lib/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/data')>();
  return {
    ...actual,
    fetchNgramShard: vi.fn(async (stream: string, letter: string) => shards[`${stream}/${letter}`] ?? {}),
    fetchNgramOccurrences: vi.fn(async (stream: string, letter: string, n: number) => occ[`${stream}/${letter}-${n}`] ?? {}),
    fetchAnalyses: vi.fn(async () => analyses),
  };
});

const offsets = {
  token_count: 100000, seg_base_offset: [0], segments: [{ book: 1, column: '57a' }],
  book_bounds: [{ book: 1, start: 0 }], turn_bounds: [],
};
vi.mock('../lib/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/search')>();
  return { ...actual, loadOffsets: vi.fn(async () => offsets) };
});

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const map = String(url).match(/lemma-map\/([a-z_])\.json$/);
    if (map) return Promise.resolve({ ok: true, json: async () => lemmaMap[map[1]] ?? {} } as Response);
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
  });
});
afterEach(() => vi.restoreAllMocks());

async function byDictionaryWord() {
  await fireEvent.click(screen.getByRole('button', { name: 'Dictionary words' }));
}

describe('Where else by dictionary word', () => {
  it('groups ἡ ψυχή by reading, the selection\'s own reading first', async () => {
    const { container } = render(WhereElse, {
      props: { keys: ['h', 'yuxh'], tokenKeys: ['h(', 'yuxh/'], work: 'Phaedo', words: 'ἡ ψυχή' },
    });
    await byDictionaryWord();
    await vi.waitFor(() => expect(container.querySelectorAll('.where-else-reading').length).toBe(4));
    const groups = [...container.querySelectorAll('.where-else-reading')].map((g) => ({
      reading: g.querySelector('h3 [lang="grc"]')!.textContent,
      count: g.querySelector('h3 .n')!.textContent,
      works: [...g.querySelectorAll('.where-else-work')].map((w) => w.querySelector('span')!.textContent),
    }));
    expect(groups).toEqual([
      { reading: 'ο ψυχη', count: '5', works: ['Phaedo', 'Republic'] },
      { reading: 'ειμι ψυχη', count: '11', works: ['Phaedo', 'Republic'] },
      { reading: 'η ψυχη', count: '3', works: ['Phaedo', 'Republic'] },
      { reading: 'ος ψυχη', count: '1', works: ['Phaedo'] },
    ]);
    expect(screen.queryByText(/^Searched/)).toBeNull();
  });

  it('puts the commonest reading first when the words have no analysis', async () => {
    const { container } = render(WhereElse, { props: { keys: ['h', 'yuxh'], words: 'ἡ ψυχή' } });
    await byDictionaryWord();
    await vi.waitFor(() => expect(container.querySelectorAll('.where-else-reading').length).toBe(4));
    const counts = [...container.querySelectorAll('.where-else-reading h3 .n')].map((n) => n.textContent);
    expect(counts).toEqual(['11', '5', '3', '1']);
  });

  it('says how many readings it searched when there are more than it may try', async () => {
    // ἡ ψυχὴ ἐν: 6 × 3 × 4 = 72 readings, over the cap of 64.
    render(WhereElse, { props: { keys: ['h', 'yuxh', 'en'], words: 'ἡ ψυχὴ ἐν' } });
    await byDictionaryWord();
    expect(await screen.findByText('Searched 64 of 72 readings')).toBeInTheDocument();
  });
});
