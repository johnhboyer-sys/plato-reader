import { describe, expect, it } from 'vitest';
import { lineRenderParts, buildTurnRows, buildEnglishTurnBlocks, type SpeakerEvent } from '../lib/speakers';
import type { Token, GreekLine, TurnPair, EnglishTurn } from '../lib/data';

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

describe('buildTurnRows — turn-paired dialogue rows', () => {
  const line = (n: number, text: string, ts: [string, number][]): GreekLine => ({
    n, text, tokens: ts.map(([t, o]) => tok(t, o)),
  });
  // Compact projection of a row's Greek: [lineNumber, cont, [part texts]].
  const grk = (row: { greek: { n: number; cont: boolean; parts: ReturnType<typeof lineRenderParts> }[] }) =>
    row.greek.map((l) => [l.n, l.cont, texts(l.parts)]);

  it('splits a two-turn segment into one row per turn (no leading row)', () => {
    const greek = [line(1, 'α β.', [['α', 0], ['β', 2]]), line(5, 'γ δ.', [['γ', 0], ['δ', 2]])];
    const events: SpeakerEvent[] = [
      { line: 1, offset: 0, label: 'ΣΩ.' },
      { line: 5, offset: 0, label: 'ΕΥΘ.' },
    ];
    const english = 'Hello. Goodbye.';
    const pairs: TurnPair[] = [
      { g: { line: 1, offset: 0 }, e: { offset: 0 }, speaker: 'Socrates', display: 'Soc.' },
      { g: { line: 5, offset: 0 }, e: { offset: 7 }, speaker: 'Euthyphro', display: 'Euth.' },
    ];
    const rows = buildTurnRows(greek, events, english, pairs);
    expect(rows.map((r) => [r.lead, r.display, r.english])).toEqual([
      [false, 'Soc.', 'Hello.'],
      [false, 'Euth.', 'Goodbye.'],
    ]);
    // Each row's Greek is exactly that turn's line, led by its siglum.
    expect(grk(rows[0])).toEqual([[1, false, ['«ΣΩ.»', 'α', ' ', 'β', '.']]]);
    expect(grk(rows[1])).toEqual([[5, false, ['«ΕΥΘ.»', 'γ', ' ', 'δ', '.']]]);
  });

  it('emits a leading continuation row and rebases a mid-line turn start', () => {
    // The segment opens mid-speech (tail of a turn begun earlier); the first NEW
    // turn starts at offset 2 of line 1.
    const greek = [line(1, 'α β γ', [['α', 0], ['β', 2], ['γ', 4]])];
    const events: SpeakerEvent[] = [{ line: 1, offset: 2, label: 'ΣΩ.' }];
    const english = 'tail. New speech.';
    const pairs: TurnPair[] = [
      { g: { line: 1, offset: 2 }, e: { offset: 6 }, speaker: 'Socrates', display: 'Soc.' },
    ];
    const rows = buildTurnRows(greek, events, english, pairs);
    expect(rows).toHaveLength(2);
    // Leading row: no lead-in, the pre-turn Greek head (line kept, gets its id).
    expect(rows[0].lead).toBe(true);
    expect(rows[0].english).toBe('tail.');
    expect(grk(rows[0])).toEqual([[1, false, ['α', ' ']]]);
    // Turn row: the tail of line 1 is a continuation (no repeated id), and the
    // siglum lead-in sits at the rebased offset 0.
    expect(rows[1].display).toBe('Soc.');
    expect(rows[1].english).toBe('New speech.');
    expect(grk(rows[1])).toEqual([[1, true, ['«ΣΩ.»', 'β', ' ', 'γ']]]);
  });

  it('renders a dash turn with a null display', () => {
    const greek = [line(1, 'α', [['α', 0]])];
    const events: SpeakerEvent[] = [{ line: 1, offset: 0, label: '—' }];
    const pairs: TurnPair[] = [
      { g: { line: 1, offset: 0 }, e: { offset: 0 }, speaker: null, display: null },
    ];
    const rows = buildTurnRows(greek, events, 'Yes.', pairs);
    expect(rows[0].display).toBeNull();
    expect(rows[0].english).toBe('Yes.');
  });

  it('splits a single line carrying two turns, keeping its id on the first only', () => {
    const greek = [line(1, 'α β γ δ', [['α', 0], ['β', 2], ['γ', 4], ['δ', 6]])];
    const events: SpeakerEvent[] = [
      { line: 1, offset: 0, label: '—' },
      { line: 1, offset: 4, label: '—' },
    ];
    const pairs: TurnPair[] = [
      { g: { line: 1, offset: 0 }, e: { offset: 0 }, speaker: null, display: null },
      { g: { line: 1, offset: 4 }, e: { offset: 4 }, speaker: null, display: null },
    ];
    const rows = buildTurnRows(greek, events, 'Aa. Bb.', pairs);
    expect(grk(rows[0])).toEqual([[1, false, ['«—»', 'α', ' ', 'β', ' ']]]);
    expect(grk(rows[1])).toEqual([[1, true, ['«—»', 'γ', ' ', 'δ']]]);
    expect(rows.map((r) => r.english)).toEqual(['Aa.', 'Bb.']);
  });

  it('returns no rows when there are no pairs', () => {
    expect(buildTurnRows([line(1, 'α', [['α', 0]])], [], 'x', [])).toEqual([]);
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
