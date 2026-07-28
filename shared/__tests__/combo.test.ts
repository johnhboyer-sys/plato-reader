import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchCombo, COMBO_WINDOW_DEFAULT, COMBO_WINDOW_MAX, type ComboOptions } from '../lib/search';

// One work, 40 tokens, laid out so every boundary rule can be tested:
//   book 1 = offsets 0-19   (turn 1 = 0-9,  turn 2 = 10-19)
//   book 2 = offsets 20-39  (turn 3 = 20-29, turn 4 = 30-39)
//   lines of 5 tokens throughout; segments of 20, 10 and 10 tokens.
// Every column is a lettered Stephanus section, which is what a Plato segment
// is keyed by — the field names are Bekker-flavoured, the values are not.
const meta = [
  { id: '1:327a', book: 1, column: '327a', greek_head: '', greek_tokens: '', english_head: '' },
  { id: '2:357a', book: 2, column: '357a', greek_head: '', greek_tokens: '', english_head: '' },
  { id: '2:357b', book: 2, column: '357b', greek_head: '', greek_tokens: '', english_head: '' },
];
const offsets = {
  token_count: 40,
  seg_base_offset: [0, 20, 30],
  segments: [
    { book: 1, column: '327a', line_runs: [[1, 5], [2, 5], [3, 5], [4, 5]] },
    { book: 2, column: '357a', line_runs: [[1, 5], [2, 5]] },
    { book: 2, column: '357b', line_runs: [[1, 5], [2, 5]] },
  ],
  book_bounds: [{ book: 1, start: 0 }, { book: 2, start: 20 }],
  // Plato's substitute for chapter bounds: a speaker turn.
  turn_bounds: [
    { book: 1, speaker: 'Socrates', start: 0, accuracy: 'exact' },
    { book: 1, speaker: 'Glaucon', start: 10, accuracy: 'exact' },
    { book: 2, speaker: 'Socrates', start: 20, accuracy: 'exact' },
    { book: 2, speaker: 'Glaucon', start: 30, accuracy: 'exact' },
  ],
};

// Each rule gets its own terms, each with a SINGLE occurrence, so a test can
// isolate one boundary without a nearer accidental pairing satisfying it.
//   alpha@2, beta@4   — same line, same turn (plain proximity)
//   delta@3           — between them, for the phrase run "delta beta"
//   epsilon@8 (turn 1) / zeta@12 (turn 2) — a turn straddle inside book 1
//   eta@19 (last of book 1) / theta@21 (first of book 2) — a book edge
const form: Record<string, [number, number][]> = {
  alpha: [[0, 2]],
  beta: [[0, 4]],
  delta: [[0, 3]],
  epsilon: [[0, 8]],
  zeta: [[0, 12]],
  eta: [[0, 19]],
  theta: [[1, 1]],
  // For the greedy counterexample: kappa occurs TWICE, and only the later
  // occurrence lets all three terms fit one window.
  iota: [[0, 10]],
  kappa: [[0, 5], [0, 12]],
  lambda: [[0, 18]],
  // Either side of the column boundary at global 30, both inside book 2.
  mu: [[1, 9]],    // global 29, last token of 357a
  nu: [[2, 0]],    // global 30, first token of 357b
};

function json(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response);
}

const opts = (over: Partial<ComboOptions> = {}): ComboOptions => ({
  window: COMBO_WINDOW_DEFAULT, unit: 'words', ordered: false, crossTurn: true, ...over,
});
const slot = (...terms: string[]) => ({ kind: 'form' as const, terms });

describe('searchCombo', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const path = String(url);
      if (path.endsWith('/meta.json')) return json(meta);
      if (path.endsWith('/offsets.json')) return json(offsets);
      if (path.endsWith('/greek_form.json')) return json(form);
      if (path.endsWith('/greek_lemma.json')) return json(form);
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('needs at least two usable slots', async () => {
    await expect(searchCombo([slot('alpha')], opts(), ['C1'])).resolves.toEqual({ results: [], failedWorks: [] });
    await expect(searchCombo([slot('alpha'), slot()], opts(), ['C2'])).resolves.toEqual({ results: [], failedWorks: [] });
    await expect(searchCombo([slot('alpha'), slot('beta')], opts(), [])).resolves.toEqual({ results: [], failedWorks: [] });
  });

  it('finds two terms inside the window and marks both tokens', async () => {
    const { results } = await searchCombo([slot('alpha'), slot('beta')], opts({ window: 5 }), ['C3']);
    expect(results).toHaveLength(1);
    expect(results[0].meta.id).toBe('1:327a');
    expect(results[0].grkPositions).toEqual([2, 4]);
  });

  it('respects the window size', async () => {
    // alpha@2 and the nearest beta@4 are 2 apart, so a window of 1 excludes it.
    const { results } = await searchCombo([slot('alpha'), slot('beta')], opts({ window: 1 }), ['C4']);
    expect(results).toHaveLength(0);
  });

  it('is unordered by default and order-locked on request', async () => {
    // beta@4 comes after alpha@2, so "beta then alpha" only matches unordered.
    const un = await searchCombo([slot('beta'), slot('alpha')], opts({ window: 5 }), ['C5']);
    expect(un.results).toHaveLength(1);
    const ord = await searchCombo([slot('beta'), slot('alpha')], opts({ window: 5, ordered: true }), ['C6']);
    expect(ord.results).toHaveLength(0);
  });

  it('never spans a book edge, however wide the window', async () => {
    // eta@19 (last of book 1) and theta@21 (first of book 2) are 2 apart.
    const { results } = await searchCombo([slot('eta'), slot('theta')], opts({ window: COMBO_WINDOW_MAX }), ['C7']);
    expect(results).toHaveLength(0);
  });

  it('keeps turn-straddling hits by default and drops them when asked', async () => {
    // epsilon@8 (turn 1) and zeta@12 (turn 2) are 4 apart, same book.
    const keep = await searchCombo([slot('epsilon'), slot('zeta')], opts({ window: 12 }), ['C8']);
    expect(keep.results).toHaveLength(1);
    const drop = await searchCombo([slot('epsilon'), slot('zeta')], opts({ window: 12, crossTurn: false }), ['C9']);
    expect(drop.results).toHaveLength(0);
  });

  it('measures by line when the unit is a line', async () => {
    // alpha@2 and beta@4 share the first line (offsets 0-4). The line is a
    // proximity measure only — no line number is ever reported.
    const { results } = await searchCombo([slot('alpha'), slot('beta')], opts({ unit: 'line' }), ['C10']);
    expect(results[0].grkPositions).toEqual([2, 4]);
    // epsilon@8 is on the next line, so it shares no line with alpha, however close.
    const none = await searchCombo([slot('alpha'), slot('epsilon')], opts({ unit: 'line' }), ['C11']);
    expect(none.results).toHaveLength(0);
  });

  it('measures by turn when the unit is a turn', async () => {
    // zeta@12 and eta@19 are 7 apart — outside the default 5-word window, but
    // both sit in book 1's second turn (offsets 10-19).
    const { results } = await searchCombo([slot('zeta'), slot('eta')], opts({ unit: 'turn' }), ['C12']);
    expect(results[0].grkPositions).toEqual([12, 19]);
  });

  it('accepts a wildcard in a slot, including inside a phrase run', async () => {
    const wild = await searchCombo([slot('alph*'), slot('bet*')], opts({ window: 5 }), ['CW1']);
    expect(wild.results[0].grkPositions).toEqual([2, 4]);
    const phrase = await searchCombo(
      [{ kind: 'phrase', terms: ['delt*', 'beta'] }, slot('alpha')],
      opts({ window: 5 }), ['CW2'],
    );
    expect(phrase.results[0].grkPositions).toEqual([2, 3, 4]);
  });

  // Combo terms go through the same one wildcard rule as the search box: a star
  // that is not the last character is not a prefix wildcard, so the slot matches
  // nothing rather than quietly widening to every word beginning "alph".
  it('does not read a mid-word star in a slot as a prefix wildcard', async () => {
    const mid = await searchCombo([slot('alph*a'), slot('bet*')], opts({ window: 5 }), ['CW1']);
    expect(mid.results).toHaveLength(0);
  });

  // Regression: taking each slot's EARLIEST feasible hit missed real matches.
  // iota@10, kappa@5 and @12, lambda@18. The assignment 10/12/18 has extent 8
  // and fits a window of 8; picking kappa@5 first pins the extent at 5-10 and
  // puts lambda@18 out of reach, so a greedy scan reported nothing at all.
  it('finds a window that needs a later occurrence than the first feasible one', async () => {
    const { results } = await searchCombo(
      [slot('iota'), slot('kappa'), slot('lambda')], opts({ window: 8 }), ['CG1'],
    );
    expect(results).toHaveLength(1);
    expect(results[0].grkPositions).toEqual([10, 12, 18]);
  });

  it('still rejects that group when the window is genuinely too small', async () => {
    const { results } = await searchCombo(
      [slot('iota'), slot('kappa'), slot('lambda')], opts({ window: 7 }), ['CG2'],
    );
    expect(results).toHaveLength(0);
  });

  it('marks both halves of a window that crosses a section boundary', async () => {
    // mu@29 ends section 357a and nu@30 opens 357b, same book. The match used
    // to be filed under 357a with nu dropped, so the reader saw a hit with one
    // of its terms missing.
    const { results } = await searchCombo([slot('mu'), slot('nu')], opts({ window: 5 }), ['CX1']);
    expect(results.map((r) => [r.meta.id, r.grkPositions])).toEqual([
      ['2:357a', [9]],
      ['2:357b', [0]],
    ]);
  });

  it('will not satisfy two identical slots with one token', async () => {
    // alpha occurs once, so "alpha near alpha" has nothing to pair it with.
    const one = await searchCombo([slot('alpha'), slot('alpha')], opts({ window: 5 }), ['CD1']);
    expect(one.results).toHaveLength(0);
    // kappa occurs at 5 and 12 — two genuine occurrences 7 apart.
    const two = await searchCombo([slot('kappa'), slot('kappa')], opts({ window: 8 }), ['CD2']);
    expect(two.results[0].grkPositions).toEqual([5, 12]);
  });

  it('lets two DIFFERENT slots match the same token', async () => {
    // A lemma slot and a form slot both landing on alpha is the "λόγος in the
    // nominative" shape, and must keep working.
    const { results } = await searchCombo(
      [{ kind: 'lemma', terms: ['alpha'] }, slot('alpha')], opts({ window: 5 }), ['CD3'],
    );
    expect(results[0].grkPositions).toEqual([2]);
  });

  it('unions the heads a lemma slot carries', async () => {
    const { results } = await searchCombo(
      [{ kind: 'lemma', terms: ['beta', 'zeta'] }, slot('alpha')],
      opts({ window: 5 }), ['C13'],
    );
    expect(results[0].grkPositions).toEqual([2, 4]);
  });

  it('caps the window rather than trusting the caller', async () => {
    // A window past the cap must not quietly reach across the book edge.
    const { results } = await searchCombo([slot('eta'), slot('theta')], opts({ window: 9999 }), ['C14']);
    expect(results).toHaveLength(0);
  });

  // The window bounds the WHOLE match, not each slot's distance from the first
  // one. Measured from slot 0 these two orderings disagree, and a window of W
  // would quietly admit a span of 2W.
  it('gives the same unordered result however the slots are ordered', async () => {
    // alpha@2, beta@4, epsilon@8: the extent is 6, so W=5 must reject and W=6
    // must accept, whichever slot is listed first.
    for (const order of [['alpha', 'beta', 'epsilon'], ['beta', 'alpha', 'epsilon'], ['epsilon', 'beta', 'alpha']]) {
      const slots = order.map((t) => slot(t));
      const tight = await searchCombo(slots, opts({ window: 5 }), [`CO5-${order[0]}`]);
      expect(tight.results, `W=5 with ${order.join(',')}`).toHaveLength(0);
      const loose = await searchCombo(slots, opts({ window: 6 }), [`CO6-${order[0]}`]);
      expect(loose.results, `W=6 with ${order.join(',')}`).toHaveLength(1);
    }
  });

  it('keeps a phrase inside the unit it is measured in', async () => {
    // The first line is offsets 0-4, so the run "delta beta" at 3-4 fits, but a
    // run starting at 4 would spill into the next line and must not count as
    // same-line.
    const { results } = await searchCombo(
      [{ kind: 'phrase', terms: ['delta', 'beta'] }, slot('alpha')],
      opts({ unit: 'line' }), ['CO7'],
    );
    expect(results[0].grkPositions).toEqual([2, 3, 4]);
  });

  it('reports ambiguity per slot, not per window', async () => {
    // A lexical slot is certain whatever a neighbouring slot's parse allows;
    // labelling it with the other slot's alternatives would attribute
    // morphology to the wrong word.
    const { results } = await searchCombo([slot('alpha'), slot('beta')], opts({ window: 5 }), ['CO8']);
    expect(results[0].grammar).toEqual([
      { values: {}, certain: true },
      { values: {}, certain: true },
    ]);
  });

  // Each later slot can be placed relative to the FIRST slot.
  describe('slot relation', () => {
    it('near accepts a hit on either side', async () => {
      const { results } = await searchCombo(
        [slot('beta'), { kind: 'form', terms: ['alpha'], relation: 'near' }],
        opts({ window: 5 }), ['CR1'],
      );
      expect(results).toHaveLength(1);
    });

    it('before requires the slot to end at or before the first slot begins', async () => {
      // alpha@2 is before beta@4.
      const ok = await searchCombo(
        [slot('beta'), { kind: 'form', terms: ['alpha'], relation: 'before' }],
        opts({ window: 5 }), ['CR2'],
      );
      expect(ok.results).toHaveLength(1);
      // epsilon@8 is after beta@4, so "before" must reject it.
      const no = await searchCombo(
        [slot('beta'), { kind: 'form', terms: ['epsilon'], relation: 'before' }],
        opts({ window: 5 }), ['CR3'],
      );
      expect(no.results).toHaveLength(0);
    });

    it('after requires the slot to begin at or after the first slot ends', async () => {
      const ok = await searchCombo(
        [slot('beta'), { kind: 'form', terms: ['epsilon'], relation: 'after' }],
        opts({ window: 5 }), ['CR4'],
      );
      expect(ok.results).toHaveLength(1);
      const no = await searchCombo(
        [slot('beta'), { kind: 'form', terms: ['alpha'], relation: 'after' }],
        opts({ window: 5 }), ['CR5'],
      );
      expect(no.results).toHaveLength(0);
    });

    it('places each slot against the first, not against its predecessor', async () => {
      // Anchor delta@3: alpha@2 before it, beta@4 after it. Both hold only
      // because each is measured against delta, not against each other.
      const { results } = await searchCombo(
        [
          slot('delta'),
          { kind: 'form', terms: ['alpha'], relation: 'before' },
          { kind: 'form', terms: ['beta'], relation: 'after' },
        ],
        opts({ window: 5 }), ['CR6'],
      );
      expect(results[0].grkPositions).toEqual([2, 3, 4]);
    });

    it('measures a preceding phrase by its end, not its start', async () => {
      // The run "delta beta" occupies 3-4, so it does NOT end before beta@4;
      // anchoring on epsilon@8 it does end before, and is accepted.
      const { results } = await searchCombo(
        [slot('epsilon'), { kind: 'phrase', terms: ['delta', 'beta'], relation: 'before' }],
        opts({ window: 5 }), ['CR7'],
      );
      expect(results[0].grkPositions).toEqual([3, 4, 8]);
    });
  });

  it('treats a phrase slot as a run and reports every token in it', async () => {
    // "delta beta" is an adjacent run at 3-4; alpha@2 sits just before it.
    const { results } = await searchCombo(
      [{ kind: 'phrase', terms: ['delta', 'beta'] }, slot('alpha')],
      opts({ window: 5 }), ['C15'],
    );
    expect(results[0].grkPositions).toEqual([2, 3, 4]);
  });
});

// -- Grammar, reachable only as a combo slot -------------------------------
//
// A standalone grammatical query returns the corpus, not a result, so grammar
// is exposed as a filter on a lexical slot and has no entry point of its own.
// 12 tokens in one segment, keyed by global offset:
//   1  "fem nom sg" (sole reading)
//   6  "fem nom/voc sg" (ONE analysis, two possible cases)
//   11 two analyses, nom sg and acc pl
// alpha@0, beta@5 and gamma@10 sit one token before each of them, so a window
// of 1 pins the grammatical slot to exactly one of the three.
const grammarDict = {
  token_count: 12,
  width: 2,
  categories: ['case', 'gender', 'number'],
  reserved: { unkeyed: 0, unanalysed: 1 },
  sigs: [
    [],
    [],
    [{ gender: ['fem'], case: ['nom'], number: ['sg'] }],
    [{ gender: ['fem'], case: ['nom', 'voc'], number: ['sg'] }],
    [
      { gender: ['fem'], case: ['nom'], number: ['sg'] },
      { gender: ['fem'], case: ['acc'], number: ['pl'] },
    ],
  ],
};
const grammarOffsets = {
  token_count: 12,
  seg_base_offset: [0],
  segments: [{ book: 1, column: '34b', line_runs: [[1, 6], [2, 6]] }],
  book_bounds: [{ book: 1, start: 0 }],
  turn_bounds: [{ book: 1, speaker: 'Socrates', start: 0, accuracy: 'exact' }],
};
const grammarColumn = Uint16Array.from([0, 2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4]);
const grammarForm: Record<string, [number, number][]> = {
  alpha: [[0, 0]],
  beta: [[0, 5]],
  gamma: [[0, 10]],
};

describe('grammar as a combo slot', () => {
  const mock = (over: { offsets?: Record<string, unknown>; dict?: Record<string, unknown> } = {}) => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const path = String(url);
      if (path.endsWith('/meta.json')) return json([{ id: '1:34b', book: 1, column: '34b', greek_head: '', greek_tokens: '', english_head: '' }]);
      if (path.endsWith('/offsets.json')) return json({ ...grammarOffsets, ...over.offsets });
      if (path.endsWith('/grammar-dict.json')) return json({ ...grammarDict, ...over.dict });
      if (path.endsWith('/greek_form.json')) return json(grammarForm);
      if (path.endsWith('/grammar-col.bin')) {
        return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(grammarColumn.buffer) } as Response);
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
    });
  };
  beforeEach(() => mock());
  afterEach(() => vi.restoreAllMocks());

  const gram = (query: Record<string, string>) => ({ kind: 'grammatical' as const, query });

  it('filters a lexical hit by a grammatical predicate', async () => {
    const { results } = await searchCombo([slot('alpha'), gram({ case: 'nom' })], opts({ window: 1 }), ['GC1']);
    expect(results).toHaveLength(1);
    expect(results[0].grkPositions).toEqual([0, 1]);
  });

  it('calls a sole unambiguous reading certain', async () => {
    const { results } = await searchCombo([slot('alpha'), gram({ case: 'nom' })], opts({ window: 1 }), ['GC2']);
    expect(results[0].grammar![1]).toEqual({ values: { case: ['nom'] }, certain: true });
  });

  // The honesty tier. Both of these would read as a single certain parse if
  // ambiguity were counted as "number of analysis records".
  it('does not call a syncretic single analysis certain', async () => {
    const { results } = await searchCombo([slot('beta'), gram({ case: 'nom' })], opts({ window: 1 }), ['GC3']);
    expect(results[0].grammar![1]).toEqual({ values: { case: ['nom', 'voc'] }, certain: false });
  });

  it('does not call a multi-analysis token certain', async () => {
    const { results } = await searchCombo([slot('gamma'), gram({ case: 'nom' })], opts({ window: 1 }), ['GC4']);
    expect(results[0].grammar![1]).toEqual({ values: { case: ['acc', 'nom'] }, certain: false });
  });

  it('requires one single reading to satisfy every part of the query', async () => {
    // Token 11 licenses nom (reading 1) and pl (reading 2), but no reading
    // licenses both — a per-category union would wrongly match it.
    const { results } = await searchCombo(
      [slot('gamma'), gram({ case: 'nom', number: 'pl' })], opts({ window: 1 }), ['GC5'],
    );
    expect(results).toHaveLength(0);
  });

  // Grammar is a filter on a lexical query and nothing else. Two grammatical
  // slots satisfy "at least two usable slots" while still being a standalone
  // grammar query, which returns the corpus rather than a result.
  it('rejects a combo with no lexical slot', async () => {
    const both = await searchCombo(
      [gram({ case: 'nom' }), gram({ gender: 'fem' })], opts({ window: 5 }), ['GC7'],
    );
    expect(both).toEqual({ results: [], failedWorks: [] });
    const one = await searchCombo([gram({ case: 'nom' })], opts({ window: 5 }), ['GC8']);
    expect(one).toEqual({ results: [], failedWorks: [] });
    // The same grammatical predicate beside a lexical slot is still allowed.
    const anchored = await searchCombo(
      [slot('alpha'), gram({ case: 'nom' })], opts({ window: 1 }), ['GC9'],
    );
    expect(anchored.results).toHaveLength(1);
  });

  it('refuses a dictionary and offsets built from different runs', async () => {
    // token_count is the build fingerprint. The column here is exactly the
    // right LENGTH for the offset space (12), so the column-length check cannot
    // catch this and only `dict.token_count !== offsets.token_count` can: the
    // dictionary claims 99 tokens, the offsets 12. Remove that one comparison
    // and the control below is what this query returns instead of throwing.
    const control = await searchCombo(
      [slot('alpha'), gram({ case: 'nom' })], opts({ window: 1 }), ['GC10'],
    );
    expect(control.results).toHaveLength(1);
    mock({ dict: { token_count: 99 } });
    await expect(
      searchCombo([slot('alpha'), gram({ case: 'nom' })], opts({ window: 1 }), ['GC11']),
    ).rejects.toThrow(/search index/);
  });
});
