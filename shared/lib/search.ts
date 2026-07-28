// Search engine — operates on the prebuilt inverted indexes from Stage 6.
//
// Greek search: input is Unicode Greek OR TLG Beta Code (with optional * wildcards).
//   Converted to fold form (base Beta Code letters only) to match the index.
//   Beta Code letters already ARE the fold form (θ→q, φ→f, χ→x, ψ→y, ξ→c,
//   η→h, ω→w, …), so Latin input passes straight through; accents/breathings
//   (the ) ( / \ = | + markers) are stripped, matching the index's fold form.
// English search: whitespace-tokenized, lowercase.
// Phrase search: after intersection, verify token adjacency in segment data.
// Cross-language: AND (intersection) or OR (union) the two result sets.

import { formatCite } from './citation';

// Honour Astro's base path. BASE_URL may lack a trailing slash, so strip + join.
// Same host override as data.ts: the desktop app points the whole data layer
// at an on-disk corpus via globalThis.__ARISTOTLE_DATA_ROOT__ (read lazily so
// module-import order doesn't matter); the site never sets it.
const DEFAULT_ROOT = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/data`;
const ROOT = () =>
  (globalThis as { __ARISTOTLE_DATA_ROOT__?: string }).__ARISTOTLE_DATA_ROOT__ ?? DEFAULT_ROOT;
const searchBase = (work: string) => `${ROOT()}/${work}/search`;

// -- Data types -----------------------------------------------------------

export interface SegMeta {
  id: string;
  book: number;
  column: string;
  greek_head: string;
  // Space-joined fold LEMMA token sequence. Stage 6 still emits it; nothing in
  // this module reads it any more — phrases are verified by posting adjacency
  // (see phraseStarts), which is the only stream that matches what was queried.
  greek_tokens: string;
  english_head: string;
}

type GrkIndex = Record<string, [number, number][]>; // fold → [[seg_idx, pos], ...]
type EngIndex = Record<string, number[]>;            // word → [seg_idx, ...]

// The word-offset primitive: one running token number per work, in document
// order, with the structural coordinates beside it. Global offset of a posting
// is seg_base_offset[seg_idx] + token_pos.
//
// The coordinate fields are named for Bekker because the artifact ports
// unchanged from the sister repo; the VALUES are Stephanus, so `column` is a
// token like '34b'. The artifact also carries an always-empty `chapter_bounds`
// (Plato has no chapters); nothing here reads it, and it must not be faked.
export interface Offsets {
  token_count: number;
  seg_base_offset: number[];
  segments: { book: number; column: string; line_runs: [number, number][] }[];
  book_bounds: { book: number; start: number }[];
  // Plato's substitute for chapter bounds: one entry per speaker turn, global
  // per book. `accuracy` is 'exact' where the turn start was matched against
  // the Greek text. Only `start` and `accuracy` are consumed here.
  turn_bounds: { book: number; speaker: string; start: number; accuracy: string }[];
}

// A morphological reading: category → the values it licenses. A reading with
// more than one value for a category is syncretic ("fem nom/voc sg"), which is
// as genuinely ambiguous as two separate analyses.
type Reading = Record<string, string[]>;

// Signature dictionary + packed column. sigs[id] is the distinct readings a
// token's analyses license; the column holds one id per token, by global offset.
export interface GrammarDict {
  token_count: number;
  width: number;               // bytes per column entry
  categories: string[];
  reserved: { unkeyed: number; unanalysed: number };
  sigs: Reading[][];
}

// A grammatical query: category → required value, e.g. { mood: 'opt' }.
export type GrammarQuery = Record<string, string>;

// Greek search can match by dictionary headword ('lemma', every inflected form)
// or by the exact surface form as written ('form').
export type MatchMode = 'lemma' | 'form';

// -- Per-work index loading (cached, lazy per file) -----------------------
//
// Each index file is fetched and cached on its own, and only when a query
// actually needs it (a Greek-only query never loads english.json, and only the
// lemma OR form index per its match mode). This keeps the request burst small:
// a Greek search over all works loads ~2 files/work, not 4 — which matters on
// Safari/WebKit, where a large simultaneous fetch burst can drop a request with
// "TypeError: Load failed" and (via Promise.all) sink the whole search.

const _fileCache = new Map<string, Promise<unknown>>();

function loadIndex<T>(work: string, file: string): Promise<T> {
  const key = `${work}/${file}`;
  const cached = _fileCache.get(key);
  if (cached) return cached as Promise<T>;
  const p = fetch(`${searchBase(work)}/${file}`).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${key}`);
    return r.json();
  });
  // Evict on failure so a transient drop can be retried — a rejected promise
  // must NOT stay cached (that would poison every later search in the tab).
  p.catch(() => { if (_fileCache.get(key) === p) _fileCache.delete(key); });
  _fileCache.set(key, p);
  return p as Promise<T>;
}

// Corpus-level indexes live beside the per-work ones rather than inside them.
// Same cache, keyed by path so it cannot collide with a work called "lemma-map".
function loadShared<T>(path: string): Promise<T> {
  const key = `::${path}`;
  const cached = _fileCache.get(key);
  if (cached) return cached as Promise<T>;
  const p = fetch(`${ROOT()}/${path}`).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${path}`);
    return r.json();
  });
  p.catch(() => { if (_fileCache.get(key) === p) _fileCache.delete(key); });
  _fileCache.set(key, p);
  return p as Promise<T>;
}

// The grammatical column is binary (one small int per token, indexed by global
// offset), so it needs arrayBuffer rather than json. Cached the same way.
function loadBinary(work: string, file: string): Promise<ArrayBuffer> {
  const key = `${work}/${file}`;
  const cached = _fileCache.get(key);
  if (cached) return cached as Promise<ArrayBuffer>;
  const p = fetch(`${searchBase(work)}/${file}`).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status} for ${key}`);
    return r.arrayBuffer();
  });
  p.catch(() => { if (_fileCache.get(key) === p) _fileCache.delete(key); });
  _fileCache.set(key, p);
  return p as Promise<ArrayBuffer>;
}

// Run `fn` over `items` with at most `limit` in flight at once (bounds the
// concurrent-fetch burst). Rejections propagate; callers that want per-item
// tolerance pass an `fn` that catches.
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

// -- Unicode Greek → Beta Code fold form ----------------------------------

const GREEK_BETA: Record<string, string> = {
  α:'a',β:'b',γ:'g',δ:'d',ε:'e',ζ:'z',η:'h',θ:'q',ι:'i',κ:'k',
  λ:'l',μ:'m',ν:'n',ξ:'c',ο:'o',π:'p',ρ:'r',σ:'s',ς:'s',τ:'t',
  υ:'u',φ:'f',χ:'x',ψ:'y',ω:'w',ϝ:'v',
};

export function greekFold(input: string): string {
  const out: string[] = [];
  for (const ch of input.normalize('NFD')) {
    const lower = ch.toLowerCase();
    const b = GREEK_BETA[lower];
    if (b) out.push(b);                          // Unicode Greek → fold letter
    else if (lower >= 'a' && lower <= 'z') out.push(lower); // Beta Code Latin input
    else if (ch === "'") out.push("'");
    // skip combining marks, punctuation, Beta Code diacritics ) ( / \ = | +,
    // asterisk (handled by caller), and sigma-variant digits
  }
  return out.join('');
}

// -- Posting-list helpers -------------------------------------------------

/** The index-key pattern a typed Greek term stands for.
 *
 * The ONE wildcard rule, so every Greek path answers the same syntax the guide
 * documents: a TRAILING '*' stands for the rest of a word, and nothing else
 * does.
 *
 * A leading '*' is Beta Code's capital marker, not a wildcard (*a)nqrwpos is
 * Ἄνθρωπος). The fold form is caseless, so it is dropped — as `search` already
 * did for its own input, and now for the combo and phrase paths too.
 *
 * A '*' anywhere else returns `null`, meaning the term matches nothing. Reading
 * it as a prefix wildcard is what this replaced: `a*b` quietly became "every
 * word beginning a", a far broader result than was asked for, with nothing on
 * the page to say the ending had been thrown away. This index is built on
 * beginnings and cannot express a medial or final pattern; refusing is the
 * honest answer, and it is the one the guide states.
 */
function termPattern(term: string): { exact: string } | { prefix: string } | null {
  const input = term.replace(/^\*+/, '');
  const star = input.indexOf('*');
  if (star === -1) {
    const fold = greekFold(input);
    return fold ? { exact: fold } : null;
  }
  if (star !== input.length - 1) return null;
  return { prefix: greekFold(input.slice(0, -1)) };
}

function grkPosting(idx: GrkIndex, term: string): Set<number> {
  const pattern = termPattern(term);
  if (!pattern) return new Set();
  if ('exact' in pattern) {
    return new Set((idx[pattern.exact] ?? []).map(([si]) => si));
  }
  const result = new Set<number>();
  for (const key of Object.keys(idx)) {
    if (key.startsWith(pattern.prefix)) {
      for (const [si] of idx[key]) result.add(si);
    }
  }
  return result;
}

function engPosting(idx: EngIndex, term: string): Set<number> {
  const word = term.toLowerCase().replace(/[^a-z'*]/g, '');
  if (!word || word === '*') return new Set(Object.values(idx).flat());
  if (word.endsWith('*')) {
    const prefix = word.slice(0, -1);
    const result = new Set<number>();
    for (const key of Object.keys(idx)) {
      if (key.startsWith(prefix)) for (const si of idx[key]) result.add(si);
    }
    return result;
  }
  return new Set(idx[word] ?? []);
}

function intersect(a: Set<number>, b: Set<number>): Set<number> {
  return new Set([...a].filter(x => b.has(x)));
}

function union(a: Set<number>, b: Set<number>): Set<number> {
  return new Set([...a, ...b]);
}

// Phrase check, by posting adjacency: seg_idx → start positions of every run
// where the terms occupy consecutive token positions, in order.
//
// The ONE phrase engine: the lexical phrase mode, combo phrase slots and the
// phrase-variant search all come through here, so the same query cannot get two
// answers depending on which path the reader's input happened to take. It
// replaced a substring match over meta.greek_tokens, which was wrong twice
// over — greek_tokens is a LEMMA fold stream, so a form-mode phrase was
// verified against the wrong words, and a wildcard was folded away to a
// literal, so "al* beta" looked for the string "al beta" and threw away the
// hits the postings had just found.
//
// This works off the same postings the query already intersected, so it uses
// whichever index the caller selected, and wildcard terms participate via their
// postings. Token positions count EVERY token, so an unanalysed word between
// two terms correctly breaks adjacency.
function phraseStarts(idx: GrkIndex, terms: string[]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const perTerm = terms.map(t => termPositions(idx, t));
  const first = perTerm[0];
  if (!first) return out;
  for (const [si, firstPositions] of first) {
    const rest = perTerm.slice(1).map(m => new Set(m.get(si) ?? []));
    if (rest.some(s => s.size === 0)) continue;
    const starts = [...new Set(firstPositions)]
      .filter(p => rest.every((s, j) => s.has(p + j + 1)))
      .sort((a, b) => a - b);
    if (starts.length) out.set(si, starts);
  }
  return out;
}

// Char offsets of every English match in a segment's full text, tokenising
// exactly as the index does ([a-z']+ over the lowercased text) so a term hits
// whole tokens (and prefix* hits token starts). 'phrase' returns each phrase's
// start offset; 'all'/'any' return every matching token. One offset = one
// rendered occurrence, so repeats past the old 500-char cap now count and show.
function engMatchTerm(word: string, term: string): boolean {
  const c = term.toLowerCase().replace(/[^a-z'*]/g, '');
  if (!c || c === '*') return false;
  return c.endsWith('*') ? word.startsWith(c.slice(0, -1)) : word === c;
}
export function englishOccurrences(text: string, terms: string[], mode: SearchMode): number[] {
  const low = text.toLowerCase();
  const re = /[a-z']+/g;
  const toks: { w: string; i: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(low)) !== null) toks.push({ w: m[0], i: m.index });
  if (mode === 'phrase' && terms.length > 1) {
    const out: number[] = [];
    for (let i = 0; i + terms.length <= toks.length; i++) {
      let ok = true;
      for (let j = 0; j < terms.length; j++) {
        if (!engMatchTerm(toks[i + j].w, terms[j])) { ok = false; break; }
      }
      if (ok) out.push(toks[i].i);
    }
    return out;
  }
  return toks.filter(t => terms.some(term => engMatchTerm(t.w, term))).map(t => t.i);
}

// -- Public search API ----------------------------------------------------

export type SearchMode = 'all' | 'any' | 'phrase';
export type LangOp = 'and' | 'or';

export interface SearchResult {
  work: string;           // which work this hit belongs to
  meta: SegMeta;
  grkMatch: boolean;
  engMatch: boolean;
  grkPositions: number[]; // token positions in the segment where a Greek term matched
  engPositions: number[]; // char offsets in the segment's English where a term matched
  // Grammatical hits only, parallel to grkPositions: the values each position's
  // readings license for the queried categories, and whether every reading
  // agrees. `certain: false` must be shown as one-of-N, never asserted.
  grammar?: { values: Record<string, string[]>; certain: boolean }[];
}

// The advanced engines return the hits PLUS any works whose index failed to
// load, so the UI can flag an incomplete result instead of presenting a partial
// search as exhaustive. `failedWorks` is empty on a fully successful search.
export interface SearchOutcome {
  results: SearchResult[];
  failedWorks: string[];  // work ids that could not be searched this run
  // Works whose turn starts are known only approximately, reported ONLY when
  // the query actually leans on turn geometry. The pipeline stamps each bound
  // exact or not; saying nothing here would let a turn-scoped result imply a
  // precision the source does not have.
  approximateTurns?: string[];
}

// Positions of a single term across segments: seg_idx → [token positions].
function termPositions(idx: GrkIndex, term: string): Map<number, number[]> {
  const m = new Map<number, number[]>();
  const add = (posts: [number, number][]) => {
    for (const [si, pos] of posts) {
      const arr = m.get(si);
      if (arr) arr.push(pos);
      else m.set(si, [pos]);
    }
  };
  const pattern = termPattern(term);
  if (!pattern) return m;
  if ('exact' in pattern) {
    add(idx[pattern.exact] ?? []);
  } else {
    for (const key of Object.keys(idx)) if (key.startsWith(pattern.prefix)) add(idx[key]);
  }
  return m;
}

// For each segment in `hits`, the token positions to highlight in a KWIC snippet.
function greekPositions(
  idx: GrkIndex,
  terms: string[][],
  mode: SearchMode,
  hits: Set<number>,
): Map<number, number[]> {
  const out = new Map<number, number[]>();
  if (mode === 'phrase' && terms.length > 1) {
    for (const [si, starts] of phraseStarts(idx, terms.map(alts => alts[0]))) {
      if (!hits.has(si)) continue;
      const ps: number[] = [];
      for (const s of starts) for (let j = 0; j < terms.length; j++) ps.push(s + j);
      out.set(si, ps);
    }
  } else {
    for (const t of terms.flat()) {
      for (const [si, ps] of termPositions(idx, t)) {
        if (!hits.has(si)) continue;
        const arr = out.get(si);
        if (arr) arr.push(...ps);
        else out.set(si, [...ps]);
      }
    }
  }
  for (const [si, ps] of out) out.set(si, [...new Set(ps)].sort((a, b) => a - b));
  return out;
}

// Search one work, returning hits tagged with that work.
async function searchWork(
  work: string,
  grkTerms: string[][],
  engTerms: string[],
  grkMode: SearchMode,
  engMode: SearchMode,
  langOp: LangOp,
  matchMode: MatchMode,
): Promise<SearchResult[]> {
  // Fetch only what this query needs: meta always; the lemma OR form Greek
  // index iff there are Greek terms; the English index iff there are English
  // terms. Kick them off together, then await.
  const metaP = loadIndex<SegMeta[]>(work, 'meta.json');
  const grkP: Promise<GrkIndex | null> = grkTerms.length
    ? loadIndex<GrkIndex>(work, matchMode === 'form' ? 'greek_form.json' : 'greek_lemma.json')
    : Promise.resolve(null);
  const engP: Promise<EngIndex | null> = engTerms.length
    ? loadIndex<EngIndex>(work, 'english.json')
    : Promise.resolve(null);
  const meta = await metaP;
  const grkIdx = await grkP;
  const engIdx = await engP;

  let grkHits: Set<number> | null = null;
  let engHits: Set<number> | null = null;

  if (grkTerms.length > 0 && grkIdx) {
    // Each term carries the keys it may match — one for a form search, the
    // headwords a typed inflection belongs to for a lemma one — so a term is
    // satisfied by ANY of its keys before the modes combine the terms.
    const postings = grkTerms.map(alts =>
      alts.map(t => grkPosting(grkIdx, t)).reduce(union));
    if (grkMode === 'any') {
      grkHits = postings.reduce(union);
    } else {
      grkHits = postings.reduce(intersect);
      if (grkMode === 'phrase' && grkTerms.length > 1) {
        // A phrase needs its words in order, which resolving each word to
        // several headwords cannot express. Match the first key of each term —
        // for a form search that is the typed word, and for a lemma search a
        // typed phrase is what "find this phrase in any inflection" is for.
        grkHits = new Set(phraseStarts(grkIdx, grkTerms.map(alts => alts[0])).keys());
      }
    }
  }

  if (engTerms.length > 0 && engIdx) {
    const postings = engTerms.map(t => engPosting(engIdx, t));
    if (engMode === 'any') {
      engHits = postings.reduce(union);
    } else {
      engHits = postings.reduce(intersect);
      if (engMode === 'phrase' && engTerms.length > 1) {
        // Token-based phrase check on the FULL text (same routine that counts
        // occurrences), so a segment is a phrase hit iff it will render one.
        engHits = new Set([...engHits].filter(si =>
          englishOccurrences(meta[si].english_head, engTerms, 'phrase').length > 0
        ));
      }
    }
  }

  let combined: Set<number>;
  if (grkHits !== null && engHits !== null) {
    combined = langOp === 'and' ? intersect(grkHits, engHits) : union(grkHits, engHits);
  } else {
    combined = grkHits ?? engHits ?? new Set();
  }

  const grkPos = grkHits && grkIdx
    ? greekPositions(grkIdx, grkTerms, grkMode, grkHits)
    : new Map<number, number[]>();

  return [...combined]
    .sort((a, b) => a - b)
    .map(si => ({
      work,
      meta: meta[si],
      grkMatch: grkHits?.has(si) ?? false,
      engMatch: engHits?.has(si) ?? false,
      grkPositions: grkPos.get(si) ?? [],
      // Occurrence offsets in the FULL English text — one rendered instance
      // each. Empty when this segment matched only on the Greek side.
      engPositions: engHits?.has(si)
        ? englishOccurrences(meta[si].english_head, engTerms, engMode)
        : [],
    }));
}

// Unified search across one or more works. `matchMode` chooses the Greek index
// (lemma = all forms of a headword, form = the exact inflected token).
export async function search(
  grkQuery: string,
  engQuery: string,
  grkMode: SearchMode,
  engMode: SearchMode,
  langOp: LangOp,
  works: string[],
  matchMode: MatchMode = 'lemma',
): Promise<SearchResult[]> {
  if (!grkQuery.trim() && !engQuery.trim()) return [];
  if (!works.length) return [];

  // Strip a leading '*' (Beta Code capital marker, e.g. *a)nqrwpos); the fold
  // form is caseless, and a leading wildcard would match everything anyway.
  const typedGrk = grkQuery.trim().split(/\s+/).filter(Boolean).map(t => t.replace(/^\*+/, ''));
  const grkTerms = matchMode === 'lemma'
    ? await resolveHeadwords(typedGrk)
    : typedGrk.map(t => [t]);
  const engTerms = engQuery.trim().split(/\s+/).filter(Boolean);

  // Bound how many works load at once, and let a single work's failed index
  // load drop just that work (logged) instead of rejecting the whole search.
  let failures = 0;
  const perWork = await pool(works, 8, async w => {
    try {
      return await searchWork(w, grkTerms, engTerms, grkMode, engMode, langOp, matchMode);
    } catch (err) {
      console.warn(`search: skipping ${w} —`, err);
      failures++;
      return [] as SearchResult[];
    }
  });
  // If EVERY work failed to load (e.g. offline, or a transient window mid-deploy
  // when the index JSONs are briefly unavailable), surface it as an error to
  // retry — not as an empty result that reads as a misleading "No passages
  // found." A partial failure still returns what loaded.
  if (failures === works.length) {
    throw new Error('Could not load the search index — check your connection and try again.');
  }
  return perWork.flat();
}

// -- The offset space -----------------------------------------------------

// Turn a global offset back into (seg_idx, token_pos).
function locate(base: number[], global: number): [number, number] {
  let lo = 0;
  let hi = base.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (base[mid] <= global) lo = mid;
    else hi = mid - 1;
  }
  return [lo, global - base[lo]];
}

// Turn a global offset into a citable position, using only offsets.json — the
// phrase browser shows hundreds of citations at once and must not have to fetch
// a whole book for each.
//
// Plato is cited by Stephanus page + section ("34b"), which is exactly a
// segment's `column`, so the citation falls out of the segment lookup alone.
// `line_runs` is deliberately NOT consulted: Plato has no user-facing line
// numbers, and there is nothing finer than the section to cite.
export interface OffsetRef { seg_idx: number; pos: number; book: number; column: string }

export function offsetRef(offsets: Offsets, global: number): OffsetRef | null {
  const base = offsets.seg_base_offset;
  if (!base.length || global < 0 || global >= offsets.token_count) return null;
  const [seg_idx, pos] = locate(base, global);
  const seg = offsets.segments[seg_idx];
  if (!seg) return null;
  return { seg_idx, pos, book: seg.book, column: seg.column };
}

// The citation string a reader sees for a global offset, e.g. "34b". Routed
// through citation.ts so the no-line rule is enforced by the work's scheme
// rather than by this call site remembering it.
export function offsetCite(work: string, offsets: Offsets, global: number): string | null {
  const ref = offsetRef(offsets, global);
  return ref ? formatCite(work, ref.column) : null;
}

// -- Grammatical matching -------------------------------------------------
//
// Grammar is a FILTER on a lexical query, never a query of its own: asking the
// corpus for "genitive plural feminine" returns tens of thousands of tokens,
// which is not a search result, it is the corpus. So this engine is reachable
// only through a combo slot, and no standalone entry point is exported.
//
// Honesty rules, applied here and rendered by the UI:
//   possible — at least one of a token's readings satisfies the query. That is
//              what a match means, and it is all a match ever claims.
//   certain  — every reading satisfies it AND each queried category has exactly
//              one licensed value. Anything else is one-of-N.
// A token whose sole analysis is "fem nom/voc sg" is NOT certain for case: one
// analysis record, two possible cases.

function readingSatisfies(reading: Reading, query: GrammarQuery): boolean {
  for (const category in query) {
    if (!reading[category]?.includes(query[category])) return false;
  }
  return true;
}

// Which signature ids satisfy the query, and how ambiguous each one is. The
// dictionary is small (a few thousand entries), so this is compiled once per
// work and the column scan then costs one lookup per token.
function compileQuery(dict: GrammarDict, query: GrammarQuery) {
  const matches = new Map<number, { values: Record<string, string[]>; certain: boolean }>();
  dict.sigs.forEach((readings, id) => {
    if (!readings.length || !readings.some(r => readingSatisfies(r, query))) return;
    const values: Record<string, string[]> = {};
    for (const category in query) {
      const licensed = new Set<string>();
      for (const reading of readings) for (const v of reading[category] ?? []) licensed.add(v);
      values[category] = [...licensed].sort();
    }
    const certain =
      readings.every(r => readingSatisfies(r, query)) &&
      Object.values(values).every(v => v.length === 1);
    matches.set(id, { values, certain });
  });
  return matches;
}

// -- Lemma-map widening ---------------------------------------------------

/** The headwords each typed word can belong to, for a lemma search.
 *
 * A lemma index is keyed on dictionary forms, so matching the typed word
 * against it directly only works when the reader already typed the dictionary
 * form — the one form the text in front of them is least likely to show. Typing
 * lo/gou found nothing while lo/gos found the same word thousands of times. The
 * corpus lemma map turns the inflection into its headwords, so the reader can
 * type what stands on the page.
 *
 * The typed fold is kept alongside the headwords: a reader who does know the
 * dictionary form must never come off worse, and a word absent from the map
 * still searches as itself. Wildcards are left alone — they are patterns over
 * index keys, not surface words to resolve.
 */
async function resolveHeadwords(terms: string[]): Promise<string[][]> {
  return Promise.all(terms.map(async term => {
    if (term.includes('*')) return [term];
    const fold = greekFold(term);
    if (!fold) return [term];
    const letter = /^[a-z]/.test(fold) ? fold[0] : '_';
    try {
      const shard = await loadShared<Record<string, string[]>>(`lemma-map/${letter}.json`);
      const heads = shard[fold];
      return heads?.length ? [...new Set([fold, ...heads])] : [term];
    } catch {
      return [term];   // without the map, behave exactly as before
    }
  }));
}

// -- Inflected variants of a typed phrase ---------------------------------
//
// A reader who types τὸ τί ἦν εἶναι gets the places where those exact words
// stand. The same formula also appears as τῷ τί ἦν εἶναι and τοῦ τί ἦν εἶναι,
// which an exact phrase cannot reach — the surface string differs. Finding
// those means knowing that τό, τῷ and τοῦ all lemmatise to ὁ, which is exactly
// the knowledge a reader should not need. So widen it for them.
//
// Widening is a FAN-OUT, not a lookup: `hn` alone belongs to several headwords,
// so a four-word phrase can have several readings. Every reading is tried and
// their OFFSETS ARE UNIONED, never summed — two readings of one passage are one
// passage, and adding them would double the count.

// Above this many readings the fan-out is truncated rather than run, and the
// caller is told. A phrase of common ambiguous words could otherwise multiply
// out to thousands of index scans for nothing.
export const VARIANT_READING_CAP = 64;

export interface VariantOutcome extends SearchOutcome {
  readings: string[][];        // the lemma readings actually tried
  productive: string[][];      // those that matched anything
  cappedFrom: number;          // 0 unless the fan-out was truncated
}

/** The headwords each folded word can belong to, one list per word.
 *
 * `null` means the corpus map itself could not be loaded: there is nothing to
 * widen with, and a caller should fall back to matching what was typed rather
 * than report an empty corpus. A word the map does not record yields an empty
 * list, which callers read differently — the phrase search takes it as nothing
 * to widen, the phrase index falls back to that one word as typed.
 */
export async function lemmaOptions(folds: string[]): Promise<string[][] | null> {
  const perTerm: string[][] = [];
  for (const fold of folds) {
    const letter = /^[a-z]/.test(fold) ? fold[0] : '_';
    try {
      const shard = await loadShared<Record<string, string[]>>(`lemma-map/${letter}.json`);
      perTerm.push(shard[fold] ?? []);
    } catch {
      return null;
    }
  }
  return perTerm;
}

// The cartesian product of each term's headwords, in the order typed.
export function lemmaReadings(perTerm: string[][], cap: number): { readings: string[][]; total: number } {
  let total = 1;
  for (const options of perTerm) total *= Math.max(options.length, 1);
  let readings: string[][] = [[]];
  for (const options of perTerm) {
    const next: string[][] = [];
    for (const so_far of readings) {
      for (const option of options) {
        if (next.length >= cap) break;
        next.push([...so_far, option]);
      }
    }
    readings = next;
  }
  return { readings, total };
}

// Every place the phrase stands under ANY reading of its words.
export async function searchPhraseVariants(
  grkQuery: string,
  works: string[],
): Promise<VariantOutcome> {
  const terms = grkQuery.trim().split(/\s+/).filter(Boolean).map(t => t.replace(/^\*+/, ''));
  const empty: VariantOutcome = {
    results: [], failedWorks: [], readings: [], productive: [], cappedFrom: 0,
  };
  if (terms.length < 2 || !works.length) return empty;

  // Resolve each typed word to the headwords it can belong to.
  const folds = terms.map(t => greekFold(t));
  if (folds.some(f => !f)) return empty;
  const perTerm = await lemmaOptions(folds);
  if (!perTerm) return empty;              // without the map there is nothing to widen with
  if (perTerm.some(options => !options.length)) return empty;

  const { readings, total } = lemmaReadings(perTerm, VARIANT_READING_CAP);
  const cappedFrom = total > readings.length ? total : 0;

  const failedWorks: string[] = [];
  const productiveKeys = new Set<string>();
  const perWork = await pool(works, 8, async work => {
    try {
      const [meta, idx] = await Promise.all([
        loadIndex<SegMeta[]>(work, 'meta.json'),
        loadIndex<GrkIndex>(work, 'greek_lemma.json'),
      ]);
      // seg_idx -> the token positions any reading matched. A Set because two
      // readings routinely land on the same token.
      const bySeg = new Map<number, Set<number>>();
      for (const reading of readings) {
        const starts = phraseStarts(idx, reading);
        if (starts.size) productiveKeys.add(reading.join(' '));
        for (const [si, positions] of starts) {
          let seen = bySeg.get(si);
          if (!seen) { seen = new Set(); bySeg.set(si, seen); }
          for (const start of positions) {
            for (let k = 0; k < reading.length; k++) seen.add(start + k);
          }
        }
      }
      return [...bySeg.keys()].sort((a, b) => a - b).map(si => ({
        work,
        meta: meta[si],
        grkMatch: true,
        engMatch: false,
        grkPositions: [...bySeg.get(si)!].sort((a, b) => a - b),
        engPositions: [],
      } as SearchResult));
    } catch (err) {
      console.warn(`searchPhraseVariants: skipping ${work} —`, err);
      failedWorks.push(work);
      return [] as SearchResult[];
    }
  });
  if (failedWorks.length === works.length) {
    throw new Error('Could not load the search index — check your connection and try again.');
  }
  return {
    results: perWork.flat(),
    failedWorks,
    readings,
    productive: readings.filter(r => productiveKeys.has(r.join(' '))),
    cappedFrom,
  };
}

// -- Combo search ---------------------------------------------------------
//
// Query-time, over the global offset. A query is a list of slots, each naming
// its own match type; a hit is a place where every slot lands within one
// proximity window. This is also the only way a grammatical predicate is
// searchable: as one slot beside a lexical one.
//
// Boundary rule: a window NEVER spans a book edge. Speaker turns are a toggle,
// default keep — an argument routinely runs across a change of speaker, and
// Plato's shortest turns are a single word.

export type SlotKind = 'phrase' | 'form' | 'lemma' | 'grammatical';

// Where a slot must fall relative to the FIRST slot — not to the slot before
// it. "before"/"after" answer the question a reader actually asks ("does the
// qualification come before the term or after it?"); chaining each slot to its
// predecessor instead is the whole-query `ordered` lock.
export type SlotRelation = 'near' | 'before' | 'after';

export interface ComboSlot {
  kind: SlotKind;
  // phrase: the token run, whitespace-separated. form: one surface token.
  // lemma: the fold keys the user ticked in the picker, unioned.
  terms?: string[];
  // grammatical only.
  query?: GrammarQuery;
  // Ignored on the first slot, which is what the others are placed against.
  relation?: SlotRelation;
}

export type WindowUnit = 'words' | 'line' | 'turn';

export interface ComboOptions {
  window: number;          // words; ignored for the line/turn units
  unit: WindowUnit;
  ordered: boolean;        // slots must appear in the order given
  crossTurn: boolean;      // default true — keep hits that straddle a turn
}

// A slot's hits in one work, as global offsets. `span` is how many tokens the
// slot occupies (a phrase covers more than one), so an ordered query can
// require the next slot to start after this one ends.
interface SlotHit { start: number; span: number; certain: boolean; values?: Record<string, string[]> }

// The proximity default: 5 words. Capped at 50, since past that "near" stops
// meaning anything.
export const COMBO_WINDOW_DEFAULT = 5;
export const COMBO_WINDOW_MAX = 50;

function slotHits(
  slot: ComboSlot,
  base: number[],
  lemmaIdx: GrkIndex | null,
  formIdx: GrkIndex | null,
  dict: GrammarDict | null,
  column: Uint16Array | Uint32Array | null,
): SlotHit[] {
  const out: SlotHit[] = [];
  if (slot.kind === 'grammatical') {
    if (!dict || !column || !slot.query) return out;
    const wanted = compileQuery(dict, slot.query);
    if (!wanted.size) return out;
    for (let g = 0; g < column.length; g++) {
      const hit = wanted.get(column[g]);
      if (hit) out.push({ start: g, span: 1, certain: hit.certain, values: hit.values });
    }
    return out;
  }

  const terms = slot.terms ?? [];
  if (!terms.length) return out;
  // A lemma slot carries the exact heads the user ticked, so its terms are
  // unioned; a form or phrase slot is a single sequence.
  const idx = slot.kind === 'lemma' ? lemmaIdx : formIdx;
  if (!idx) return out;

  if (slot.kind === 'phrase' && terms.length > 1) {
    for (const [si, starts] of phraseStarts(idx, terms)) {
      for (const p of starts) out.push({ start: base[si] + p, span: terms.length, certain: true });
    }
    return out;
  }
  for (const term of terms) {
    for (const [si, positions] of termPositions(idx, term)) {
      for (const p of positions) out.push({ start: base[si] + p, span: 1, certain: true });
    }
  }
  return out;
}

// The structural unit an offset falls in, as a half-open [start, end) range of
// global offsets. Bounds are sorted, so this is a binary search over a short
// array. Used for the line/turn window units and the book-edge rule.
function unitRange(starts: number[], global: number, total: number): [number, number] {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= global) lo = mid;
    else hi = mid - 1;
  }
  return [starts[lo], lo + 1 < starts.length ? starts[lo + 1] : total];
}

// First index in a sorted hit list whose start is >= target.
function lowerBound(hits: SlotHit[], target: number): number {
  let lo = 0;
  let hi = hits.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (hits[mid].start < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Flatten the per-segment line runs into one array of line-start offsets, so a
// same-line window is the same kind of lookup as same-turn. The line is a
// proximity measure only — it is never shown, and never cited.
function lineStarts(offsets: Offsets): number[] {
  const out: number[] = [];
  offsets.segments.forEach((seg, i) => {
    let at = offsets.seg_base_offset[i];
    for (const [, count] of seg.line_runs) { out.push(at); at += count; }
  });
  return out;
}

// Given each slot's hits, find every window where all slots co-occur.
//
// Anchors on the FIRST slot's hits and, for each, asks whether every other slot
// has a hit in range. That is O(hits) with a sorted scan per slot rather than a
// cross-product, and it makes the ordered case a simple forward walk.
export function comboWindows(
  perSlot: SlotHit[][],
  opts: ComboOptions,
  offsets: Offsets,
  relations: SlotRelation[] = [],
  // Two slots sharing an identity are the same query asked twice, so they may
  // not both be satisfied by one token. Empty string means "no constraint".
  identities: string[] = [],
): { start: number; end: number; hits: SlotHit[] }[] {
  if (!perSlot.length || perSlot.some(h => !h.length)) return [];
  const sorted = perSlot.map(h => [...h].sort((a, b) => a.start - b.start));
  const total = offsets.token_count;
  const bookStarts = offsets.book_bounds.map(b => b.start);
  const turnStarts = offsets.turn_bounds.map(t => t.start);
  const lines = opts.unit === 'line' ? lineStarts(offsets) : null;

  // The offsets an anchor's partners may occupy: the structural unit the anchor
  // sits in, intersected with the word window. Computed once per anchor, so each
  // slot is then a binary search rather than a scan — which would be quadratic
  // on a grammatical slot holding tens of thousands of hits.
  //
  // The word window is measured over the WHOLE match, not outward from the
  // anchor. Measuring from the anchor would make an unordered query depend on
  // which slot happened to be listed first (with W=5 and hits at 0, 5 and 10,
  // anchoring on 0 rejects and anchoring on 5 accepts) and would quietly admit
  // a span of 2W. A window of W now means every slot lands within W tokens of
  // every other, whatever order the slots were typed in.
  const structural = (at: number): [number, number] => {
    let lo = 0;
    let hi = total;
    const clamp = ([s, e]: [number, number]) => { if (s > lo) lo = s; if (e < hi) hi = e; };
    clamp(unitRange(bookStarts, at, total));                       // never cross a book
    if (!opts.crossTurn && turnStarts.length) clamp(unitRange(turnStarts, at, total));
    if (opts.unit === 'line' && lines) clamp(unitRange(lines, at, total));
    if (opts.unit === 'turn' && turnStarts.length) clamp(unitRange(turnStarts, at, total));
    return [lo, hi];
  };

  const out: { start: number; end: number; hits: SlotHit[] }[] = [];
  for (const anchor of sorted[0]) {
    const [unitLo, unitHi] = structural(anchor.start);
    if (anchor.start + anchor.span > unitHi) continue;   // the anchor's own run must fit

    // Everything each slot could contribute for THIS anchor: inside the unit,
    // inside the word window, and on the side its relation requires.
    const reach = opts.unit === 'words' ? opts.window : total;
    const lo = Math.max(unitLo, anchor.start - reach);
    const hi = Math.min(unitHi, anchor.start + reach + 1);
    const feasible: SlotHit[][] = [[anchor]];
    let possible = true;
    for (let s = 1; s < sorted.length && possible; s++) {
      const relation = relations[s] ?? 'near';
      const from = relation === 'after' ? Math.max(lo, anchor.start + anchor.span) : lo;
      const to = relation === 'before' ? Math.min(hi, anchor.start + 1) : hi;
      const picks: SlotHit[] = [];
      for (let i = lowerBound(sorted[s], from); i < sorted[s].length; i++) {
        const h = sorted[s][i];
        if (h.start >= to) break;
        if (h.start + h.span > unitHi) continue;
        // "before" is measured by the END of the run, so a phrase only counts
        // as preceding when the whole run finishes first.
        if (relation === 'before' && h.start + h.span > anchor.start) continue;
        picks.push(h);
      }
      if (!picks.length) possible = false;
      else feasible.push(picks);
    }
    if (!possible) continue;

    // A window of W means every slot lands within W of every other, so the
    // group must fit in some span [s, s+W] that contains the anchor. Taking the
    // earliest feasible hit per slot is NOT sufficient: choosing an early
    // partner can push the far end out of reach when a later one would have
    // fitted. So try each candidate start rather than committing greedily.
    const starts = new Set<number>([anchor.start]);
    for (const picks of feasible) for (const h of picks) {
      if (h.start <= anchor.start) starts.add(h.start);
    }
    let chosen: SlotHit[] | null = null;
    for (const s0 of [...starts].sort((a, b) => a - b)) {
      if (opts.unit === 'words' && anchor.start - s0 > opts.window) continue;
      const limit = opts.unit === 'words' ? s0 + opts.window : unitHi;
      const take: SlotHit[] = [anchor];
      let cursor = anchor.start + anchor.span;   // for the whole-query order lock
      let ok = true;
      // One token may satisfy two DIFFERENT slots — "λόγος in the nominative"
      // is a lemma slot and a grammatical slot landing on the same word, and is
      // the most useful combo query there is. But two IDENTICAL slots asking
      // the same thing want two occurrences, not one word counted twice.
      const used = new Map<string, Set<number>>();
      const claim = (s: number, at: number): boolean => {
        const id = identities[s];
        if (!id) return true;
        let taken = used.get(id);
        if (!taken) { taken = new Set(); used.set(id, taken); }
        if (taken.has(at)) return false;
        taken.add(at);
        return true;
      };
      claim(0, anchor.start);
      for (let s = 1; s < feasible.length; s++) {
        const relation = relations[s] ?? 'near';
        const from = opts.ordered ? Math.max(s0, cursor) : s0;
        // "before" wants the nearest preceding run; everything else the
        // earliest, which also chains correctly when the order lock is on.
        const window = feasible[s].filter(h => h.start >= from && h.start <= limit);
        const ordered = relation === 'before' ? [...window].reverse() : window;
        const pick = ordered.find(h => claim(s, h.start));
        if (!pick) { ok = false; break; }
        take.push(pick);
        cursor = pick.start + pick.span;
      }
      if (ok) { chosen = take; break; }
    }
    if (!chosen) continue;
    out.push({
      start: Math.min(...chosen.map(h => h.start)),
      end: Math.max(...chosen.map(h => h.start + h.span - 1)),
      hits: chosen,
    });
  }
  return out;
}

async function comboSearchWork(
  work: string,
  slots: ComboSlot[],
  opts: ComboOptions,
): Promise<SearchResult[]> {
  const needLemma = slots.some(s => s.kind === 'lemma');
  const needForm = slots.some(s => s.kind === 'form' || s.kind === 'phrase');
  const needGrammar = slots.some(s => s.kind === 'grammatical');

  const [meta, offsets, lemmaIdx, formIdx, dict] = await Promise.all([
    loadIndex<SegMeta[]>(work, 'meta.json'),
    loadIndex<Offsets>(work, 'offsets.json'),
    needLemma ? loadIndex<GrkIndex>(work, 'greek_lemma.json') : Promise.resolve(null),
    needForm ? loadIndex<GrkIndex>(work, 'greek_form.json') : Promise.resolve(null),
    needGrammar ? loadIndex<GrammarDict>(work, 'grammar-dict.json') : Promise.resolve(null),
  ]);
  let column: Uint16Array | Uint32Array | null = null;
  if (dict) {
    // The column is joined to the offsets by position alone, so a mismatched
    // token_count means the two files came from different builds — refuse
    // rather than silently report the wrong words.
    if (dict.token_count !== offsets.token_count) {
      throw new Error(`${work}: grammar/offsets built from different runs`);
    }
    const buffer = await loadBinary(work, 'grammar-col.bin');
    column = dict.width === 4 ? new Uint32Array(buffer) : new Uint16Array(buffer);
    // A short column would silently drop every grammatical hit past its end and
    // still report a complete result.
    if (column.length !== offsets.token_count) {
      throw new Error(`${work}: grammar column length does not match token count`);
    }
  }

  const base = offsets.seg_base_offset;
  const perSlot = slots.map(s => slotHits(s, base, lemmaIdx, formIdx, dict, column));
  const slotIds = slots.map(s => JSON.stringify([s.kind, s.terms ?? null, s.query ?? null]));
  const duplicated = new Set(slotIds.filter((id, i) => slotIds.indexOf(id) !== i));
  const windows = comboWindows(
    perSlot, opts, offsets,
    slots.map(s => s.relation ?? 'near'),
    slotIds.map(id => (duplicated.has(id) ? id : '')),
  );

  const bySeg = new Map<number, SearchResult>();
  const seenBySeg = new Map<number, Set<number>>();
  const resultFor = (si: number): SearchResult => {
    let r = bySeg.get(si);
    if (!r) {
      r = {
        work, meta: meta[si], grkMatch: true, engMatch: false,
        grkPositions: [], engPositions: [], grammar: [],
      };
      bySeg.set(si, r);
      seenBySeg.set(si, new Set());
    }
    return r;
  };
  for (const w of windows) {
    // Report every matched token so the KWIC marks all of them. Ambiguity is
    // recorded PER SLOT, not per window: a lexically matched word is certain
    // whatever its neighbour's parse allows, and labelling it with the other
    // slot's alternatives would attribute morphology to the wrong word.
    for (const h of w.hits) {
      for (let k = 0; k < h.span; k++) {
        const [hs, hp] = locate(base, h.start + k);
        // A window can straddle a column boundary — segments are keyed
        // (book, column), and a book edge is the only thing a window may not
        // cross. Mark the token in whichever segment it actually falls in, so
        // both halves of the passage are shown.
        const result = resultFor(hs);
        const seen = seenBySeg.get(hs)!;
        if (seen.has(hp)) continue;
        seen.add(hp);
        result.grkPositions.push(hp);
        result.grammar!.push({ values: h.values ?? {}, certain: h.certain });
      }
    }
  }
  for (const r of bySeg.values()) {
    const order = r.grkPositions.map((p, i) => [p, i] as const).sort((a, b) => a[0] - b[0]);
    r.grkPositions = order.map(([p]) => p);
    r.grammar = order.map(([, i]) => r.grammar![i]);
  }
  return [...bySeg.keys()].sort((a, b) => a - b).map(si => bySeg.get(si)!);
}

// Combo search across one or more works.
export async function searchCombo(
  slots: ComboSlot[],
  opts: ComboOptions,
  works: string[],
): Promise<SearchOutcome> {
  const usable = slots.filter(s =>
    s.kind === 'grammatical' ? Object.keys(s.query ?? {}).length : (s.terms ?? []).length);
  // Grammar is a FILTER on a lexical query and nothing else. Two grammatical
  // slots and no lexical one is still a standalone grammar query — asking for
  // genitive plural feminine returns tens of thousands of tokens, which is not
  // a search result, it is the corpus. Withholding the searchGrammar export is
  // not enough on its own; the combo path has to refuse it too.
  const hasLexical = usable.some(s => s.kind !== 'grammatical');
  if (usable.length < 2 || !hasLexical || !works.length) {
    return { results: [], failedWorks: [] };
  }

  const bounded: ComboOptions = {
    ...opts,
    window: Math.max(1, Math.min(opts.window || COMBO_WINDOW_DEFAULT, COMBO_WINDOW_MAX)),
  };
  const failedWorks: string[] = [];
  const perWork = await pool(works, 8, async w => {
    try {
      return await comboSearchWork(w, usable, bounded);
    } catch (err) {
      console.warn(`searchCombo: skipping ${w} —`, err);
      failedWorks.push(w);
      return [] as SearchResult[];
    }
  });
  if (failedWorks.length === works.length) {
    throw new Error('Could not load the search index — check your connection and try again.');
  }

  // Only worth saying when the answer depends on where a turn begins.
  const approximateTurns: string[] = [];
  if (bounded.unit === 'turn' || !bounded.crossTurn) {
    for (const w of works) {
      if (failedWorks.includes(w)) continue;
      try {
        const offsets = await loadIndex<Offsets>(w, 'offsets.json');   // already cached
        if (offsets.turn_bounds.some(t => t.accuracy !== 'exact' && t.start !== 0)) {
          approximateTurns.push(w);
        }
      } catch { /* a work that failed to load is already reported */ }
    }
  }
  return { results: perWork.flat(), failedWorks, approximateTurns };
}
