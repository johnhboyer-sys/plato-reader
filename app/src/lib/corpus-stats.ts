// Build-time corpus statistics for the lemma pages and the per-work
// vocabulary pages, from what scripts/build-lemmata.mjs writes:
//   public/data/lemmata/_words.json   each work's and book's word count
//   build/vocabulary.json             every lemma's written forms per work
// Counts are the concordance's (a token's primary analysis), so a lemma's
// counts here agree with its lemma page.

import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface WorkWords { words: number; books: Record<string, number> }
export type WordsMap = Record<string, WorkWords>;

export interface VocabLemma {
  head: string;
  fold: string;                                  // the lemma search key
  slug?: string;                                 // its lemma page, if any
  byWork: Record<string, Record<string, number>>; // work -> form -> count
}
export interface Vocabulary { words: WordsMap; lemmata: Record<string, VocabLemma> }

const DATA = 'public/data';

export function loadWords(): WordsMap {
  return JSON.parse(readFileSync(join(DATA, 'lemmata', '_words.json'), 'utf-8'));
}

let _vocab: Vocabulary | null = null;
/** Read once per build: every vocabulary page shares the one parse. */
export function loadVocabulary(): Vocabulary {
  _vocab ??= JSON.parse(readFileSync(join(dirname(realpathSync(DATA)), 'vocabulary.json'), 'utf-8'));
  return _vocab!;
}

export const corpusWords = (words: WordsMap) =>
  Object.values(words).reduce((n, w) => n + w.words, 0);

export interface StatRow {
  count: number;
  words: number;
  rate: number;      // per 1,000 words
  expected: number;  // the lemma's corpus rate × these words
  ratio: number;     // count / expected
}
export interface WorkStatRow extends StatRow { work: string; title: string; books?: (StatRow & { book: number })[] }

function stat(count: number, words: number, corpusRate: number): StatRow {
  const expected = corpusRate * words;
  return { count, words, rate: words ? (count / words) * 1000 : 0, expected, ratio: expected ? count / expected : 0 };
}

/** A lemma's count by work (and by book, for a work of several books) against
 *  what its rate across the whole corpus predicts. */
export function lemmaStats(
  byWork: { work: string; title: string; count: number; books?: Record<string, number> }[],
  words: WordsMap,
): WorkStatRow[] {
  const total = byWork.reduce((n, w) => n + w.count, 0);
  const corpusRate = total / corpusWords(words);
  return byWork.map((w) => {
    const ww = words[w.work];
    const row: WorkStatRow = { work: w.work, title: w.title, ...stat(w.count, ww?.words ?? 0, corpusRate) };
    if (w.books && ww) {
      row.books = Object.keys(ww.books)
        .map(Number)
        .sort((a, b) => a - b)
        .map((book) => ({ book, ...stat(w.books![book] ?? 0, ww.books[book], corpusRate) }));
    }
    return row;
  });
}

export interface VocabEntry {
  key: string;
  head: string;
  fold: string;
  slug?: string;
  count: number;
  forms: [string, number][];
}

/** Every lemma one work uses, commonest first, with its forms. */
export function workVocabulary(vocab: Vocabulary, work: string): VocabEntry[] {
  const out: VocabEntry[] = [];
  for (const [key, l] of Object.entries(vocab.lemmata)) {
    const forms = l.byWork[work];
    if (!forms) continue;
    const list = Object.entries(forms);
    out.push({
      key, head: l.head, fold: l.fold, slug: l.slug,
      count: list.reduce((n, [, c]) => n + c, 0),
      forms: list,
    });
  }
  return out.sort((a, b) => b.count - a.count || a.head.localeCompare(b.head, 'el'));
}

export interface KeyRow { entry: VocabEntry; expected: number; ratio: number; g2: number }

const xlnx = (x: number, e: number) => (x > 0 ? x * Math.log(x / e) : 0);

/** The lemmata a work uses most and least against the rest of Plato, ranked
 *  by log-likelihood (G²), and those found in this work alone. A lemma the
 *  work never uses can be among its least used: it counts as 0. */
export function keyness(vocab: Vocabulary, work: string, limit = 25) {
  const n = corpusWords(vocab.words);
  const nw = vocab.words[work]?.words ?? 0;
  const nr = n - nw;
  const mine = new Map(workVocabulary(vocab, work).map((e) => [e.key, e]));
  const over: KeyRow[] = [];
  const under: KeyRow[] = [];
  const only: VocabEntry[] = [];
  for (const [key, l] of Object.entries(vocab.lemmata)) {
    let total = 0;
    for (const forms of Object.values(l.byWork)) for (const c of Object.values(forms)) total += c;
    const entry = mine.get(key) ?? { key, head: l.head, fold: l.fold, slug: l.slug, count: 0, forms: [] };
    const a = entry.count;
    const b = total - a;
    if (a && !b) { only.push(entry); continue; }
    const expected = (b / nr) * nw;           // against the rest of Plato
    const e1 = (total * nw) / n;
    const e2 = (total * nr) / n;
    const g2 = 2 * (xlnx(a, e1) + xlnx(b, e2));
    const row = { entry, expected, ratio: expected ? a / expected : 0, g2 };
    if (a > expected) over.push(row);
    else if (a < expected) under.push(row);
  }
  const byG2 = (x: KeyRow, y: KeyRow) => y.g2 - x.g2 || x.entry.head.localeCompare(y.entry.head, 'el');
  return {
    over: over.sort(byG2).slice(0, limit),
    under: under.sort(byG2).slice(0, limit),
    only: only.sort((x, y) => y.count - x.count || x.head.localeCompare(y.head, 'el')),
  };
}
