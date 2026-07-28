import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SPEAKER_NONE,
  SPEAKER_UNKNOWN,
  SpeakerIntegrityError,
  searchSpeaker,
  speakerFilterOccurrences,
} from '../lib/search';
import { worksWithSpeakers, worksWithoutSpeakers, type SpeakerRegistry } from '../lib/data';

// -- An attributed work, 20 tokens in two segments -------------------------
//
//   globals  0-4   Socrates   (id 2)
//            5-9   Euthyphro  (id 3)
//           10-12  a turn with no speaker label      (SPEAKER_UNKNOWN, id 1)
//           13-14  no turn covers these at all       (SPEAKER_NONE,    id 0)
//           15-19  Socrates again, opening a LINE-SNAPPED turn
//
// Lines run five tokens each, so the snapped turn's uncertainty window is
// exactly [15, 20): its recorded start is the line's first token and the true
// start may be any token in that line.
const meta = [
  { id: '1:17a', book: 1, column: '17a', greek_head: '', greek_tokens: '', english_head: '' },
  { id: '1:17b', book: 1, column: '17b', greek_head: '', greek_tokens: '', english_head: '' },
];
const offsets = {
  token_count: 20,
  seg_base_offset: [0, 10],
  segments: [
    { book: 1, column: '17a', line_runs: [[1, 5], [2, 5]] },
    { book: 1, column: '17b', line_runs: [[3, 5], [4, 5]] },
  ],
  book_bounds: [{ book: 1, start: 0 }],
  chapter_bounds: [],
  turn_bounds: [
    { book: 1, speaker: 'Socrates', start: 0, accuracy: 'exact' },
    { book: 1, speaker: 'Euthyphro', start: 5, accuracy: 'exact' },
    { book: 1, speaker: null, start: 10, accuracy: 'exact' },
    { book: 1, speaker: 'Socrates', start: 15, accuracy: 'line-snapped' },
  ],
};
const dict = {
  token_count: 20,
  width: 2,
  reserved: { none: 0, unknown: 1 },
  speakers: [null, null, 'Socrates', 'Euthyphro'],
};
const column = Uint16Array.from([
  2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 1, 1, 1, 0, 0, 2, 2, 2, 2, 2,
]);
// One term standing once in each attribution class:
//   seg0 pos 0 -> global 0  Socrates
//   seg0 pos 6 -> global 6  Euthyphro
//   seg1 pos 1 -> global 11 SPEAKER_UNKNOWN
//   seg1 pos 3 -> global 13 SPEAKER_NONE
//   seg1 pos 7 -> global 17 Socrates, inside the snapped window
const form: Record<string, [number, number][]> = {
  logos: [[0, 0], [0, 6], [1, 1], [1, 3], [1, 7]],
};

// -- A narrated work: no turns, every token unattributed --------------------
const narMeta = [{ id: '1:327a', book: 1, column: '327a', greek_head: '', greek_tokens: '', english_head: '' }];
const narOffsets = {
  token_count: 6,
  seg_base_offset: [0],
  segments: [{ book: 1, column: '327a', line_runs: [[1, 6]] }],
  book_bounds: [{ book: 1, start: 0 }],
  chapter_bounds: [],
  turn_bounds: [],
};
const narDict = { token_count: 6, width: 2, reserved: { none: 0, unknown: 1 }, speakers: [null, null] };
const narColumn = Uint16Array.from([0, 0, 0, 0, 0, 0]);
const narForm: Record<string, [number, number][]> = { logos: [[0, 0], [0, 3]] };

function json(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response);
}
function bin(data: Uint16Array) {
  return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(data.buffer) } as Response);
}

// Work ids containing "NAR" serve the narrated fixture and ids containing "BAD"
// a dictionary that disagrees with the offsets on token_count; every other id
// gets the sound attributed fixture. Keying off the id lets one mock serve a
// MIXED query, and lets a test name a fresh id (the per-work file cache lives
// for the whole module) without a fresh mock.
const install = (over: { dict?: Record<string, unknown>; column?: Uint16Array } = {}) => {
  vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const path = String(url);
    const narrated = /\/[^/]*NAR[^/]*\//.test(path);
    const mismatched = /\/[^/]*BAD[^/]*\//.test(path);
    // "GONE" stands for a work whose files are simply unreachable.
    if (/\/[^/]*GONE[^/]*\//.test(path)) {
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
    }
    if (path.endsWith('/meta.json')) return json(narrated ? narMeta : meta);
    if (path.endsWith('/offsets.json')) return json(narrated ? narOffsets : offsets);
    if (path.endsWith('/speaker-dict.json')) {
      if (narrated) return json(narDict);
      if (mismatched) return json({ ...dict, token_count: 99 });
      return json({ ...dict, ...over.dict });
    }
    if (path.endsWith('/speaker-col.bin')) return bin(narrated ? narColumn : over.column ?? column);
    if (path.endsWith('/greek_form.json') || path.endsWith('/greek_lemma.json')) {
      return json(narrated ? narForm : form);
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
  });
};

const positions = (r: { meta: { id: string }; grkPositions: number[] }[]) =>
  r.map((hit) => [hit.meta.id, hit.grkPositions]);

describe('searchSpeaker', () => {
  beforeEach(() => install());
  afterEach(() => vi.restoreAllMocks());

  it('keeps only the named speaker', async () => {
    const { results } = await searchSpeaker('logos', 'all', ['S1'], { include: ['Socrates'] }, 'form');
    expect(positions(results)).toEqual([['1:17a', [0]], ['1:17b', [7]]]);
  });

  it('excludes a speaker — "anywhere but Socrates"', async () => {
    const { results } = await searchSpeaker('logos', 'all', ['S2'], { exclude: ['Socrates'] }, 'form');
    expect(positions(results)).toEqual([['1:17a', [6]], ['1:17b', [1, 3]]]);
  });

  it('reports who is speaking at each surviving position', async () => {
    const { results } = await searchSpeaker('logos', 'all', ['S3'], { exclude: [SPEAKER_NONE] }, 'form');
    expect(results.flatMap((r) => r.speakers!.map((s) => s.label))).toEqual([
      'Socrates', 'Euthyphro', SPEAKER_UNKNOWN, 'Socrates',
    ]);
  });

  // The two reserved ids are different answers and must never be merged: one
  // says no turn covers the token, the other that a turn does but the source
  // named nobody. Conflate them and both queries below return both positions.
  it('keeps SPEAKER_NONE and SPEAKER_UNKNOWN apart', async () => {
    const unnamed = await searchSpeaker('logos', 'all', ['S4'], { include: [SPEAKER_UNKNOWN] }, 'form');
    expect(positions(unnamed.results)).toEqual([['1:17b', [1]]]);
    const unattributed = await searchSpeaker('logos', 'all', ['S5'], { include: [SPEAKER_NONE] }, 'form');
    expect(positions(unattributed.results)).toEqual([['1:17b', [3]]]);
    // Each label is reported as itself, not as the other.
    expect(unnamed.results[0].speakers).toEqual([{ label: SPEAKER_UNKNOWN, settled: true }]);
    expect(unattributed.results[0].speakers).toEqual([{ label: SPEAKER_NONE, settled: true }]);
  });

  it('excluding one reserved id does not exclude the other', async () => {
    const { results } = await searchSpeaker('logos', 'all', ['S6'], { exclude: [SPEAKER_UNKNOWN] }, 'form');
    // Drops global 11 (unnamed) and keeps global 13 (unattributed).
    expect(positions(results)).toEqual([['1:17a', [0, 6]], ['1:17b', [3, 7]]]);
  });

  it('marks a hit inside a line-snapped turn boundary unsettled', async () => {
    const { results } = await searchSpeaker('logos', 'all', ['S7'], { include: ['Socrates'] }, 'form');
    // global 0 is an exact boundary; global 17 opens a snapped one.
    expect(results[0].speakers).toEqual([{ label: 'Socrates', settled: true }]);
    expect(results[1].speakers).toEqual([{ label: 'Socrates', settled: false }]);
  });

  it('is never a standalone speaker search', async () => {
    const noQuery = await searchSpeaker('', 'all', ['S8'], { include: ['Socrates'] }, 'form');
    expect(noQuery.results).toHaveLength(0);
    expect(noQuery.coverage.searched).toEqual([]);
    const noWorks = await searchSpeaker('logos', 'all', [], { include: ['Socrates'] }, 'form');
    expect(noWorks.results).toHaveLength(0);
    // No filter at all is just search(), not a speaker query.
    const noFilter = await searchSpeaker('logos', 'all', ['S9'], {}, 'form');
    expect(noFilter.results).toHaveLength(0);
  });

  describe('coverage', () => {
    it('skips a work with no speaker data and says so', async () => {
      const { results, coverage } = await searchSpeaker(
        'logos', 'all', ['S10', 'NAR10'], { include: ['Socrates'] }, 'form',
      );
      expect(coverage.searched).toEqual(['S10']);
      expect(coverage.skipped).toEqual(['NAR10']);
      expect(coverage.tokensSearched).toBe(20);
      expect(coverage.tokensSkipped).toBe(6);
      expect(results.every((r) => r.work === 'S10')).toBe(true);
    });

    // The honesty crux. A narrated work is all SPEAKER_NONE, so "anywhere but
    // Socrates" would otherwise return every hit in it — including the Republic,
    // where Socrates is the narrator.
    it('does not hand back a narrated work under an exclude filter', async () => {
      const { results, coverage } = await searchSpeaker(
        'logos', 'all', ['NAR11'], { exclude: ['Socrates'] }, 'form',
      );
      expect(results).toHaveLength(0);
      expect(coverage.skipped).toEqual(['NAR11']);
      expect(coverage.tokensSkipped).toBe(6);
    });

    it('searches a narrated work when the filter asks for SPEAKER_NONE', async () => {
      const { results, coverage } = await searchSpeaker(
        'logos', 'all', ['NAR12'], { include: [SPEAKER_NONE] }, 'form',
      );
      expect(positions(results)).toEqual([['1:327a', [0, 3]]]);
      expect(coverage.searched).toEqual(['NAR12']);
      expect(coverage.skipped).toEqual([]);
    });
  });

  it('refuses a dictionary and offsets built from different runs', async () => {
    // The column is exactly the right LENGTH for the offset space (20), so the
    // column-length check cannot catch this and only the token_count
    // fingerprint can. The control shows the same query otherwise succeeds.
    const control = await searchSpeaker('logos', 'all', ['S13'], { include: ['Socrates'] }, 'form');
    expect(control.results).toHaveLength(2);
    await expect(
      searchSpeaker('logos', 'all', ['S14BAD'], { include: ['Socrates'] }, 'form'),
    ).rejects.toThrow(SpeakerIntegrityError);
  });

  // A broken build must not be survivable. Folding an integrity failure into
  // failedWorks would hand back the sound work's hits and call the query done,
  // which the reader cannot tell from the mismatched work having no hits — and
  // that is the whole thing the fingerprint exists to prevent.
  it('throws rather than returning partial results when one work is inconsistent', async () => {
    const sound = await searchSpeaker('logos', 'all', ['S16'], { include: ['Socrates'] }, 'form');
    expect(sound.results).toHaveLength(2);          // this work alone is fine
    await expect(
      searchSpeaker('logos', 'all', ['S16', 'S17BAD'], { include: ['Socrates'] }, 'form'),
    ).rejects.toThrow(/built from different runs/);
  });

  it('still tolerates a work that simply will not load', async () => {
    // The other half of the distinction: a 404 is transient and per-work, so
    // the query survives it and reports the gap rather than throwing.
    const { results, failedWorks } = await searchSpeaker(
      'logos', 'all', ['S18', 'S19GONE'], { include: ['Socrates'] }, 'form',
    );
    expect(results).toHaveLength(2);
    expect(failedWorks).toEqual(['S19GONE']);
  });

  it('refuses a column that does not span the offset space', async () => {
    install({ column: Uint16Array.from([2, 2, 2]) });
    await expect(
      searchSpeaker('logos', 'all', ['S15'], { include: ['Socrates'] }, 'form'),
    ).rejects.toThrow(SpeakerIntegrityError);
  });
});

describe('speakerFilterOccurrences', () => {
  beforeEach(() => install());
  afterEach(() => vi.restoreAllMocks());

  it('filters phrase occurrences by speaker and labels each one', async () => {
    const out = await speakerFilterOccurrences('S20', [0, 6, 11, 13, 17], { include: ['Socrates'] });
    expect(out.offsets).toEqual([0, 17]);
    expect(out.speakers).toEqual([
      { label: 'Socrates', settled: true },
      { label: 'Socrates', settled: false },
    ]);
    expect(out.attributable).toBe(true);
  });

  it('keeps the reserved ids apart here too', async () => {
    const unnamed = await speakerFilterOccurrences('S21', [11, 13], { include: [SPEAKER_UNKNOWN] });
    expect(unnamed.offsets).toEqual([11]);
    const unattributed = await speakerFilterOccurrences('S22', [11, 13], { include: [SPEAKER_NONE] });
    expect(unattributed.offsets).toEqual([13]);
  });

  it('refuses an occurrence outside the column rather than resolving it', async () => {
    // The n-gram shards and the column are separate artifacts; an offset past
    // the end means they came from different builds.
    await expect(
      speakerFilterOccurrences('S23', [0, 20], { include: ['Socrates'] }),
    ).rejects.toThrow(/different runs/);
  });

  it('reports a work with no speaker data instead of filtering it', async () => {
    const out = await speakerFilterOccurrences('NAR24', [0, 3], { exclude: ['Socrates'] });
    expect(out.attributable).toBe(false);
    expect(out.offsets).toEqual([]);
  });
});

// -- The picker's view: coverage from the registry alone --------------------
const registry: SpeakerRegistry = {
  works: 4,
  tokens: 100,
  turns: 10,
  speakers: {
    Socrates: { tokens: 40, turns: 6, works: { Euthyphro: { tokens: 40, turns: 6 } } },
  },
  reserved: {
    // Parmenides stands for the trap: real turns, but the source labelled none
    // of them, so it appears under no speaker name while still being covered.
    unknown: { id: 1, tokens: 20, turns: 4, works: { Parmenides: { tokens: 20, turns: 4 } } },
    none: {
      id: 0,
      tokens: 40,
      turns: 0,
      works: {
        Parmenides: { tokens: 5, turns: 0 },
        Republic: { tokens: 30, turns: 0 },
        Apology: { tokens: 5, turns: 0 },
      },
    },
  },
};

describe('speaker coverage from the registry', () => {
  it('counts a work with only unlabelled turns as covered', async () => {
    expect(worksWithSpeakers(registry)).toEqual(['Euthyphro', 'Parmenides']);
  });

  it('names only the genuinely narrated works as uncovered', async () => {
    // Reading named speakers alone would wrongly list Parmenides here.
    expect(worksWithoutSpeakers(registry)).toEqual(['Apology', 'Republic']);
  });
});
