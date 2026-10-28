import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lexeisAst, lexeisAstHref } from '../lib/lexeis';

const slugs: Record<string, string> = JSON.parse(readFileSync('lemma-slugs.json', 'utf-8'));

describe('lexeis-ast.json', () => {
  it('loads, and covers most of the lexicon', () => {
    expect(Object.keys(lexeisAst).length).toBeGreaterThan(4500);
  });

  it('keys only lemmas the site has', () => {
    const stray = Object.keys(lexeisAst).filter((k) => !(k in slugs));
    expect(stray).toEqual([]);
  });

  it('holds single Greek headwords, never a homograph number', () => {
    const bad = Object.values(lexeisAst).filter((t) => !/^[\p{Script=Greek}̀-ͯ]+$/u.test(t));
    expect(bad).toEqual([]);
  });

  it('leaves out Lexeis homographs', () => {
    expect(lexeisAst['a)rgo/s1']).toBeUndefined(); // ἀργός / ἀργός2
  });

  it('never joins a common noun to a proper name', () => {
    expect(lexeisAst['kalli/as']).toBeUndefined(); // "tame ape", not Καλλίας
    expect(lexeisAst['ke/fa^los']).toBeUndefined(); // "mullet", not Κέφαλος
  });

  it('matches accents exactly, never an accent apart', () => {
    expect(lexeisAst['farma^/keia^']).toBeUndefined(); // φαρμάκεια, not φαρμακεία
    expect(lexeisAst['di^xh/']).toBeUndefined(); // διχή, not διχῆ
    expect(lexeisAst['ba^si/leia^1']).toBeUndefined(); // βασίλεια, not βασιλεία
  });
});

describe('lexeisAstHref', () => {
  it('links a word with an entry to its Lexeis page', () => {
    expect(lexeisAstHref('a)reth/')).toBe(`https://lexeis.org/plato/#/entry/${encodeURIComponent('ἀρετή')}`);
  });

  it('gives no link for a word without one, or no key', () => {
    expect(lexeisAstHref('ei)=pon')).toBeUndefined();
    expect(lexeisAstHref(undefined)).toBeUndefined();
    expect(lexeisAstHref('')).toBeUndefined();
  });
});
