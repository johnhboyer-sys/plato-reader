import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { englishOccurrences, greekFold, search } from '../lib/search';

const meta = [
  { id: 's1', book: 1, column: '1094a', greek_head: 'λόγος ἀρετή', greek_tokens: 'logos areth', english_head: 'virtue is a habit of choice' },
  { id: 's2', book: 1, column: '1094b', greek_head: 'ψυχή λόγος', greek_tokens: 'yuxh logos', english_head: 'happiness and virtue together' },
  { id: 's3', book: 2, column: '1100a', greek_head: 'τέχνη', greek_tokens: 'texnh', english_head: 'craft concerns making' },
];

const greekIndex = {
  logos: [[0, 0], [1, 1]],
  areth: [[0, 1]],
  yuxh: [[1, 0]],
  texnh: [[2, 0]],
} satisfies Record<string, [number, number][]>;

const englishIndex = {
  virtue: [0, 1],
  habit: [0],
  choice: [0],
  happiness: [1],
  craft: [2],
  making: [2],
} satisfies Record<string, number[]>;

function json(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response);
}

describe('greekFold', () => {
  it.each([
    ['λόγος', 'logos'],
    ['lo/gos', 'logos'],
    ['*a)nqrwpos', 'anqrwpos'],
    ["ἀρετή'", "areth'"],
    ['ψυχή κόσμος', 'yuxhkosmos'],
  ])('folds %s', (input, expected) => {
    expect(greekFold(input)).toBe(expected);
  });
});

describe('search', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const path = String(url);
      if (path.endsWith('/meta.json')) return json(meta);
      if (path.endsWith('/greek_lemma.json') || path.endsWith('/greek_form.json')) return json(greekIndex);
      if (path.endsWith('/english.json')) return json(englishIndex);
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns no results for empty queries or no works', async () => {
    await expect(search('', ' ', 'all', 'all', 'and', ['TEmpty'])).resolves.toEqual([]);
    await expect(search('logos', '', 'all', 'all', 'and', [])).resolves.toEqual([]);
  });

  it('supports all, any, and phrase modes', async () => {
    expect(await search('logos areth', '', 'all', 'all', 'and', ['TAll'])).toHaveLength(1);
    expect(await search('yuxh areth', '', 'any', 'all', 'and', ['TAny'])).toHaveLength(2);
    expect(await search('logos areth', '', 'phrase', 'all', 'and', ['TPhraseMiss'])).toHaveLength(1);
    expect(await search('areth logos', '', 'phrase', 'all', 'and', ['TPhraseHit'])).toHaveLength(0);
  });

  it('supports wildcards for Greek and English terms', async () => {
    const greek = await search('tex*', '', 'all', 'all', 'and', ['TGreekWildcard']);
    const english = await search('', 'hap*', 'all', 'all', 'and', ['TEngWildcard']);
    expect(greek.map((r) => r.meta.id)).toEqual(['s3']);
    expect(english.map((r) => r.meta.id)).toEqual(['s2']);
  });

  it('combines Greek and English boxes with AND or OR', async () => {
    const andHits = await search('logos', 'happiness', 'all', 'all', 'and', ['TAnd']);
    const orHits = await search('texnh', 'happiness', 'all', 'all', 'or', ['TOr']);
    expect(andHits.map((r) => r.meta.id)).toEqual(['s2']);
    expect(orHits.map((r) => r.meta.id)).toEqual(['s2', 's3']);
  });

  it.each([
    ['whitespace only', '   ', '\t'],
    ['pure punctuation', '!!!', '...'],
    ['regex metacharacters', '.*+?^${}()|[]\\', '.*+?^${}()|[]\\'],
    ['Greek string', 'λόγος τέχνη', 'virtue'],
    ['very long string', `${'logos '.repeat(500)}texnh`, `${'virtue '.repeat(500)}craft`],
  ])('does not throw for adversarial input: %s', async (_label, grk, eng) => {
    await expect(search(grk, eng, 'any', 'any', 'or', [`TAdv-${_label}`])).resolves.toEqual(expect.any(Array));
  });
});

describe('englishOccurrences', () => {
  it('returns one offset per matching token (repeats counted)', () => {
    // #11: "socrates" three times -> three offsets, not one.
    const text = 'Socrates asked; then Socrates replied, and Socrates smiled.';
    expect(englishOccurrences(text, ['socrates'], 'all')).toHaveLength(3);
  });

  it('finds a phrase whose occurrence is past the old 500-char cap', () => {
    // #5: the phrase sits well beyond character 500; token-based matching still finds it.
    const filler = 'word '.repeat(200);           // ~1000 chars
    const text = `${filler}you shall avail yourself of it`;
    const offs = englishOccurrences(text, ['shall', 'avail'], 'phrase');
    expect(offs).toHaveLength(1);
    expect(offs[0]).toBeGreaterThan(500);
  });

  it('matches whole tokens and prefix wildcards, not substrings', () => {
    const text = 'virtue and virtues and virtuous';
    expect(englishOccurrences(text, ['virtue'], 'all')).toHaveLength(1);   // not "virtues"/"virtuous"
    expect(englishOccurrences(text, ['virtu*'], 'all')).toHaveLength(3);   // prefix hits all three
  });
});

describe('search English occurrences (index integration)', () => {
  const longText = `${'filler word '.repeat(60)}the crux is that one shall avail nothing`;
  const engMeta = [
    { id: 's1', book: 1, column: '406a', greek_head: '', greek_tokens: '', english_head: longText },
  ];
  const engIndex = { shall: [0], avail: [0], filler: [0], word: [0], the: [0] };
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const path = String(url);
      if (path.endsWith('/meta.json')) return json(engMeta);
      if (path.endsWith('/english.json')) return json(engIndex);
      if (path.endsWith('/greek_lemma.json') || path.endsWith('/greek_form.json')) return json({});
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('phrase past char 500 is found (regression for the [:500] truncation)', async () => {
    const idx = longText.toLowerCase().indexOf('shall avail');
    expect(idx).toBeGreaterThan(500);
    const hits = await search('', 'shall avail', 'all', 'phrase', 'and', ['TEng500']);
    expect(hits).toHaveLength(1);
    expect(hits[0].engPositions).toEqual([idx]);
  });

  it('counts repeated English occurrences per segment', async () => {
    const hits = await search('', 'word', 'all', 'all', 'and', ['TEngCount']);
    expect(hits).toHaveLength(1);
    // "word" appears 60 times in the filler.
    expect(hits[0].engPositions).toHaveLength(60);
  });
});
