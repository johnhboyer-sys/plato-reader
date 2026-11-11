// The one step of a running-text search that can run away: a user's regular
// expression over a work's whole text. Kept free of imports so the search
// worker (running-text.worker.ts) carries only this.

/** Every match of `re` (a global RegExp) in `text`, as [start, end) pairs,
 * flattened. A match of nothing is stepped past, never listed. */
export function findMatches(text: string, re: RegExp): Int32Array {
  const spans: number[] = [];
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (!m[0].length) { re.lastIndex++; continue; }
    spans.push(m.index, m.index + m[0].length);
  }
  return Int32Array.from(spans);
}
