import { describe, expect, it } from 'vitest';
import { lineRenderParts, type SpeakerEvent } from '../lib/speakers';
import type { Token } from '../lib/data';

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
