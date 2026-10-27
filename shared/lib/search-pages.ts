// Counting and paging the search results, from the index alone: the page
// count and every page's slice are known before any book is fetched, so only
// the books on the page in view are loaded.
//
// The results page groups hits by Stephanus page (a "34" card holding 34a–e),
// so a result page breaks only between Stephanus pages and a card never runs
// across two. A result is one section, and a section belongs to one Stephanus
// page, so its place in the order is read off its column alone: unlike the
// sister repo's chapters, which cut across its columns, nothing here needs the
// offsets.
import type { EngHit, SearchResult } from './search';
import { WORK_ORDER } from './works';

/** What one translation's match counts for: each word the query matched
 * there, as Greek counts each matching word. A bare * matches no word in
 * particular and counts as one. */
export const engHitCount = (h: EngHit): number => Math.max(1, h.positions.length);

/** What a result counts for: every Greek word matched, and every English word
 * matched in each translation. */
export function hitCount(r: SearchResult): number {
  const grk = r.grkMatch ? r.grkPositions.length : 0;
  const eng = !r.engMatch ? 0 : r.engHits ? r.engHits.reduce((n, h) => n + engHitCount(h), 0) : 1;
  return grk + eng;
}

/** The Stephanus page a section column belongs to: "34b" → 34. */
export const stephanusPage = (column: string): number => parseInt(column, 10) || 0;

// A place in the corpus to the Stephanus page: work order, book, page.
type Pos = [number, number, number];
const cmp = (a: Pos, b: Pos) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const posOf = (r: SearchResult): Pos =>
  [WORK_ORDER.get(r.work) ?? 0, r.meta.book, stephanusPage(r.meta.column)];

/** Lay results out in pages of about `target` hits, breaking only between
 * Stephanus pages, in corpus order. A Stephanus page with more hits than
 * `target` is a result page of its own. */
export function paginate(results: SearchResult[], target: number): SearchResult[][] {
  const units = new Map<string, { pos: Pos; n: number; results: SearchResult[] }>();
  for (const r of results) {
    const pos = posOf(r);
    const key = pos.join(':');
    const unit = units.get(key) ?? units.set(key, { pos, n: 0, results: [] }).get(key)!;
    unit.n += hitCount(r);
    unit.results.push(r);
  }
  const pages: SearchResult[][] = [];
  let n = 0;
  for (const unit of [...units.values()].sort((a, b) => cmp(a.pos, b.pos))) {
    if (!pages.length || (n > 0 && n + unit.n > target)) {
      pages.push([]);
      n = 0;
    }
    pages[pages.length - 1].push(...unit.results);
    n += unit.n;
  }
  return pages;
}
