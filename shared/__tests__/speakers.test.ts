import { describe, expect, it } from 'vitest';
import { lineRenderParts, buildFlowRows, buildEnglishTurnBlocks, type SpeakerEvent } from '../lib/speakers';
import type { Token, GreekLine, Segment, TurnFlow, EnglishTurn } from '../lib/data';

// A token as the pipeline emits it: surface form, char offset, Beta Code key.
const tok = (t: string, o: number): Token => ({ t, o, k: '' });

// Compact projections so assertions read clearly.
const kinds = (parts: ReturnType<typeof lineRenderParts>) => parts.map((p) => p.kind);
const texts = (parts: ReturnType<typeof lineRenderParts>) =>
  parts.map((p) => (p.kind === 'speaker' ? `«${p.label}»` : p.text));

describe('lineRenderParts — token/gap split (no speakers)', () => {
  it('splits a line into clickable tokens and verbatim gaps', () => {
    const text = 'ὦ φίλε.';
    const tokens = [tok('ὦ', 0), tok('φίλε', 2)];
    const parts = lineRenderParts(text, tokens);
    expect(kinds(parts)).toEqual(['token', 'text', 'token', 'text']);
    expect(texts(parts)).toEqual(['ὦ', ' ', 'φίλε', '.']);
    // The token parts carry the original Token object for the popup lookup.
    expect(parts[0]).toMatchObject({ kind: 'token', text: 'ὦ', tok: tokens[0] });
  });

  it('is byte-identical whether events is omitted or an empty array', () => {
    const text = 'α β γ';
    const tokens = [tok('α', 0), tok('β', 2), tok('γ', 4)];
    expect(lineRenderParts(text, tokens)).toEqual(lineRenderParts(text, tokens, []));
  });

  it('keeps an unlocatable token clickable without dropping trailing text', () => {
    // A token whose surface isn't found in `text` (shouldn't happen) stays a
    // clickable zero-width atom; the tail text still renders.
    const parts = lineRenderParts('βγ', [tok('α', 0)]);
    expect(kinds(parts)).toEqual(['token', 'text']);
    expect(texts(parts)).toEqual(['α', 'βγ']);
  });
});

describe('lineRenderParts — speaker lead-ins', () => {
  const text = 'ὦ φίλε.';
  const tokens = [tok('ὦ', 0), tok('φίλε', 2)];

  it('offset 0 leads the whole line with the siglum', () => {
    const events: SpeakerEvent[] = [{ line: 1, offset: 0, label: 'ΣΩ.' }];
    const parts = lineRenderParts(text, tokens, events);
    expect(kinds(parts)).toEqual(['speaker', 'token', 'text', 'token', 'text']);
    expect(parts[0]).toEqual({ kind: 'speaker', label: 'ΣΩ.', dash: false });
  });

  it('a mid-line offset at a token boundary sits immediately before that token', () => {
    const events: SpeakerEvent[] = [{ line: 1, offset: 2, label: 'ΕΥΘ.' }];
    const parts = lineRenderParts(text, tokens, events);
    expect(kinds(parts)).toEqual(['token', 'text', 'speaker', 'token', 'text']);
    expect(texts(parts)).toEqual(['ὦ', ' ', '«ΕΥΘ.»', 'φίλε', '.']);
  });

  it('an offset strictly inside a verbatim gap splits the gap around the label', () => {
    // Two-space gap [1,3); the turn begins at offset 2, mid-gap.
    const t2 = 'α  β';
    const tk2 = [tok('α', 0), tok('β', 3)];
    const parts = lineRenderParts(t2, tk2, [{ line: 1, offset: 2, label: 'ΣΩ.' }]);
    expect(kinds(parts)).toEqual(['token', 'text', 'speaker', 'text', 'token']);
    expect(texts(parts)).toEqual(['α', ' ', '«ΣΩ.»', ' ', 'β']);
  });

  it('renders multiple turns on one line in order', () => {
    const t2 = 'α β';
    const tk2 = [tok('α', 0), tok('β', 2)];
    const events: SpeakerEvent[] = [
      { line: 1, offset: 0, label: 'ΣΩ.' },
      { line: 1, offset: 2, label: 'ΕΥΘ.' },
    ];
    const parts = lineRenderParts(t2, tk2, events);
    expect(kinds(parts)).toEqual(['speaker', 'token', 'text', 'speaker', 'token']);
    expect(texts(parts)).toEqual(['«ΣΩ.»', 'α', ' ', '«ΕΥΘ.»', 'β']);
  });

  it('flags the dialectic dash so it renders as an em-dash, not a small-caps siglum', () => {
    const parts = lineRenderParts(text, tokens, [{ line: 1, offset: 0, label: '—' }]);
    expect(parts[0]).toEqual({ kind: 'speaker', label: '—', dash: true });
  });

  it('sorts unordered events and appends a turn at/after the line end', () => {
    const t2 = 'α β';
    const tk2 = [tok('α', 0), tok('β', 2)];
    const events: SpeakerEvent[] = [
      { line: 1, offset: 99, label: 'END' }, // past the text end → trailing
      { line: 1, offset: 0, label: 'ΣΩ.' },
    ];
    const parts = lineRenderParts(t2, tk2, events);
    expect(kinds(parts)).toEqual(['speaker', 'token', 'text', 'token', 'speaker']);
    expect(texts(parts)).toEqual(['«ΣΩ.»', 'α', ' ', 'β', '«END»']);
  });

  it('does not shift the surviving token offsets (labels are outside the token stream)', () => {
    const parts = lineRenderParts(text, tokens, [{ line: 1, offset: 2, label: 'ΕΥΘ.' }]);
    const toks = parts.filter((p) => p.kind === 'token');
    expect(toks.map((p) => (p as { tok: Token }).tok.o)).toEqual([0, 2]);
  });
});

describe('buildFlowRows — whole-book turn flow', () => {
  const line = (n: number, text: string, ts: [string, number][]): GreekLine => ({
    n, text, tokens: ts.map(([t, o]) => tok(t, o)),
  });
  const seg = (column: string, greek: GreekLine[], speakers: SpeakerEvent[] = []): Segment =>
    ({ id: `1:${column}`, column, greek, english: null, speakers });
  // Compact Greek projection: [col, n, cont, tick, [part texts]].
  const grk = (row: { greek: { col: string; n: number; cont: boolean; tick: string | null; parts: ReturnType<typeof lineRenderParts> }[] }) =>
    row.greek.map((l) => [l.col, l.n, l.cont, l.tick, texts(l.parts)]);

  const segments = [
    seg('2a',
      [line(1, 'α β.', [['α', 0], ['β', 2]]), line(2, 'γ δ.', [['γ', 0], ['δ', 2]])],
      [{ line: 1, offset: 0, label: 'ΣΩ.' }, { line: 2, offset: 0, label: 'ΕΥΘ.' }]),
    seg('2b',
      [line(1, 'ε ζ.', [['ε', 0], ['ζ', 2]])],
      [{ line: 1, offset: 2, label: 'ΣΩ.' }]),
  ];

  it('renders one row per turn across section boundaries, ticks on section-first lines', () => {
    const flow: TurnFlow = {
      leadE: null,
      turns: [
        { s: 'Socrates', d: 'Soc.', g: { c: '2a', n: 1, o: 0 }, e: 'One.', p: true },
        { s: 'Euthyphro', d: 'Euth.', g: { c: '2a', n: 2, o: 0 }, e: 'Two.', p: true },
        { s: 'Socrates', d: 'Soc.', g: { c: '2b', n: 1, o: 2 }, e: 'Three.', p: true },
      ],
    };
    const rows = buildFlowRows(segments, flow);
    expect(rows.map((r) => [r.lead, r.paired, r.display, r.english])).toEqual([
      [false, true, 'Soc.', 'One.'],
      [false, true, 'Euth.', 'Two.'],
      [false, true, 'Soc.', 'Three.'],
    ]);
    // Row 1: 2a line 1 (section-first -> tick "2a").
    expect(grk(rows[0])).toEqual([['2a', 1, false, '2a', ['«ΣΩ.»', 'α', ' ', 'β', '.']]]);
    // Row 2 spans the 2a/2b section boundary: 2a line 2 + the head of 2b line 1
    // (which is 2b's first line -> tick "2b" rides it).
    expect(grk(rows[1])).toEqual([
      ['2a', 2, false, null, ['«ΕΥΘ.»', 'γ', ' ', 'δ', '.']],
      ['2b', 1, false, '2b', ['ε', ' ']],
    ]);
    expect(rows[1].ticks).toEqual(['2b']);
    // Row 3: the tail of 2b line 1 is a continuation slice (no id repeat, no tick).
    expect(grk(rows[2])).toEqual([['2b', 1, true, null, ['«ΣΩ.»', 'ζ', '.']]]);
  });

  it('emits a leading continuation row for pre-turn Greek and leadE', () => {
    const flow: TurnFlow = {
      leadE: 'tail of speech.',
      turns: [{ s: 'Euthyphro', d: 'Euth.', g: { c: '2a', n: 2, o: 0 }, e: 'New.', p: true }],
    };
    const rows = buildFlowRows(segments, flow);
    expect(rows[0].lead).toBe(true);
    expect(rows[0].english).toBe('tail of speech.');
    // The line-1 siglum event still splices in (the Greek column always shows
    // its sigla, lead row or not).
    expect(grk(rows[0])).toEqual([['2a', 1, false, '2a', ['«ΣΩ.»', 'α', ' ', 'β', '.']]]);
    expect(rows[0].ticks).toEqual(['2a']);
    expect(rows[1].english).toBe('New.');
  });

  it('renders one-sided residual rows in place', () => {
    const flow: TurnFlow = {
      leadE: null,
      turns: [
        { s: 'Socrates', d: 'Soc.', g: { c: '2a', n: 1, o: 0 }, e: 'One.', p: true },
        { s: 'Euthyphro', d: 'Euth.', g: null, e: 'Loose English.', p: false },
        { s: null, d: null, g: { c: '2a', n: 2, o: 0 }, e: null, p: false },
      ],
    };
    const rows = buildFlowRows(segments, flow);
    // Paired row's Greek runs to the NEXT Greek-bearing turn (the residual
    // English turn between them does not cut the Greek).
    expect(grk(rows[0])).toEqual([['2a', 1, false, '2a', ['«ΣΩ.»', 'α', ' ', 'β', '.']]]);
    expect(rows[1].greek).toEqual([]);
    expect(rows[1].english).toBe('Loose English.');
    expect(rows[1].paired).toBe(false);
    // Greek-only residual: its Greek runs to the book end, no English cell.
    expect(rows[2].english).toBeNull();
    expect(grk(rows[2])[0][1]).toBe(2);
  });

  it('token identity survives slicing (popup lookups keep the original Token)', () => {
    const flow: TurnFlow = {
      leadE: null,
      turns: [{ s: 'Socrates', d: 'Soc.', g: { c: '2b', n: 1, o: 2 }, e: 'X.', p: true }],
    };
    const rows = buildFlowRows(segments, flow);
    const lastRow = rows[rows.length - 1];
    const tokPart = lastRow.greek[0].parts.find((pt) => pt.kind === 'token');
    expect((tokPart as { tok: Token }).tok).toBe(segments[1].greek[0].tokens[1]);
  });

  it('merges a same-speaker English residual into the previous row as a continuation', () => {
    // Euthyphro 2d-3a: Fowler splits Socrates' speech into two <said> where
    // the OCT has ONE ΣΩ. turn — the second half flows under the same row.
    const flow: TurnFlow = {
      leadE: null,
      turns: [
        { s: 'Socrates', d: 'Soc.', g: { c: '2a', n: 1, o: 0 }, e: 'First half.', p: true },
        { s: 'Socrates', d: 'Soc.', g: null, e: 'And so Meletus, perhaps.', p: false },
        { s: 'Euthyphro', d: 'Euth.', g: { c: '2a', n: 2, o: 0 }, e: 'Reply.', p: true },
      ],
    };
    const rows = buildFlowRows(segments, flow);
    expect(rows).toHaveLength(2);
    expect(rows[0].english).toBe('First half.');
    expect(rows[0].englishCont).toEqual([{ text: 'And so Meletus, perhaps.', ep: undefined }]);
    expect(rows[1].english).toBe('Reply.');
  });

  it('merges an unattributed (null-speaker) English residual into the previous row', () => {
    const flow: TurnFlow = {
      leadE: null,
      turns: [
        { s: 'Socrates', d: 'Soc.', g: { c: '2a', n: 1, o: 0 }, e: 'Speech.', p: true },
        { s: null, d: null, g: null, e: 'Unattributed continuation.', p: false },
      ],
    };
    const rows = buildFlowRows(segments, flow);
    expect(rows).toHaveLength(1);
    expect(rows[0].englishCont).toEqual([{ text: 'Unattributed continuation.', ep: undefined }]);
  });

  it('keeps a different-speaker English residual as its own one-sided row', () => {
    const flow: TurnFlow = {
      leadE: null,
      turns: [
        { s: 'Socrates', d: 'Soc.', g: { c: '2a', n: 1, o: 0 }, e: 'Mine.', p: true },
        { s: 'Euthyphro', d: 'Euth.', g: null, e: 'Not his.', p: false },
      ],
    };
    const rows = buildFlowRows(segments, flow);
    expect(rows).toHaveLength(2);
    expect(rows[0].englishCont).toEqual([]);
    expect(rows[1].english).toBe('Not his.');
    expect(rows[1].greek).toEqual([]);
    expect(rows[1].paired).toBe(false);
  });

  it('returns no rows for an empty flow', () => {
    expect(buildFlowRows(segments, { leadE: null, turns: [] })).toEqual([]);
  });

  it('leaves ep/et/sub undefined for ordinary dialogue rows (no para leakage)', () => {
    const flow: TurnFlow = {
      leadE: null,
      turns: [{ s: 'Socrates', d: 'Soc.', g: { c: '2a', n: 1, o: 0 }, e: 'Hi.', p: true }],
    };
    const rows = buildFlowRows(segments, flow);
    expect(rows[0].ep).toBeUndefined();
    expect(rows[0].et).toBeUndefined();
    expect(rows[0].sub).toBeUndefined();
  });

  it('never merges a sub-bearing English residual into the previous row (sub would drop)', () => {
    // Pipeline B4 (Lysis's opening): a g:null residual whose speaker matches
    // the previous row but which carries folded sub-speeches — merging its `e`
    // into prev.englishCont would silently lose the stack.
    const flow: TurnFlow = {
      leadE: null,
      turns: [
        { s: 'Socrates', d: 'Soc.', g: { c: '2a', n: 1, o: 0 }, e: 'Speech.', p: true },
        { s: 'Socrates', d: null, g: null, e: 'Narration lead.', p: false,
          sub: [{ s: 'Hippothales', d: null, e: 'Whither away?', ep: null }] },
      ],
    };
    const rows = buildFlowRows(segments, flow);
    expect(rows).toHaveLength(2);
    expect(rows[0].englishCont).toEqual([]);
    expect(rows[1].english).toBe('Narration lead.');
    expect(rows[1].sub).toEqual([{ s: 'Hippothales', d: null, e: 'Whither away?', ep: null }]);
  });

  it('a null/empty sub does not block the same-speaker residual merge (old behavior)', () => {
    const flow: TurnFlow = {
      leadE: null,
      turns: [
        { s: 'Socrates', d: 'Soc.', g: { c: '2a', n: 1, o: 0 }, e: 'Speech.', p: true },
        { s: 'Socrates', d: null, g: null, e: 'Continuation.', p: false, sub: null },
        { s: null, d: null, g: null, e: 'More.', p: false, sub: [] },
      ],
    };
    const rows = buildFlowRows(segments, flow);
    expect(rows).toHaveLength(1);
    expect(rows[0].englishCont).toEqual([{ text: 'Continuation.', ep: undefined }, { text: 'More.', ep: undefined }]);
  });

  it('preserves ep paragraph breaks through the same-speaker residual merge (Timaeus)', () => {
    // B2: a long residual speech carries internal paragraph breaks. Merged as a
    // continuation it must keep them ({text, ep}); merged as the row's main
    // English (previous row had none) they become the row's own ep.
    const flow: TurnFlow = {
      leadE: null,
      turns: [
        { s: 'Critias', d: 'Crit.', g: { c: '2a', n: 1, o: 0 }, e: 'Lead speech.', p: true },
        { s: 'Critias', d: null, g: null, e: 'Long tale. New paragraph here.', p: false, ep: [10] },
      ],
    };
    const rows = buildFlowRows(segments, flow);
    expect(rows).toHaveLength(1);
    expect(rows[0].englishCont).toEqual([{ text: 'Long tale. New paragraph here.', ep: [10] }]);
    // Main-English variant: the residual merges into a row whose english was
    // null (a Greek-only residual), so its ep rides the row itself.
    const flow2: TurnFlow = {
      leadE: null,
      turns: [
        { s: null, d: null, g: { c: '2a', n: 1, o: 0 }, e: null, p: false },
        { s: null, d: null, g: null, e: 'Tail. Break follows here.', p: false, ep: [5] },
      ],
    };
    const rows2 = buildFlowRows(segments, flow2);
    expect(rows2).toHaveLength(1);
    expect(rows2[0].english).toBe('Tail. Break follows here.');
    expect(rows2[0].ep).toEqual([5]);
  });

  it('passes sub:null and sub:[] through on e:null rows without merging or crashing', () => {
    // Codex review finding 1's data shapes: a Greek-anchored row with e:null
    // and a null (the pipeline's explicit null) or empty sub must come out as
    // its own row — english null, sub passed through — never folded or dropped.
    const flow: TurnFlow = {
      leadE: null,
      turns: [
        { s: 'Socrates', d: 'Soc.', g: { c: '2a', n: 1, o: 0 }, e: 'Speech.', p: true },
        { s: null, d: null, g: { c: '2a', n: 2, o: 0 }, e: null, p: false, sub: null },
        { s: null, d: null, g: { c: '2b', n: 1, o: 0 }, e: null, p: false, sub: [] },
      ],
    };
    const rows = buildFlowRows(segments, flow);
    expect(rows).toHaveLength(3);
    expect(rows[1].english).toBeNull();
    expect(rows[1].sub).toBeNull();
    expect(rows[1].greek.length).toBeGreaterThan(0);
    expect(rows[2].english).toBeNull();
    expect(rows[2].sub).toEqual([]);
    expect(rows[2].greek.length).toBeGreaterThan(0);
  });

  describe('paragraph flow (narrated works, kind:"para")', () => {
    it('carries ep/et/sub through and still slices Greek for s:null rows', () => {
      const flow: TurnFlow = {
        kind: 'para',
        leadE: null,
        turns: [
          // Ordinary paragraph row: no speaker, an internal paragraph break (ep).
          { s: null, d: null, g: { c: '2a', n: 1, o: 0 }, e: 'Para one. Para two.', p: false, ep: [10] },
          // Embedded-dialogue row: a narrated paragraph carrying english.turns.
          { s: null, d: null, g: { c: '2a', n: 2, o: 0 }, e: 'Reported speech.', p: false,
            et: [{ o: 0, s: 'Socrates', d: 'Soc.' }] },
          // Section-anchored one-sided row: English cell null, sub-speeches stacked.
          { s: null, d: null, g: { c: '2b', n: 1, o: 0 }, e: null, p: false,
            sub: [{ s: 'Cephalus', d: 'Ceph.', e: 'A one-sided speech.', ep: [4] }] },
        ],
      };
      const rows = buildFlowRows(segments, flow);
      expect(rows).toHaveLength(3);
      // Row 0: passthrough ep; speaker/display null; Greek still sliced (s:null
      // rows are handled by the speaker-agnostic slicer unchanged).
      expect(rows[0].ep).toEqual([10]);
      expect(rows[0].english).toBe('Para one. Para two.');
      expect(rows[0].speaker).toBeNull();
      expect(rows[0].display).toBeNull();
      expect(rows[0].greek.length).toBeGreaterThan(0);
      // Row 1: passthrough et.
      expect(rows[1].et).toEqual([{ o: 0, s: 'Socrates', d: 'Soc.' }]);
      expect(rows[1].english).toBe('Reported speech.');
      // Row 2: e:null does NOT trigger the same-speaker English merge (that path
      // needs t.e truthy) — it lands as its own row with sub carried through.
      expect(rows[2].english).toBeNull();
      expect(rows[2].sub).toEqual([{ s: 'Cephalus', d: 'Ceph.', e: 'A one-sided speech.', ep: [4] }]);
      expect(rows[2].greek.length).toBeGreaterThan(0);
    });

    it('does not fold consecutive s:null para rows into one (each paragraph is its own row)', () => {
      // Both rows carry Greek (g resolves), so the English-residual merge (which
      // only fires when greek is empty) never runs — s:null must not collapse
      // adjacent paragraphs the way it would a null-speaker English residual.
      const flow: TurnFlow = {
        kind: 'para',
        leadE: null,
        turns: [
          { s: null, d: null, g: { c: '2a', n: 1, o: 0 }, e: 'First paragraph.', p: false },
          { s: null, d: null, g: { c: '2a', n: 2, o: 0 }, e: 'Second paragraph.', p: false },
        ],
      };
      const rows = buildFlowRows(segments, flow);
      expect(rows).toHaveLength(2);
      expect(rows[0].english).toBe('First paragraph.');
      expect(rows[1].english).toBe('Second paragraph.');
      expect(rows[0].englishCont).toEqual([]);
    });
  });
});

describe('buildEnglishTurnBlocks — fallback English turn stack', () => {
  const turn = (offset: number, speaker: string | null, display: string | null): EnglishTurn =>
    ({ offset, speaker, display });

  it('slices the prose into one block per turn, labels never inline', () => {
    // "as I have. Our Athenians…" — the two turns must come out as SEPARATE
    // blocks (the glued "…as I have.SOCRATES. Our…" defect this guards against).
    const text = 'What is new? Nothing, as I have. Our Athenians differ.';
    const turns = [turn(0, 'Euthyphro', 'Euthyphro.'), turn(33, 'Socrates', 'Socrates.')];
    const blocks = buildEnglishTurnBlocks(text, turns);
    expect(blocks).toEqual([
      { lead: false, display: 'Euthyphro.', text: 'What is new? Nothing, as I have.' },
      { lead: false, display: 'Socrates.', text: 'Our Athenians differ.' },
    ]);
  });

  it('puts pre-turn continuation text in an unlabeled leading block', () => {
    const text = 'tail of an earlier speech. A new turn.';
    const turns = [turn(27, 'Socrates', 'Soc.')];
    const blocks = buildEnglishTurnBlocks(text, turns);
    expect(blocks).toEqual([
      { lead: true, display: null, text: 'tail of an earlier speech.' },
      { lead: false, display: 'Soc.', text: 'A new turn.' },
    ]);
  });

  it('omits an empty leading block when the first turn opens the chunk', () => {
    const blocks = buildEnglishTurnBlocks('Speech.', [turn(0, 'Socrates', 'Soc.')]);
    expect(blocks).toEqual([{ lead: false, display: 'Soc.', text: 'Speech.' }]);
  });

  it('an unattributed turn keeps a null display (renders as an em-dash block)', () => {
    const blocks = buildEnglishTurnBlocks('Yes. No.', [turn(0, null, null), turn(5, null, null)]);
    expect(blocks.map((b) => [b.lead, b.display, b.text])).toEqual([
      [false, null, 'Yes.'],
      [false, null, 'No.'],
    ]);
  });


  it('drops an empty unlabeled slice (no bare em-dash paragraph) but keeps an empty labeled one', () => {
    // Adjacent boundaries with nothing between: the dash block vanishes; a
    // labeled turn keeps its attribution block even with no text.
    const blocks = buildEnglishTurnBlocks('Speech.', [
      turn(0, null, null),
      turn(0, 'Socrates', 'Soc.'),
    ]);
    expect(blocks).toEqual([{ lead: false, display: 'Soc.', text: 'Speech.' }]);
  });

  it('a chunk with no turns is a single unlabeled block (plain prose)', () => {
    expect(buildEnglishTurnBlocks('Just prose.', [])).toEqual([
      { lead: true, display: null, text: 'Just prose.' },
    ]);
  });
});
