// The results page's grammar facets and its form grouping. The readings come
// from greekHitGrammar and the forms from greekHitForms (lib/search); this
// file only matches, counts, filters and groups, from the result set, so
// ticking a facet or changing the view asks the network for nothing.
import type { HitForms, HitGrammar, LangOp, Reading, SearchResult } from './search';

/** How the hits of one results page are grouped. */
export type ResultView = 'page' | 'form' | 'work' | 'grammar';
export const RESULT_VIEWS: readonly ResultView[] = ['page', 'form', 'work', 'grammar'];

/** Category → the values ticked. A category with none ticked does not filter. */
export type Facets = Record<string, string[]>;

// The order a reading is printed and the facets are listed in: the noun's
// categories, then the verb's, then Morpheus's word-class tags.
const CATEGORY_ORDER = ['case', 'number', 'gender', 'tense', 'mood', 'voice', 'person', 'degree', 'marker'];
const rank = (category: string) => {
  const i = CATEGORY_ORDER.indexOf(category);
  return i < 0 ? CATEGORY_ORDER.length : i;
};
const byCategory = (a: string, b: string) => rank(a) - rank(b) || a.localeCompare(b);

const keyOf = (r: SearchResult) => `${r.work}:${r.meta.id}`;
const ticked = (facets: Facets) => Object.entries(facets).filter(([, values]) => values.length);

export const hasFacets = (facets: Facets) => ticked(facets).length > 0;

/** One reading answers the facets when, in every category ticked, it
 * licenses at least one of the values ticked. */
export function readingMatches(reading: Reading, facets: Facets): boolean {
  return ticked(facets).every(([category, values]) => values.some(v => reading[category]?.includes(v)));
}

/** A token passes on any of its readings, as a grammatical search's match
 * does: ambiguity is not held against it. With a facet ticked an unanalysed
 * token claims nothing, so does not pass. */
export function tokenMatches(readings: Reading[], facets: Facets): boolean {
  if (!hasFacets(facets)) return true;
  return readings.some(r => readingMatches(r, facets));
}

/** The token passes, but not on every one of its readings. */
export function ambiguous(readings: Reading[], facets: Facets): boolean {
  return tokenMatches(readings, facets) && !readings.every(r => readingMatches(r, facets));
}

/** A reading as a line: "nom/voc pl masc". */
export function formatReading(reading: Reading): string {
  return Object.keys(reading).filter(c => reading[c]?.length).sort(byCategory)
    .map(c => reading[c].join('/')).join(' ');
}

export interface FacetCount { category: string; values: { value: string; count: number }[] }

/** Each value present among the Greek hits of `results`, with the number of
 * hits that have a reading licensing it; categories in printing order, values
 * commonest first. `keep` passes over the positions another filter removed. */
export function facetCounts(
  results: SearchResult[],
  grammar: HitGrammar,
  keep?: (r: SearchResult, i: number) => boolean,
): FacetCount[] {
  const counts = new Map<string, Map<string, number>>();
  for (const r of results) {
    if (!r.grkMatch) continue;
    const own = grammar.byResult.get(keyOf(r));
    if (!own) continue;
    r.grkPositions.forEach((_, i) => {
      if (keep && !keep(r, i)) return;
      const licensed = new Set<string>();
      for (const reading of own[i] ?? []) {
        for (const category in reading) for (const v of reading[category]) licensed.add(`${category}\u0000${v}`);
      }
      for (const pair of licensed) {
        const [category, value] = pair.split('\u0000');
        const values = counts.get(category) ?? counts.set(category, new Map()).get(category)!;
        values.set(value, (values.get(value) ?? 0) + 1);
      }
    });
  }
  return [...counts.keys()].sort(byCategory).map(category => ({
    category,
    values: [...counts.get(category)!.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
  }));
}

/** `counts` with every ticked value listed, at 0 where no hit in view has
 * it, so a facet ticked can always be unticked. */
export function withTicked(counts: FacetCount[], facets: Facets): FacetCount[] {
  const out = counts.map(c => ({ ...c, values: [...c.values] }));
  for (const [category, values] of ticked(facets)) {
    let row = out.find(c => c.category === category);
    if (!row) { row = { category, values: [] }; out.push(row); }
    for (const value of values) if (!row.values.some(v => v.value === value)) row.values.push({ value, count: 0 });
  }
  return out.sort((a, b) => byCategory(a.category, b.category));
}

/** Whether a hit passes the facets, as `keep` for the other filters' counts.
 * A result with no readings (its work's grammar did not load) is not narrowed. */
export function facetKeep(grammar: HitGrammar | null, facets: Facets) {
  return (r: SearchResult, i: number): boolean => {
    const own = grammar?.byResult.get(keyOf(r));
    return !own || tokenMatches(own[i] ?? [], facets);
  };
}

/** `results` without the hits whose form is set aside or which fail the
 * facets, in one pass: both side tables are parallel to the positions as
 * searched, so the two filters cannot be chained. A passage left with no
 * Greek hit stays only if its English matched and the two queries were joined
 * by "either" (as excludeForms in lib/form-panel). A result missing from a
 * side table is not narrowed by that filter. */
export function refine(
  results: SearchResult[],
  by: { forms?: HitForms; excluded?: ReadonlySet<string>; grammar?: HitGrammar; facets?: Facets },
  langOp: LangOp,
): SearchResult[] {
  const excluded = by.forms && by.excluded?.size ? by.excluded : null;
  const facets = by.grammar && by.facets && hasFacets(by.facets) ? by.facets : null;
  if (!excluded && !facets) return results;
  return results.flatMap(r => {
    if (!r.grkMatch) return [r];
    const forms = excluded ? by.forms!.byResult.get(keyOf(r)) : undefined;
    const readings = facets ? by.grammar!.byResult.get(keyOf(r)) : undefined;
    if (!forms && !readings) return [r];
    const keep = r.grkPositions.map((_, i) =>
      (!forms || !excluded!.has(forms[i])) && (!readings || tokenMatches(readings[i] ?? [], facets!)));
    if (keep.every(Boolean)) return [r];
    const cut = <T>(list: T[] | undefined) => list?.filter((_, i) => keep[i]);
    const left: SearchResult = {
      ...r,
      grkPositions: cut(r.grkPositions)!,
      ...(r.grammar ? { grammar: cut(r.grammar) } : {}),
      ...(r.speakers ? { speakers: cut(r.speakers) } : {}),
    };
    if (left.grkPositions.length) return [left];
    return r.engMatch && langOp === 'or' ? [{ ...left, grkMatch: false }] : [];
  });
}

export interface FormGroupOf<T> {
  /** The folded form; null for the hits with no Greek, grouped last. */
  form: string | null;
  /** Its accented spellings among the items, in the order met. */
  surfaces: string[];
  items: T[];
  count: number;
}

/** The items grouped by form, most hits first and then by form, each group
 * keeping the items' order; the items without a form in one group at the end. */
export function formGroupsOf<T extends { form?: string; surface?: string; hits: number }>(items: T[]): FormGroupOf<T>[] {
  const byForm = new Map<string | null, FormGroupOf<T>>();
  for (const item of items) {
    const form = item.form ?? null;
    const g = byForm.get(form) ?? byForm.set(form, { form, surfaces: [], items: [], count: 0 }).get(form)!;
    g.items.push(item);
    g.count += item.hits;
    if (item.surface && !g.surfaces.includes(item.surface)) g.surfaces.push(item.surface);
  }
  const english = byForm.get(null);
  byForm.delete(null);
  const groups = [...byForm.values()].sort((a, b) => b.count - a.count || a.form!.localeCompare(b.form!));
  return english ? [...groups, english] : groups;
}
