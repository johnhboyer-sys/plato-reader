import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Phrases from '../components/Phrases.svelte';
import type { NgramRow } from '../lib/data';

// ἦν δ' ἐγώ ("said I") is the commonest formula in Plato and is stored in the
// dictionary-form index as ἠμί δέ ἐγώ and εἰμί δέ ἐγώ — ἦν is genuinely
// ambiguous, so not every reading of the typed phrase is a phrase that recurs.
// τό is a headword of nothing: τὸ καλόν is filed under ὁ καλός.
//
// These entries are the real /data/lemma-map ones, trimmed to what the tests
// touch. A dictionary form is always among its own headwords, because it is a
// form that occurs: ὁ maps to ὁ and ὅ.
const lemmaMap: Record<string, Record<string, string[]>> = {
  h: { hn: ['ean', 'eimi', 'hmi', 'hn', 'os'], h: ['eimi', 'h', 'hmi', 'ihmi', 'o', 'os'] },
  d: { "d'": ['de'], de: ['de'] },
  e: { egw: ['egw'], eimi: ['eimi'] },
  t: { to: ['o'], ti: ['tis'] },
  k: { kalon: ['kalos'], kalos: ['kalos'] },
  o: { o: ['o', 'os'] },
  p: { panu: ['panu'] },
  // Two words of nine headwords each: 81 readings, past VARIANT_READING_CAP of
  // 64. No reading is a phrase that recurs, so the query is capped AND empty —
  // the case where the cap notice matters most and used to disappear.
  z: {
    za: Array.from({ length: 9 }, (_, i) => `za${i}`),
    zb: Array.from({ length: 9 }, (_, i) => `zb${i}`),
  },
};

const shards: Record<string, Record<string, NgramRow>> = {
  'lemma/h': { 'hmi de egw': [3, 861, 8960.8, 12], 'hn egw': [2, 5, 2.2, 3] },
  'lemma/e': { 'eimi de egw': [3, 864, 6253.0, 13] },
  'lemma/o': { 'o kalos': [2, 385, 483.4, 32] },
  'lemma/p': { 'panu men oun': [3, 333, 4126.3, 27] },
  'form/h': { "hn d' egw": [3, 860, 12012.6, 11] },
  'form/t': { 'to kalon': [2, 93, 355.0, 14] },
  // No phrase of four or five words begins with ξ.
  'form/c': { 'cene legeis': [2, 12, 62.1, 3], 'cenous te kai': [3, 3, 23.9, 3] },
};

// The shard and occurrence fetchers cache per letter for the life of the
// module, which is right in a browser and useless in a test: the second test
// would see no request at all. Mock them instead of the network, and record
// what each render actually asked for.
const { shardCalls, occCalls } = vi.hoisted(() => ({
  shardCalls: [] as string[],
  occCalls: [] as string[],
}));

vi.mock('../lib/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/data')>();
  return {
    ...actual,
    fetchNgramShard: vi.fn(async (stream: string, letter: string) => {
      shardCalls.push(`${stream}/${letter}`);
      return shards[`${stream}/${letter}`] ?? {};
    }),
    // Stage 8 writes an occurrence file only for a letter and length that hold a
    // phrase, and the real fetcher rejects on the 404 for any other. Every
    // phrase here stands once in the Republic.
    fetchNgramOccurrences: vi.fn(async (stream: string, letter: string, n: number) => {
      occCalls.push(`${stream}/${letter}-${n}`);
      const rows = Object.entries(shards[`${stream}/${letter}`] ?? {}).filter(([, row]) => row[0] === n);
      if (!rows.length) throw new Error(`HTTP 404 for ngrams/${stream}/occ/${letter}-${n}.json`);
      return Object.fromEntries(rows.map(([phrase]) => [phrase, { Republic: [90000] }]));
    }),
  };
});

function json(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response);
}

// Plato's offset primitive, cut to one segment. The column is a lettered
// Stephanus section, which is the whole citation — there is no line.
const offsets = {
  token_count: 100_000,
  seg_base_offset: [90_000],
  segments: [{ book: 1, column: '34b', line_runs: [[1, 40]] }],
  book_bounds: [{ book: 1, start: 0 }],
  turn_bounds: [],
};

// The Greek the page prints is the fold turned back into letters, so it carries
// no accents — ἠμί δέ ἐγώ appears as ημι δε εγω. Asserting on the accented
// spelling would be asserting on a phrase the page never shows.
const GREEK = {
  hmiReading: 'ημι δε εγω',
  eimiReading: 'ειμι δε εγω',
  eanReading: 'εαν δε εγω',
  oKalos: 'ο καλος',
  panuMenOun: 'πανυ μεν ουν',
  surface: "ην δ' εγω",
  toKalon: 'το καλον',
};

// A phrase can appear twice on the page — once as a row, once named in the note
// under the box — so a row is looked up by its own class.
function findRow(greek: string) {
  return screen.findByText(greek, { selector: '.phrase-greek' });
}

// Pick the dictionary-form stream (the "Dictionary words" switch), then type,
// so the widening runs against a settled query.
async function typeInLemmaMode(text: string) {
  const view = render(Phrases);
  await fireEvent.click(screen.getByRole('button', { name: 'Dictionary words' }));
  await fireEvent.input(screen.getByRole('searchbox'), { target: { value: text } });
  await vi.waitFor(() => expect(shardCalls.length).toBeGreaterThan(0));
  return view;
}

describe('Phrases: the dictionary-form index takes the form on the page', () => {
  beforeEach(() => {
    shardCalls.length = 0;
    occCalls.length = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const path = String(url);
      const map = path.match(/lemma-map\/([a-z_])\.json$/);
      if (map) return json(lemmaMap[map[1]] ?? {});
      if (path.endsWith('offsets.json')) return json(offsets);
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  // The defect: the index is keyed on headwords, so the phrase a reader has in
  // front of them matched nothing typed literally — ἦν is no headword, ἠμί is.
  it('finds the phrase typed as it stands on the page', async () => {
    await typeInLemmaMode("hn d' egw");
    expect(await findRow(GREEK.hmiReading)).toBeInTheDocument();
  });

  it('reads the shard a reading lives in, not the typed letter', async () => {
    await typeInLemmaMode('to kalon');
    expect(await findRow(GREEK.oKalos)).toBeInTheDocument();
    // τό resolves to ὁ, so the row is in the O shard — and the T shard is never
    // fetched, because τό is no headword and reading it literally would cost a
    // multi-megabyte shard with nothing in it.
    expect(shardCalls).toContain('lemma/o');
    expect(shardCalls).not.toContain('lemma/t');
  });

  // Half-typed words are the common case while a reader is still typing, and the
  // map records none of them.
  it('matches a word the map does not record as typed', async () => {
    await typeInLemmaMode('panu men ou');
    expect(await findRow(GREEK.panuMenOun)).toBeInTheDocument();
  });

  // Which shards are wanted turns on the FIRST word: ἦν is the surface of εἰμί
  // and ἠμί, whose phrases are filed under different letters.
  it('reads every shard when the first word is ambiguous', async () => {
    await typeInLemmaMode("hn d' egw");
    expect(await findRow(GREEK.eimiReading)).toBeInTheDocument();
    expect(shardCalls).toContain('lemma/h');
    expect(shardCalls).toContain('lemma/e');
    expect(shardCalls).toContain('lemma/o');
  });

  it('names the readings that matched, and only those', async () => {
    await typeInLemmaMode("hn d' egw");
    const note = await screen.findByText(/Reading these words as/);
    expect(note.textContent).toContain(GREEK.hmiReading);
    expect(note.textContent).toContain(GREEK.eimiReading);
    // ἦν read as ἐάν is a real reading, but no such phrase recurs, so claiming
    // it matched would be a lie.
    expect(note.textContent).not.toContain(GREEK.eanReading);
  });

  it('still matches a dictionary form typed as one', async () => {
    await typeInLemmaMode('o kalos');
    expect(await findRow(GREEK.oKalos)).toBeInTheDocument();
  });

  // The letter buttons type into the same box. h is the surface of ἡ, whose
  // headword is ὁ, so widening one letter would silently move the browse.
  it('does not widen a single letter', async () => {
    await typeInLemmaMode('h');
    expect(await findRow(GREEK.hmiReading)).toBeInTheDocument();
    expect(shardCalls).not.toContain('lemma/o');
    expect(shardCalls).not.toContain('lemma/e');
  });

  it("fetches a row's occurrences from the shard that holds it", async () => {
    await typeInLemmaMode("hn d' egw");
    await fireEvent.click(await findRow(GREEK.eimiReading));
    // Not lemma/h-3 by luck of the typed letter: h is what was typed, e is
    // where the row lives.
    await vi.waitFor(() => expect(occCalls).toContain('lemma/e-3'));
  });

  it('leaves the surface stream matching what was typed', async () => {
    render(Phrases);
    await fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'to kalon' } });
    expect(await findRow(GREEK.toKalon)).toBeInTheDocument();
    expect(shardCalls).toContain('form/t');
    const requested = vi.mocked(globalThis.fetch).mock.calls.map((c) => String(c[0]));
    expect(requested.filter((p) => p.includes('lemma-map'))).toHaveLength(0);
  });

  // The cap is a silent loss: readings are dropped before any shard is read, so
  // a capped query that matches nothing looks exactly like a phrase Plato never
  // wrote. The notice has to survive the empty result, not only decorate a full
  // one.
  it('says the fan-out was capped even when nothing matched', async () => {
    await typeInLemmaMode('za zb');
    expect(await screen.findByText(/81 readings in all/)).toBeInTheDocument();
    expect(await screen.findByText(/only the first 64 were tried/)).toBeInTheDocument();
    // and it really is the empty case, not a list of rows with a note on top
    expect(screen.queryAllByText('', { selector: '.phrase-greek' })).toHaveLength(0);
  });

  // Plato is cited by Stephanus page + section, and the section letter is part
  // of the citation. A citation rendered as "34" — or a jump link that split the
  // letter off as a line number — would name the wrong half-page.
  it('cites an occurrence by its lettered Stephanus section', async () => {
    await typeInLemmaMode("hn d' egw");
    await fireEvent.click(await findRow(GREEK.hmiReading));
    const link = await screen.findByRole('link', { name: '34b' });
    expect(link.getAttribute('href')).toMatch(/\?loc=34b$/);
  });
});

// Ticking a work reads the occurrence files of the letter being browsed, and
// all four lengths are ticked by default. The live page asked for ξ's four- and
// five-word files, which do not exist, and refused to filter at all.
describe('Phrases: the work filter', () => {
  beforeEach(() => {
    shardCalls.length = 0;
    occCalls.length = 0;
  });

  it('filters a letter that has no phrase of some lengths', async () => {
    render(Phrases, { props: { letters: { form: ['c'] } } });
    await fireEvent.click(screen.getByRole('button', { name: 'c' }));
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Republic' }));
    expect(await findRow('ξενε λεγεις')).toBeInTheDocument();
    expect(await findRow('ξενους τε και')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(occCalls).not.toContain('form/c-4');
    expect(occCalls).not.toContain('form/c-5');
  });
});
