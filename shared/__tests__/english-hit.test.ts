import { describe, expect, it } from 'vitest';
import type { BookData, FlowTurn, Segment } from '../lib/data';
import { englishSnippet, markEnglishHtml, translationTexts, turnTranslationTexts } from '../lib/english-hit';
import { englishQueryUnits, englishWords } from '../lib/search';

const seg = (column: string, text = ''): Segment => ({
  id: `1:${column}`, column, greek: [], english: text ? { text, notes: [], markers: [], bekker: [] } as unknown as Segment['english'] : null,
});
const turn = (column: string | null, jowett?: string | null): FlowTurn => ({
  s: 'Socrates', d: 'Soc.', g: column ? { c: column, n: 1, o: 0 } : null, e: 'x', p: true,
  ...(jowett !== undefined ? { alt: { jowett: { e: jowett } } } : {}),
});
const book = (turns: FlowTurn[]): Pick<BookData, 'segments' | 'turnFlow'> => ({
  segments: [seg('70a', 'Can you tell me, Socrates, whether virtue can be taught?'), seg('70b', 'Meno, of old')],
  turnFlow: { leadE: null, turns },
});

describe('turnTranslationTexts', () => {
  // The same book the pipeline test files (test_translation_index.py): the
  // word positions a posting carries must count through these texts in this
  // order, or a hit lands on the wrong word.
  it('files a turn under the section its Greek starts in, in turn order', () => {
    const texts = turnTranslationTexts(book([
      turn('70a', 'Is virtue taught?'),
      turn('70a', 'I cannot say.'),
      turn('70b', 'Then let us ask.'),
    ]), 'jowett');
    expect([...texts]).toEqual([
      ['1:70a', ['Is virtue taught?', 'I cannot say.']],
      ['1:70b', ['Then let us ask.']],
    ]);
    const words = texts.get('1:70a')!.flatMap(t => englishWords(t)).map(w => w.word);
    expect(words.indexOf('virtue')).toBe(1);
    expect(words.indexOf('cannot')).toBe(4);
  });

  it('puts a residual turn with the section before it, and the first ones in the book’s first', () => {
    const texts = turnTranslationTexts(book([turn(null, 'opening'), turn('70b', 'first'), turn(null, 'stray words')]), 'jowett');
    expect([...texts]).toEqual([['1:70a', ['opening']], ['1:70b', ['first', 'stray words']]]);
  });

  it('skips a turn the translation has no text for, and a book with no turn flow', () => {
    expect([...turnTranslationTexts(book([turn('70a', null), turn('70b')]), 'jowett')]).toEqual([]);
    expect(turnTranslationTexts({ segments: [seg('70a')], turnFlow: undefined }, 'jowett').size).toBe(0);
  });
});

describe('translationTexts', () => {
  it('reads the primary off the segment and a turn-aligned overlay off the book', () => {
    const b = book([turn('70a', 'Is virtue taught?')]);
    const turns = turnTranslationTexts(b, 'jowett');
    expect(translationTexts(b.segments[0], { id: 'lamb', slot: 'english' })).toEqual([b.segments[0].english!.text]);
    expect(translationTexts(b.segments[0], { id: 'jowett', slot: 'overlay' }, turns)).toEqual(['Is virtue taught?']);
    expect(translationTexts(b.segments[1], { id: 'jowett', slot: 'overlay' }, turns)).toEqual([]);
  });
});

describe('englishSnippet', () => {
  const texts = ['Is virtue taught, Socrates?', 'I cannot say whether virtue is taught.'];
  const words = texts.flatMap(t => englishWords(t)).map(w => w.word);

  it('marks the words at the index’s positions, in the text they fall in', () => {
    const at = words.indexOf('cannot');
    expect(englishSnippet(texts, [at], ['cannot'], false)).toBe('I <mark>cannot</mark> say whether virtue is taught');
  });

  it('marks the whole run of a phrase and only that run', () => {
    const start = words.lastIndexOf('virtue');
    expect(englishSnippet(texts, [start, start + 1], ['virtue', 'is'], true))
      .toBe('I cannot say whether <mark>virtue</mark> <mark>is</mark> taught');
  });

  it('finds the words itself when the positions are missing or do not fit', () => {
    expect(englishSnippet(texts, [], ['taught'], false)).toBe('Is virtue <mark>taught</mark>, Socrates');
    expect(englishSnippet(texts, [999], ['taught'], false)).toBe('Is virtue <mark>taught</mark>, Socrates');
  });

  it('marks the form an any-form search found', () => {
    const t = ['the virtues of men'];
    expect(englishSnippet(t, [3], ['man'], false, true)).toBe('the virtues of <mark>men</mark>');
  });

  it('shows no apparatus, and is null where the translation has no text', () => {
    expect(englishSnippet(['his emotions,[^1.9] his [[s3]] study'], [1], ['emotions'], false))
      .toBe('his <mark>emotions</mark>, his study');
    expect(englishSnippet([], [0], ['a'], false)).toBeNull();
    expect(englishSnippet([''], [0], ['a'], false)).toBeNull();
  });
});

describe('markEnglishHtml', () => {
  const mark = (query: string, text: string, phrase = false, forms = false) =>
    markEnglishHtml(text, englishQueryUnits(query), phrase, forms);

  it('marks whole words, not every word a term begins', () => {
    expect(mark('end', 'the end, not the ending we endure'))
      .toBe('the <mark>end</mark>, not the ending we endure');
    expect(mark('end*', 'the end and the ending')).toBe('the <mark>end</mark> and the <mark>ending</mark>');
  });

  it('in an exact phrase marks only the run', () => {
    expect(mark('the good', 'they say the good is there, and the end is good', true))
      .toBe('they say <mark>the</mark> <mark>good</mark> is there, and the end is good');
  });

  it('marks a hyphenated term where its words stand together', () => {
    expect(mark('coming-to-be', 'coming-to-be, or coming slowly to be'))
      .toBe('<mark>coming</mark>-<mark>to</mark>-<mark>be</mark>, or coming slowly to be');
  });

  it('marks a word with an apostrophe or across a footnote marker, and leaves the marker as text', () => {
    expect(mark('isn’t emotions', 'it isn’t emotions,[^1.9] his'))
      .toBe('it <mark>isn’t</mark> <mark>emotions</mark>,[^1.9] his');
  });

  it('marks every form of a word for an any-form search, and nothing that only begins like it', () => {
    const text = 'the men’s virtues and a man’s virtue, not manly or virtuous';
    expect(mark('man virtue', text, false, true))
      .toBe('the <mark>men’s</mark> <mark>virtues</mark> and a <mark>man’s</mark> <mark>virtue</mark>, not manly or virtuous');
    expect(mark('man virtue', text)).toBe('the men’s virtues and a man’s <mark>virtue</mark>, not manly or virtuous');
  });

  it('marks a word the page prints with a ligature or an accent', () => {
    expect(mark('lacedaemonians', 'the Lacedæmonians')).toBe('the <mark>Lacedæmonians</mark>');
    expect(mark('Lacedæmonians versa', 'vice versâ, Lacedæmonians')).toBe('vice <mark>versâ</mark>, <mark>Lacedæmonians</mark>');
  });

  it('marks nothing for no query, or the bare *', () => {
    expect(mark('', 'a < b')).toBe('a &lt; b');
    expect(mark('*', 'a < b')).toBe('a &lt; b');
  });
});
