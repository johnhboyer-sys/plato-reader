// Where an English hit stands on the page: the snippet to show, for any of a
// work's translations, not only the primary.
//
// The index says which words matched (word positions counted by englishWords()
// through the translation's text for the segment); this turns them back into
// a place. The primary translation is one chunk per Stephanus section. Jowett
// is turn-aligned: align_turns.py writes it onto the book's turnFlow, and the
// pipeline files each speech's words under the section its Greek starts in
// (stage6 turn_translations). turnTranslationTexts below cuts the same texts in
// the same order, so a word_pos lands on the word it was counted from.
//
// A section never runs across a Stephanus page, and Plato has no user-facing
// lines, so a hit's place is its section: nothing here estimates a line.
import type { BookData, Segment } from './data';
import { englishTermMatcher, englishWords, type EnglishWord } from './search';
import { esc } from './text';
import type { TranslationRef } from './works';

type Ref = Pick<TranslationRef, 'id' | 'slot'>;

/** One turn-aligned translation's texts in a book, by segment id, in turn
 * order. A turn goes under the section its Greek starts in (g.c); an
 * English-only residual (g null) under the section before it, or the book's
 * first. Mirror of stage6 turn_translations(). */
export function turnTranslationTexts(book: Pick<BookData, 'segments' | 'turnFlow'>, id: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const turns = book.turnFlow?.turns;
  if (!turns?.length || !book.segments.length) return out;
  const ids = new Map(book.segments.map(s => [s.column, s.id]));
  let current = book.segments[0].id;
  for (const turn of turns) {
    const at = turn.g ? ids.get(turn.g.c) : undefined;
    if (at) current = at;
    const text = turn.alt?.[id]?.e;
    if (text) (out.get(current) ?? out.set(current, []).get(current)!).push(text);
  }
  return out;
}

/** A translation's texts in one segment, in the order the index counted
 * them. `turns` is the book's turnTranslationTexts for this translation, which
 * is where a turn-aligned overlay lives; a section-cut overlay (the sister
 * repo's shape) is read off the segment. */
export function translationTexts(seg: Segment, t: Ref, turns?: Map<string, string[]>): string[] {
  if (t.slot === 'english') return seg.english?.text ? [seg.english.text] : [];
  if (t.slot === 'secondary') return (seg.secondary ?? []).map(p => p.text);
  if (t.slot === 'third') return (seg.third ?? []).map(p => p.text);
  const pieces = seg.overlays?.[t.id];
  if (pieces?.length) return pieces.map(p => p.text);
  return turns?.get(seg.id) ?? [];
}

// Characters of context either side of the hit.
const WINDOW = 140;

// The reader shows a footnote marker as a numbered control and floats a
// sidenote or figure out of the prose, so a snippet shows neither.
const FOOTNOTE = /\[\^[0-9A-Za-z_.*†]+\]/g;
const SIDENOTE = /\s*\[\[(?:s|fig)[0-9]+\]\]\s*/g;
const plain = (s: string) => s.replace(SIDENOTE, ' ').replace(FOOTNOTE, '');

/** The KWIC snippets for one translation's hit in a segment, matched words
 * in <mark>: one passage for each place the words fall, so every match the
 * results count is shown — a second match in another speech, or past the
 * first one's window, gets a passage of its own. `positions` are the index's
 * word positions; when they are missing or do not land on a matching word (an
 * index from a different build than the books), the matching words are found
 * in the text instead, by the same rule the index used — with `forms`, any
 * form of each term, as an "any form" search found it. Empty when the
 * translation has no text here. */
export function englishSnippets(
  texts: string[],
  positions: number[],
  terms: string[],
  phrase: boolean,
  forms = false,
): string[] {
  if (!texts.some(Boolean)) return [];
  const words: (EnglishWord & { piece: number })[] = [];
  texts.forEach((text, i) => { for (const w of englishWords(text)) words.push({ ...w, piece: i }); });

  const marked = matchedWords(words, positions, terms, phrase, forms);
  if (!marked.length) return [head(texts.find(Boolean)!)];
  const set = new Set(marked);
  const out: string[] = [];
  let shown = -1;   // the last word a passage so far has printed
  for (const center of marked) {
    if (center <= shown) continue;
    const piece = words[center].piece;
    const { html, last } = snippet(texts[piece], words, piece, center, set, shown);
    out.push(html);
    shown = last;
  }
  return out;
}

function matchedWords(
  words: { word: string; piece: number }[],
  positions: number[],
  terms: string[],
  phrase: boolean,
  forms: boolean,
): number[] {
  const any = englishTermMatcher(terms, forms);
  // Every position must land on a matching word: one that misses means the
  // index counted a different text, and the rest are no safer.
  if (positions.length && positions.every(p => words[p] && any(words[p].word))) {
    return [...positions].sort((a, b) => a - b);
  }
  if (phrase && terms.length > 1) {
    const each = terms.map(t => englishTermMatcher([t], forms));
    const runs: number[] = [];
    for (let i = 0; i + terms.length <= words.length; i++) {
      const run = terms.map((_, j) => i + j);
      if (run.every((k, j) => words[k].piece === words[i].piece && each[j](words[k].word))) {
        runs.push(...run);
        i += terms.length - 1;
      }
    }
    return runs;
  }
  return words.flatMap((w, i) => (any(w.word) ? [i] : []));
}

function snippet(
  text: string,
  words: { start: number; end: number; piece: number }[],
  piece: number,
  center: number,
  marked: Set<number>,
  shown: number,
): { html: string; last: number } {
  // Back no further than the passage before it reached, so no word prints twice.
  let first = center;
  while (first - 1 > shown && words[first - 1].piece === piece
    && words[center].start - words[first - 1].start <= WINDOW) first--;
  // A phrase is shown whole, however long; past it, the window decides.
  let last = center;
  while (last + 1 < words.length && words[last + 1].piece === piece && marked.has(last + 1)) last++;
  while (last + 1 < words.length && words[last + 1].piece === piece
    && words[last + 1].end - words[center].start <= WINDOW) last++;
  // Nor is a phrase the window reaches cut off at its edge.
  while (last + 1 < words.length && words[last + 1].piece === piece
    && marked.has(last) && marked.has(last + 1)) last++;

  let html = '';
  for (let i = first; i <= last; i++) {
    if (i > first) html += esc(plain(text.slice(words[i - 1].end, words[i].start)));
    const w = esc(plain(text.slice(words[i].start, words[i].end)));
    html += marked.has(i) ? `<mark>${w}</mark>` : w;
  }
  const more = (i: number) => i >= 0 && i < words.length && words[i].piece === piece;
  if (more(first - 1)) html = '… ' + html;
  if (more(last + 1)) html += ' …';
  return { html, last };
}

function head(text: string): string {
  const t = plain(text);
  return esc(t.slice(0, 300)) + (t.length > 300 ? ' …' : '');
}

/** A stretch of English as HTML with the query's words marked, by the rule
 * the search used: whole words, a wildcard as the index reads it, a unit's
 * words only where they stand in a row, and in an exact phrase only the run.
 * The reader used to mark every word that merely began with a term, so "end"
 * lit up "endure" and the phrase "the good" every "they" and "there".
 * With `forms`, any form of a word, as an "any form" search found it.
 * Footnote and sidenote markers pass through as text, escaped. */
export function markEnglishHtml(text: string, units: string[][], phrase: boolean, forms = false): string {
  const runs = (phrase ? [units.flat()] : units)
    .filter(run => run.length && !(run.length === 1 && run[0] === '*'));
  if (!runs.length) return esc(text);
  const words = englishWords(text);
  const hit = new Set<number>();
  for (const run of runs) {
    const each = run.map(t => englishTermMatcher([t], forms));
    for (let i = 0; i + run.length <= words.length; i++) {
      if (run.every((_, j) => each[j](words[i + j].word))) {
        for (let j = 0; j < run.length; j++) hit.add(i + j);
      }
    }
  }
  let html = '';
  let at = 0;
  words.forEach((w, i) => {
    if (!hit.has(i)) return;
    html += `${esc(text.slice(at, w.start))}<mark>${esc(text.slice(w.start, w.end))}</mark>`;
    at = w.end;
  });
  return html + esc(text.slice(at));
}
