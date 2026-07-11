import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBook, fetchFootnotes, fetchLsjShard, invalidateBookCache, lookupWord, lsjShard, parseBekker, parseLocation, resolveBekker } from '../lib/data';

function mockFetch(map: Record<string, unknown>) {
  vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const key = Object.keys(map).find((part) => String(url).includes(part));
    if (!key) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
    return Promise.resolve({ ok: true, json: async () => map[key] } as Response);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { __ARISTOTLE_BOOK_HOOK__?: unknown }).__ARISTOTLE_BOOK_HOOK__;
});

describe('parseBekker and resolveBekker', () => {
  it.each([
    ['1097a15', { column: '1097a', line: 15 }],
    ['1097a 15', { column: '1097a', line: 15 }],
    ['1097A.15', { column: '1097a', line: 15 }],
    ['  1000b2  ', { column: '1000b', line: 2 }],
    ['not a citation', null],
    // The citation-scheme contract's column grammar is shared a-e across
    // schemes (pipeline/plato_pipeline/scheme.py's `_COLUMN_RE`/`_REF_RE`),
    // so parseBekker — now a thin wrapper over the bekker scheme — accepts
    // c/d/e too; real column membership is still gated by resolveBekker
    // against columns.json, not by this grammar.
    ['1097c15', { column: '1097c', line: 15 }],
    ['1097f15', null], // outside a-e: still rejected
    ['1097a', null],   // bare column, no line: not a *Bekker* citation
  ])('parses %s', (raw, expected) => {
    expect(parseBekker(raw)).toEqual(expected);
  });

  it('resolves columns and snaps shared-column gaps to the nearest book', () => {
    const columns = {
      '1097a': [{ book: 1, lo: 1, hi: 20 }],
      '1100b': [{ book: 1, lo: 1, hi: 8 }, { book: 2, lo: 14, hi: 20 }],
    };
    expect(resolveBekker(columns, '1097a', 10)).toBe(1);
    expect(resolveBekker(columns, '1100b', 4)).toBe(1);
    expect(resolveBekker(columns, '1100b', 12)).toBe(2);
    expect(resolveBekker(columns, '999a', 1)).toBeNull();
  });
});

describe('parseLocation (per-work scheme dispatch)', () => {
  it('parses a bekker work\'s bare column and column:line forms', () => {
    expect(parseLocation('EN', '1097a')).toEqual({ column: '1097a', line: null });
    expect(parseLocation('EN', '1097a:15')).toEqual({ column: '1097a', line: 15 });
    expect(parseLocation('EN', '1097a15')).toEqual({ column: '1097a', line: 15 });
  });

  it('parses a busse-scheme work the same way — it has user-facing lines '
    + '(no busse work is in the registry right now, so this exercises the '
    + 'unknown-work bekker default, which shares busse\'s hasUserFacingLines)', () => {
    expect(parseLocation('NoSuchWork', '1a')).toEqual({ column: '1a', line: null });
    expect(parseLocation('NoSuchWork', '1a:5')).toEqual({ column: '1a', line: 5 });
  });

  it('falls back to bekker for an unknown work id', () => {
    expect(parseLocation('NoSuchWork', '1097a:15')).toEqual({ column: '1097a', line: 15 });
  });
});

describe('fetch and lookup helpers', () => {
  it('fetchBook returns JSON data and applies the runtime hook', async () => {
    mockFetch({
      'HookWork/book-01.json': { book: 1, segments: [] },
    });
    (globalThis as { __ARISTOTLE_BOOK_HOOK__?: unknown }).__ARISTOTLE_BOOK_HOOK__ = vi.fn((_work, _n, data) => ({
      ...data,
      segments: [{ id: 'hooked', column: '1a', greek: [], english: null }],
    }));

    await expect(fetchBook('HookWork', 1)).resolves.toMatchObject({
      book: 1,
      segments: [{ id: 'hooked' }],
    });
  });

  it('invalidateBookCache forces a re-fetch that re-runs the book hook', async () => {
    // Two fetches of the same book normally hit the promise cache once — the
    // hook runs a single time. This is the desktop import staleness bug: a
    // re-import updates the hook's overlay data, but the open book keeps its
    // first (pre-import) hook result until the cache is dropped.
    mockFetch({ 'EvictWork/book-01.json': { book: 1, segments: [] } });
    const hook = vi.fn((_work, _n, data) => data);
    (globalThis as { __ARISTOTLE_BOOK_HOOK__?: unknown }).__ARISTOTLE_BOOK_HOOK__ = hook;

    await fetchBook('EvictWork', 1);
    await fetchBook('EvictWork', 1);
    expect(hook).toHaveBeenCalledTimes(1);           // cached: hook ran once

    invalidateBookCache('EvictWork');
    await fetchBook('EvictWork', 1);
    expect(hook).toHaveBeenCalledTimes(2);           // evicted: re-fetch re-ran the hook

    // A different work's cache is untouched by the eviction.
    invalidateBookCache('OtherWork');
    await fetchBook('EvictWork', 1);
    expect(hook).toHaveBeenCalledTimes(2);           // still cached — no spurious re-fetch
  });

  it('fetchFootnotes linkifies glossary references for EN only', async () => {
    mockFetch({
      'EN/footnotes.json': { '1': 'See Glossary, <em>hexis</em>.' },
      'DA/footnotes.json': { '1': 'See Glossary, <em>hexis</em>.' },
    });

    await expect(fetchFootnotes('EN')).resolves.toMatchObject({
      '1': expect.stringContaining('class="gloss-ref"'),
    });
    await expect(fetchFootnotes('DA')).resolves.toMatchObject({
      '1': 'See Glossary, <em>hexis</em>.',
    });
  });

  it('selects LSJ shards and de-duplicates lookupWord dictionary entries', async () => {
    mockFetch({
      'LookupWork/analyses.json': {
        logos: [
          { lemma: 'lo/gos', gloss: 'word', parse: 'noun', lsj: ['lo/gos', '*a)rxh/'] },
          { lemma: 'lo/gos', gloss: 'speech', parse: 'noun', lsj: ['lo/gos'] },
        ],
      },
      '/lsj/l.json': { 'lo/gos': { key: 'lo/gos', head: 'λόγος', html: '<p>word</p>' } },
      '/lsj/a.json': { '*a)rxh/': { key: '*a)rxh/', head: 'ἀρχή', html: '<p>beginning</p>' } },
    });

    expect(lsjShard('*a)rxh/')).toBe('a');
    expect(lsjShard('123')).toBe('_');
    const result = await lookupWord('LookupWork', 'logos');
    expect(result.analyses).toHaveLength(2);
    expect(result.lsj.map((e) => e.key)).toEqual(['lo/gos', '*a)rxh/']);
    await expect(fetchLsjShard('missing')).resolves.toEqual({});
  });
});
