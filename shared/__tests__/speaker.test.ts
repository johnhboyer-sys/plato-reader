import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  search,
  searchCombo,
  searchPhraseVariants,
  speakerAt,
  speakerRoster,
  COMBO_WINDOW_DEFAULT,
  type ComboOptions,
  type Offsets,
} from '../lib/search';

// One dialogue, 20 tokens in two sections, four turns:
//   327a: offsets 0-9    Socrates 0-4, Glaucon 5-9
//   327b: offsets 10-19  Socrates 10-14, Adeimantus 15-19
// Offsets before a work's first turn are a narrator's opening; 'Narrated' below
// puts the first label at 3 so 0-2 have no speaker.
const meta = [
  { id: '1:327a', book: 1, column: '327a', greek_head: '', greek_tokens: '', english_head: 'justice said Socrates and Glaucon agreed' },
  { id: '1:327b', book: 1, column: '327b', greek_head: '', greek_tokens: '', english_head: 'justice again' },
];
const offsets: Offsets = {
  token_count: 20,
  seg_base_offset: [0, 10],
  segments: [
    { book: 1, column: '327a', line_runs: [[1, 5], [2, 5]] },
    { book: 1, column: '327b', line_runs: [[1, 5], [2, 5]] },
  ],
  book_bounds: [{ book: 1, start: 0 }],
  turn_bounds: [
    { book: 1, speaker: 'Socrates', start: 0, accuracy: 'exact' },
    { book: 1, speaker: 'Glaucon', start: 5, accuracy: 'exact' },
    { book: 1, speaker: 'Socrates', start: 10, accuracy: 'exact' },
    { book: 1, speaker: 'Adeimantus', start: 15, accuracy: 'exact' },
  ],
};
// dikh occurs in every turn: Socrates@2, Glaucon@7, Socrates@12, Adeimantus@17.
// areth occurs only in Glaucon's turn (@8) and Adeimantus' (@16).
// A two-word phrase "kalos kagaqos" sits in Socrates' first turn (3-4) and in
// Glaucon's (8-9, overlapping areth for compactness of the fixture).
const lemma: Record<string, [number, number][]> = {
  dikh: [[0, 2], [0, 7], [1, 2], [1, 7]],
  areth: [[0, 8], [1, 6]],
  kalos: [[0, 3], [0, 8]],
  kagaqos: [[0, 4], [0, 9]],
};
const english = { justice: [0, 1], socrates: [0], glaucon: [0], again: [1] };

// A narrated work: no labels, no turn bounds.
const narratedOffsets: Offsets = { ...offsets, turn_bounds: [] };
// A work whose first label comes after an opening the narrator speaks.
const lateOffsets: Offsets = {
  ...offsets,
  turn_bounds: [{ book: 1, speaker: 'Phaedo', start: 3, accuracy: 'exact' }],
};

function json(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response);
}

function mockFetch(offsetsFor: (work: string) => Offsets | null) {
  vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const path = String(url);
    const work = path.split('/data/')[1]?.split('/')[0] ?? '';
    if (path.endsWith('/meta.json')) return json(meta);
    if (path.endsWith('/greek_lemma.json') || path.endsWith('/greek_form.json')) return json(lemma);
    if (path.endsWith('/english.json')) return json(english);
    if (path.endsWith('/offsets.json')) {
      const o = offsetsFor(work);
      return o ? json(o) : Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
  });
}

// Every test uses a fresh work id: the index cache is per work for the life of
// the module, so a reused id would serve the previous test's offsets.
let n = 0;
const fresh = (tag: string) => `${tag}${++n}`;

describe('speakerAt', () => {
  it('names the turn whose start is the last at or before the offset', () => {
    expect(speakerAt(offsets, 0)).toBe('Socrates');
    expect(speakerAt(offsets, 4)).toBe('Socrates');
    expect(speakerAt(offsets, 5)).toBe('Glaucon');
    expect(speakerAt(offsets, 9)).toBe('Glaucon');
    expect(speakerAt(offsets, 10)).toBe('Socrates');
    expect(speakerAt(offsets, 19)).toBe('Adeimantus');
  });

  it('has no speaker before the first labelled turn, and none at all in a narrated work', () => {
    expect(speakerAt(lateOffsets, 2)).toBeNull();
    expect(speakerAt(lateOffsets, 3)).toBe('Phaedo');
    expect(speakerAt(narratedOffsets, 5)).toBeNull();
  });
});

describe('search with a speaker filter', () => {
  beforeEach(() => mockFetch(() => offsets));
  afterEach(() => vi.restoreAllMocks());

  it('keeps only the Greek hits inside the named speaker\'s turns, and says who spoke each', async () => {
    const results = await search('dikh', '', 'all', 'all', 'and', [fresh('Only')], 'lemma',
      { mode: 'only', names: ['Socrates'] });
    expect(results.map((r) => [r.meta.id, r.grkPositions, r.speakers])).toEqual([
      ['1:327a', [2], ['Socrates']],
      ['1:327b', [2], ['Socrates']],
    ]);
  });

  it('"anyone but" drops the named speaker and keeps everyone else', async () => {
    const results = await search('dikh', '', 'all', 'all', 'and', [fresh('Except')], 'lemma',
      { mode: 'except', names: ['Socrates'] });
    expect(results.map((r) => [r.meta.id, r.grkPositions, r.speakers])).toEqual([
      ['1:327a', [7], ['Glaucon']],
      ['1:327b', [7], ['Adeimantus']],
    ]);
  });

  it('drops a section entirely when none of its hits survive', async () => {
    // areth is spoken by Glaucon (327a) and Adeimantus (327b) only.
    const results = await search('areth', '', 'all', 'all', 'and', [fresh('Drop')], 'lemma',
      { mode: 'only', names: ['Socrates'] });
    expect(results).toEqual([]);
  });

  it('accepts several names at once', async () => {
    const results = await search('dikh', '', 'all', 'all', 'and', [fresh('Many')], 'lemma',
      { mode: 'only', names: ['Glaucon', 'Adeimantus'] });
    expect(results.map((r) => r.speakers)).toEqual([['Glaucon'], ['Adeimantus']]);
  });

  it('filters English hits by the speakers present in the passage', async () => {
    // 327a holds Socrates and Glaucon; 327b holds Socrates and Adeimantus.
    const glaucon = await search('', 'justice', 'all', 'all', 'and', [fresh('Eng')], 'lemma',
      { mode: 'only', names: ['Glaucon'] });
    expect(glaucon.map((r) => r.meta.id)).toEqual(['1:327a']);
    const notSocrates = await search('', 'justice', 'all', 'all', 'and', [fresh('Eng')], 'lemma',
      { mode: 'except', names: ['Socrates'] });
    // Both passages have someone other than Socrates in them.
    expect(notSocrates.map((r) => r.meta.id)).toEqual(['1:327a', '1:327b']);
  });

  it('applies the filter before Greek and English combine', async () => {
    // Greek areth in 327b is Adeimantus'; English "again" is in 327b. AND with
    // "only Glaucon" must find nothing: Glaucon's areth is in 327a, where
    // "again" does not occur.
    const results = await search('areth', 'again', 'all', 'all', 'and', [fresh('And')], 'lemma',
      { mode: 'only', names: ['Glaucon'] });
    expect(results).toEqual([]);
  });

  it('does not load the offsets when no filter is given', async () => {
    await search('dikh', '', 'all', 'all', 'and', [fresh('NoLoad')], 'lemma');
    const urls = (fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.endsWith('/offsets.json'))).toBe(false);
  });

  it('treats an empty name list as no filter', async () => {
    const results = await search('dikh', '', 'all', 'all', 'and', [fresh('Empty')], 'lemma',
      { mode: 'only', names: [] });
    expect(results.map((r) => r.grkPositions)).toEqual([[2, 7], [2, 7]]);
    expect(results[0].speakers).toBeUndefined();
  });
});

describe('a work with nobody to attribute', () => {
  afterEach(() => vi.restoreAllMocks());

  it('excludes a narrated work from any speaker-filtered search', async () => {
    mockFetch(() => narratedOffsets);
    const only = await search('dikh', '', 'all', 'all', 'and', [fresh('Narr')], 'lemma',
      { mode: 'only', names: ['Socrates'] });
    expect(only).toEqual([]);
    // "Anyone but Socrates" is no better: an unlabelled word is not known to
    // be anyone else's.
    const except = await search('dikh', '', 'all', 'all', 'and', [fresh('Narr')], 'lemma',
      { mode: 'except', names: ['Socrates'] });
    expect(except).toEqual([]);
  });

  it('fails the words before a work\'s first labelled turn under both modes', async () => {
    mockFetch(() => lateOffsets);
    // dikh@2 precedes Phaedo's first turn at 3; dikh@7, @12, @17 are Phaedo's.
    const only = await search('dikh', '', 'all', 'all', 'and', [fresh('Late')], 'lemma',
      { mode: 'only', names: ['Phaedo'] });
    expect(only.map((r) => r.grkPositions)).toEqual([[7], [2, 7]]);
    const except = await search('dikh', '', 'all', 'all', 'and', [fresh('Late')], 'lemma',
      { mode: 'except', names: ['Phaedo'] });
    expect(except).toEqual([]);
  });
});

describe('searchCombo with a speaker filter', () => {
  beforeEach(() => mockFetch(() => offsets));
  afterEach(() => vi.restoreAllMocks());
  const opts = (over: Partial<ComboOptions> = {}): ComboOptions => ({
    window: COMBO_WINDOW_DEFAULT, unit: 'words', ordered: false, crossTurn: true, ...over,
  });

  it('keeps a window only when every term is in a wanted turn', async () => {
    // kalos@3 kagaqos@4 (Socrates) and kalos@8 kagaqos@9 (Glaucon), both in 327a.
    // The Glaucon case is the trap: kalos@8's nearest kagaqos is Socrates' @4,
    // so a filter applied to formed windows would have lost Glaucon's pair.
    const soc = await searchCombo(
      [{ kind: 'form', terms: ['kalos'] }, { kind: 'form', terms: ['kagaqos'] }],
      opts({ speaker: { mode: 'only', names: ['Socrates'] } }), [fresh('Combo')],
    );
    expect(soc.results.map((r) => [r.grkPositions, r.speakers])).toEqual([[[3, 4], ['Socrates', 'Socrates']]]);
    const gla = await searchCombo(
      [{ kind: 'form', terms: ['kalos'] }, { kind: 'form', terms: ['kagaqos'] }],
      opts({ speaker: { mode: 'except', names: ['Socrates'] } }), [fresh('Combo')],
    );
    expect(gla.results.map((r) => [r.grkPositions, r.speakers])).toEqual([[[8, 9], ['Glaucon', 'Glaucon']]]);
  });

  it('rejects a window that straddles into an unwanted speaker', async () => {
    // Unfiltered: dikh@7 (Glaucon) near areth@8 in 327a, and dikh@12 (Socrates)
    // near areth@16 (Adeimantus) in 327b — two passages. Every areth is spoken
    // by someone other than Socrates, so "only Socrates" can pair nothing.
    const both = await searchCombo(
      [{ kind: 'form', terms: ['dikh'] }, { kind: 'form', terms: ['areth'] }],
      opts({ window: 8 }), [fresh('Straddle')],
    );
    expect(both.results).toHaveLength(2);
    const soc = await searchCombo(
      [{ kind: 'form', terms: ['dikh'] }, { kind: 'form', terms: ['areth'] }],
      opts({ window: 8, speaker: { mode: 'only', names: ['Socrates'] } }), [fresh('Straddle')],
    );
    expect(soc.results).toHaveLength(0);
  });

  it('leaves the results unlabelled when no filter is set', async () => {
    const plain = await searchCombo(
      [{ kind: 'form', terms: ['kalos'] }, { kind: 'form', terms: ['kagaqos'] }],
      opts(), [fresh('Plain')],
    );
    expect(plain.results[0].speakers).toBeUndefined();
  });
});

describe('searchPhraseVariants with a speaker filter', () => {
  afterEach(() => vi.restoreAllMocks());

  it('keeps or drops a phrase on the turn its first word falls in', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const path = String(url);
      if (path.endsWith('/meta.json')) return json(meta);
      if (path.endsWith('/greek_lemma.json')) return json(lemma);
      if (path.endsWith('/offsets.json')) return json(offsets);
      // The lemma map: each word is its own headword.
      if (path.includes('/lemma-map/')) return json({ kalos: ['kalos'], kagaqos: ['kagaqos'] });
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
    });
    const soc = await searchPhraseVariants('kalos kagaqos', [fresh('Var')], { mode: 'only', names: ['Socrates'] });
    expect(soc.results.map((r) => [r.grkPositions, r.speakers])).toEqual([[[3, 4], ['Socrates', 'Socrates']]]);
    const gla = await searchPhraseVariants('kalos kagaqos', [fresh('Var')], { mode: 'only', names: ['Glaucon'] });
    expect(gla.results.map((r) => r.grkPositions)).toEqual([[8, 9]]);
  });
});

describe('speakerRoster', () => {
  afterEach(() => vi.restoreAllMocks());

  it('counts turns per speaker, most first, and marks narrated and unloadable works apart', async () => {
    mockFetch((work) => (work.startsWith('Narr') ? narratedOffsets : work.startsWith('Gone') ? null : offsets));
    const roster = await speakerRoster([fresh('Cast'), fresh('Narr'), fresh('Gone')]);
    expect(roster[0].loaded).toBe(true);
    expect(roster[0].speakers).toEqual([
      { name: 'Socrates', turns: 2 },
      { name: 'Adeimantus', turns: 1 },
      { name: 'Glaucon', turns: 1 },
    ]);
    expect(roster[1]).toMatchObject({ loaded: true, speakers: [], narrator: null });
    expect(roster[2]).toMatchObject({ loaded: false, speakers: [], narrator: null });
  });

  it('does not make a chip of the unlabelled turns', async () => {
    // The OCT's dash turns reach the offsets with no speaker. 2,003 of them
    // across six works once aggregated into one chip that showed only a count
    // and, ticked, filtered nothing.
    const dashed: Offsets = {
      ...offsets,
      turn_bounds: [
        { book: 1, speaker: 'Socrates', start: 0, accuracy: 'exact' },
        { book: 1, speaker: null as unknown as string, start: 5, accuracy: 'exact' },
        { book: 1, speaker: null as unknown as string, start: 10, accuracy: 'exact' },
      ],
    };
    const allDashed: Offsets = { ...dashed, turn_bounds: dashed.turn_bounds.slice(1) };
    mockFetch((work) => (work.startsWith('Dash') ? dashed : allDashed));
    const [some, none] = await speakerRoster([fresh('Dash'), fresh('AllDash')]);
    expect(some.speakers).toEqual([{ name: 'Socrates', turns: 1 }]);
    // Every turn unlabelled: the work reads as having no cast, and the note
    // names it as left out instead of passing it off as searchable.
    expect(none).toMatchObject({ loaded: true, speakers: [], narrator: null });
  });

  it('leaves a narrated work out and names its narrator', async () => {
    // Phaedo's labels are the Echecrates/Phaedo frame; filtered on them, every
    // word Socrates says in the prison came back as Phaedo's.
    mockFetch(() => offsets);
    const [entry] = await speakerRoster(['Phaedo']);
    expect(entry).toMatchObject({ loaded: true, speakers: [], narrator: 'Phaedo' });
    const only = await search('dikh', '', 'all', 'all', 'and', ['Phaedo'], 'lemma',
      { mode: 'only', names: ['Socrates'] });
    expect(only).toEqual([]);
    const except = await search('dikh', '', 'all', 'all', 'and', ['Phaedo'], 'lemma',
      { mode: 'except', names: ['Socrates'] });
    expect(except).toEqual([]);
    // Unfiltered, the work searches as before.
    const plain = await search('dikh', '', 'all', 'all', 'and', ['Phaedo'], 'lemma');
    expect(plain.length).toBe(2);
  });

  it('reports a work whose turn starts were only snapped to a line', async () => {
    const snapped: Offsets = {
      ...offsets,
      turn_bounds: [
        { book: 1, speaker: 'Socrates', start: 0, accuracy: 'line-snapped' },
        { book: 1, speaker: 'Glaucon', start: 5, accuracy: 'line-snapped' },
      ],
    };
    mockFetch((work) => (work.startsWith('Snap') ? snapped : offsets));
    const [exact, approx] = await speakerRoster([fresh('Cast'), fresh('Snap')]);
    // A snapped bound at offset 0 is the book opening — exact in the only
    // sense that matters — so it alone does not raise the flag.
    expect(exact.approximate).toBe(false);
    expect(approx.approximate).toBe(true);
  });
});

describe('a filtered query keeps the structure its mode is defined over', () => {
  afterEach(() => vi.restoreAllMocks());

  it('"all words" needs one speaker to have said every term, not just one of them', async () => {
    // Both words stand in both sections, so an unfiltered "all words" query
    // matches each: in 327a dikh is Socrates' (2) and Glaucon's (7) and areth
    // is Glaucon's (8); in 327b dikh is Socrates' (12) and Adeimantus' (17)
    // and areth is Adeimantus' (16). No section has both in Socrates' mouth.
    mockFetch(() => offsets);
    const plain = await search('dikh areth', '', 'all', 'all', 'and', [fresh('All')], 'lemma');
    expect(plain.map((r) => r.meta.id)).toEqual(['1:327a', '1:327b']);
    // Under "only Socrates" it must NOT match: he says dikh but never areth.
    // Keeping the section because SOME matched token was his would report a
    // pairing he never made.
    const soc = await search('dikh areth', '', 'all', 'all', 'and', [fresh('All')], 'lemma',
      { mode: 'only', names: ['Socrates'] });
    expect(soc).toEqual([]);
    // Glaucon said both, so his query keeps it, with both words marked.
    const gla = await search('dikh areth', '', 'all', 'all', 'and', [fresh('All')], 'lemma',
      { mode: 'only', names: ['Glaucon'] });
    expect(gla.map((r) => [r.meta.id, r.grkPositions])).toEqual([['1:327a', [7, 8]]]);
  });

  it('"any word" still keeps a section where one term survives', async () => {
    mockFetch(() => offsets);
    const soc = await search('dikh areth', '', 'any', 'all', 'and', [fresh('Any')], 'lemma',
      { mode: 'only', names: ['Socrates'] });
    expect(soc.map((r) => [r.meta.id, r.grkPositions])).toEqual([['1:327a', [2]], ['1:327b', [2]]]);
  });

  it('a phrase is kept or dropped whole, on the turn its first word falls in', async () => {
    // kalos kagaqos runs 3-4 (Socrates) and 8-9 (Glaucon), both in 327a.
    mockFetch(() => offsets);
    const soc = await search('kalos kagaqos', '', 'phrase', 'all', 'and', [fresh('Phr')], 'form',
      { mode: 'only', names: ['Socrates'] });
    // Never a half phrase: both words of his run, neither word of Glaucon's.
    expect(soc.map((r) => [r.meta.id, r.grkPositions])).toEqual([['1:327a', [3, 4]]]);
    const gla = await search('kalos kagaqos', '', 'phrase', 'all', 'and', [fresh('Phr')], 'form',
      { mode: 'except', names: ['Socrates'] });
    expect(gla.map((r) => r.grkPositions)).toEqual([[8, 9]]);
  });
});


describe('a phrase across a turn break', () => {
  afterEach(() => vi.restoreAllMocks());

  // Socrates owns 0-4, Glaucon 5-9; "kalos kagaqos" at 4-5 straddles the
  // break. Kept on its first word, the phrase is Socrates' throughout — the
  // tail must not come back labelled Glaucon on an "only Socrates" result.
  const straddle: Record<string, [number, number][]> = { kalos: [[0, 4]], kagaqos: [[0, 5]] };
  function mockStraddle() {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const path = String(url);
      if (path.endsWith('/meta.json')) return json(meta);
      if (path.endsWith('/greek_lemma.json') || path.endsWith('/greek_form.json')) return json(straddle);
      if (path.endsWith('/offsets.json')) return json(offsets);
      if (path.includes('/lemma-map/')) return json({ kalos: ['kalos'], kagaqos: ['kagaqos'] });
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
    });
  }

  it('labels every word of the phrase with its first word\'s speaker', async () => {
    mockStraddle();
    const hits = await search('kalos kagaqos', '', 'phrase', 'all', 'and', [fresh('Str')], 'lemma',
      { mode: 'only', names: ['Socrates'] });
    expect(hits.map((r) => [r.grkPositions, r.speakers])).toEqual([[[4, 5], ['Socrates', 'Socrates']]]);
    const gla = await search('kalos kagaqos', '', 'phrase', 'all', 'and', [fresh('Str')], 'lemma',
      { mode: 'only', names: ['Glaucon'] });
    expect(gla).toEqual([]);
  });

  it('does the same in the variant engine', async () => {
    mockStraddle();
    const soc = await searchPhraseVariants('kalos kagaqos', [fresh('StrVar')], { mode: 'only', names: ['Socrates'] });
    expect(soc.results.map((r) => [r.grkPositions, r.speakers])).toEqual([[[4, 5], ['Socrates', 'Socrates']]]);
  });
});

