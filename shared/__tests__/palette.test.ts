import { describe, expect, it } from 'vitest';
import { hasGreek, rankLemmata, rankWorks } from '../lib/palette';
import type { LemmaRef } from '../lib/data';

// Note: citation parsing for the palette is delegated to the work's own
// citation scheme (shared/lib/citation.ts, tested in citation.test.ts) rather
// than duplicated here — the palette library owns only the Greek/work/lemma
// ranking below.

describe('hasGreek', () => {
  it('detects polytonic and monotonic Greek', () => {
    expect(hasGreek('λόγος')).toBe(true);
    expect(hasGreek('ἀρετή')).toBe(true);
    expect(hasGreek('justice')).toBe(false);
    expect(hasGreek('34b')).toBe(false);
  });
});

describe('rankWorks', () => {
  it('ranks a title-prefix match first', () => {
    const r = rankWorks('republic');
    expect(r[0]?.id).toBe('Republic');
  });
  it('matches a Plato abbreviation, ignoring its trailing dot', () => {
    // "Rep." → "rep"; "Grg." → "grg"; both are exact-abbr (top-tier) hits.
    expect(rankWorks('rep')[0]?.id).toBe('Republic');
    expect(rankWorks('grg')[0]?.id).toBe('Gorgias');
  });
  it('matches on the id', () => {
    expect(rankWorks('laws').some((w) => w.id === 'Laws')).toBe(true);
  });
  it('returns nothing for an empty query', () => {
    expect(rankWorks('  ')).toEqual([]);
  });
  it('caps the result count', () => {
    expect(rankWorks('a', undefined, 3).length).toBeLessThanOrEqual(3);
  });
});

describe('rankLemmata', () => {
  const lemmata: Record<string, LemmaRef> = {
    'lo/gos': { slug: 'logos', head: 'λόγος', count: 100 },
    'le/gw': { slug: 'lego', head: 'λέγω', count: 500 },
    'lu/w': { slug: 'luo', head: 'λύω', count: 5 },
    'a)reth/': { slug: 'arete', head: 'ἀρετή', count: 300 },
  };
  it('prefix-matches on the folded headword, frequency-ranked', () => {
    const r = rankLemmata('λ', lemmata);
    expect(r.map((x) => x.slug)).toEqual(['lego', 'logos', 'luo']);
  });
  it('accent-insensitive matching', () => {
    expect(rankLemmata('λογο', lemmata).map((x) => x.slug)).toEqual(['logos']);
  });
  it('respects the limit', () => {
    expect(rankLemmata('λ', lemmata, 1).map((x) => x.slug)).toEqual(['lego']);
  });
  it('empty for non-matching input', () => {
    expect(rankLemmata('ζζζ', lemmata)).toEqual([]);
  });
});
