// Running-text search (PR 9, ruling 1): a regular expression over a work's
// Greek as one running text, so a pattern may cross word boundaries or stop
// inside a word.
//
// Each work's search/running.json (pipeline/plato_pipeline/running_text.py)
// holds every token as its Beta Code letters with its marks, and between two
// tokens the punctuation printed there. Token and gap characters never meet:
//
//   token  a-z  '  ( ) / \ = | +      gap  space , . ; : " -
//
// so the n-th run of token characters is global token n, which offsets.json
// places in a segment. A search reads the text in one of four views: marks
// kept or stripped (the Accents switch), punctuation kept or each gap made one
// space (the Punctuation switch). A match is cited and marked at the tokens it
// touches; one inside a word marks that word.
import { WORK_ORDER } from './works';
import { memoAsyncBy } from './memo';
import {
  attributable, GREEK_BETA, loadIndex, loadOffsets, offsetRef, pool, speakerAt, speakerPasses,
  type LangOp, type Offsets, type SearchOutcome, type SearchResult, type SegMeta, type SpeakerFilter,
} from './search';

export interface RunningFile { v: number; token_count: number; text: string }
export interface RunningOptions { accents: boolean; punctuation: boolean }

const MARKS = '()/\\=|+';
const GAPS = ' ,.;:"-';
// The marks as a character class's contents, and as escaped literals.
const MARK_CLASS = '()/\\\\=|+';
const MARK_LITERAL: Record<string, string> = { ')': '\\)', '(': '\\(', '/': '\\/', '\\': '\\\\', '=': '=', '|': '\\|', '+': '\\+' };
// A letter's marks are written breathing, diaeresis, accent, iota subscript —
// running_text.py's _MARK_RANK — whatever order they were typed in.
const MARK_RANK: Record<string, number> = { ')': 0, '(': 0, '+': 1, '/': 2, '\\': 2, '=': 2, '|': 3 };
// Combining marks as Beta Code marks (NFD), as beta.py reads them.
const COMBINING: Record<string, string> = {
  '̓': ')', '̔': '(', '́': '/', '̀': '\\', '͂': '=', 'ͅ': '|', '̈': '+',
};

const isTokenChar = (c: string) => (c >= 'a' && c <= 'z') || c === "'" || MARKS.includes(c);

/** One view of a work's running text: the string searched, and each token's
 * [start, end) in it. */
export interface RunningView { text: string; starts: Int32Array; ends: Int32Array }

export function runningView(file: RunningFile, opts: RunningOptions): RunningView {
  const src = file.text;
  const starts = new Int32Array(file.token_count);
  const ends = new Int32Array(file.token_count);
  let out = '';
  let n = 0;
  let inToken = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (isTokenChar(c)) {
      if (!inToken) {
        if (n >= file.token_count) throw new Error('running text holds more words than it says');
        starts[n] = out.length;
        inToken = true;
      }
      if (opts.accents || !MARKS.includes(c)) out += c;
    } else if (GAPS.includes(c)) {
      if (inToken) { ends[n++] = out.length; inToken = false; }
      if (opts.punctuation) out += c;
      else if (!out.endsWith(' ')) out += ' ';
    } else {
      throw new Error(`running text: unexpected character ${JSON.stringify(c)}`);
    }
  }
  if (inToken) ends[n++] = out.length;
  if (n !== file.token_count) throw new Error(`running text holds ${n} words, not ${file.token_count}`);
  return { text: out, starts, ends };
}

// Punctuation as the text writes it: the raised dot is :, every quote mark ",
// a dash -. ’ and ʼ are the elision mark, as greekFold reads them.
const QUERY_PUNCT: Record<string, string> = {
  '·': ':', '·': ':', ';': ';',
  '“': '"', '”': '"', '‘': '"', '«': '"', '»': '"',
  '’': "'", 'ʼ': "'", '᾽': "'",
  '—': '-', '–': '-',
};

/**
 * The typed pattern as a RegExp over a view of the running text, or null when
 * it is empty or not a pattern the engine can read. Greek letters and Latin
 * (Beta Code) letters are both letters; capitals are small. The rest is
 * JavaScript regular-expression syntax, so Beta Code's ( ) \ | + are syntax
 * here and only / and = are read as marks — type the other marks in Greek.
 * With accents on, a letter matches only that letter with exactly the marks
 * typed on it, and . or a class takes a letter with whatever marks it has.
 */
export function runningPattern(query: string, accents: boolean): RegExp | null {
  const src = [...query.trim().normalize('NFD')];
  if (!src.length) return null;
  let out = '';
  let inClass = false;
  let classStart = false;
  let negated = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') {
      out += ch + (src[++i] ?? '');
      classStart = false;
      continue;
    }
    const lower = ch.toLowerCase();
    const letter = GREEK_BETA[lower] ?? (lower >= 'a' && lower <= 'z' ? lower : null);
    if (letter) {
      const marks: string[] = [];
      while (i + 1 < src.length && (COMBINING[src[i + 1]] || '/='.includes(src[i + 1]))) {
        marks.push(COMBINING[src[++i]] ?? src[i]);
      }
      if (inClass || !accents) out += letter;
      else {
        marks.sort((a, b) => MARK_RANK[a] - MARK_RANK[b]);
        out += `(?:${letter}${marks.map(m => MARK_LITERAL[m]).join('')}(?![${MARK_CLASS}]))`;
      }
      classStart = false;
      continue;
    }
    // The = of a lookaround, (?= and (?<=, is syntax.
    if (ch === '=' && (out.endsWith('(?') || out.endsWith('(?<'))) { out += ch; continue; }
    // A mark with no letter before it, and / = outside a class, are marks
    // that cannot attach: dropped, as the text has none on its own.
    if (COMBINING[ch] || (!inClass && '/='.includes(ch))) continue;
    if (inClass) {
      if (ch === '^' && classStart) { negated = true; out += ch; classStart = false; continue; }
      if (ch === ']' && !classStart) {
        inClass = false;
        out += accents ? `${negated ? MARK_CLASS : ''}][${MARK_CLASS}]*)` : ']';
        continue;
      }
      classStart = false;
      out += QUERY_PUNCT[ch] ?? ch;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      classStart = true;
      negated = false;
      out += accents ? '(?:[' : '[';
      continue;
    }
    if (ch === '.' && accents) { out += `(?:[^${MARK_CLASS}][${MARK_CLASS}]*)`; continue; }
    out += QUERY_PUNCT[ch] ?? ch;
  }
  try {
    return new RegExp(out, 'g');
  } catch {
    return null;
  }
}

// The file, cached like the other per-work indexes; and each view of it,
// built once per work and switch setting.
const _views = new Map<string, RunningView>();
const loadRunning = memoAsyncBy<string, RunningFile>(work => loadIndex<RunningFile>(work, 'running.json'));
async function viewOf(work: string, opts: RunningOptions): Promise<RunningView> {
  const key = `${work}|${opts.accents ? 1 : 0}${opts.punctuation ? 1 : 0}`;
  let view = _views.get(key);
  if (!view) {
    view = runningView(await loadRunning(work), opts);
    _views.set(key, view);
  }
  return view;
}

// The tokens a match [from, to) touches: every token overlapping it, or, for
// a match that lies wholly in punctuation, the word before it.
function touched(view: RunningView, from: number, to: number): [number, number] {
  const { starts, ends } = view;
  // The first token ending after `from`.
  let lo = 0, hi = ends.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ends[mid] <= from) lo = mid + 1; else hi = mid; }
  const first = lo;
  // The last token starting before `to`.
  lo = 0; hi = starts.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (starts[mid] < to) lo = mid + 1; else hi = mid; }
  const last = lo - 1;
  if (last < first) return [Math.max(0, last), Math.max(0, last)];
  return [first, last];
}

export interface RunningQuery extends RunningOptions { pattern: string }

/** Thrown for a pattern the engine cannot read. */
export class RunningPatternError extends Error {}

async function searchWork(
  work: string, re: RegExp, opts: RunningOptions, speaker?: SpeakerFilter,
): Promise<SearchResult[]> {
  const [view, offsets, meta] = await Promise.all([
    viewOf(work, opts), loadOffsets(work), loadIndex<SegMeta[]>(work, 'meta.json'),
  ]);
  if (view.starts.length !== offsets.token_count) {
    throw new Error(`${work}: running text and offsets disagree`);
  }
  // As the word search: a work no one can be named in has nothing to give a
  // speaker filter.
  if (speaker && !attributable(work, offsets)) return [];
  const bySeg = new Map<number, { windows: number[][]; speakers: Map<number, string | null> }>();
  const base = offsets.seg_base_offset;
  re.lastIndex = 0;
  for (let m = re.exec(view.text); m; m = re.exec(view.text)) {
    if (!m[0].length) { re.lastIndex++; continue; }
    const [first, last] = touched(view, m.index, m.index + m[0].length);
    // One utterance, as a phrase is: it stands or falls on its first word.
    const who = speaker ? speakerAt(offsets, first) : null;
    if (speaker && !speakerPasses(speaker, who)) continue;
    const ref = offsetRef(offsets as Offsets, first);
    if (!ref) continue;
    // Cited and marked in the section it starts in.
    const segEnd = ref.seg_idx + 1 < base.length ? base[ref.seg_idx + 1] : offsets.token_count;
    const window: number[] = [];
    for (let g = first; g <= last && g < segEnd; g++) window.push(g - base[ref.seg_idx]);
    const entry = bySeg.get(ref.seg_idx) ?? bySeg.set(ref.seg_idx, { windows: [], speakers: new Map() }).get(ref.seg_idx)!;
    entry.windows.push(window);
    for (const p of window) if (!entry.speakers.has(p)) entry.speakers.set(p, who);
  }
  return [...bySeg.entries()].sort((a, b) => a[0] - b[0]).map(([si, { windows, speakers }]) => {
    // Windows partition the positions: a token two matches share is the
    // first's, and a match left with none of its own is not listed.
    const claimed = new Set<number>();
    const own = windows.map(w => w.filter(p => !claimed.has(p) && (claimed.add(p), true))).filter(w => w.length);
    const positions = [...claimed].sort((a, b) => a - b);
    return {
      work,
      meta: meta[si],
      grkMatch: true,
      engMatch: false,
      grkPositions: positions,
      windows: own,
      ...(speaker ? { speakers: positions.map(p => speakers.get(p) ?? null) } : {}),
    };
  });
}

/**
 * Every place the pattern matches in `works`, as word-search results: one per
 * section, its positions the tokens the matches touch, one window per match.
 * Works load four at a time; `onProgress(done, total)` follows them. A work
 * whose files do not load is listed in failedWorks; if none loads, it throws.
 */
export async function searchRunningText(
  q: RunningQuery,
  works: string[],
  speaker?: SpeakerFilter,
  onProgress?: (done: number, total: number) => void,
): Promise<SearchOutcome> {
  const re = runningPattern(q.pattern, q.accents);
  if (!re) throw new RunningPatternError('Not a pattern the search can read.');
  if (!works.length) return { results: [], failedWorks: [] };
  if (speaker && !speaker.names.length) speaker = undefined;
  const opts = { accents: q.accents, punctuation: q.punctuation };
  const failedWorks: string[] = [];
  let done = 0;
  onProgress?.(0, works.length);
  const perWork = await pool(works, 4, async work => {
    try {
      // Each work runs its own copy: a global RegExp carries its place.
      return await searchWork(work, new RegExp(re.source, re.flags), opts, speaker);
    } catch (err) {
      console.warn(`running text: skipping ${work} —`, err);
      failedWorks.push(work);
      return [] as SearchResult[];
    } finally {
      onProgress?.(++done, works.length);
    }
  });
  if (failedWorks.length === works.length) {
    throw new Error('Could not load the running text — check your connection and try again.');
  }
  return { results: perWork.flat(), failedWorks };
}

const sectionOrder = (column: string) => [parseInt(column, 10) || 0, column.replace(/^\d+/, '')] as const;

/**
 * A running-text search joined with an English one, as search() joins its
 * Greek and English: by section, both (and) or either (or). The English
 * outcome comes from search() with no Greek query, under the same speaker
 * filter.
 */
export function joinEnglish(grk: SearchOutcome, eng: SearchOutcome, op: LangOp): SearchOutcome {
  const key = (r: SearchResult) => `${r.work}\u0000${r.meta.id}`;
  const english = new Map(eng.results.map(r => [key(r), r]));
  const out: SearchResult[] = [];
  const seen = new Set<string>();
  for (const r of grk.results) {
    const e = english.get(key(r));
    seen.add(key(r));
    if (e) out.push({ ...r, engMatch: true, engHits: e.engHits ?? [] });
    else if (op === 'or') out.push({ ...r, engHits: [] });
  }
  if (op === 'or') for (const e of eng.results) if (!seen.has(key(e))) out.push(e);
  out.sort((a, b) => {
    const [pa, la] = sectionOrder(a.meta.column);
    const [pb, lb] = sectionOrder(b.meta.column);
    return (WORK_ORDER.get(a.work) ?? 0) - (WORK_ORDER.get(b.work) ?? 0)
      || a.meta.book - b.meta.book || pa - pb || la.localeCompare(lb);
  });
  return {
    results: out,
    failedWorks: [...new Set([...grk.failedWorks, ...eng.failedWorks])],
    ...(eng.unsearchedTranslations?.length ? { unsearchedTranslations: eng.unsearchedTranslations } : {}),
  };
}
