// Corpus tools over the stage 8 phrase index: "Where else" from a selection in
// the reader, and the phrases two works share. Both read only what the Phrases
// page reads (the browse shards and their occurrence files) and cite through
// citation.ts, so no line number ever reaches the page.

import {
  decodeOffsets,
  fetchNgramOccurrences,
  fetchNgramShard,
} from './data';
import { formatCite, formatLocValue } from './citation';
import {
  VARIANT_READING_CAP,
  lemmaOptions,
  lemmaReadings,
  offsetRef,
  type Offsets,
} from './search';
import { workPath } from './works';

export type GreekStream = 'form' | 'lemma';

// Stage 8 indexes runs of two to five words; nothing else can be asked of it.
export const WHERE_ELSE_MIN = 2;
export const WHERE_ELSE_MAX = 5;
export const whereElseOffered = (words: number) =>
  words >= WHERE_ELSE_MIN && words <= WHERE_ELSE_MAX;

/** A token key as stage 6 folds it into the form stream (fold_lemma). */
export const foldKey = (k: string) => k.toLowerCase().replace(/[^a-z']/g, '');

/** The shard a phrase lives in: its first letter, the rule stage 8 used. */
export function shardLetter(phrase: string): string {
  const first = phrase[0] ?? '';
  return first >= 'a' && first <= 'z' ? first : '_';
}

/** The folded keys of the Greek words a range covers, in reading order.
 *  null when any covered word has no key: such a run cannot be in the index. */
export function selectedKeys(range: Range, root: ParentNode): string[] | null {
  const keys: string[] = [];
  for (const el of root.querySelectorAll<HTMLElement>('.tok[data-k]')) {
    if (!range.intersectsNode(el)) continue;
    const k = foldKey(el.dataset.k ?? '');
    if (!k) return null;
    keys.push(k);
  }
  return keys;
}

export interface Occurrences {
  readings: string[];                 // the index keys that matched
  byWork: Record<string, number[]>;   // work -> sorted global offsets
}

/** Every occurrence of a run of folded forms, by form or by dictionary word.
 *
 * By lemma, each word is read as every headword the lemma map gives it and
 * each reading looked up, as the Phrases page widens a typed phrase; the index
 * holds every reading at every position, so the union is every place the
 * same dictionary words stand in the same order. */
export async function findOccurrences(stream: GreekStream, forms: string[]): Promise<Occurrences> {
  let keys = [forms.join(' ')];
  if (stream === 'lemma') {
    const options = await lemmaOptions(forms);
    const perTerm = forms.map((f, i) => (options?.[i]?.length ? options[i] : [f]));
    keys = lemmaReadings(perTerm, VARIANT_READING_CAP).readings.map((r) => r.join(' '));
  }
  const n = forms.length;
  const readings: string[] = [];
  const merged: Record<string, Set<number>> = {};
  for (const key of keys) {
    const letter = shardLetter(key);
    const shard = await fetchNgramShard(stream, letter);
    if (!Object.hasOwn(shard, key)) continue;
    const occ = await fetchNgramOccurrences(stream, letter, n);
    const byWork = Object.hasOwn(occ, key) ? occ[key] : {};
    readings.push(key);
    for (const [work, deltas] of Object.entries(byWork)) {
      const set = (merged[work] ??= new Set());
      for (const at of decodeOffsets(deltas)) set.add(at);
    }
  }
  const byWork: Record<string, number[]> = {};
  for (const [work, set] of Object.entries(merged)) byWork[work] = [...set].sort((a, b) => a - b);
  return { readings, byWork };
}

export interface Citation {
  cite: string;
  href: string;
}

/** Global offsets in one work as Stephanus citations linking into the reader. */
export function citationsFor(work: string, offsets: Offsets, globals: number[], base: string): Citation[] {
  const out: Citation[] = [];
  for (const g of globals) {
    const ref = offsetRef(offsets, g);
    if (!ref) continue;
    out.push({
      cite: formatCite(work, ref.column),
      href: `${base}${workPath(work, ref.book)}?loc=${formatLocValue(work, ref.column)}`,
    });
  }
  return out;
}

export interface SharedPhrase {
  key: string;
  n: number;
  a: number[];   // global offsets in the first work
  b: number[];   // and in the second
}

/** The phrases two works both use, from loaded occurrence files. */
export function sharedPhrases(
  files: Array<Record<string, Record<string, number[]>>>,
  workA: string,
  workB: string,
): SharedPhrase[] {
  const out: SharedPhrase[] = [];
  if (!workA || !workB || workA === workB) return out;
  for (const file of files) {
    for (const [key, byWork] of Object.entries(file)) {
      const a = byWork[workA];
      const b = byWork[workB];
      if (!a || !b) continue;
      out.push({ key, n: key.split(' ').length, a: decodeOffsets(a), b: decodeOffsets(b) });
    }
  }
  return out;
}

// The commonest Greek words: the article, particles, conjunctions, pronouns,
// prepositions and εἰμί, as folded forms and folded headwords alike (the two
// streams share one key space). Strictly grammatical words only, as the
// Phrases page's English list; nothing that could carry weight in Plato.
export const GREEK_FUNCTION_WORDS = new Set(`
  o h to tou ths tw th twn tois tais ton thn ta oi ai tous tas toin
  kai de d' te t' men oun gar alla all' ou ouk oux mh ei ws an ge g' dh
  toinun mhn oude oud' oute mhte mhde ara ar' per oti epei ina eite kaitoi mentoi
  kan outw outws
  eimi esti estin einai hn ontos on onta ousa eisi eisin estai
  en eis es ek ec peri pros kata kat' kaq' para par' dia di' epi ep' ef' apo ap'
  af' upo up' uf' meta met' meq' uper ana anti pro sun xun
  autos auto autou auth authn autw auton autwn autois autas autous auta
  outos touto toutou toutw touton toutwn toutois tauta tauthn tauths
  ode hde tode ekeinos ekeino ekeinou ekeinh ekeina
  egw emoi moi eme me mou emou su soi se sou hmeis hmin hmas hmwn umeis umin umas umwn
  eautou eautw eauton
  tis ti tinos tini tina tinwn tines tisi
  os ou w on wn ois ais as ous
`.trim().toLowerCase().split(/\s+/));

/** How many of a phrase's words are not grammatical words. */
export function contentWords(phrase: string): number {
  let n = 0;
  for (const w of phrase.split(' ')) if (!GREEK_FUNCTION_WORDS.has(w)) n++;
  return n;
}
