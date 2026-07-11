import { afterEach, describe, expect, it, vi } from 'vitest';

// A works.ts-shaped fixture registry: a stephanus work (Plato) and a bekker
// work (default), so the citation composers can be exercised for a stephanus
// work WITHOUT adding a real registry entry (those land later). Only getWork is
// consumed by the citation module.
vi.mock('../lib/works', () => {
  const metas: Record<string, { id: string; abbr: string; citation?: { scheme: string } }> = {
    Euthphr: { id: 'Euthphr', abbr: 'Euthphr.', citation: { scheme: 'stephanus' } },
    EN: { id: 'EN', abbr: 'EN' }, // no citation field → bekker default
  };
  return { getWork: (id: string) => metas[id] };
});

import { formatCite, formatHash, formatLocValue, schemeFor } from '../lib/citation';
import { fetchSections, sectionPages, type SectionRef } from '../lib/data';

describe('citation composition for a stephanus work (fixture meta)', () => {
  it('resolves the scheme from the fixture meta', () => {
    expect(schemeFor('Euthphr').id).toBe('stephanus');
    expect(schemeFor('EN').id).toBe('bekker');
  });

  it('formatCite drops the line — the section token is the only granularity', () => {
    expect(formatCite('Euthphr', '17a')).toBe('17a');
    expect(formatCite('Euthphr', '17a', 5)).toBe('17a');
  });

  it('formatHash is the bare section token, never a line', () => {
    expect(formatHash('Euthphr', '17a', 5)).toBe('#17a');
    expect(formatHash('Euthphr', '2b')).toBe('#2b');
  });

  it('formatLocValue emits ?loc=17a with no :line for a lineless scheme', () => {
    expect(formatLocValue('Euthphr', '17a', 5)).toBe('17a');
    expect(formatLocValue('Euthphr', '17a')).toBe('17a');
  });

  it('leaves the bekker path byte-identical (line-bearing composition)', () => {
    expect(formatCite('EN', '1094a', 15)).toBe('1094a15');
    expect(formatHash('EN', '1094a', 15)).toBe('#1094a15');
    expect(formatLocValue('EN', '1094a', 15)).toBe('1094a:15');
    expect(formatLocValue('EN', '1094a')).toBe('1094a');
  });
});

describe('sectionPages — group a book’s sections into Stephanus pages', () => {
  const secs: SectionRef[] = [
    { column: '2a', page: 2, letter: 'a', id: 'Euthphr:2a' },
    { column: '2b', page: 2, letter: 'b', id: 'Euthphr:2b' },
    { column: '2c', page: 2, letter: 'c', id: 'Euthphr:2c' },
    { column: '3a', page: 3, letter: 'a', id: 'Euthphr:3a' },
    { column: '3b', page: 3, letter: 'b', id: 'Euthphr:3b' },
    { column: '4a', page: 4, letter: 'a', id: 'Euthphr:4a' },
  ];

  it('yields one entry per page, anchored to the page’s first section column', () => {
    expect(sectionPages(secs)).toEqual([
      { page: 2, column: '2a' },
      { page: 3, column: '3a' },
      { page: 4, column: '4a' },
    ]);
  });

  it('is empty for an empty section list', () => {
    expect(sectionPages([])).toEqual([]);
  });
});

describe('fetchSections', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fetches and returns the per-book section map', async () => {
    const data = { '1': [{ column: '2a', page: 2, letter: 'a', id: 'W:2a' }] };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      { ok: true, json: async () => data } as Response,
    );
    // A distinct work id avoids the module-level cache colliding across tests.
    await expect(fetchSections('StephFetchWork')).resolves.toEqual(data);
  });
});
