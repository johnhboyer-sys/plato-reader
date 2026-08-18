import { describe, expect, it } from 'vitest';
import { lineRenderParts, buildFlowRows, buildEnglishTurnBlocks, labelSuppression, type SpeakerEvent, type FlowRow } from '../lib/speakers';
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

  it('drops a genuinely unlocatable token rather than printing a phantom', () => {
    // A token whose surface really isn't in `text` (shouldn't happen) emits no
    // part at all — a phantom atom would print a word the line doesn't have.
    // The verbatim text still renders in full.
    const parts = lineRenderParts('βγ', [tok('α', 0)]);
    expect(kinds(parts)).toEqual(['text']);
    expect(texts(parts)).toEqual(['βγ']);
  });
});

describe('lineRenderParts — editorial sigla inside a word', () => {
  // Letters 362a line 5: the OCT supplies <τα> inside ἔπειτα, so the token
  // surface doesn't occur verbatim and a plain indexOf misses it. The word must
  // print ONCE, in its bracketed form, and stay clickable.
  it('matches a token across an angle-bracket supplement', () => {
    const text = 'ὡς ᾠόμεθα, ἔπει<τα> καὶ';
    const tokens = [tok('ὡς', 0), tok('ᾠόμεθα', 3), tok('ἔπειτα', 11), tok('καὶ', 20)];
    const parts = lineRenderParts(text, tokens);
    // The rendered line is byte-identical to the source text.
    expect(texts(parts).join('')).toBe(text);
    expect(kinds(parts)).toEqual(['token', 'text', 'token', 'text', 'token', 'text', 'token']);
    // One part for the supplemented word, printed verbatim, carrying its Token.
    expect(parts[4]).toMatchObject({ kind: 'token', text: 'ἔπει<τα>', tok: tokens[2] });
    expect(texts(parts).filter((t) => t.includes('ἔπει'))).toHaveLength(1);
  });

  it('matches a token across a square-bracket deletion at the line head', () => {
    // Philebus 52d line 1: "[προς]θῶμεν".
    const text = '[προς]θῶμεν αὐτὰς';
    const tokens = [tok('προςθῶμεν', 0), tok('αὐτὰς', 12)];
    const parts = lineRenderParts(text, tokens);
    expect(texts(parts).join('')).toBe(text);
    expect(kinds(parts)).toEqual(['text', 'token', 'text', 'token']);
    expect(parts[1]).toMatchObject({ kind: 'token', text: 'προς]θῶμεν', tok: tokens[0] });
  });

  it('leaves a phrase-level closer outside a word whose bracket closed mid-word', () => {
    // Cratylus 389e "ἀ<μφι>γνοεῖν" and Laws 756a "ἀντι<προ>βολὴν" close their
    // bracket INSIDE the word, so nothing is owing at its end. A closer right
    // after the word is then the phrase's, not the word's, and must stay out of
    // the clickable span (in the corpus a "·" or space follows, so this is the
    // adversarial form of those two lines).
    const text = '[ἀ<μφι>γνοεῖν] δὲ';
    const tokens = [tok('ἀμφιγνοεῖν', 1), tok('δὲ', 14)];
    const parts = lineRenderParts(text, tokens);
    expect(texts(parts).join('')).toBe(text);
    // The closer joins the following gap (gaps split only at speaker events);
    // what matters is that it is OUTSIDE the clickable token span.
    expect(texts(parts)).toEqual(['[', 'ἀ<μφι>γνοεῖν', '] ', 'δὲ']);
    expect(parts.find((p) => p.kind === 'token')).toMatchObject({ text: 'ἀ<μφι>γνοεῖν' });
  });

  it('keeps speaker lead-ins positioned around a bracketed word', () => {
    const text = 'ἔπει<τα> καὶ';
    const tokens = [tok('ἔπειτα', 0), tok('καὶ', 9)];
    const events: SpeakerEvent[] = [{ line: 1, offset: 9, label: 'ΣΩ.' }];
    const parts = lineRenderParts(text, tokens, events);
    expect(texts(parts)).toEqual(['ἔπει<τα>', ' ', '«ΣΩ.»', 'καὶ']);
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

  it('never doubles a bracketed word when a row anchor cuts inside its sigla', () => {
    // Row anchors carry mid-line offsets, and they move on every rebuild — so a
    // cut can land INSIDE a bracketed token's verbatim span ("ἔπει|<τα>"). The
    // token is then filtered into the first slice while its text straddles the
    // boundary. It must not print twice: the word loses its click target on
    // that row, and the Greek still reads verbatim across the two slices.
    const brk = [
      seg('3a', [line(1, 'ἔπει<τα> καὶ', [['ἔπειτα', 0], ['καὶ', 9]])]),
    ];
    const flow: TurnFlow = {
      leadE: null,
      turns: [
        { s: 'Socrates', d: 'Soc.', g: { c: '3a', n: 1, o: 0 }, e: 'One.', p: true },
        // Cut at offset 5 — between "ἔπει" and "<τα>", inside the token span.
        { s: 'Euthyphro', d: 'Euth.', g: { c: '3a', n: 1, o: 5 }, e: 'Two.', p: true },
      ],
    };
    const rows = buildFlowRows(brk, flow);
    // The two slices concatenate to the source line, unaltered.
    const rendered = rows.flatMap((r) => r.greek).flatMap((l) => l.parts)
      .filter((p) => p.kind !== 'speaker').map((p) => p.text).join('');
    expect(rendered).toBe('ἔπει<τα> καὶ');
    // The straddled word appears exactly once, and as plain text (no phantom
    // token part duplicating it before the verbatim run).
    expect(grk(rows[0])).toEqual([['3a', 1, false, '3a', ['ἔπει<']]]);
    expect(rows[0].greek[0].parts.filter((p) => p.kind === 'token')).toHaveLength(0);
    expect(grk(rows[1])).toEqual([['3a', 1, true, null, ['τα> ', 'καὶ']]]);
  });

  it('merges a Greek-bearing same-speaker residual (section split mid-speech) into the previous row', () => {
    const flow: TurnFlow = {
      leadE: null,
      turns: [
        { s: 'Socrates', d: 'Soc.', g: { c: '2a', n: 1, o: 0 }, e: 'One.', p: true },
        // Section 2b opens mid-speech: no top-level English, the continuation is
        // a same-speaker folded sub. It must merge into row 0, not make its own.
        { s: null, d: null, g: { c: '2b', n: 1, o: 0 }, e: null, p: false,
          sub: [{ s: 'Socrates', d: 'Soc.', e: 'Still Socrates.' }] },
      ],
    };
    const rows = buildFlowRows(segments, flow);
    expect(rows.length).toBe(1);
    expect([rows[0].display, rows[0].english]).toEqual(['Soc.', 'One.']);
    // The sub folds in as a continuation paragraph (no repeated label)...
    expect(rows[0].englishCont).toEqual([{ text: 'Still Socrates.', ep: undefined }]);
    // ...and the section-2b Greek + its tick merge into the same row.
    expect(rows[0].ticks).toEqual(['2a', '2b']);
    expect(grk(rows[0]).some((l) => l[0] === '2b')).toBe(true);
  });

  it('does NOT merge a residual whose folded speaker differs (never mis-attribute)', () => {
    const flow: TurnFlow = {
      leadE: null,
      turns: [
        { s: 'Socrates', d: 'Soc.', g: { c: '2a', n: 1, o: 0 }, e: 'One.', p: true },
        { s: null, d: null, g: { c: '2b', n: 1, o: 0 }, e: null, p: false,
          sub: [{ s: 'Euthyphro', d: 'Euth.', e: 'Different speaker.' }] },
      ],
    };
    const rows = buildFlowRows(segments, flow);
    expect(rows.length).toBe(2);        // kept as its own one-sided row
    expect(rows[1].sub?.[0]?.d).toBe('Euth.');
  });

  it('does NOT merge a same-speaker residual whose folded display is a real heading', () => {
    // A narrated frame's section rubric ("The Speech of Pausanias") whose
    // canonical speaker is the narrator is a heading, not a redundant label —
    // it must keep its own row so the heading survives.
    const flow: TurnFlow = {
      leadE: null,
      turns: [
        { s: 'Apollodorus', d: 'Ap.', g: { c: '2a', n: 1, o: 0 }, e: 'Frame.', p: true },
        { s: null, d: null, g: { c: '2b', n: 1, o: 0 }, e: null, p: false,
          sub: [{ s: 'Apollodorus', d: 'The Speech of Pausanias', e: 'A speech.' }] },
      ],
    };
    const rows = buildFlowRows(segments, flow);
    expect(rows.length).toBe(2);
    expect(rows[1].sub?.[0]?.d).toBe('The Speech of Pausanias');
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

describe('labelSuppression', () => {
  // Minimal FlowRow factory — only the fields labelSuppression reads.
  const row = (p: Partial<FlowRow>): FlowRow => ({
    lead: false, paired: true, display: null, speaker: null,
    greek: [], english: 'x', englishCont: [], ticks: [], sub: null, ...p,
  });

  it('suppresses a lead-in that repeats the same speaker + display', () => {
    const meta = labelSuppression([
      row({ speaker: 'Socrates', display: 'Soc.' }),
      row({ speaker: 'Socrates', display: 'Soc.' }),
    ]);
    expect(meta.map((m) => m.hideLead)).toEqual([false, true]);
  });

  it('keeps labels through a genuine alternation', () => {
    const meta = labelSuppression([
      row({ speaker: 'Meno', display: 'Men.' }),
      row({ speaker: 'Socrates', display: 'Soc.' }),
      row({ speaker: 'Meno', display: 'Men.' }),
    ]);
    expect(meta.map((m) => m.hideLead)).toEqual([false, false, false]);
  });

  it('keeps a folded sub whose display is a real heading (not a redundant label)', () => {
    // Codex #1: same canonical speaker (the narrator) but a rubric display.
    const meta = labelSuppression([
      row({ speaker: 'Apollodorus', display: 'Ap.' }),
      row({ speaker: null, display: null, english: null,
        sub: [{ s: 'Apollodorus', d: 'The Speech of Pausanias', e: 'A speech.' }] }),
    ]);
    expect(meta[1].hideSub).toEqual([false]); // heading kept
  });

  it('still suppresses a folded sub that repeats the same label', () => {
    const meta = labelSuppression([
      row({ speaker: 'Socrates', display: 'Soc.' }),
      row({ speaker: null, display: null, english: null,
        sub: [{ s: 'Socrates', d: 'Soc.', e: 'More.' }] }),
    ]);
    expect(meta[1].hideSub).toEqual([true]);
  });

  it('resets the floor after an em-dash turn (Codex #2)', () => {
    // Soc. → unattributed dash → Soc. again: the second Soc. must keep its label.
    const meta = labelSuppression([
      row({ speaker: 'Socrates', display: 'Soc.' }),
      row({ speaker: null, display: null }),          // em-dash turn (has English)
      row({ speaker: 'Socrates', display: 'Soc.' }),
    ]);
    expect(meta.map((m) => m.hideLead)).toEqual([false, false, false]);
  });
});

// ── Stephanus section offsets (`es`) ────────────────────────────────────────
// The gutter citation bug: a turn spanning several sections used to render one
// absolutely-positioned tick per section, ALL at the row's top-left coordinate,
// so Laches 181e-182d printed five labels on top of each other. The fix hangs
// each citation beside the prose where its section actually begins, which needs
// the pipeline's `es` offsets to survive every path that reshapes a row's
// English. These tests pin that passthrough; the geometry itself is verified in
// a real browser (happy-dom has no layout, so offsetTop here is always 0).
describe('buildFlowRows — Stephanus section offsets', () => {
  const line = (n: number, text: string): GreekLine => ({ n, text, tokens: [tok(text, 0)] });
  const seg = (column: string, greek: GreekLine[], speakers: SpeakerEvent[] = []): Segment =>
    ({ id: `1:${column}`, column, greek, english: null, speakers });

  const segments = [
    seg('181e', [line(1, 'α')], [{ line: 1, offset: 0, label: 'ΣΩ.' }]),
    seg('182a', [line(1, 'β')]),
    seg('182b', [line(1, 'γ')]),
  ];

  it('carries a multi-section turn\'s offsets onto the row', () => {
    const flow: TurnFlow = {
      leadE: null,
      turns: [{
        s: 'Socrates', d: 'Soc.', g: { c: '181e', n: 1, o: 0 }, p: true,
        e: 'Alpha Bravo Charlie',
        es: [{ o: 0, c: '181e' }, { o: 6, c: '182a' }, { o: 12, c: '182b' }],
      }],
    };
    const rows = buildFlowRows(segments, flow);
    expect(rows[0].es).toEqual([
      { o: 0, c: '181e' }, { o: 6, c: '182a' }, { o: 12, c: '182b' },
    ]);
    // One offset per section, strictly increasing: distinct offsets are what
    // put the ticks on distinct LINES rather than in a pile.
    const offs = rows[0].es!.map((s) => s.o);
    expect(offs).toEqual([...offs].sort((a, b) => a - b));
    expect(new Set(offs).size).toBe(offs.length);
  });

  it('carries offsets onto a folded sub-speech', () => {
    // The Laches case John hit: Nicias\' speech renders through `sub`, so ticks
    // dropped here vanished for 182a-d specifically.
    const flow: TurnFlow = {
      leadE: null,
      turns: [{
        s: 'Socrates', d: 'Soc.', g: { c: '181e', n: 1, o: 0 }, e: null, p: false,
        sub: [{ s: 'Nicias', d: 'Nic.', e: 'Bravo Charlie',
                es: [{ o: 0, c: '182a' }, { o: 6, c: '182b' }] }],
      }],
    };
    const rows = buildFlowRows(segments, flow);
    expect(rows[0].sub![0].es).toEqual([{ o: 0, c: '182a' }, { o: 6, c: '182b' }]);
  });

  it('keeps a merged residual\'s offsets with its own continuation text', () => {
    // A residual continuing the same speaker folds into the previous row's
    // englishCont; its offsets index THAT text, not the row's main English, so
    // they must ride the continuation entry rather than merge into row.es.
    const flow: TurnFlow = {
      leadE: null,
      turns: [
        { s: 'Socrates', d: 'Soc.', g: { c: '181e', n: 1, o: 0 }, p: true,
          e: 'Alpha', es: [{ o: 0, c: '181e' }] },
        { s: 'Socrates', d: null, g: null, e: 'Bravo Charlie', p: false,
          es: [{ o: 0, c: '182a' }, { o: 6, c: '182b' }] },
      ],
    };
    const rows = buildFlowRows(segments, flow);
    expect(rows).toHaveLength(1);
    expect(rows[0].es).toEqual([{ o: 0, c: '181e' }]);
    expect(rows[0].englishCont[0]).toMatchObject({
      text: 'Bravo Charlie',
      es: [{ o: 0, c: '182a' }, { o: 6, c: '182b' }],
    });
  });

  it('leaves es undefined on data that predates it', () => {
    // Old built JSON has no `es` anywhere; the reader detects that per BOOK and
    // falls back to a single opening tick, never the stacked list.
    const flow: TurnFlow = {
      leadE: null,
      turns: [{ s: 'Socrates', d: 'Soc.', g: { c: '181e', n: 1, o: 0 }, e: 'Alpha', p: true }],
    };
    expect(buildFlowRows(segments, flow)[0].es).toBeUndefined();
  });
});
