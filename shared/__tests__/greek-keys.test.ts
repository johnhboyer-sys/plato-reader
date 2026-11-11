// The on-screen Greek keyboard's edits (lib/greek-keys): a key types at the
// caret, a mark joins the letter before the caret as the Beta Code box
// composes it, and backspace takes a whole letter with its marks.
import { describe, expect, it } from 'vitest';
import { addMark, deleteBack, GREEK_KEYS, GREEK_MARKS, insertText } from '../lib/greek-keys';
import { liveGreek } from '../lib/betacode';

const M = Object.fromEntries(GREEK_MARKS.map((m) => [m.name, m.mark]));

describe('greek keys', () => {
  it('has the 24 letters, final sigma, and the seven marks', () => {
    expect(GREEK_KEYS.join('')).toBe('αβγδεζηθικλμνξοπρστυφχψως');
    expect(GREEK_MARKS.map((m) => m.name)).toEqual([
      'smooth breathing', 'rough breathing', 'acute', 'grave', 'circumflex', 'diaeresis', 'iota subscript',
    ]);
  });

  it('types at the caret, over a selection', () => {
    expect(insertText('λγος', 1, 1, 'ο')).toEqual({ value: 'λογος', caret: 2 });
    expect(insertText('λxyος', 1, 3, 'ογ')).toEqual({ value: 'λογος', caret: 3 });
  });

  it('joins a mark to the letter before the caret, composed as the Beta Code box composes it', () => {
    expect(addMark('ψυχη', 4, M.acute)).toEqual({ value: 'ψυχή', caret: 4 });
    // In any order, breathing then accent then subscript.
    const a = addMark('α', 1, M['iota subscript'])!;
    const b = addMark(a.value, a.caret, M.acute)!;
    const c = addMark(b.value, b.caret, M['rough breathing'])!;
    expect(c.value).toBe('ᾅ');
    expect(c.value).toBe(liveGreek('a(/|'));
    // Mid-word: the caret stays after the letter.
    expect(addMark('λογος', 2, M.acute)).toEqual({ value: 'λόγος', caret: 2 });
    // A capital takes its marks too.
    expect(addMark('Α', 1, M['smooth breathing'])?.value).toBe('Ἀ');
  });

  it('replaces a mark of the same kind rather than stacking it', () => {
    expect(addMark('ά', 1, M.grave)?.value).toBe('ὰ');
    expect(addMark('ἀ', 1, M['rough breathing'])?.value).toBe('ἁ');
    expect(addMark('ά', 1, M['smooth breathing'])?.value).toBe('ἄ');
  });

  it('does nothing with no Greek letter before the caret', () => {
    expect(addMark('', 0, M.acute)).toBeNull();
    expect(addMark('λόγος ', 6, M.acute)).toBeNull();
    expect(addMark('log', 3, M.acute)).toBeNull();
  });

  it('backspace takes the letter before the caret with its marks, or the selection', () => {
    expect(deleteBack('ψυχή', 4, 4)).toEqual({ value: 'ψυχ', caret: 3 });
    expect(deleteBack('ψυχή', 5, 5)).toEqual({ value: 'ψυχ', caret: 3 });
    expect(deleteBack('λόγος', 1, 3)).toEqual({ value: 'λος', caret: 1 });
    expect(deleteBack('', 0, 0)).toEqual({ value: '', caret: 0 });
  });
});
