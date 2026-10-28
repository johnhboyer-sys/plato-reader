import { describe, expect, it } from 'vitest';
import { betaToGreek, liveGreek } from '../lib/betacode';
import { greekFold } from '../lib/search';

describe('betaToGreek', () => {
  it.each([
    ['plain letters', 'logos', 'λογος'],
    ['acute accent', 'lo/gos', 'λόγος'],
    ['grave accent', 'a\\nqrwpos', 'ὰνθρωπος'],
    ['circumflex', 'a=ra', 'ἆρα'.replace('ἆ', 'ᾶ')],
    ['smooth breathing', 'a)reth/', 'ἀρετή'],
    ['rough breathing', 'a(/gios', 'ἅγιος'],
    ['iota subscript', 'a)/|dhs', 'ᾄδης'],
    ['diaeresis', 'i+sxu/s', 'ϊσχύς'],
    ['final sigma before punctuation', 'logos, logos.', 'λογος, λογος.'],
    ['medial sigma', 'swma', 'σωμα'],
    ['capital marker', '*aristote/lhs', 'Αριστοτέλης'],
    ['capital with breathing', '*)/anqrwpos', 'Ἄνθρωπος'],
    ['capital lemma example', '*eu)rw/phs', 'Εὐρώπης'],
    // Proper-noun lemma with no LSJ entry — the lexicon fallback must convert
    // this, not surface Beta Code (was showing "*plataio/s" in the lexicon).
    ['capital proper-noun lemma, word-final sigma', '*plataio/s', 'Πλαταιός'],
    ['drops trailing homograph digit', 'le/gw1', 'λέγω'],
    ['passes punctuation through', 'peri\\ yuxh=s', 'περὶ ψυχῆς'],
    ['leaves ! prefix while converting following Beta Code', '!*)agaqo/s', '!Ἀγαθός'],
  ])('%s', (_label, input, expected) => {
    expect(betaToGreek(input)).toBe(expected);
  });

  it('keeps a capital with iota subscript as one letter', () => {
    // String#toUpperCase on the composed form expands ᾅ to "ἍΙ" — a capital
    // iota in the middle of the word. Ported with the fix from
    // aristotle-reader 25d0d67, which arrived here without its test.
    expect(betaToGreek('*(/|adhs')).toBe('ᾍδης');
    expect(betaToGreek('*)/|adhs')).toBe('ᾌδης');
    expect(betaToGreek('*|a')).toBe('ᾼ');
  });

  it('leaves strings without Beta Code letters untouched', () => {
    expect(betaToGreek('λόγος 123 !?')).toBe('λόγος 123 !?');
  });
});

// liveGreek: the search box's as-you-type converter. Cases from Grammata
// (grammar-site tests/betacode.test.ts, via greek-plays search-type-greek.test.ts).
describe('liveGreek', () => {
  it('turns Beta Code into Greek, including the cases the toggle promises', () => {
    expect(liveGreek('lo/gos')).toBe('λόγος');
    expect(liveGreek('a)reth/')).toBe('ἀρετή');
    // Final sigma, not medial σ.
    expect(liveGreek('logos')).toBe('λογο\u03c2');
    expect(liveGreek('Swkra/ths')).toBe('Σωκράτης');
    expect(liveGreek('*(hra')).toBe('Ἡρα');
    expect(liveGreek('fron*')).toBe('φρον*');
  });

  // The search's * wildcard works inside a word ("* any letters, inside or at
  // the end of a word"): after a letter it stays a wildcard; only at the start
  // of a word is it the Beta Code capital (Codex review of #67).
  it('keeps a * inside a word as the search wildcard', () => {
    expect(liveGreek('log*os')).toBe('λογ*ος');
    expect(liveGreek('lo/g*s')).toBe('λόγ*ς');
    expect(liveGreek('a)ret* *(hra')).toBe('ἀρετ* Ἡρα');
    expect(liveGreek(liveGreek('log*os'))).toBe('λογ*ος');
  });

  it('TypeGreek conventions', () => {
    expect(liveGreek('lo/gos')).toBe('λόγος');
    expect(liveGreek('logosde')).toBe('λογοσδε');      // sigma flips back mid-word
    expect(liveGreek('Swkra/ths')).toBe('Σωκράτης');   // Shift capitals
    expect(liveGreek('qeo/j')).toBe('θεός');           // j is an explicit sigma
    expect(liveGreek('o(/ti')).toBe('ὅτι');
    expect(liveGreek('tw=|')).toBe('τῷ');              // circumflex, iota subscript
    expect(liveGreek('proi+')).toBe('προϊ');           // diaeresis
    expect(liveGreek('*(hra')).toBe('Ἡρα');            // '*' still makes a capital
    expect(liveGreek('*(/a|dhs')).toBe('ᾍδης');        // capital with iota subscript stays one letter
    expect(liveGreek('to\\n')).toBe('τὸν');            // grave
  });

  it('marks compose in any typed order', () => {
    expect(liveGreek('a)/')).toBe('ἄ');
    expect(liveGreek('a/)')).toBe('ἄ');
    expect(liveGreek('i/+')).toBe('ΐ');
    expect(liveGreek('i+/')).toBe('ΐ');
    expect(liveGreek('w=)|')).toBe('ᾦ');
    expect(liveGreek('w)=|')).toBe('ᾦ');
  });

  it('is idempotent on its own output', () => {
    for (const input of ['lo/gos', '/*ab', '*(hra', 'a *', 'tw=| kai\\', 'logos ', "d'", 'fron*', 'a)reth/']) {
      const once = liveGreek(input);
      expect(liveGreek(once), input).toBe(once);
    }
  });

  it('leaves unfinished business as typed; marks before * wait for the capital', () => {
    expect(liveGreek('/*ab')).toBe('Άβ');
    expect(liveGreek('*(')).toBe('*(');
    expect(liveGreek('/')).toBe('/');
  });

  it('re-normalizes Greek already in the box mixed with new ASCII', () => {
    expect(liveGreek('λόγο\u03c3')).toBe('λόγο\u03c2');
    expect(liveGreek('λο/gos')).toBe('λόγος');
  });

  it('keeps the search wildcard and the apostrophe the search folds', () => {
    expect(liveGreek('fron*')).toBe('φρον*');
    expect(liveGreek("d'")).toBe("δ'");
    for (const q of ['fron*', "d' a)/n", 'lo/gos kai\\', '*)aga/memnwn', 'a)reth/']) {
      expect(greekFold(liveGreek(q)), q).toBe(greekFold(q));
    }
  });
});
