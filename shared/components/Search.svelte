<script lang="ts">
  import { tick, onMount } from 'svelte';
  import {
    search,
    searchCombo,
    searchPhraseVariants,
    greekFold,
    lemmaOptions,
    COMBO_WINDOW_DEFAULT,
    COMBO_WINDOW_MAX,
    VARIANT_READING_CAP,
    type SearchMode,
    type LangOp,
    type MatchMode,
    type SearchResult,
    type GrammarQuery,
    type SlotKind,
    type ComboSlot,
    type SlotRelation,
    type ComboOptions,
    type WindowUnit,
  } from '../lib/search';
  import { fetchBook, fetchChapters, fetchSections, type Segment, type ChapterRef, type SectionRef } from '../lib/data';
  import { highlightPrefixMatches } from '../lib/text';
  import { WORKS, getWork, workPath, WORK_ORDER, WORK_GROUPS } from '../lib/works';
  import { formatCite, formatLocValue, schemeFor } from '../lib/citation';

  const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, '');

  // One match occurrence, located precisely enough to label and jump to.
  interface Instance {
    lang: 'grk' | 'eng';
    column: string;
    line: number;
    ref: string;       // e.g. "1097a15"
    html: string;      // KWIC snippet
    jumpUrl: string;
    // Grammatical hits only: the reading is stated as one-of-N when the parse
    // does not settle it. Absent when the parse is unambiguous.
    oneOf?: string;
  }
  // All instances within one chapter, merged into a single (collapsible) card.
  interface ChapterGroup {
    key: string;
    work: string;
    book: number;
    chapter: string;
    bekker: string;
    order: number;     // chapter position within the book, for sorting
    instances: Instance[];
  }

  let grkQuery = '';
  let engQuery = '';
  // Greek and English each get an independent match mode (Change 5).
  let grkMode: SearchMode = 'all';
  let engMode: SearchMode = 'all';
  let langOp: LangOp = 'and';
  let matchMode: MatchMode = 'lemma';
  // Which works to search. Default: all. Selected in the collapsible panel below.
  let selectedWorks = new Set<string>(WORKS.map(w => w.id));
  let worksOpen = false;  // is the works "Refine" panel expanded?
  let groups: ChapterGroup[] = [];        // chapter groups of the CURRENT page
  let totalInstances = 0;                 // across the whole result set (all pages)
  let expanded = new Set<string>();
  let loading = false;                    // running the index search
  let searched = false;
  let error = '';
  let showHelp = false;
  let helpModal: HTMLDivElement;
  let helpTrigger: HTMLElement | null = null;

  // Pagination. search() returns the complete hit list (index-only); we render
  // it a page at a time, snapping page breaks to whole books so a chapter never
  // splits across pages — and so only the current page's books/chapters are
  // fetched. That keeps the request burst tiny regardless of how broad the
  // query is, instead of loading every result's book at once.
  const PAGE_TARGET = 40;                 // ~instances per page (whole books)
  let pages: SearchResult[][] = [];       // each page's slice of the result set
  let pageIdx = 0;
  let pageLoading = false;                // fetching the current page's books
  let pageError = '';                     // partial-load notice for this page
  let csvBusy = false;
  let csvNote = '';

  // Immutable snapshot of the SUBMITTED query. Pagination and CSV build snippets
  // and jump-links after the search completes, so they must use the query that
  // produced the results — not whatever is currently typed in the boxes (a user
  // can edit the inputs without re-submitting, then page/retry/export).
  interface SearchCtx { grkQuery: string; engQuery: string; engTerms: string[]; grkAccentTerms: string[]; }
  let searchCtx: SearchCtx = { grkQuery: '', engQuery: '', engTerms: [], grkAccentTerms: [] };

  // ── Accent-sensitive Greek matching ────────────────────────────────────────
  // The indexes are accent-folded (λόγος and λογός share a key), which is the
  // right default and stays the default. The toggle offers strict matching as
  // an instance-level post-filter: the index still finds the folded hits, then
  // each matched surface token must carry the query's exact diacritics. Strict
  // semantics, stated on the control: a query typed WITHOUT accents then only
  // matches genuinely unaccented tokens.
  let accentSensitive = false;
  // NFC + lowercase + final-sigma normalisation, diacritics KEPT.
  const accentNorm = (s: string) => s.normalize('NFC').toLowerCase().replace(/ς/g, 'σ');
  function accentTokenMatch(token: string, terms: string[]): boolean {
    const t = accentNorm(token);
    return terms.some(q =>
      q.endsWith('*') ? t.startsWith(q.slice(0, -1)) : t === q);
  }

  // ── Combo search ──────────────────────────────────────────────────────────
  //
  // Grammatical features never make a question on their own: asked alone,
  // "genitive plural feminine" answers with tens of thousands of tokens, which
  // is a fact about Greek and not an answer to anything. So the grammar index
  // is reachable ONLY as one term beside another, and search.ts refuses a combo
  // with no lexical term. Nothing here offers a standalone grammar search.
  const GRAMMAR_CATEGORIES: { key: string; label: string; values: string[] }[] = [
    { key: 'case',   label: 'Case',   values: ['nom', 'gen', 'dat', 'acc', 'voc'] },
    { key: 'number', label: 'Number', values: ['sg', 'pl', 'dual'] },
    { key: 'gender', label: 'Gender', values: ['masc', 'fem', 'neut'] },
    { key: 'tense',  label: 'Tense',  values: ['pres', 'imperf', 'fut', 'aor', 'perf', 'plup', 'futperf'] },
    { key: 'mood',   label: 'Mood',   values: ['ind', 'subj', 'opt', 'imperat', 'inf', 'part'] },
    { key: 'voice',  label: 'Voice',  values: ['act', 'mid', 'pass', 'mp'] },
    { key: 'person', label: 'Person', values: ['1st', '2nd', '3rd'] },
    { key: 'degree', label: 'Degree', values: ['comp', 'superl', 'irreg_comp'] },
    // Morpheus's own explicit word-class tags — the only part-of-speech-like
    // claim the analyses actually support. Indexed, so offer them rather than
    // stranding them.
    { key: 'marker', label: 'Word class', values: ['adverb', 'adverbial', 'particle', 'prep', 'conj', 'interrog', 'exclam', 'indecl', 'numeral', 'letter'] },
  ];

  // No jargon on the control: a reader who knows what a lemma is loses nothing
  // by being told "in any of its forms", and a reader who does not is stopped
  // dead by "lemma". Same words as the phrase index uses.
  const SLOT_KINDS: { v: SlotKind; l: string }[] = [
    { v: 'form', l: 'Word as written' },
    { v: 'lemma', l: 'Word in any of its forms' },
    { v: 'phrase', l: 'Exact phrase' },
    { v: 'grammatical', l: 'Grammatical description' },
  ];

  interface ComboEditor {
    id: number;
    kind: SlotKind;
    text: string;
    grammar: GrammarQuery;
    relation: SlotRelation;
  }

  let nextComboId = 1;
  function newComboEditor(kind: SlotKind): ComboEditor {
    return { id: nextComboId++, kind, text: '', grammar: {}, relation: 'near' };
  }

  let comboEditors: ComboEditor[] = [newComboEditor('lemma'), newComboEditor('form')];
  let comboWindow = COMBO_WINDOW_DEFAULT;
  let comboUnit: WindowUnit = 'words';
  let comboOrdered = false;
  let comboCrossTurn = true;
  // Which dictionary words a lemma term was actually read as, filled in by the
  // search that used them. Stated rather than assumed: the reader typed a form
  // on the page and is owed the headwords it was resolved to.
  let comboLemmaNote = '';

  // `ordered` is passed in rather than read from scope so the reactive
  // statement below re-runs when the order lock is toggled.
  function comboSlot(editor: ComboEditor, ordered: boolean): ComboSlot | null {
    // The order lock is a whole-query constraint, so it supersedes the per-slot
    // relations rather than combining with them (the two can contradict).
    const relation = ordered ? 'near' : editor.relation;
    if (editor.kind === 'grammatical') {
      return Object.keys(editor.grammar).length
        ? { kind: editor.kind, query: { ...editor.grammar }, relation }
        : null;
    }
    const text = editor.text.trim();
    if (!text) return null;
    return {
      kind: editor.kind,
      terms: editor.kind === 'phrase' ? text.split(/\s+/) : [text],
      relation,
    };
  }

  $: comboSearchSlots = comboEditors
    .map((editor) => comboSlot(editor, comboOrdered))
    .filter((slot): slot is ComboSlot => slot !== null);
  $: comboActive = comboSearchSlots.length >= 2;
  let advancedOpen = false;
  $: if (comboActive) advancedOpen = true;
  // Whether the tool's <details> is open has to live in component state. Bound
  // one way as open={comboActive}, a panel the reader opened by hand is only
  // ever open in the DOM — the component still thinks it is shut, so the next
  // render that re-applies the attribute slams it closed under them. This keeps
  // the auto-open (activating the tool reveals it) while recording the reader's
  // own toggle, so nothing they typed can collapse the panel they typed it in.
  let comboPanelOpen = false;
  $: if (comboActive) comboPanelOpen = true;
  $: comboOptions = {
    window: comboWindow,
    unit: comboUnit,
    ordered: comboOrdered,
    crossTurn: comboCrossTurn,
  } satisfies ComboOptions;

  function toggleAdvanced() {
    advancedOpen = comboActive ? true : !advancedOpen;
  }

  function setComboKind(id: number, kind: SlotKind) {
    const index = comboEditors.findIndex((slot) => slot.id === id);
    if (index < 0 || comboEditors[index].kind === kind) return;
    const relation = comboEditors[index].relation;   // not kind-specific; keep it
    comboEditors[index] = { ...newComboEditor(kind), id, relation };
    comboEditors = [...comboEditors];
  }

  function setComboRelation(id: number, relation: SlotRelation) {
    const editor = comboEditors.find((slot) => slot.id === id);
    if (!editor) return;
    editor.relation = relation;
    comboEditors = [...comboEditors];
  }

  function setComboText(id: number, text: string) {
    const editor = comboEditors.find((slot) => slot.id === id);
    if (!editor) return;
    editor.text = text;
    comboEditors = [...comboEditors];
  }

  function addComboEditor() {
    if (comboEditors.length < 4) comboEditors = [...comboEditors, newComboEditor('form')];
  }

  function removeComboEditor(id: number) {
    if (comboEditors.length > 2) comboEditors = comboEditors.filter((slot) => slot.id !== id);
  }

  function setComboGrammar(id: number, key: string, value: string) {
    const editor = comboEditors.find((slot) => slot.id === id);
    if (!editor) return;
    const next = { ...editor.grammar };
    if (value) next[key] = value; else delete next[key];
    editor.grammar = next;
    comboEditors = [...comboEditors];
  }

  function clampComboWindow() {
    comboWindow = Math.max(1, Math.min(Number(comboWindow) || COMBO_WINDOW_DEFAULT, COMBO_WINDOW_MAX));
  }

  /** Resolve every lemma term to the dictionary words it can belong to.
   *
   * The lemma index is keyed on headwords, so a term typed as it stands on the
   * page — the one form a reader is likely to have — matches nothing until it
   * is resolved. The typed fold is kept alongside the headwords: here that
   * costs one extra index lookup, so a reader who does know the dictionary form
   * must not come off worse. (The phrase index cannot afford the same union —
   * there an unmapped reading costs a whole shard fetch.)
   */
  async function widenLemmaSlots(slots: ComboSlot[]): Promise<ComboSlot[]> {
    const read: string[] = [];
    const out = await Promise.all(slots.map(async (slot) => {
      if (slot.kind !== 'lemma') return slot;
      const fold = greekFold(slot.terms?.[0] ?? '');
      if (!fold || fold.includes('*')) return slot;
      const options = await lemmaOptions([fold]);
      const heads = options?.[0]?.length ? options[0] : [];
      const terms = [...new Set([fold, ...heads])];
      if (heads.length) read.push(`${fold} → ${heads.join(', ')}`);
      return { ...slot, terms };
    }));
    comboLemmaNote = read.length
      ? `Read as dictionary words: ${read.join('; ')}.`
      : '';
    return out;
  }

  // A grammatical hit whose parse the Greek does not settle is reported as
  // one-of-N rather than resolved for the reader. `values` holds every value
  // the token's readings license for each queried category.
  function oneOfLabel(entry: { values: Record<string, string[]>; certain: boolean }): string | undefined {
    if (entry.certain) return undefined;
    const parts = Object.entries(entry.values)
      .filter(([, values]) => values.length)
      .map(([category, values]) => `${category} ${values.join('/')}`);
    return parts.length ? `one of: ${parts.join(', ')}` : 'one of several readings';
  }

  // Shared option list for the per-language mode selectors.
  const MODE_OPTS: { v: SearchMode; l: string }[] = [
    { v: 'all', l: 'All words' },
    { v: 'any', l: 'Any word' },
    { v: 'phrase', l: 'Exact phrase' },
  ];

  function toggleWork(id: string) {
    if (selectedWorks.has(id)) { if (selectedWorks.size > 1) selectedWorks.delete(id); }
    else selectedWorks.add(id);
    selectedWorks = selectedWorks; // reactivity
  }

  // "Select all" reflects the true all-selected state: deselecting any single
  // work flips it off automatically (no fire-and-forget flag). Toggling it on
  // selects every work; toggling it off clears the selection.
  $: allSelected = selectedWorks.size === WORKS.length;
  function selectAll() { selectedWorks = new Set(WORKS.map(w => w.id)); }
  function clearWorks() { selectedWorks = new Set(); }

  // Per-group scope helpers for the works panel. "only" narrows the selection to
  // exactly this division; "add" unions the division into the current selection.
  function groupState(ids: string[]): 'all' | 'some' | 'none' {
    const n = ids.filter(id => selectedWorks.has(id)).length;
    return n === 0 ? 'none' : n === ids.length ? 'all' : 'some';
  }
  function selectOnly(ids: string[]) { selectedWorks = new Set(ids); }
  function addGroup(ids: string[]) {
    for (const id of ids) selectedWorks.add(id);
    selectedWorks = selectedWorks;
  }

  // Authenticity scope — quick-filter the selection by authorship status.
  // "Genuine" = works with no authenticity flag (or explicitly 'genuine'); the
  // others match the tagged works. Each acts like a division "only": clicking it
  // narrows the selection to exactly that class. Empty classes render disabled.
  const AUTH_SCOPES = [
    { key: 'all',      label: 'All',      ids: WORKS.map((w) => w.id) },
    { key: 'genuine',  label: 'Genuine',  ids: WORKS.filter((w) => !w.authenticity || w.authenticity === 'genuine').map((w) => w.id) },
    { key: 'dubious',  label: 'Dubious',  ids: WORKS.filter((w) => w.authenticity === 'dubious').map((w) => w.id) },
    { key: 'spurious', label: 'Spurious', ids: WORKS.filter((w) => w.authenticity === 'spurious').map((w) => w.id) },
  ] as const;
  // Which scope (if any) the current selection exactly matches — drives the active pill.
  $: activeAuthScope = allSelected
    ? 'all'
    : (AUTH_SCOPES.find(
        (s) => s.key !== 'all' && s.ids.length > 0 &&
          s.ids.length === selectedWorks.size && s.ids.every((id) => selectedWorks.has(id)),
      )?.key ?? null);

  // Compact summary for the collapsed trigger.
  $: worksSummary = allSelected
    ? 'All works'
    : selectedWorks.size === 0
      ? 'None selected'
      : `${selectedWorks.size} of ${WORKS.length}`;

  // Results grouped Work → Book → chapter groups, in corpus then numeric order.
  $: groupsByWork = (() => {
    const byWork = new Map<string, Map<number, ChapterGroup[]>>();
    for (const g of groups) {
      const books = byWork.get(g.work) ?? byWork.set(g.work, new Map()).get(g.work)!;
      (books.get(g.book) ?? books.set(g.book, []).get(g.book)!).push(g);
    }
    return [...byWork.entries()]
      .sort((a, b) => (WORK_ORDER.get(a[0]) ?? 0) - (WORK_ORDER.get(b[0]) ?? 0))
      .map(([work, books]) => ({
        work,
        books: [...books.entries()].sort((a, b) => a[0] - b[0]),
      }));
  })();

  function toggle(key: string) {
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
    expanded = expanded; // trigger reactivity
  }

  // Run `fn` over `items` with at most `limit` in flight (bounds the concurrent
  // fetch burst that can make Safari drop requests with "Load failed").
  async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    });
    await Promise.all(workers);
  }

  // Beta Code reference for the "How to type Greek" chart. Keys are the same
  // letters the search index uses, so anything typed here matches directly.
  const BETA_LETTERS: { beta: string; greek: string; name: string }[] = [
    { beta: 'a', greek: 'α', name: 'alpha' },
    { beta: 'b', greek: 'β', name: 'beta' },
    { beta: 'g', greek: 'γ', name: 'gamma' },
    { beta: 'd', greek: 'δ', name: 'delta' },
    { beta: 'e', greek: 'ε', name: 'epsilon' },
    { beta: 'z', greek: 'ζ', name: 'zeta' },
    { beta: 'h', greek: 'η', name: 'eta' },
    { beta: 'q', greek: 'θ', name: 'theta' },
    { beta: 'i', greek: 'ι', name: 'iota' },
    { beta: 'k', greek: 'κ', name: 'kappa' },
    { beta: 'l', greek: 'λ', name: 'lambda' },
    { beta: 'm', greek: 'μ', name: 'mu' },
    { beta: 'n', greek: 'ν', name: 'nu' },
    { beta: 'c', greek: 'ξ', name: 'xi' },
    { beta: 'o', greek: 'ο', name: 'omicron' },
    { beta: 'p', greek: 'π', name: 'pi' },
    { beta: 'r', greek: 'ρ', name: 'rho' },
    { beta: 's', greek: 'σ / ς', name: 'sigma' },
    { beta: 't', greek: 'τ', name: 'tau' },
    { beta: 'u', greek: 'υ', name: 'upsilon' },
    { beta: 'f', greek: 'φ', name: 'phi' },
    { beta: 'x', greek: 'χ', name: 'chi' },
    { beta: 'y', greek: 'ψ', name: 'psi' },
    { beta: 'w', greek: 'ω', name: 'omega' },
  ];

  // Diacritics are typed AFTER the vowel. They're stripped before matching,
  // so they're optional — but they show how full Beta Code is written.
  const BETA_MARKS: { beta: string; example: string; name: string }[] = [
    { beta: ')', example: 'a) → ἀ', name: 'smooth breathing' },
    { beta: '(', example: 'a( → ἁ', name: 'rough breathing' },
    { beta: '/', example: 'a/ → ά', name: 'acute accent' },
    { beta: '\\', example: 'a\\ → ὰ', name: 'grave accent' },
    { beta: '=', example: 'a= → ᾶ', name: 'circumflex' },
    { beta: '|', example: 'a| → ᾳ', name: 'iota subscript' },
    { beta: '+', example: 'i+ → ϊ', name: 'diaeresis' },
  ];

  const BETA_EXAMPLES: { beta: string; greek: string }[] = [
    { beta: 'a)reth/', greek: 'ἀρετή' },
    { beta: 'lo/gos', greek: 'λόγος' },
    { beta: 'yuxh/', greek: 'ψυχή' },
    { beta: 'h(donh/', greek: 'ἡδονή' },
    { beta: 'eu)daimoni/a', greek: 'εὐδαιμονία' },
    { beta: 'fron*', greek: 'φρόν… (wildcard)' },
  ];

  async function openHelp(e?: MouseEvent) {
    helpTrigger = e?.currentTarget instanceof HTMLElement
      ? e.currentTarget
      : document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    showHelp = true;
    await tick();
    helpModal?.focus();
  }

  function closeHelp() {
    showHelp = false;
    helpTrigger?.focus();
    helpTrigger = null;
  }

  function helpFocusableEls(): HTMLElement[] {
    return helpModal
      ? Array.from(helpModal.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )).filter((el) => !el.hasAttribute('disabled') && el.tabIndex !== -1)
      : [];
  }

  function onHelpKey(e: KeyboardEvent) {
    if (!showHelp) return;
    if (e.key === 'Escape') {
      closeHelp();
      return;
    }
    if (e.key !== 'Tab') return;
    const els = helpFocusableEls();
    if (els.length === 0) {
      e.preventDefault();
      helpModal?.focus();
      return;
    }
    const first = els[0];
    const last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // Map a hit's (column, line) to the chapter it falls in, for one book.
  // Chapters are ordered by document position; pick the last whose start is
  // at or before the hit.
  function chapterLookup(bookData: { segments: Segment[] }, chapters: ChapterRef[]) {
    const colIdx = new Map<string, number>();
    bookData.segments.forEach((s, i) => { if (!colIdx.has(s.column)) colIdx.set(s.column, i); });
    const chs = chapters
      .map((c, i) => ({ ...c, ci: colIdx.get(c.column) ?? 0, ln: parseInt(c.line), order: i }))
      .sort((a, b) => a.ci - b.ci || a.ln - b.ln);
    return (column: string, line: number): { chapter: string; bekker: string; order: number } => {
      // Defensive: never return undefined (callers deref .chapter). If the
      // chapter list is empty, group the hit under a placeholder rather than
      // throwing and collapsing the whole page.
      if (!chs.length) return { chapter: '—', bekker: column, order: 0 };
      const ci = colIdx.get(column) ?? 0;
      let found = chs[0];
      for (const c of chs) {
        if (c.ci < ci || (c.ci === ci && c.ln <= line)) found = c;
        else break;
      }
      return found;
    };
  }

  // Stephanus works (all of Plato) ship an EMPTY chapters.json — they're cited by
  // page+section, so the outline lives in sections.json instead. Adapt a book's
  // section outline into the ChapterRef shape chapterLookup/buildGroups expect,
  // grouping hits by Stephanus page: one "chapter" per page, anchored at its
  // first section column, with the page's section columns as the displayed span
  // (e.g. page 2 → anchor "2a", range "2a–2e"). Without this the group builder
  // treats every book as unloadable and renders zero results (the reported bug:
  // "N pages of results, but none of them will load").
  function sectionsToChapters(secs: Record<string, SectionRef[]>): Record<string, ChapterRef[]> {
    const out: Record<string, ChapterRef[]> = {};
    for (const [book, sections] of Object.entries(secs)) {
      const byPage = new Map<number, { anchor: string; cols: string[] }>();
      for (const s of sections) {
        let e = byPage.get(s.page);
        if (!e) { e = { anchor: s.column, cols: [] }; byPage.set(s.page, e); }
        e.cols.push(s.column);
      }
      out[book] = [...byPage.values()].map((e) => ({
        chapter: e.cols[0].slice(0, -1) || e.cols[0],   // page label ("2a" → "2")
        column: e.anchor,
        line: '0',
        bekker: e.cols.length > 1 ? `${e.cols[0]}–${e.cols[e.cols.length - 1]}` : e.cols[0],
      }));
    }
    return out;
  }

  // Load a work's grouping outline: Stephanus works from sections.json, everyone
  // else from chapters.json. Both resolve to the ChapterRef shape.
  function fetchOutline(work: string): Promise<Record<string, ChapterRef[]>> {
    return schemeFor(work).id === 'stephanus'
      ? fetchSections(work).then(sectionsToChapters)
      : fetchChapters(work);
  }

  // Heading word for a result group, keyed to the work's citation scheme —
  // "Stephanus 2" for Plato, "Chapter 5" for a Bekker/Busse work.
  function groupUnitLabel(work: string): string {
    return schemeFor(work).id === 'stephanus' ? 'Stephanus' : 'Chapter';
  }

  // Bekker line number of the token at index `pos` within a segment.
  function lineOfPosition(seg: Segment, pos: number): number {
    let count = 0;
    for (const line of seg.greek) {
      if (pos < count + line.tokens.length) return line.n;
      count += line.tokens.length;
    }
    return seg.greek[seg.greek.length - 1]?.n ?? 1;
  }

  // Approximate Bekker line of an English match at char offset `pos` (for
  // chapter grouping and the jump target), by proportion through the segment.
  function englishLineAt(seg: Segment, pos: number): number {
    const text = seg.english?.text ?? '';
    const lines = seg.greek;
    if (!lines.length) return 1;
    if (pos < 0 || !text.length) return lines[0]?.n ?? 1;
    const idx = Math.min(lines.length - 1, Math.floor(pos / Math.max(1, text.length) * lines.length));
    return lines[idx].n;
  }

  // Instances a result contributes (mirrors how `buildGroups` adds them): one
  // per Greek match position, plus one per English match occurrence. Lets us
  // count the total and lay out pages from the index alone, before any book is
  // fetched (engPositions come from the full English text in meta).
  function instCount(r: SearchResult): number {
    return (r.grkMatch ? r.grkPositions.length : 0) + (r.engMatch ? r.engPositions.length : 0);
  }

  // Build the chapter groups for a slice of results: load the books + chapters
  // they touch (bounded concurrency), then assemble and sort. A failed book or
  // chapter fetch is evicted (see data.ts) and its work:book key collected in
  // `failed` — NOT swallowed as a successful empty result — so the caller can
  // show an incomplete-results notice and offer a retry.
  async function buildGroups(results: SearchResult[], ctx: SearchCtx): Promise<{ groups: ChapterGroup[]; failed: string[] }> {
    const wbPairs = [...new Set(results.map(r => `${r.work}:${r.meta.book}`))];
    const workSet = [...new Set(results.map(r => r.work))];
    const failed: string[] = [];

    const chaptersByWork = new Map<string, Record<string, ChapterRef[]>>();
    await pool(workSet, 8, async w => {
      try { chaptersByWork.set(w, await fetchOutline(w)); }
      catch (err) { console.warn(`search: outline failed for ${w} —`, err); failed.push(w); }
    });
    const segMap = new Map<string, Segment>();             // key: work:segId
    const lookups = new Map<string, ReturnType<typeof chapterLookup>>(); // key: work:book
    await pool(wbPairs, 8, async pair => {
      const [w, bStr] = pair.split(':');
      const b = Number(bStr);
      // If the work's chapters never loaded we can't group its hits — mark the
      // pair failed and skip (don't feed an empty list into chapterLookup),
      // so the page shows the partial-results notice instead of crashing.
      const chapters = chaptersByWork.get(w)?.[String(b)];
      if (!chapters) { failed.push(pair); return; }
      try {
        const data = await fetchBook(w, b);
        for (const s of data.segments) segMap.set(`${w}:${s.id}`, s);
        lookups.set(pair, chapterLookup(data, chapters));
      } catch (err) { console.warn(`search: book failed for ${pair} —`, err); failed.push(pair); }
    });

    const gmap = new Map<string, ChapterGroup>();
    const add = (work: string, book: number, ch: { chapter: string; bekker: string; order: number }, inst: Instance) => {
      const key = `${work}:${book}:${ch.chapter}`;
      let g = gmap.get(key);
      if (!g) { g = { key, work, book, chapter: ch.chapter, bekker: ch.bekker, order: ch.order, instances: [] }; gmap.set(key, g); }
      g.instances.push(inst);
    };

    // Carry the SUBMITTED queries so the reader can highlight them; loc scrolls
    // to the line. Use the snapshot (ctx), not live input state.
    const qs = new URLSearchParams();
    if (ctx.grkQuery) qs.set('hlg', ctx.grkQuery);
    if (ctx.engQuery) qs.set('hle', ctx.engQuery);
    const base = qs.toString();
    const root = import.meta.env.BASE_URL.replace(/\/$/, '');
    // The `?loc=` value composes through the work's citation scheme:
    // "1094a:15" (bekker — byte-identical), "17a" (stephanus — no :line, since
    // Plato has no user-facing lines). See shared/lib/citation.ts.
    const jumpFor = (work: string, book: number, column: string, line: number) =>
      `${root}${workPath(work, book)}?${base}${base ? '&' : ''}loc=${formatLocValue(work, column, line)}`;

    for (const r of results) {
      const seg = segMap.get(`${r.work}:${r.meta.id}`);
      const lookup = lookups.get(`${r.work}:${r.meta.book}`);
      if (!seg || !lookup) continue;
      if (r.grkMatch) {
        // Flattened surface tokens, for the accent post-filter (positions are
        // token indices — the same flattening greekKwic uses).
        const toks: string[] = [];
        if (ctx.grkAccentTerms.length) {
          for (const line of seg.greek) for (const tok of line.tokens) toks.push(tok.t);
        }
        r.grkPositions.forEach((pos, i) => {
          if (ctx.grkAccentTerms.length
            && !accentTokenMatch(toks[pos] ?? '', ctx.grkAccentTerms)) return;
          const line = lineOfPosition(seg, pos);
          const ch = lookup(seg.column, line);
          // Ambiguity is recorded per matched token by searchCombo, in the same
          // order as grkPositions; a plain search leaves `grammar` unset.
          const parse = r.grammar?.[i];
          add(r.work, r.meta.book, ch, { lang: 'grk', column: seg.column, line, ref: formatCite(r.work, seg.column, line), html: greekKwic(seg, [pos]), jumpUrl: jumpFor(r.work, r.meta.book, seg.column, line), oneOf: parse ? oneOfLabel(parse) : undefined });
        });
      }
      if (r.engMatch) {
        // One instance per occurrence (offsets into the segment's full English,
        // which equals meta.english_head — see search.ts englishOccurrences).
        for (const off of r.engPositions) {
          const line = englishLineAt(seg, off);
          const ch = lookup(seg.column, line);
          add(r.work, r.meta.book, ch, { lang: 'eng', column: seg.column, line, ref: seg.column, html: englishKwicAt(seg, off, ctx.engTerms), jumpUrl: jumpFor(r.work, r.meta.book, seg.column, line) });
        }
      }
    }

    for (const g of gmap.values()) g.instances.sort(bekkerCmp);
    const out = [...gmap.values()].sort((a, b) =>
      ((WORK_ORDER.get(a.work) ?? 0) - (WORK_ORDER.get(b.work) ?? 0)) || a.book - b.book || a.order - b.order);
    return { groups: out, failed: [...new Set(failed)] };
  }

  // Split the full result set into pages of whole books (~PAGE_TARGET instances
  // each). Ordered by home-page work order then book; a stable sort keeps each
  // book's hits in document order. Whole books per page ⇒ no chapter splits and
  // only a handful of books fetched per page.
  function paginate(results: SearchResult[]): SearchResult[][] {
    const sorted = [...results].sort((a, b) =>
      ((WORK_ORDER.get(a.work) ?? 0) - (WORK_ORDER.get(b.work) ?? 0)) || (a.meta.book - b.meta.book));
    const blocks: { results: SearchResult[]; count: number }[] = [];
    let key = '';
    for (const r of sorted) {
      const k = `${r.work}:${r.meta.book}`;
      if (k !== key) { blocks.push({ results: [], count: 0 }); key = k; }
      const blk = blocks[blocks.length - 1];
      blk.results.push(r); blk.count += instCount(r);
    }
    const out: SearchResult[][] = [];
    let page: SearchResult[] = []; let count = 0;
    for (const blk of blocks) {
      if (page.length && count + blk.count > PAGE_TARGET) { out.push(page); page = []; count = 0; }
      page.push(...blk.results); count += blk.count;
    }
    if (page.length) out.push(page);
    return out;
  }

  async function renderPage(i: number) {
    pageIdx = i;
    pageLoading = true;
    pageError = '';
    try {
      const { groups: g, failed } = await buildGroups(pages[i] ?? [], searchCtx);
      groups = g;
      // Single-hit chapters open by default; merged (multi-hit) start collapsed.
      expanded = new Set(groups.filter(x => x.instances.length === 1).map(x => x.key));
      if (failed.length) {
        pageError = `${failed.length} passage source${failed.length === 1 ? '' : 's'} on this page didn’t load — some hits may be missing.`;
      }
    } catch (err) {
      pageError = String(err);
      groups = [];
    } finally {
      pageLoading = false;
    }
  }

  function goPage(i: number) {
    if (i < 0 || i >= pages.length || i === pageIdx || pageLoading) return;
    renderPage(i);
    if (typeof document !== 'undefined') {
      document.querySelector('.result-bar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // The command palette (and any external link) can hand off a query via
  // ?g= (Greek) / ?e= (English): prefill and run it on mount. ?q= is the
  // generic term our SearchAction structured data advertises to search
  // engines (sitelinks searchbox) — route it to English, unless an explicit
  // ?e= is also present.
  onMount(() => {
    const params = new URLSearchParams(window.location.search);
    const g = params.get('g');
    const en = params.get('e') ?? params.get('q');
    if (g) grkQuery = g;
    if (en) engQuery = en;
    if (g || en) doSearch();
  });

  async function doSearch(e?: Event) {
    e?.preventDefault();
    if (!comboActive && !grkQuery.trim() && !engQuery.trim()) return;
    loading = true;
    error = '';
    pageError = '';
    csvNote = '';
    variantNote = '';
    variantsShown = false;
    approximateTurns = [];
    comboFailedWorks = [];
    searched = false;
    try {
      const works = WORKS.map(w => w.id).filter(id => selectedWorks.has(id));
      let results: SearchResult[];
      if (comboActive) {
        // Combo runs on its own: it asks a different question of a different
        // index, and mixing it with the plain boxes would report two searches
        // as one. Nothing about it is highlighted from the query boxes either.
        searchCtx = { grkQuery: '', engQuery: '', engTerms: [], grkAccentTerms: [] };
        const outcome = await searchCombo(await widenLemmaSlots(comboSearchSlots), comboOptions, works);
        results = outcome.results;
        approximateTurns = outcome.approximateTurns ?? [];
        comboFailedWorks = outcome.failedWorks;
      } else {
        // Snapshot the submitted query for all deferred (per-page / CSV) rendering.
        searchCtx = {
          grkQuery: grkQuery.trim(),
          engQuery: engQuery.trim(),
          engTerms: engQuery.trim().split(/\s+/).filter(Boolean),
          grkAccentTerms: accentSensitive
            ? grkQuery.trim().split(/\s+/).filter(Boolean).map(accentNorm)
            : [],
        };
        comboLemmaNote = '';
        results = await search(grkQuery, engQuery, grkMode, engMode, langOp, works, matchMode);
      }
      totalInstances = results.reduce((n, r) => n + instCount(r), 0);
      pages = paginate(results);
      searched = true;
      if (pages.length) await renderPage(0);
      else { groups = []; pageIdx = 0; }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  // ── The same phrase in every inflection ───────────────────────────────────
  //
  // An exact phrase search finds only the endings that were typed. ἦν δ' ἐγώ
  // also stands as ἦ δ' ὅς; no exact search reaches it, because the letters on
  // the page differ. This widens the phrase through the corpus lemma map and
  // unions the results — never sums them, since two readings of one passage are
  // one passage.
  let variantBusy = false;
  let variantsShown = false;
  let variantNote = '';
  let approximateTurns: string[] = [];
  let comboFailedWorks: string[] = [];
  $: canWiden = !comboActive
    && searched
    && grkMode === 'phrase'
    && searchCtx.grkQuery.trim().split(/\s+/).filter(Boolean).length > 1;

  async function findVariants() {
    variantBusy = true;
    variantNote = '';
    try {
      const works = WORKS.map(w => w.id).filter(id => selectedWorks.has(id));
      const outcome = await searchPhraseVariants(searchCtx.grkQuery, works);
      if (!outcome.readings.length) {
        variantNote = 'These words could not be resolved to dictionary words, so there is nothing to widen.';
        return;
      }
      variantsShown = true;
      totalInstances = outcome.results.reduce((n, r) => n + instCount(r), 0);
      pages = paginate(outcome.results);
      if (pages.length) await renderPage(0);
      else { groups = []; pageIdx = 0; }
      const read = outcome.productive.map(r => r.join(' ')).join(', ');
      variantNote = read
        ? `Every inflection of this phrase. Matched as ${read}.`
        : 'No inflection of this phrase occurs.';
      if (outcome.cappedFrom) {
        variantNote += ` These words have ${outcome.cappedFrom} readings in all; the first ${VARIANT_READING_CAP} were tried.`;
      }
    } catch (err) {
      variantNote = err instanceof Error ? err.message : String(err);
    } finally {
      variantBusy = false;
    }
  }

  // Greek keyword-in-context: a window of surface tokens around the match,
  // with the matched token(s) highlighted. Positions come from the index.
  const GRK_WINDOW = 8;
  function greekKwic(seg: Segment, positions: number[]): string {
    const toks: string[] = [];
    for (const line of seg.greek) for (const tok of line.tokens) toks.push(tok.t);
    if (!positions.length) {
      const head = toks.slice(0, 2 * GRK_WINDOW + 1);
      return esc(head.join(' ')) + (toks.length > head.length ? ' …' : '');
    }
    const posSet = new Set(positions);
    const center = positions[0];
    const start = Math.max(0, center - GRK_WINDOW);
    const end = Math.min(toks.length, center + GRK_WINDOW + 1);
    const win = [];
    for (let i = start; i < end; i++) {
      const w = esc(toks[i]);
      win.push(posSet.has(i) ? `<mark>${w}</mark>` : w);
    }
    let html = win.join(' ');
    if (start > 0) html = '… ' + html;
    if (end < toks.length) html = html + ' …';
    return html;
  }

  // English keyword-in-context: a character window around the match at char
  // offset `pos` in the full chunk text, with all query terms highlighted.
  const ENG_WINDOW = 140;
  function englishKwicAt(seg: Segment, pos: number, terms: string[]): string {
    const text = seg.english?.text ?? '';
    if (!text) return '';
    const earliest = pos >= 0 && pos < text.length ? pos : 0;
    let start = Math.max(0, earliest - ENG_WINDOW);
    let end = Math.min(text.length, earliest + ENG_WINDOW);
    if (start > 0) {
      const sp = text.indexOf(' ', start);
      if (sp >= 0 && sp < earliest) start = sp + 1;
    }
    if (end < text.length) {
      const sp = text.lastIndexOf(' ', end);
      if (sp > earliest) end = sp;
    }
    let html = highlightEnglish(text.slice(start, end), terms);
    if (start > 0) html = '… ' + html;
    if (end < text.length) html = html + ' …';
    return html;
  }

  function highlightEnglish(text: string, terms: string[]): string {
    return highlightPrefixMatches(text, terms);
  }

  function esc(s: string): string {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Bekker order within a chapter: page number, then column half (a < b), then
  // line. Sorting by line alone mis-orders hits that span two columns of one
  // chapter (e.g. 1097b3 before 1097a15). Works for grk and eng instances alike.
  function bekkerCmp(a: Instance, b: Instance): number {
    const pa = parseInt(a.column, 10) || 0;
    const pb = parseInt(b.column, 10) || 0;
    if (pa !== pb) return pa - pb;
    const ha = a.column.slice(-1), hb = b.column.slice(-1);
    if (ha !== hb) return ha < hb ? -1 : 1;
    return a.line - b.line;
  }

  // --- CSV export (the FULL result set, every page) ------------------------
  function stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .trim();
  }
  function csvCell(v: string): string {
    return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  }
  async function exportCsv() {
    if (csvBusy) return;
    csvBusy = true;
    csvNote = '';
    try {
      // Export every result, not just the current page — so build groups over
      // the whole set (loads any not-yet-fetched books on demand, bounded +
      // retried). If some book truly can't load, the CSV omits those rows and
      // we say so rather than silently shipping a short file.
      const { groups: allGroups, failed } = await buildGroups(pages.flat(), searchCtx);
      const origin = typeof location !== 'undefined' ? location.origin : '';
      // URL comes BEFORE the free-text Snippet (and Snippet is the LAST column)
      // on purpose. The snippet holds prose full of commas; we RFC-quote it, but
      // iPad Excel / Numbers don't reliably honour the quoting, so those commas
      // split the row — and since each snippet has a different comma count, the
      // URL landed in a different column on every row and stopped being clickable
      // (reported by a user). With the URL ahead of it, the link always sits in
      // one fixed, comma-free column; only the trailing snippet can spill, which
      // is harmless. A compliant parser reads all seven columns either way.
      const rows: string[][] = [['Work', 'Book', 'Chapter', 'Citation', 'Language', 'URL', 'Snippet']];
      for (const g of allGroups) {
        const w = getWork(g.work);
        const workTitle = w?.title ?? g.work;
        const book = w?.bookLabels[g.book - 1] ?? String(g.book);
        for (const inst of g.instances) {
          rows.push([
            workTitle, String(book), g.chapter, inst.ref,
            inst.lang === 'grk' ? 'Greek' : 'English',
            origin + inst.jumpUrl,
            stripHtml(inst.html),
          ]);
        }
      }
      const csv = rows.map(r => r.map(csvCell).join(',')).join('\r\n');
      // Prepend a UTF-8 BOM so Excel renders Greek correctly.
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `plato-search-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      if (failed.length) {
        csvNote = `Exported, but ${failed.length} passage source${failed.length === 1 ? '' : 's'} couldn’t load — the CSV may be missing some rows. Try again to retry those.`;
      }
    } catch (err) {
      csvNote = `Export failed: ${String(err)}`;
    } finally {
      csvBusy = false;
    }
  }

  function onEnter(e: KeyboardEvent) {
    if (e.key === 'Enter') doSearch();
  }
</script>

<svelte:window on:keydown={onHelpKey} />

<main class="search-page">
  <form class="search-form" on:submit={doSearch} novalidate>

    <div class="query-row">
      <label class="query-label" for="grk-input">Greek</label>
      <input
        id="grk-input"
        class="query-input greek-input"
        lang="grc"
        type="search"
        placeholder="τέχνη or texnh, fronhsis*, …"
        bind:value={grkQuery}
        on:keydown={onEnter}
        autocomplete="off"
        autocorrect="off"
        autocapitalize="none"
        spellcheck="false"
        disabled={comboActive}
      />
      <button type="button" class="help-btn" on:click={openHelp} aria-haspopup="dialog" title="How to type Greek">
        ⌨ Type Greek
      </button>
    </div>

    <div class="below-query">
      <fieldset class="mode-group">
        <legend>Greek match</legend>
        {#each MODE_OPTS as opt}
          <label><input type="radio" name="grkmode" value={opt.v} bind:group={grkMode} /> {opt.l}</label>
        {/each}
      </fieldset>
      <fieldset class="mode-group" title="The first takes whatever form you type and finds every form of that word; the second matches the word only as written">
        <legend>Form</legend>
        <label><input type="radio" name="matchmode" value="lemma" bind:group={matchMode} /> Any form of this word</label>
        <label><input type="radio" name="matchmode" value="form" bind:group={matchMode} /> Only as I typed it</label>
      </fieldset>
      <fieldset class="mode-group" title="Match diacritics exactly: λόγος and λογός become different queries. A query typed without accents then only matches unaccented tokens.">
        <legend>Accents</legend>
        <label><input type="checkbox" bind:checked={accentSensitive} /> Match accents exactly</label>
      </fieldset>
    </div>

    <div class="advanced-panel">
      <div class="advanced-head">
        <button
          type="button"
          class="advanced-trigger"
          aria-expanded={advancedOpen}
          aria-controls="advanced-tools"
          on:click={toggleAdvanced}
        >
          Advanced search <span aria-hidden="true">{advancedOpen ? '▴' : '▾'}</span>
        </button>
        <a class="guide-link" href={`${BASE_URL}/advanced`} target="_blank" rel="noreferrer">What these tools do</a>
      </div>
      {#if advancedOpen}
        <div id="advanced-tools" class="advanced-body">
          <details class="combo-panel" bind:open={comboPanelOpen}>
            <summary>
              Words near each other
              {#if comboActive}<span class="combo-active">{comboSearchSlots.length} terms ready</span>{/if}
            </summary>

            <div class="combo-slots">
              {#each comboEditors as slot, slotIndex (slot.id)}
                <section class="combo-slot" aria-labelledby={`combo-slot-${slot.id}`}>
                  <div class="combo-slot-head">
                    <span id={`combo-slot-${slot.id}`} class="combo-slot-number">Term {slotIndex + 1}</span>
                    <label class="combo-kind">
                      <span>Kind</span>
                      <select
                        value={slot.kind}
                        aria-label={`Kind for term ${slotIndex + 1}`}
                        on:change={(e) => setComboKind(slot.id, e.currentTarget.value as SlotKind)}
                      >
                        {#each SLOT_KINDS as k}<option value={k.v}>{k.l}</option>{/each}
                      </select>
                    </label>
                    {#if slotIndex > 0}
                      <!-- Placed against term 1, not against the term above it, so
                           each answers "before or after the word I am studying?".
                           The order lock is the stronger whole-query constraint and
                           supersedes these. -->
                      <label class="combo-kind">
                        <span>Relative to term 1</span>
                        <select
                          value={slot.relation}
                          disabled={comboOrdered}
                          aria-label={`Position of term ${slotIndex + 1} relative to term 1`}
                          on:change={(e) => setComboRelation(slot.id, e.currentTarget.value as SlotRelation)}
                        >
                          <option value="near">Near</option>
                          <option value="before">Before</option>
                          <option value="after">After</option>
                        </select>
                      </label>
                    {/if}
                    <button
                      type="button"
                      class="combo-remove"
                      disabled={comboEditors.length <= 2}
                      aria-label={`Remove term ${slotIndex + 1}`}
                      on:click={() => removeComboEditor(slot.id)}
                    >Remove</button>
                  </div>

                  {#if slot.kind === 'grammatical'}
                    <div class="combo-grammar-grid">
                      {#each GRAMMAR_CATEGORIES as cat}
                        <label class="grammar-field">
                          <span>{cat.label}</span>
                          <select
                            value={slot.grammar[cat.key] ?? ''}
                            on:change={(e) => setComboGrammar(slot.id, cat.key, e.currentTarget.value)}
                          >
                            <option value="">any</option>
                            {#each cat.values as v}<option value={v}>{v}</option>{/each}
                          </select>
                        </label>
                      {/each}
                    </div>
                  {:else}
                    <label class="combo-text-field" for={`combo-text-${slot.id}`}>
                      <span>
                        {slot.kind === 'phrase'
                          ? 'The words, in order'
                          : slot.kind === 'lemma'
                            ? 'A word, in any form'
                            : 'The word as written'}
                      </span>
                      <input
                        id={`combo-text-${slot.id}`}
                        lang="grc"
                        type="text"
                        value={slot.text}
                        on:input={(e) => setComboText(slot.id, e.currentTarget.value)}
                        autocomplete="off"
                        autocorrect="off"
                        autocapitalize="none"
                        spellcheck="false"
                      />
                    </label>
                  {/if}
                </section>
              {/each}
            </div>

            <button
              type="button"
              class="combo-add"
              disabled={comboEditors.length >= 4}
              on:click={addComboEditor}
            >Add term</button>

            <div class="combo-proximity">
              <label class="combo-option combo-window">
                <span>Window (words)</span>
                <input
                  type="number"
                  min="1"
                  max={COMBO_WINDOW_MAX}
                  bind:value={comboWindow}
                  disabled={comboUnit !== 'words'}
                  on:blur={clampComboWindow}
                />
              </label>
              <label class="combo-option">
                <span>Measured in</span>
                <select bind:value={comboUnit}>
                  <option value="words">Words</option>
                  <option value="line">Same line of Greek</option>
                  <option value="turn">Same speech</option>
                </select>
              </label>
              <label class="combo-check"><input type="checkbox" bind:checked={comboOrdered} /> In this order</label>
              <label class="combo-check"><input type="checkbox" bind:checked={comboCrossTurn} /> Keep hits that cross from one speaker to the next</label>
            </div>

            <p class="combo-note">
              This runs on its own and ignores the Greek and English boxes.
              <a class="guide-link" href={`${BASE_URL}/advanced#combo`} target="_blank" rel="noreferrer">What is this?</a>
              A grammatical description is only ever one term beside another —
              asked alone it returns the corpus, not an answer. Every term after
              the first can be placed near, before or after term 1; the order
              lock is stronger and overrides those. A window never spans a book
              boundary. Where a term rests on an ambiguous parse, the hit is
              reported as one of several readings.
              <a class="guide-link" href={`${BASE_URL}/advanced#honesty`} target="_blank" rel="noreferrer">What is this?</a>
            </p>
          </details>
        </div>
      {/if}
    </div>

    <div class="query-row">
      <label class="query-label" for="eng-input">English</label>
      <input
        id="eng-input"
        class="query-input"
        type="search"
        placeholder="virtue, happiness, …"
        bind:value={engQuery}
        on:keydown={onEnter}
        autocomplete="off"
        disabled={comboActive}
      />
    </div>

    <div class="below-query">
      <fieldset class="mode-group">
        <legend>English match</legend>
        {#each MODE_OPTS as opt}
          <label><input type="radio" name="engmode" value={opt.v} bind:group={engMode} /> {opt.l}</label>
        {/each}
      </fieldset>
    </div>

    <div class="works-panel" role="group" aria-label="Works to search">
      <button
        type="button"
        class="works-trigger"
        aria-expanded={worksOpen}
        on:click={() => (worksOpen = !worksOpen)}
      >
        <span class="works-label">Works</span>
        <span class="works-summary">{worksSummary}</span>
        <span class="works-caret">{worksOpen ? 'Hide ▴' : 'Refine ▾'}</span>
      </button>

      {#if worksOpen}
        <div class="works-body">
          <div class="works-actions">
            <button type="button" class="works-action" on:click={selectAll} disabled={allSelected}>Select all</button>
            <button type="button" class="works-action" on:click={clearWorks} disabled={selectedWorks.size === 0}>Clear</button>
          </div>

          <div class="works-auth" role="group" aria-label="Filter works by authorship status">
            {#each AUTH_SCOPES as s}
              <button
                type="button"
                class="auth-btn"
                class:on={activeAuthScope === s.key}
                aria-pressed={activeAuthScope === s.key}
                disabled={s.ids.length === 0}
                on:click={() => selectOnly(s.ids)}
                title={s.key === 'all' ? 'Search all works' : `Search only ${s.label.toLowerCase()} works`}
              >{s.label}{#if s.key !== 'all'}<span class="auth-count">{s.ids.length}</span>{/if}</button>
            {/each}
          </div>

          {#each WORK_GROUPS as grp}
            {@const gs = groupState(grp.ids)}
            <div class="works-group">
              <div class="works-group-head">
                <span class="works-group-name">{grp.ref}. {grp.label}</span>
                <span class="works-group-scope">
                  <button type="button" class="scope-btn" class:on={gs === 'all'} on:click={() => selectOnly(grp.ids)} title="Search only this division">only</button>
                  <button type="button" class="scope-btn" on:click={() => addGroup(grp.ids)} title="Add this division to the selection">+ add</button>
                </span>
              </div>
              <div class="works-chips">
                {#each grp.ids as id}
                  {@const w = getWork(id)}
                  {#if w}
                    <button
                      type="button"
                      class="work-chip"
                      class:on={selectedWorks.has(id)}
                      aria-pressed={selectedWorks.has(id)}
                      on:click={() => toggleWork(id)}
                      title={w.title}
                    >{w.abbr} · {w.title}</button>
                  {/if}
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="controls-row">
      <fieldset class="op-group" class:inactive={!(grkQuery.trim() && engQuery.trim())}>
        <legend>Greek + English</legend>
        <label title="Only passages matching both queries"><input type="radio" name="op" value="and" bind:group={langOp} /> Both queries</label>
        <label title="Passages matching either query"><input type="radio" name="op" value="or"  bind:group={langOp} /> Either query</label>
      </fieldset>

      <button type="submit" class="search-btn" disabled={loading}>
        {loading ? 'Searching…' : 'Search'}
      </button>
    </div>

    <p class="search-hint">
      Type Greek in Greek letters or <button type="button" class="link-btn" on:click={openHelp}>Beta Code</button>
      (<code>texnh</code> = τέχνη). End a word with <code>*</code> for a wildcard: <code>fron*</code> matches φρόνησις, φρόνιμος, etc.
      A <code>*</code> anywhere else matches nothing — the index is built on word beginnings.
    </p>
  </form>

  {#if showHelp}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="help-backdrop" on:click={closeHelp}>
      <div
        class="help-modal"
        bind:this={helpModal}
        role="dialog"
        aria-modal="true"
        aria-label="How to type Greek"
        tabindex="-1"
        on:click|stopPropagation
        on:keydown={onHelpKey}
      >
        <div class="help-head">
          <h2>How to type Greek</h2>
          <button type="button" class="help-close" on:click={closeHelp} aria-label="Close">×</button>
        </div>

        <p class="help-intro">
          The Greek box accepts Greek letters <em>or</em> <strong>Beta Code</strong> — a plain-ASCII
          transliteration. Each Greek letter is one Latin key:
        </p>

        <div class="beta-grid">
          {#each BETA_LETTERS as L}
            <div class="beta-cell">
              <span class="beta-key">{L.beta}</span>
              <span class="beta-grk" lang="grc">{L.greek}</span>
              <span class="beta-name">{L.name}</span>
            </div>
          {/each}
        </div>

        <h3>Accents &amp; breathings <span class="help-note">(optional — ignored when matching)</span></h3>
        <p class="help-sub">Type the mark right after the vowel:</p>
        <ul class="mark-list">
          {#each BETA_MARKS as M}
            <li><span class="beta-key">{M.beta}</span> <span class="mark-ex" lang="grc">{M.example}</span> <span class="beta-name">{M.name}</span></li>
          {/each}
        </ul>

        <h3>Examples</h3>
        <ul class="example-list">
          {#each BETA_EXAMPLES as E}
            <li><code>{E.beta}</code> <span class="ex-arrow" aria-hidden="true">→</span> <span class="ex-grk" lang="grc">{E.greek}</span></li>
          {/each}
        </ul>

        <p class="help-foot">
          Long vowels are distinct: <code>h</code> = η (not <code>e</code> = ε), <code>w</code> = ω (not <code>o</code> = ο).
          Type them exactly. Accents and breathings may be included or left off.
        </p>
      </div>
    </div>
  {/if}

  {#if error}
    <p class="search-error">{error}</p>
  {:else if searched}
    {#if comboFailedWorks.length}
      <p class="search-note warn">
        The index for {comboFailedWorks.map((w) => getWork(w)?.title ?? w).join(', ')}
        did not load. Counts below may be short.
        <button type="button" class="retry-btn" on:click={doSearch}>Retry</button>
      </p>
    {/if}
    {#if approximateTurns.length}
      <p class="search-note">
        Where a speech begins in {approximateTurns.map((w) => getWork(w)?.title ?? w).join(', ')}
        is recorded to the section rather than the word, so a hit at the very start
        of a speech may belong to the one before it.
      </p>
    {/if}
    <div class="result-bar">
      <p class="result-count">
        {totalInstances === 0
          ? 'No passages found.'
          : `${totalInstances} instance${totalInstances === 1 ? '' : 's'}` +
            (searchCtx.grkAccentTerms.length ? ' before accent filtering' : '') +
            (pages.length > 1 ? ` · page ${pageIdx + 1} of ${pages.length}` : '')}
      </p>
      {#if canWiden && !variantsShown}
        <button
          type="button"
          class="export-btn"
          on:click={findVariants}
          disabled={variantBusy}
          title="ἦν δ’ ἐγώ also stands as ἦ δ’ ὅς — one formula, different endings"
        >
          {variantBusy ? 'Looking…' : 'Find this phrase in any inflection'}
        </button>
        <a class="guide-link result-guide" href={`${BASE_URL}/advanced#variants`} target="_blank" rel="noreferrer">What is this?</a>
      {/if}
      {#if totalInstances > 0}
        <button type="button" class="export-btn" on:click={exportCsv} disabled={csvBusy}>
          {csvBusy ? 'Preparing CSV…' : 'Export results as CSV'}
        </button>
      {/if}
    </div>
    {#if comboLemmaNote}
      <p class="search-note">{comboLemmaNote}</p>
    {/if}
    {#if variantNote}
      <p class="search-note">{variantNote}</p>
    {/if}
    {#if csvNote}
      <p class="search-note">{csvNote}</p>
    {/if}

    {#if pages.length > 1}
      <nav class="pager" aria-label="Result pages">
        <button type="button" class="pager-btn" on:click={() => goPage(pageIdx - 1)} disabled={pageIdx === 0 || pageLoading}>‹ Prev</button>
        <span class="pager-status">{pageLoading ? 'Loading…' : `Page ${pageIdx + 1} of ${pages.length}`}</span>
        <button type="button" class="pager-btn" on:click={() => goPage(pageIdx + 1)} disabled={pageIdx >= pages.length - 1 || pageLoading}>Next ›</button>
      </nav>
    {/if}

    {#if pageError}
      <p class="search-note warn">
        {pageError}
        <button type="button" class="retry-btn" on:click={() => renderPage(pageIdx)} disabled={pageLoading}>Retry</button>
      </p>
    {/if}

    {#each groupsByWork as wg}
      {#each wg.books as [book, bookGroups]}
      <section class="book-section">
        <h2 class="book-header">
          <span class="work-name">{getWork(wg.work)?.title ?? wg.work}</span>
          <span class="book-name">Book {getWork(wg.work)?.bookLabels[book - 1] ?? book}</span>
        </h2>

        {#each bookGroups as g (g.key)}
          <div class="chapter-group">
            <button class="group-head" on:click={() => toggle(g.key)} aria-expanded={expanded.has(g.key)}>
              <span class="caret">{expanded.has(g.key) ? '▾' : '▸'}</span>
              <span class="group-label">{groupUnitLabel(wg.work)} {g.chapter}</span>
              <span class="group-bekker">{g.bekker}</span>
              <span class="group-count">{g.instances.length} {g.instances.length === 1 ? 'instance' : 'instances'}</span>
            </button>

            {#if expanded.has(g.key)}
              <ul class="instance-list">
                {#each g.instances as inst}
                  <li class="instance">
                    <a class="inst-ref" href={inst.jumpUrl} target="_blank" rel="noopener" title="Open in reader (new tab)">{inst.ref}</a>
                    <span class="inst-snippet" class:greek={inst.lang === 'grk'} lang={inst.lang === 'grk' ? 'grc' : 'en'}>
                      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                      {@html inst.html}
                    </span>
                    {#if inst.oneOf}
                      <span class="inst-oneof">{inst.oneOf}</span>
                    {/if}
                  </li>
                {/each}
              </ul>
            {/if}
          </div>
        {/each}
      </section>
      {/each}
    {/each}

    {#if pages.length > 1}
      <nav class="pager pager-bottom" aria-label="Result pages">
        <button type="button" class="pager-btn" on:click={() => goPage(pageIdx - 1)} disabled={pageIdx === 0 || pageLoading}>‹ Prev</button>
        <span class="pager-status">{pageLoading ? 'Loading…' : `Page ${pageIdx + 1} of ${pages.length}`}</span>
        <button type="button" class="pager-btn" on:click={() => goPage(pageIdx + 1)} disabled={pageIdx >= pages.length - 1 || pageLoading}>Next ›</button>
      </nav>
    {/if}
  {/if}
</main>

<style>
  .search-page {
    max-width: 760px;
    margin: 0 auto;
    padding: 1.5rem 1rem 4rem;
  }

  .search-form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    background: var(--col-bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1.25rem 1.5rem 1rem;
    margin-bottom: 1.5rem;
  }

  .query-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .query-label {
    font-family: var(--font-ui);
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: .04em;
    color: var(--text-mid);
    width: 3.5rem;
    flex-shrink: 0;
  }

  .query-input {
    flex: 1;
    font-family: var(--font-english);
    font-size: 1rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.4rem 0.6rem;
    background: var(--input-bg);
    color: var(--text);
    appearance: none;
    -webkit-appearance: none;
  }
  .query-input:focus {
    outline: 2px solid var(--accent-light);
    outline-offset: 1px;
  }
  .greek-input { font-family: var(--font-greek); }

  .controls-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
  }

  /* Per-language mode selectors sitting directly below each query box. */
  .below-query {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
    margin: -0.3rem 0 0.1rem 4.25rem;  /* align under the input, past the label */
  }

  /* --- Advanced tools ---------------------------------------------------- */
  .advanced-panel {
    margin: 0.35rem 0 0.1rem 4.25rem;
    font-family: var(--font-ui);
  }
  .advanced-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .advanced-trigger {
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    font-family: var(--font-ui);
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: .04em;
    color: var(--text-mid);
  }
  .advanced-body {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    margin-top: 0.55rem;
  }
  .guide-link {
    font-family: var(--font-ui);
    font-size: 0.72rem;
    font-weight: 400;
    letter-spacing: 0;
    color: var(--text-light);
    text-decoration: underline;
    text-underline-offset: 0.12em;
  }
  .guide-link:hover { color: var(--accent); }

  .grammar-field {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.78rem;
    color: var(--text-mid);
  }
  .grammar-field select {
    font-family: var(--font-ui);
    font-size: 0.85rem;
    padding: 0.2rem 0.3rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--col-bg);
    color: var(--text);
  }

  .combo-panel {
    margin: 0;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--input-bg);
    padding: 0.45rem 0.75rem;
    font-family: var(--font-ui);
  }
  .combo-panel > summary {
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: .04em;
    color: var(--text-mid);
  }
  .combo-active {
    margin-left: 0.5rem;
    font-weight: 400;
    letter-spacing: 0;
    color: var(--accent);
  }
  .combo-slots {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-top: 0.6rem;
  }
  .combo-slot {
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--col-bg);
    padding: 0.55rem 0.65rem 0.65rem;
  }
  .combo-slot-head {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.6rem;
    margin-bottom: 0.5rem;
  }
  .combo-slot-number {
    align-self: center;
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--text-mid);
  }
  .combo-kind,
  .combo-text-field,
  .combo-option {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.75rem;
    color: var(--text-mid);
  }
  .combo-kind:first-of-type { margin-left: auto; }
  .combo-kind select,
  .combo-text-field input,
  .combo-option select,
  .combo-option input {
    font-family: var(--font-ui);
    font-size: 0.85rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--input-bg);
    color: var(--text);
    padding: 0.25rem 0.4rem;
  }
  .combo-text-field input {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--font-greek);
    font-size: 0.95rem;
  }
  .combo-kind select:focus,
  .combo-text-field input:focus,
  .combo-option select:focus,
  .combo-option input:focus,
  .grammar-field select:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .combo-remove,
  .combo-add {
    font-family: var(--font-ui);
    font-size: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--input-bg);
    color: var(--accent);
    padding: 0.25rem 0.55rem;
    cursor: pointer;
  }
  .combo-remove:disabled,
  .combo-add:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .combo-add { margin-top: 0.6rem; }
  .combo-grammar-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem 1rem;
  }
  .combo-proximity {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 0.6rem 0.9rem;
    margin-top: 0.75rem;
    padding-top: 0.65rem;
    border-top: 1px solid var(--border);
  }
  .combo-window input { width: 4.5rem; }
  .combo-option input:disabled { opacity: 0.5; }
  .combo-check {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.78rem;
    color: var(--text);
    cursor: pointer;
    padding-bottom: 0.25rem;
  }
  .combo-note {
    margin: 0.6rem 0 0.15rem;
    font-size: 0.8rem;
    line-height: 1.45;
    color: var(--text-mid);
    max-width: 62ch;
  }

  /* A hit whose parse allows more than one reading. Stated, never implied. */
  .inst-oneof {
    display: inline-block;
    margin-left: 0.5rem;
    font-family: var(--font-ui);
    font-size: 0.72rem;
    color: var(--text-mid);
    border: 1px dashed var(--border);
    border-radius: 3px;
    padding: 0 0.3rem;
    white-space: nowrap;
  }

  /* --- Collapsible works selector --------------------------------------- */
  .works-panel {
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--input-bg);
  }
  .works-trigger {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.45rem 0.75rem;
    text-align: left;
    font-family: var(--font-ui);
  }
  .works-label {
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: .04em;
    color: var(--text-mid);
  }
  .works-summary { font-size: 0.85rem; color: var(--text); }
  .works-caret {
    margin-left: auto;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--accent);
  }
  .works-body {
    padding: 0.25rem 0.75rem 0.75rem;
    border-top: 1px solid var(--border);
    max-height: 18rem;
    overflow-y: auto;
  }
  .works-actions {
    display: flex;
    gap: 0.5rem;
    padding: 0.5rem 0 0.25rem;
  }
  .works-action {
    font-family: var(--font-ui);
    font-size: 0.76rem;
    font-weight: 600;
    color: var(--accent);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.2rem 0.6rem;
    cursor: pointer;
  }
  .works-action:disabled { opacity: 0.45; cursor: default; }
  .works-auth { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.55rem; }
  .auth-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-family: var(--font-ui);
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--text-mid);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.18rem 0.6rem;
    cursor: pointer;
  }
  .auth-btn:hover:not(:disabled) { border-color: var(--accent-light); color: var(--accent); }
  .auth-btn.on { color: var(--accent); border-color: var(--accent-light); background: color-mix(in srgb, var(--accent) 8%, transparent); }
  .auth-btn:disabled { opacity: 0.4; cursor: default; }
  .auth-count { font-size: 0.66rem; opacity: 0.6; font-variant-numeric: tabular-nums; }
  .works-group { margin-top: 0.6rem; }
  .works-group-head {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    margin-bottom: 0.3rem;
  }
  .works-group-name {
    font-family: var(--font-ui);
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--text-mid);
  }
  .works-group-scope { margin-left: auto; display: flex; gap: 0.3rem; }
  .scope-btn {
    font-family: var(--font-ui);
    font-size: 0.7rem;
    color: var(--text-light);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.05rem 0.4rem;
    cursor: pointer;
  }
  .scope-btn:hover { border-color: var(--accent-light); color: var(--accent); }
  .scope-btn.on { color: var(--accent); border-color: var(--accent-light); }
  .works-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .work-chip {
    font-family: var(--font-ui);
    font-size: 0.78rem;
    color: var(--text-mid);
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 0.2rem 0.7rem;
    cursor: pointer;
    transition: background .12s ease, color .12s ease, border-color .12s ease, scale .12s ease;
  }
  .work-chip:hover { border-color: var(--accent-light); }
  .work-chip.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--on-accent);
  }

  fieldset {
    border: none;
    padding: 0;
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  legend {
    font-family: var(--font-ui);
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: .04em;
    color: var(--text-mid);
    float: left;
    margin-right: 0.5rem;
    padding-top: 0.1rem;
  }

  fieldset label {
    font-family: var(--font-ui);
    font-size: 0.85rem;
    display: flex;
    align-items: center;
    gap: 0.3rem;
    cursor: pointer;
    color: var(--text);
  }

  /* The Greek/English combine choice only applies when both boxes have text;
     keep it visible (for discoverability) but dimmed until then. */
  .op-group.inactive { opacity: 0.5; }

  .search-btn {
    margin-left: auto;
    font-family: var(--font-ui);
    font-size: 0.9rem;
    font-weight: 600;
    background: var(--accent);
    color: var(--on-accent);
    border: none;
    border-radius: 4px;
    padding: 0.45rem 1.25rem;
    cursor: pointer;
    letter-spacing: .02em;
  }
  .search-btn:hover:not(:disabled) { background: var(--accent-light); }
  .search-btn:disabled { opacity: 0.6; cursor: not-allowed; }

  .search-hint {
    font-family: var(--font-ui);
    font-size: 0.75rem;
    color: var(--text-light);
    margin-top: -0.25rem;
    text-wrap: pretty;
  }
  .search-hint code,
  .help-modal code {
    background: var(--border);
    border-radius: 2px;
    padding: 0 0.25em;
    font-size: 0.85em;
  }

  .help-btn {
    flex-shrink: 0;
    font-family: var(--font-ui);
    font-size: 0.78rem;
    font-weight: 600;
    background: transparent;
    color: var(--accent);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.35rem 0.6rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .help-btn:hover { background: var(--col-bg); border-color: var(--accent-light); }

  .link-btn {
    font: inherit;
    background: none;
    border: none;
    padding: 0;
    color: var(--accent);
    cursor: pointer;
    text-decoration: underline;
  }

  /* --- Help modal --- */
  .help-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 2rem 1rem;
    overflow-y: auto;
    z-index: 50;
    animation: backdrop-in 0.18s ease-out;
  }
  .help-modal {
    background: var(--popup-bg);
    border-radius: 8px;
    max-width: 540px;
    width: 100%;
    padding: 1.25rem 1.5rem 1.75rem;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.25);
    font-family: var(--font-ui);
    color: var(--text);
    /* Soft rise + fade as it opens, matching the reader's Help modal. */
    animation: modal-in 0.2s cubic-bezier(0.2, 0, 0, 1);
  }
  @keyframes backdrop-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes modal-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .help-backdrop, .help-modal { animation: none; }
  }
  .help-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.5rem;
  }
  .help-head h2 {
    font-size: 1.1rem;
    margin: 0;
    color: var(--text);
  }
  .help-close {
    background: none;
    border: none;
    font-size: 1.6rem;
    line-height: 1;
    color: var(--text-light);
    cursor: pointer;
    padding: 0 0.25rem;
  }
  .help-close:hover { color: var(--text); }

  .help-intro {
    font-size: 0.85rem;
    color: var(--text-mid);
    line-height: 1.5;
    margin: 0 0 0.9rem;
    text-wrap: pretty;
  }

  .beta-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 0.4rem;
    margin-bottom: 1.1rem;
  }
  .beta-cell {
    display: grid;
    grid-template-columns: auto auto;
    align-items: baseline;
    column-gap: 0.4rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.3rem 0.45rem;
  }
  .beta-key {
    font-family: var(--font-english);
    font-weight: 700;
    font-size: 0.95rem;
    color: var(--accent);
  }
  .beta-grk {
    font-family: var(--font-greek);
    font-size: 1.05rem;
    color: var(--text);
  }
  .beta-name {
    grid-column: 1 / -1;
    font-size: 0.68rem;
    color: var(--text-light);
    letter-spacing: .02em;
  }

  .help-modal h3 {
    font-size: 0.9rem;
    margin: 1rem 0 0.35rem;
    color: var(--text);
  }
  .help-note {
    font-weight: 400;
    font-size: 0.72rem;
    color: var(--text-light);
  }
  .help-sub {
    font-size: 0.78rem;
    color: var(--text-mid);
    margin: 0 0 0.4rem;
  }

  .mark-list {
    list-style: none;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 0.3rem 0.75rem;
    margin: 0;
    padding: 0;
  }
  .mark-list li {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-size: 0.8rem;
  }
  .mark-ex { font-family: var(--font-greek); color: var(--text); }

  .example-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .example-list li {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-size: 0.85rem;
  }
  .ex-arrow { color: var(--text-light); }
  .ex-grk { font-family: var(--font-greek); font-size: 1rem; }

  .help-foot {
    font-size: 0.78rem;
    color: var(--text-mid);
    line-height: 1.5;
    margin: 1rem 0 0;
    padding-top: 0.75rem;
    border-top: 1px solid var(--border);
    text-wrap: pretty;
  }

  .search-error { color: var(--error); font-family: var(--font-ui); font-size: 0.9rem; }

  .result-bar {
    display: flex;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    margin-bottom: 0.75rem;
  }
  .result-count {
    font-family: var(--font-ui);
    font-size: 0.85rem;
    color: var(--text-mid);
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  .export-btn {
    margin-left: auto;
    font-family: var(--font-ui);
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--accent);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.3rem 0.7rem;
    cursor: pointer;
    white-space: nowrap;
  }
  .export-btn:hover:not(:disabled) { background: var(--col-bg); border-color: var(--accent-light); }
  .export-btn:disabled { opacity: 0.6; cursor: default; }

  .search-note {
    font-family: var(--font-ui);
    font-size: 0.8rem;
    color: var(--text-mid);
    margin: 0 0 0.75rem;
  }
  .search-note.warn { color: var(--error); display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
  .retry-btn {
    font-family: var(--font-ui);
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--accent);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.15rem 0.6rem;
    cursor: pointer;
  }
  .retry-btn:hover:not(:disabled) { border-color: var(--accent-light); }
  .retry-btn:disabled { opacity: 0.5; cursor: default; }

  /* Result pagination */
  .pager {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    margin: 0.5rem 0 1.25rem;
  }
  .pager-bottom { margin: 1.5rem 0 0.5rem; }
  .pager-btn {
    font-family: var(--font-ui);
    font-size: 0.82rem;
    font-weight: 600;
    color: var(--accent);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 0.3rem 0.9rem;
    cursor: pointer;
  }
  .pager-btn:hover:not(:disabled) { background: var(--col-bg); border-color: var(--accent-light); }
  .pager-btn:disabled { opacity: 0.4; cursor: default; }
  .pager-status {
    font-family: var(--font-ui);
    font-size: 0.82rem;
    color: var(--text-mid);
    min-width: 8rem;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  /* ── Grouped results: Work → Book → Chapter ──────────────────────── */

  .book-section { margin-bottom: 1.5rem; }

  .book-header {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    border-bottom: 2px solid var(--border);
    padding-bottom: 0.35rem;
    margin: 0 0 0.6rem;
  }
  .work-name {
    font-family: var(--font-ui);
    font-size: 0.95rem;
    font-weight: 700;
    color: var(--text);
  }
  .book-name {
    font-family: var(--font-ui);
    font-size: 0.85rem;
    color: var(--text-mid);
  }

  .chapter-group {
    border: 1px solid var(--border);
    border-radius: 5px;
    margin-bottom: 0.5rem;
    background: var(--col-bg);
    overflow: hidden;
  }
  .group-head {
    width: 100%;
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0.55rem 0.85rem;
    text-align: left;
    font-family: var(--font-ui);
  }
  .group-head:hover { background: var(--border); }
  .caret { color: var(--text-light); font-size: 0.75rem; width: 0.8rem; flex-shrink: 0; }
  .group-label { font-weight: 700; color: var(--accent); font-size: 0.9rem; }
  .group-bekker { font-size: 0.8rem; color: var(--text-light); font-variant-numeric: tabular-nums; }
  .group-count { margin-left: auto; font-size: 0.78rem; color: var(--text-mid); }

  .instance-list {
    list-style: none;
    margin: 0;
    padding: 0 0.85rem 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .instance {
    display: flex;
    gap: 0.6rem;
    align-items: baseline;
    border-top: 1px solid var(--border);
    padding-top: 0.5rem;
  }
  .inst-ref {
    flex-shrink: 0;
    font-family: var(--font-ui);
    font-size: 0.78rem;
    font-weight: 700;
    color: var(--accent);
    text-decoration: none;
    min-width: 4.5rem;
    /* Bekker citations (1097a15) line up as a clean left column of refs. */
    font-variant-numeric: tabular-nums;
  }
  .inst-ref:hover { text-decoration: underline; }
  .inst-snippet {
    font-family: var(--font-english);
    font-size: 0.88rem;
    line-height: 1.5;
    color: var(--text-mid);
  }
  .inst-snippet.greek {
    font-family: var(--font-greek);
    font-size: 0.95rem;
    color: var(--text);
  }

  :global(mark) {
    background: var(--mark-bg);
    border-radius: 2px;
    padding: 0 0.1em;
    color: inherit;
  }

  @media (max-width: 500px) {
    .search-form { padding: 1rem; }
    .query-row { flex-direction: column; align-items: stretch; }
    .query-label { width: auto; }
    .below-query { margin-left: 0; gap: 0.75rem; }
    .controls-row { gap: 0.5rem; }
    .search-btn { margin-left: 0; width: 100%; margin-top: 0.25rem; }
  }
</style>
