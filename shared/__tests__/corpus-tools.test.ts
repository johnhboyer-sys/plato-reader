import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  citationsFor,
  contentWords,
  findOccurrences,
  selectedKeys,
  sharedPhrases,
  whereElseOffered,
} from '../lib/corpus-tools';

// Real rows from build/dist/ngrams, trimmed. τίνα τρόπον opens the Republic at
// 327a ("in what manner they would hold it") and stands 91 times in 17 works;
// as dictionary words, τίς τρόπος, 138 times in 24. Only the Phaedo and
// Republic occurrences are kept here, with their real delta-encoded offsets.
const shards: Record<string, Record<string, unknown>> = {
  'form/t': { 'tina tropon': [2, 91, 673.4, 17] },
  'lemma/t': { 'tis tropos': [2, 138, 426.2, 24] },
};
const occ: Record<string, Record<string, Record<string, number[]>>> = {
  'form/t-2': { 'tina tropon': { Phaedo: [5831, 15462], Republic: [18, 14202, 1520] } },
  'lemma/t-2': { 'tis tropos': { Phaedo: [405, 3746, 1680, 15462], Republic: [18, 14202, 1520] } },
};

vi.mock('../lib/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/data')>();
  return {
    ...actual,
    fetchNgramShard: vi.fn(async (stream: string, letter: string) => shards[`${stream}/${letter}`] ?? {}),
    fetchNgramOccurrences: vi.fn(async (stream: string, letter: string, n: number) => {
      const file = occ[`${stream}/${letter}-${n}`];
      if (!file) throw new Error('HTTP 404');
      return file;
    }),
  };
});

const lemmaMap: Record<string, Record<string, string[]>> = {
  t: { tina: ['tis'], tropon: ['tropos'] },
};

function json(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response);
}

describe('Where else: the n-gram lookup', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const map = String(url).match(/lemma-map\/([a-z_])\.json$/);
      if (map) return json(lemmaMap[map[1]] ?? {});
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('finds τίνα τρόπον by form, offsets decoded', async () => {
    const found = await findOccurrences('form', ['tina', 'tropon']);
    expect(found.readings).toEqual(['tina tropon']);
    expect(found.byWork).toEqual({ Phaedo: [5831, 21293], Republic: [18, 14220, 15740] });
  });

  it('finds τίνα τρόπον by dictionary word through the lemma map', async () => {
    const found = await findOccurrences('lemma', ['tina', 'tropon']);
    expect(found.readings).toEqual(['tis tropos']);
    expect(found.byWork.Phaedo).toEqual([405, 4151, 5831, 21293]);
  });

  it('finds nothing for a run the index does not hold', async () => {
    const found = await findOccurrences('form', ['tina', 'logon']);
    expect(found).toEqual({ readings: [], byWork: {} });
  });
});

describe('Where else: citations', () => {
  // Republic's offsets, cut to its first three Stephanus sections.
  const offsets = {
    token_count: 200,
    seg_base_offset: [0, 45, 104],
    segments: [
      { book: 1, column: '327a', line_runs: [] },
      { book: 1, column: '327b', line_runs: [] },
      { book: 1, column: '327c', line_runs: [] },
    ],
    book_bounds: [{ book: 1, start: 0 }],
    turn_bounds: [],
  } as never;

  it('cites a global offset by Stephanus section and links into the reader', () => {
    expect(citationsFor('Republic', offsets, [18, 60], '')).toEqual([
      { cite: '327a', href: '/Republic/book/1?loc=327a' },
      { cite: '327b', href: '/Republic/book/1?loc=327b' },
    ]);
  });
});

describe('Where else: offered for two to five words', () => {
  it('is offered for 2–5 words and for nothing else', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(whereElseOffered))
      .toEqual([false, false, true, true, true, true, false, false]);
  });

  it('reads the keys of the words a selection covers', () => {
    document.body.innerHTML =
      '<p><span class="tok" data-k="ti/na">τίνα</span> <span class="tok" data-k="tro/pon">τρόπον</span> ' +
      '<span class="tok" data-k="poih/sousin">ποιήσουσιν</span></p>';
    const toks = document.querySelectorAll('.tok');
    const range = document.createRange();
    range.setStart(toks[0].firstChild!, 1);
    range.setEnd(toks[1].firstChild!, 2);
    expect(selectedKeys(range, document)).toEqual(['tina', 'tropon']);
  });
});

describe('Compare works: shared phrases', () => {
  it('lists only the phrases both works use, each side decoded', () => {
    const files = [
      occ['form/t-2'],
      { 'kata to dunaton kai en': { Phaedo: [3616], Republic: [87474] }, 'ws epos eipein': { Republic: [100] } },
    ];
    const shared = sharedPhrases(files, 'Phaedo', 'Republic');
    expect(shared.map((s) => s.key).sort()).toEqual(['kata to dunaton kai en', 'tina tropon']);
    const row = shared.find((s) => s.key === 'tina tropon')!;
    expect(row).toEqual({ key: 'tina tropon', n: 2, a: [5831, 21293], b: [18, 14220, 15740] });
    expect(sharedPhrases(files, 'Phaedo', 'Phaedo')).toEqual([]);
  });

  it('counts the words that are not grammatical words', () => {
    expect(contentWords("kai mhn h d' os")).toBe(0);
    expect(contentWords('tina tropon')).toBe(1);
    expect(contentWords('kata to dunaton kai en')).toBe(1);
    expect(contentWords('kalos te kai agaqos')).toBe(2);
  });
});
