// Matching logic for the ⌘K command palette — pure functions so the ranking
// is unit-testable without mounting the component. The palette accepts three
// kinds of input: a Stephanus citation (jump within the current work — parsed
// by the work's own citation scheme, see ./citation), a work name/abbreviation
// (open that work, resuming its saved position), or Greek (lemma lookup).
// Everything else falls through to corpus search.

import { WORKS, type Work } from './works';
import { greekFold } from './search';
import type { LemmaRef } from './data';

export function hasGreek(q: string): boolean {
  return /[Ͱ-Ͽἀ-῿]/.test(q);
}

// Rank works for a query: exact abbr/id first, then title-prefix, word-start,
// abbr/id-prefix, and finally any substring; alphabetical within a tier. Abbr
// and id match case-insensitively ("rep" → Republic via id, "phdr" → Phaedrus
// via abbr). Plato abbreviations carry a trailing dot ("Ap.", "Phd."), so the
// abbr is compared with any trailing punctuation stripped.
export function rankWorks(q: string, works: readonly Work[] = WORKS, limit = 6): Work[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  const tier = (w: Work): number => {
    const title = w.title.toLowerCase();
    const abbr = w.abbr.toLowerCase().replace(/[.\s]+$/, '');
    const id = w.id.toLowerCase();
    if (abbr === needle || id === needle) return 0;
    if (title.startsWith(needle)) return 1;
    // Word-start match inside the title ("laws" → the Laws; "sophist" → Sophist).
    if (title.includes(` ${needle}`)) return 2;
    if (abbr.startsWith(needle) || id.startsWith(needle)) return 3;
    if (title.includes(needle)) return 4;
    return -1;
  };
  return works
    .map((w) => ({ w, t: tier(w) }))
    .filter((x) => x.t >= 0)
    .sort((a, b) => a.t - b.t || a.w.title.localeCompare(b.w.title))
    .slice(0, limit)
    .map((x) => x.w);
}

// Rank lemmata for a Greek query: fold-prefix matches on the headword,
// most frequent first.
export function rankLemmata(
  q: string,
  lemmata: Record<string, LemmaRef>,
  limit = 5,
): LemmaRef[] {
  const needle = greekFold(q.trim());
  if (!needle) return [];
  const out: LemmaRef[] = [];
  for (const ref of Object.values(lemmata)) {
    if (greekFold(ref.head).startsWith(needle)) out.push(ref);
  }
  return out.sort((a, b) => b.count - a.count).slice(0, limit);
}
