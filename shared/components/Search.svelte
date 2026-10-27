<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import {
    search,
    searchCombo,
    searchPhraseVariants,
    speakerRoster,
    greekFold,
    englishQueryUnits,
    COMBO_WINDOW_DEFAULT,
    COMBO_WINDOW_MAX,
    type SpeakerFilter,
    type SpeakerRosterEntry,
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
    type EngHit,
    pool,
  } from '../lib/search';
  import { englishSnippet, translationTexts, turnTranslationTexts } from '../lib/english-hit';
  import { engHitCount, hitCount, paginate } from '../lib/search-pages';
  import {
    fetchBook,
    fetchChapters,
    fetchSections,
    fetchLemmaPickerShard,
    fetchLemmaGlosses,
    type BookData,
    type Segment,
    type ChapterRef,
    type SectionRef,
    type LemmaCandidate,
  } from '../lib/data';
  import { WORKS, getWork, workPath, WORK_ORDER, WORK_GROUPS, searchableTranslations, type TranslationRef } from '../lib/works';
  import { formatCite, formatLocValue, schemeFor } from '../lib/citation';
  import { decodeSearchUrl, encodeSearchUrl, hasSearch, type UrlSearch } from '../lib/search-url';

  const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, '');

  // One match occurrence, located precisely enough to label and jump to.
  interface Instance {
    lang: 'grk' | 'eng';
    column: string;
    line: number;
    ref: string;       // e.g. "34b"
    html: string;      // KWIC snippet
    jumpUrl: string;
    // Grammatical hits only: the reading is stated as one-of-N when the parse
    // does not settle it. Absent when the parse is unambiguous.
    oneOf?: string;
    // Greek hits under a speaker filter: who is speaking at the matched word.
    speaker?: string;
    // English only: one row per translation the query matched in this section,
    // in the work's own order, so where Lamb and Jowett render the same lines
    // their words sit together. An English instance's html/jumpUrl are its
    // first row's.
    rows?: TransRow[];
  }
  interface TransRow {
    translation: string;   // TranslationRef id
    // The translator's short name, shown on every row: a reader is owed whose
    // words the snippet is in, whether or not the work offers a choice.
    label: string;
    title: string;         // full citation
    html: string;
    jumpUrl: string;
    hits: number;          // the words it matched here, each a hit
  }
  // All instances within one Stephanus page (the `chapter` of the sister repo's
  // shape), merged into a single (collapsible) card.
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
  // English "any form": a word also finds its plurals and possessives.
  let engForms = true;
  // Which works to search. Default: all. Selected in the collapsible panel below.
  let selectedWorks = new Set<string>(WORKS.map(w => w.id));
  let worksOpen = false;  // is the works "Refine" panel expanded?
  let groups: ChapterGroup[] = [];        // chapter groups of the CURRENT page
  let totalInstances = 0;                 // across the whole result set (all pages)
  let expanded = new Set<string>();
  let loading = false;                    // running the index search
  let searched = false;
  let error = '';
  let failedWorks: string[] = [];         // works whose index didn't load this run
  // Works whose turn starts are line-precise only; set solely when the query
  // depends on where a speech begins, so it is never noise.
  let approximateTurns: string[] = [];

  // Inflected variants of a typed phrase. Offered only for a Greek phrase
  // searched by surface form, which is the case where finding the variants by
  // hand means knowing every word's dictionary form.
  let variantNote = '';
  let variantBusy = false;
  let variantsShown = false;
  // Offered for ANY multi-word Greek query, not only a form-phrase one. Tying it
  // to "Exact phrase" + "Exact form" hid it behind two controls a reader has no
  // reason to touch, so the people it helps most were the least likely to meet
  // it. What it does does not depend on the current mode: it finds the phrase
  // under every dictionary form of its words.
  $: canWiden = !comboActive && !soloLemmaActive
    && grkQuery.trim().split(/\s+/).filter(Boolean).length > 1;

  // Lemma mode matches dictionary forms, so a phrase typed as it stands on the
  // page (ἦν δ’ ἐγώ) finds nothing — ἦν is not a headword, εἰμί is. That reads
  // as "no such phrase" when it is really "not in one passage". A typed
  // inflection now resolves to its headword, so this no longer fires for the
  // reader who simply did not know the dictionary form — what is left is a
  // genuine miss, and widening is what answers it.
  $: lemmaDeadEnd = searched && !error && totalInstances === 0 && !variantsShown
    && matchMode === 'lemma' && canWiden && !engQuery.trim();

  // Stepping through history can start a search while another is running;
  // only the latest may write results.
  let searchRun = 0;

  async function findVariants() {
    // Counted with the searches: the back button must be able to retire it.
    const run = ++searchRun;
    variantBusy = true;
    error = '';
    try {
      const works = WORKS.map(w => w.id).filter(id => selectedWorks.has(id));
      const query = searchCtx.grkQuery || grkQuery;
      // The speaker filter frozen with the search, not the live control: the
      // note under the results describes the search that ran.
      const speaker = searchCtx.speaker;
      const outcome = await searchPhraseVariants(query, works, speaker);
      if (run !== searchRun) return;
      if (!outcome.results.length && !outcome.readings.length) {
        variantNote = 'No dictionary form is recorded for one of these words, so there is nothing to widen.';
        return;
      }
      failedWorks = outcome.failedWorks;
      unsearched = [];
      allResults = outcome.results;
      transFilter = null;
      workFilter = null;
      // The widened results are other inflections by definition, so the typed
      // accent pattern must not be held against them — kept, buildGroups would
      // drop τῷ and τοῦ from a search typed as τὸ, the very forms this finds.
      // Built whole, as runSearch builds it, so the ctx describes the search
      // that produced these results rather than patching the previous one.
      searchCtx = { ...emptyCtx(), grkQuery: query, speaker };
      searched = true;
      variantsShown = true;
      await showResults(outcome.results);
      if (run !== searchRun) return;
      // Say what was actually searched. Two readings of one word routinely land
      // on the same tokens — one passage under two parses — so the places are
      // unioned, not added up, and the count below is places, not readings.
      const readings = outcome.productive.length || outcome.readings.length;
      variantNote =
        `Showing every place this phrase stands under any dictionary form of its words`
        + ` (${readings} reading${readings === 1 ? '' : 's'} matched`
        + (outcome.cappedFrom ? `, of ${outcome.cappedFrom} possible — the rest were not tried` : '')
        + ').';
    } catch (err) {
      if (run === searchRun) error = err instanceof Error ? err.message : String(err);
    } finally {
      if (run === searchRun) variantBusy = false;
    }
  }
  let showHelp = false;
  let helpModal: HTMLDivElement;
  let helpTrigger: HTMLElement | null = null;

  // Pagination. search() returns the complete hit list (index-only); we render
  // it a page at a time, breaking pages only between Stephanus pages
  // (lib/search-pages) so a card never splits across result pages — and so only
  // the current page's books are fetched. That keeps the request burst small
  // however broad the query is, instead of loading every result's book at once.
  const PAGE_TARGET = 40;                 // ~instances per page (whole Stephanus pages)
  let pages: SearchResult[][] = [];       // each page's slice of the result set
  let shownResults: SearchResult[] = [];  // every page's results, once each
  let pageIdx = 0;
  let pageLoading = false;                // fetching the current page's books
  let pageError = '';                     // partial-load notice for this page
  let csvBusy = false;
  let csvNote = '';

  // Immutable snapshot of the SUBMITTED query. Pagination and CSV build snippets
  // and jump-links after the search completes, so they must use the query that
  // produced the results — not whatever is currently typed in the boxes (a user
  // can edit the inputs without re-submitting, then page/retry/export).
  interface SearchCtx {
    grkQuery: string; engQuery: string; engTerms: string[]; grkAccentTerms: string[];
    engPhrase: boolean;   // the English terms are a phrase: mark the run, not each word
    engForms: boolean;    // the English terms matched any form of each word
    langOp: LangOp;       // how the two queries were joined, for the translation filter
    // The speaker filter the results on screen were produced under. Frozen with
    // the rest of the query: "widen to all inflections" runs after the fact,
    // and reading the live control there would rerun it under a filter the
    // note beneath the results no longer describes.
    speaker?: SpeakerFilter;
  }
  const emptyCtx = (): SearchCtx => ({
    grkQuery: '', engQuery: '', engTerms: [], grkAccentTerms: [], engPhrase: false, engForms: false, langOp: 'and',
  });
  let searchCtx: SearchCtx = emptyCtx();

  // ── Translations ───────────────────────────────────────────────────────────
  // An English query is asked of every translation a work carries, and each
  // hit says whose prose it is in. The full result set is kept so the reader
  // can narrow it to one translator and back without searching again.
  let allResults: SearchResult[] = [];
  let transFilter: string | null = null;   // a TranslationRef id, or every translation
  let transListOpen = false;
  // Translations the English query could not be asked of (their index did
  // not load), as "Jowett (Meno)".
  let unsearched: string[] = [];
  const TRANS_CHIPS = 8;                    // shown before "more"

  function translationsOf(work: string): TranslationRef[] {
    const w = getWork(work);
    return w ? searchableTranslations(w) : [];
  }
  function translationRef(work: string, id: string): TranslationRef | undefined {
    return translationsOf(work).find(t => t.id === id);
  }

  // Hits per translator, most first — the breakdown is itself an answer
  // (which translators use this word, and how often). Counted within the work
  // chosen below, if any, so the counts add up to the English hits shown.
  $: transCounts = (() => {
    const by = new Map<string, { id: string; short: string; n: number }>();
    for (const r of narrowWork(allResults, workFilter)) {
      for (const h of r.engHits ?? []) {
        const entry = by.get(h.translation)
          ?? by.set(h.translation, { id: h.translation, short: translationRef(r.work, h.translation)?.short ?? h.translation, n: 0 }).get(h.translation)!;
        entry.n += engHitCount(h);
      }
    }
    return [...by.values()].sort((a, b) => b.n - a.n || a.short.localeCompare(b.short));
  })();
  // A filter is offered only where some work answered in two translations or
  // more; across single-translation works it would only restate the work list.
  // A filter in force stays on offer, so it can be lifted.
  $: transChoice = transFilter !== null || (() => {
    const shown = narrowWork(allResults, workFilter);
    return new Set(shown.flatMap(r => (r.engHits ?? []).map(h => `${r.work}:${h.translation}`))).size
      > new Set(shown.filter(r => r.engHits?.length).map(r => r.work)).size;
  })();

  // Which works a second translation can answer in, said beside the row: a
  // translator's count is out of those works, not the whole corpus.
  const secondScope = (() => {
    const multi = WORKS.filter(w => searchableTranslations(w).length > 1);
    const names = [...new Set(multi.flatMap(w => searchableTranslations(w).slice(1).map(t => t.short)))];
    if (!multi.length) return '';
    return names.length === 1
      ? `in the ${multi.length} dialogues that carry ${names[0]}`
      : `in the ${multi.length} dialogues with a second translation`;
  })();

  // ── Works ──────────────────────────────────────────────────────────────────
  // Where the hits fall, most first, and a way to narrow to one work. Pages run
  // in corpus order, so without this a broad search's first page says nothing
  // of the works further on. Counted under the translation filter, so the
  // counts add up to the total shown.
  let workFilter: string | null = null;    // a work id, or every work
  let workListOpen = false;
  const WORK_CHIPS = 8;                    // shown before "more"
  function narrowWork(results: SearchResult[], id: string | null): SearchResult[] {
    return id ? results.filter(r => r.work === id) : results;
  }
  $: workCounts = (() => {
    const by = new Map<string, number>();
    for (const r of narrow(allResults, transFilter, searchCtx)) {
      const n = hitCount(r);
      if (n) by.set(r.work, (by.get(r.work) ?? 0) + n);
    }
    return [...by.entries()]
      .map(([id, n]) => ({ id, n, abbr: getWork(id)?.abbr ?? id, title: getWork(id)?.title ?? id }))
      .sort((a, b) => b.n - a.n || (WORK_ORDER.get(a.id) ?? 0) - (WORK_ORDER.get(b.id) ?? 0));
  })();
  $: workChoice = workFilter !== null || workCounts.length > 1;

  $: countText = totalInstances === 0
    ? 'No passages found.'
    : `${totalInstances} instance${totalInstances === 1 ? '' : 's'}`
      + (searchCtx.grkAccentTerms.length ? ' before accent filtering' : '')
      + (pages.length > 1 ? ` · page ${pageIdx + 1} of ${pages.length}` : '');

  function setWorkFilter(id: string | null) {
    workFilter = workFilter === id ? null : id;
    // A filter, not a new search, as the translator chip is.
    if (lastSearch) writeUrl({ ...lastSearch, trans: transFilter, workFilter }, 'replace');
    showResults(allResults);
  }

  // One translation's hits, or all of them. A passage that matched only in
  // the translations set aside drops out — unless its Greek matched and the
  // two queries were joined by "either", when the Greek hit still stands.
  function narrow(results: SearchResult[], id: string | null, ctx: SearchCtx): SearchResult[] {
    if (!id) return results;
    return results.flatMap(r => {
      if (!r.engHits) return [r];
      const engHits = r.engHits.filter(h => h.translation === id);
      if (engHits.length) return [{ ...r, engHits, engMatch: true }];
      return r.grkMatch && ctx.langOp === 'or' ? [{ ...r, engHits: [], engMatch: false }] : [];
    });
  }

  let layoutRun = 0;
  async function showResults(results: SearchResult[]) {
    const run = ++layoutRun;
    const shown = narrowWork(narrow(results, transFilter, searchCtx), workFilter);
    totalInstances = shown.reduce((n, r) => n + hitCount(r), 0);
    shownResults = shown;
    // Pages are laid out from the index alone (a section's Stephanus page is
    // read off its column), so nothing is fetched before the first one.
    pages = paginate(shown, PAGE_TARGET);
    if (run !== layoutRun) return;
    if (pages.length) await renderPage(0);
    // A retired page leaves pageLoading to the layout that retired it.
    else { groups = []; pageIdx = 0; pageLoading = false; }
  }

  function setTransFilter(id: string | null) {
    transFilter = transFilter === id ? null : id;
    // A filter, not a new search: it replaces the history entry rather than
    // adding one.
    if (lastSearch) writeUrl({ ...lastSearch, trans: transFilter, workFilter }, 'replace');
    showResults(allResults);
  }

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
  // This filter compares ACCENTED tokens, so it cannot reuse the engine's
  // fold-form matcher — but it has to honour the same wildcard syntax, or a `?`
  // or mid-word `*` query with accents on would find its hits in the index and
  // then silently drop every one of them here.
  const _accentRe = new Map<string, RegExp>();
  function accentRegex(q: string): RegExp {
    let re = _accentRe.get(q);
    if (!re) {
      const body = [...q].map(ch =>
        ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
      re = new RegExp(`^${body}$`);
      _accentRe.set(q, re);
    }
    return re;
  }
  function accentTokenMatch(token: string, terms: string[]): boolean {
    const t = accentNorm(token);
    return terms.some(q => {
      const p = q.replace(/^\*+/, '');           // leading * is the capital marker
      if (!p.includes('*') && !p.includes('?')) return t === p;
      return accentRegex(p).test(t);
    });
  }

  // ── Grammatical descriptions ───────────────────────────────────────────────
  // Grammatical features never make a question on their own: asked alone,
  // "genitive plural feminine" answers with tens of thousands of tokens, which
  // is a fact about Greek and not an answer to anything. So the grammar index
  // is reachable ONLY as one term beside another, and search.ts refuses a combo
  // with no lexical term. Nothing here offers a standalone grammar search.
  //
  // The vocabulary is exactly what Morpheus emits, nothing inferred. There is
  // no part-of-speech option: the analyses carry no noun/verb/adjective field,
  // and deriving one from feature presence would claim more than the data says.
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

  // ── Combo search ──────────────────────────────────────────────────────────
  // No jargon on the control: a reader who knows what a lemma is loses nothing
  // by being told "in any of its forms", and a reader who does not is stopped
  // dead by "lemma". Same words as the phrase index uses.
  const SLOT_KINDS: { v: SlotKind; l: string }[] = [
    { v: 'form', l: 'Word as written' },
    { v: 'lemma', l: 'Word in any of its forms' },
    { v: 'phrase', l: 'Exact phrase' },
    { v: 'grammatical', l: 'Grammatical description' },
  ];

  interface LemmaMatch {
    key: string;
    count: number;              // tokens a search on this fold key returns
    candidates: LemmaCandidate[];
  }
  interface ComboEditor {
    id: number;
    kind: SlotKind;
    text: string;
    picked: string[];
    grammar: GrammarQuery;
    lemmaInput: string;
    lemmaMatches: LemmaMatch[];
    lemmaCapped: boolean;
    lemmaLoading: boolean;
    lemmaError: string;
    lemmaRequest: number;
    relation: SlotRelation;
  }

  let nextComboId = 1;
  let nextLemmaRequest = 1;
  function newComboEditor(kind: SlotKind): ComboEditor {
    return {
      id: nextComboId++,
      kind,
      text: '',
      picked: [],
      grammar: {},
      lemmaInput: '',
      lemmaMatches: [],
      lemmaCapped: false,
      lemmaLoading: false,
      lemmaError: '',
      lemmaRequest: 0,
      relation: 'near',
    };
  }

  let comboEditors: ComboEditor[] = [newComboEditor('lemma'), newComboEditor('form')];

  // One dictionary word on its own. Combo could express it with a single slot,
  // but asking for every occurrence of a lemma is the commonest scholarly
  // question there is, and it should not cost the reader a proximity query to
  // ask. It reuses the combo lemma picker so both offer the same headword list.
  let soloLemma = newComboEditor('lemma');
  $: soloLemmaActive = soloLemma.picked.length > 0;

  // The picker edits whichever of these holds the id; combo slots live in an
  // array, the solo term on its own, so reads and writes go through these.
  function editorById(id: number): ComboEditor | undefined {
    return id === soloLemma.id ? soloLemma : comboEditors.find((slot) => slot.id === id);
  }
  function commitEditor(id: number) {
    if (id === soloLemma.id) soloLemma = soloLemma;
    else comboEditors = [...comboEditors];
  }
  let comboWindow = COMBO_WINDOW_DEFAULT;
  let comboUnit: WindowUnit = 'words';
  let comboOrdered = false;
  let comboCrossTurn = true;
  let lemmaGlosses: Record<string, string[]> = {};
  const lemmaGlossLoading = new Set<string>();

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
    if (editor.kind === 'lemma') {
      return editor.picked.length
        ? { kind: editor.kind, terms: [...editor.picked], relation }
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
  $: if (comboActive || soloLemmaActive) advancedOpen = true;
  // Whether the tool's <details> is open has to live in component state. Bound
  // one way as open={comboActive}, a panel the reader opened by hand is only
  // ever open in the DOM — the component still thinks it is shut, so the next
  // render that re-applies the attribute slams it closed under them. This keeps
  // the auto-open (activating the tool reveals it) while recording the reader's
  // own toggle, so nothing they typed can collapse the panel they typed it in.
  let comboPanelOpen = false;
  let soloPanelOpen = false;
  $: if (comboActive) comboPanelOpen = true;
  $: if (soloLemmaActive) soloPanelOpen = true;
  $: comboOptions = {
    window: comboWindow,
    unit: comboUnit,
    ordered: comboOrdered,
    crossTurn: comboCrossTurn,
    speaker: speakerFilter,
  } satisfies ComboOptions;

  function toggleAdvanced() {
    advancedOpen = comboActive || soloLemmaActive ? true : !advancedOpen;
  }

  function setComboKind(id: number, kind: SlotKind) {
    const index = comboEditors.findIndex((slot) => slot.id === id);
    if (index < 0 || comboEditors[index].kind === kind) return;
    const relation = comboEditors[index].relation;   // not kind-specific; keep it
    comboEditors[index] = newComboEditor(kind);
    comboEditors[index].id = id;
    comboEditors[index].relation = relation;
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

  async function searchLemmaChoices(id: number, input: string) {
    const editor = editorById(id);
    if (!editor) return;
    editor.lemmaInput = input;
    editor.lemmaMatches = [];
    editor.lemmaCapped = false;
    editor.lemmaError = '';
    const folded = greekFold(input.trim());
    // Counted across the panel, not per editor: changing a slot's kind swaps in
    // a fresh editor under the same id, so a per-editor counter would restart
    // and let an in-flight response from the old editor pass the staleness check.
    const request = nextLemmaRequest++;
    editor.lemmaRequest = request;
    if (!folded) {
      editor.lemmaLoading = false;
      commitEditor(id);
      return;
    }
    editor.lemmaLoading = true;
    commitEditor(id);
    const letter = /^[a-z]/.test(folded) ? folded[0] : '_';
    try {
      const shard = await fetchLemmaPickerShard(letter);
      // Commonest first, not alphabetical: typing "log" should offer λόγος
      // before λόγιον. Candidates within a key are already frequency-ordered by
      // the build, so the first one carries the key's weight. Ties fall back to
      // alphabetical so the list is stable.
      const found = Object.entries(shard)
        .filter(([key]) => key.startsWith(folded))
        .sort(([a, ca], [b, cb]) => cb.n - ca.n || a.localeCompare(b));
      const current = editorById(id);
      if (!current || current.lemmaRequest !== request) return;
      current.lemmaMatches = found.slice(0, 30).map(([key, choice]) => ({ key, count: choice.n, candidates: choice.c }));
      current.lemmaCapped = found.length > 30;
      current.lemmaLoading = false;
      commitEditor(id);
    } catch {
      const current = editorById(id);
      if (!current || current.lemmaRequest !== request) return;
      current.lemmaLoading = false;
      current.lemmaError = 'Lemma choices could not be loaded. Try typing again.';
      commitEditor(id);
    }
  }

  // What a picked key looks like, kept from the list it was picked in, so the
  // picked row can show headword, gloss and count after the list is gone. A
  // key restored from the address bar has none and shows as the key.
  let pickInfo: Record<string, { heads: string; slug?: string; count: number }> = {};

  function toggleComboLemma(id: number, key: string, info?: { heads: string; slug?: string; count: number }) {
    const editor = editorById(id);
    if (!editor) return;
    if (info) pickInfo = { ...pickInfo, [key]: info };
    if (editor.picked.includes(key)) {
      editor.picked = editor.picked.filter((picked) => picked !== key);
    } else {
      editor.picked = [...editor.picked, key];
      // A pick closes the list, as choosing from a field does.
      editor.lemmaInput = '';
      editor.lemmaMatches = [];
      editor.lemmaCapped = false;
    }
    commitEditor(id);
  }

  // Picks restored from the address bar arrive as bare keys. Read each one's
  // headwords and count back from its picker shard, so the picked row reads as
  // it did when it was chosen.
  async function fillPickInfo(keys: string[]) {
    for (const key of keys) {
      if (pickInfo[key]) continue;
      try {
        const shard = await fetchLemmaPickerShard(/^[a-z]/.test(key) ? key[0] : '_');
        const choice = Object.hasOwn(shard, key) ? shard[key] : undefined;
        if (!choice) continue;
        const slug = choice.c.find((c) => c.s)?.s;
        pickInfo = { ...pickInfo, [key]: { heads: choice.c.length ? choice.c.map((c) => c.h).join(' · ') : key, slug, count: choice.n } };
        if (slug) loadLemmaGlosses(slug);
      } catch { /* the key stands for itself */ }
    }
  }

  async function loadLemmaGlosses(slug: string) {
    if (lemmaGlosses[slug] || lemmaGlossLoading.has(slug)) return;
    lemmaGlossLoading.add(slug);
    try {
      // Awaited before the map is copied: a list opens several of these at
      // once, and a copy taken before the await would let the last one to
      // land write back a map without the others' glosses.
      const glosses = await fetchLemmaGlosses(slug);
      lemmaGlosses = { ...lemmaGlosses, [slug]: glosses };
    } catch {
      lemmaGlosses = { ...lemmaGlosses, [slug]: [] };
    } finally {
      lemmaGlossLoading.delete(slug);
    }
  }

  function glossOnMount(_node: HTMLElement, slug?: string) {
    if (slug) loadLemmaGlosses(slug);
    return {
      update(next?: string) {
        if (next) loadLemmaGlosses(next);
      },
    };
  }

  function clampComboWindow() {
    comboWindow = Math.max(1, Math.min(Number(comboWindow) || COMBO_WINDOW_DEFAULT, COMBO_WINDOW_MAX));
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

  // ── Spoken by ──────────────────────────────────────────────────────────────
  //
  // The TLG labels every change of speaker, so each Greek word in a dialogue
  // has a speaker, and a search can be held to one: ἀρετή in Socrates' mouth
  // only, or anywhere but. The cast is read from each selected work's turn
  // bounds (offsets.json), fetched only once this control is switched on. The
  // narrated works carry no labels in the OCT and so have no cast here; a
  // filtered search leaves them out and says so.
  type SpeakerMode = 'anyone' | 'only' | 'except';
  let speakerMode: SpeakerMode = 'anyone';
  let speakerNames = new Set<string>();
  let speakerOpen = false;
  let roster: SpeakerRosterEntry[] = [];
  let rosterLoading = false;
  let rosterError = '';
  // The request the roster on screen answers; a stale response is discarded.
  let rosterKey = '';

  $: rosterWanted = speakerMode !== 'anyone' ? [...selectedWorks].sort().join(',') : '';
  $: if (rosterWanted && rosterWanted !== rosterKey) loadRoster(rosterWanted);

  async function loadRoster(key: string) {
    rosterKey = key;
    rosterLoading = true;
    rosterError = '';
    try {
      const works = WORKS.map(w => w.id).filter(id => selectedWorks.has(id));
      const entries = await speakerRoster(works);
      if (rosterKey !== key) return;
      roster = entries;
      // Drop ticked names that no selected work has.
      // Prune ticked names no selected work has — but only against the works
      // that actually loaded. A work whose offsets.json failed contributes no
      // names, so pruning against it would silently untick a speaker who lives
      // only there, and unticking the last one turns the filter off entirely:
      // the next search would run over the whole corpus while the panel still
      // read as filtered. When anything failed, keep the selection as it is.
      if (entries.every(e => e.loaded)) {
        const present = new Set(entries.flatMap(e => e.speakers.map(s => s.name)));
        const kept = [...speakerNames].filter(n => present.has(n));
        if (kept.length !== speakerNames.size) speakerNames = new Set(kept);
      }
    } catch (err) {
      if (rosterKey !== key) return;
      rosterError = err instanceof Error ? err.message : String(err);
    } finally {
      if (rosterKey === key) rosterLoading = false;
    }
  }

  // One row per speaker across the selected works: total turns, and how many
  // works they appear in. Most turns first, so Socrates heads every list he is
  // in and a walk-on part sits at the end.
  $: cast = (() => {
    const by = new Map<string, { name: string; turns: number; works: number }>();
    for (const e of roster) {
      for (const s of e.speakers) {
        const row = by.get(s.name) ?? { name: s.name, turns: 0, works: 0 };
        row.turns += s.turns;
        row.works += 1;
        by.set(s.name, row);
      }
    }
    return [...by.values()].sort((a, b) => b.turns - a.turns || a.name.localeCompare(b.name));
  })();
  const workTitle = (id: string) => getWork(id)?.title ?? id;
  $: unlabelledWorks = roster.filter(e => e.loaded && !e.narrator && !e.speakers.length).map(e => workTitle(e.work));
  // Works reported by a narrator: the labels are the frame, not the speeches,
  // so the filter leaves them out — said apart from the works with no labels.
  $: narratedWorks = roster.filter(e => e.loaded && e.narrator).map(e => `${workTitle(e.work)} (${e.narrator})`);
  $: rosterFailedWorks = roster.filter(e => !e.loaded).map(e => workTitle(e.work));
  // Works whose turn starts were matched only to a line of Greek: every word
  // between the true boundary and the snapped one is attributed to the wrong
  // speaker, which a filtered result has to admit rather than imply away.
  $: approxRosterWorks = roster.filter(e => e.approximate && !e.narrator).map(e => workTitle(e.work));
  // Whether `roster` actually describes the works now selected. The note under
  // the results is written from it, so while a reload is in flight it would
  // otherwise name the previous selection's exclusions.
  $: rosterFresh = rosterKey === rosterWanted && !rosterLoading && !rosterError;

  function toggleSpeaker(name: string) {
    if (speakerNames.has(name)) speakerNames.delete(name);
    else speakerNames.add(name);
    speakerNames = speakerNames;
  }
  function clearSpeakers() { speakerNames = new Set(); }

  // The filter a search runs with: nothing until a mode is chosen AND a name
  // is ticked, so switching the mode on cannot by itself empty the results.
  $: speakerFilter = (speakerMode !== 'anyone' && speakerNames.size
    ? { mode: speakerMode, names: [...speakerNames] }
    : undefined) as SpeakerFilter | undefined;

  const listNames = (names: string[]) =>
    names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  $: speakerSummary = speakerMode === 'anyone'
    ? 'Anyone'
    : !speakerNames.size
      ? (speakerMode === 'only' ? 'Only… (pick a speaker)' : 'Anyone but… (pick a speaker)')
      : `${speakerMode === 'only' ? 'Only' : 'Anyone but'} ${listNames([...speakerNames])}`;

  // Frozen at search time so the note under the results describes the search
  // that ran, not the control as it stands now.
  let speakerNote = '';
  // The works a filtered search ran over. Its note names the works the filter
  // left out, which only the cast of those works can say; a search arriving
  // from the address bar runs before the cast has loaded, so the note is
  // written again once it has, and only for those works.
  let speakerNoteKey = '';
  $: if (speakerNoteKey && rosterFresh && rosterKey === speakerNoteKey) {
    speakerNote = describeSpeakerFilter(searchCtx.speaker);
  }
  function describeSpeakerFilter(filter: SpeakerFilter | undefined): string {
    if (!filter) return '';
    const who = listNames(filter.names);
    let note = filter.mode === 'only'
      ? `Greek matches spoken by ${who} only; English matches from passages where ${who} ${filter.names.length > 1 ? 'speak' : 'speaks'}.`
      : `Greek matches spoken by anyone but ${who}; English matches from passages where someone else speaks.`;
    // Only from a roster that describes this search's works; a stale one would
    // name the wrong exclusions, and saying nothing is better than that.
    if (rosterFresh && unlabelledWorks.length) {
      note += ` ${listNames(unlabelledWorks)} ${unlabelledWorks.length > 1 ? 'are' : 'is'} narrated without speaker labels and ${unlabelledWorks.length > 1 ? 'were' : 'was'} left out.`;
    }
    if (rosterFresh && narratedWorks.length) {
      note += ` ${listNames(narratedWorks)} ${narratedWorks.length > 1 ? 'are' : 'is'} reported by a narrator — the text labels the frame, not the speeches inside it — and ${narratedWorks.length > 1 ? 'were' : 'was'} left out.`;
    }
    if (rosterFresh && approxRosterWorks.length) {
      note += ` Where a speech begins in ${listNames(approxRosterWorks)} is recorded to the line rather than the word, so a match at the very edge of a speech may belong to the one beside it.`;
    }
    return note;
  }

  // Results grouped Work → Book → Stephanus-page groups, in corpus then numeric order.
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

  // Map a hit's (column, line) to the group it falls in, for one book.
  // Groups are ordered by document position; pick the last whose start is
  // at or before the hit.
  function chapterLookup(bookData: { segments: Segment[] }, chapters: ChapterRef[]) {
    const colIdx = new Map<string, number>();
    bookData.segments.forEach((s, i) => { if (!colIdx.has(s.column)) colIdx.set(s.column, i); });
    const chs = chapters
      .map((c, i) => ({ ...c, ci: colIdx.get(c.column) ?? 0, ln: parseInt(c.line), order: i }))
      .sort((a, b) => a.ci - b.ci || a.ln - b.ln);
    return (column: string, line: number): { chapter: string; bekker: string; order: number } => {
      // Defensive: never return undefined (callers deref .chapter). If the
      // outline is empty, group the hit under a placeholder rather than
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
  // treats every book as unloadable and renders zero results.
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

  // The Greek line of the token at index `pos` within a segment. A proximity
  // measure only: the citation is formatted through the work's scheme, which
  // for Stephanus prints the section alone.
  function lineOfPosition(seg: Segment, pos: number): number {
    let count = 0;
    for (const line of seg.greek) {
      if (pos < count + line.tokens.length) return line.n;
      count += line.tokens.length;
    }
    return seg.greek[seg.greek.length - 1]?.n ?? 1;
  }

  // What an instance counts for: a Greek one is one word; an English one, each
  // word its translations matched (see hitCount in lib/search-pages, which
  // counts the total and lays out pages from the index alone).
  const hitsIn = (inst: Instance) => inst.rows?.reduce((n, row) => n + row.hits, 0) ?? 1;
  const groupHits = (g: ChapterGroup) => g.instances.reduce((n, inst) => n + hitsIn(inst), 0);

  // Build the Stephanus-page groups for a slice of results: load the books and
  // outlines they touch (bounded concurrency), then assemble and sort. A failed
  // book or outline fetch is evicted (see data.ts) and its work:book key
  // collected in `failed` — NOT swallowed as a successful empty result — so the
  // caller can show an incomplete-results notice and offer a retry.
  async function buildGroups(
    results: SearchResult[],
    ctx: SearchCtx,
  ): Promise<{ groups: ChapterGroup[]; failed: string[] }> {
    const wbPairs = [...new Set(results.map(r => `${r.work}:${r.meta.book}`))];
    const workSet = [...new Set(results.map(r => r.work))];
    const failed: string[] = [];

    const chaptersByWork = new Map<string, Record<string, ChapterRef[]>>();
    await pool(workSet, 8, async w => {
      try { chaptersByWork.set(w, await fetchOutline(w)); }
      catch (err) { console.warn(`search: outline failed for ${w} —`, err); failed.push(w); }
    });
    const segMap = new Map<string, Segment>();             // key: work:segId
    const books = new Map<string, BookData>();             // key: work:book
    const lookups = new Map<string, ReturnType<typeof chapterLookup>>(); // key: work:book
    await pool(wbPairs, 8, async pair => {
      const [w, bStr] = pair.split(':');
      const b = Number(bStr);
      // If the work's outline never loaded we can't group its hits — mark the
      // pair failed and skip (don't feed an empty list into chapterLookup),
      // so the page shows the partial-results notice instead of crashing.
      const chapters = chaptersByWork.get(w)?.[String(b)];
      if (!chapters) { failed.push(pair); return; }
      try {
        const data = await fetchBook(w, b);
        for (const s of data.segments) segMap.set(`${w}:${s.id}`, s);
        books.set(pair, data);
        lookups.set(pair, chapterLookup(data, chapters));
      } catch (err) { console.warn(`search: book failed for ${pair} —`, err); failed.push(pair); }
    });
    // A turn-aligned translation's texts, cut per section from its book once
    // (lib/english-hit turnTranslationTexts, the pipeline's own order).
    const turnTexts = new Map<string, Map<string, string[]>>();   // work:book:id
    const turnsOf = (pair: string, id: string) => {
      const key = `${pair}:${id}`;
      let m = turnTexts.get(key);
      if (!m) { m = turnTranslationTexts(books.get(pair)!, id); turnTexts.set(key, m); }
      return m;
    };

    const gmap = new Map<string, ChapterGroup>();
    const add = (work: string, book: number, ch: { chapter: string; bekker: string; order: number }, inst: Instance) => {
      const key = `${work}:${book}:${ch.chapter}`;
      let g = gmap.get(key);
      if (!g) { g = { key, work, book, chapter: ch.chapter, bekker: ch.bekker, order: ch.order, instances: [] }; gmap.set(key, g); }
      g.instances.push(inst);
    };

    // Carry the SUBMITTED queries so the reader can highlight them; loc scrolls
    // to the section. Use the snapshot (ctx), not live input state.
    const qs = new URLSearchParams();
    if (ctx.grkQuery) qs.set('hlg', ctx.grkQuery);
    if (ctx.engQuery) qs.set('hle', ctx.engQuery);
    if (ctx.engQuery && ctx.engPhrase) qs.set('hlm', 'phrase');
    if (ctx.engQuery && ctx.engForms) qs.set('hlf', 'any');
    const base = qs.toString();
    // A translation hit opens the reader in that translation, where the
    // highlighted words are; a Greek one leaves the reader's choice alone.
    // A Greek hit also names its exact tokens (hlt), so the reader marks the
    // words the search found — every form a lemma search reached, the words
    // of a grammatical or proximity search — not whatever begins like the
    // typed text. The `loc=` value composes through the work's citation
    // scheme: "17a" for Stephanus, which has no user-facing lines.
    const jumpFor = (work: string, book: number, column: string, line: number, trans?: string, hits?: number[]) =>
      `${BASE_URL}${workPath(work, book)}?${base}${base ? '&' : ''}`
      + `${trans ? `trans=${encodeURIComponent(trans)}&` : ''}`
      + `${hits?.length ? `hlt=${column}:${hits.join(',')}&` : ''}loc=${formatLocValue(work, column, line)}`;

    for (const r of results) {
      const pair = `${r.work}:${r.meta.book}`;
      const seg = segMap.get(`${r.work}:${r.meta.id}`);
      const lookup = lookups.get(pair);
      if (!seg || !lookup) continue;
      if (r.grkMatch) {
        // Flattened surface tokens, for the accent post-filter (positions are
        // token indices — the same flattening greekKwic uses).
        const toks: string[] = [];
        if (ctx.grkAccentTerms.length) {
          for (const line of seg.greek) for (const tok of line.tokens) toks.push(tok.t);
        }
        const kept = r.grkPositions.filter(pos => !ctx.grkAccentTerms.length
          || accentTokenMatch(toks[pos] ?? '', ctx.grkAccentTerms));
        const keep = new Set(kept);
        for (let i = 0; i < r.grkPositions.length; i++) {
          const pos = r.grkPositions[i];
          if (!keep.has(pos)) continue;
          const line = lineOfPosition(seg, pos);
          const ch = lookup(seg.column, line);
          // r.grammar runs parallel to grkPositions on a grammatical search.
          // Where the parse doesn't settle the reading, say so on the hit
          // rather than letting the match imply a certainty it doesn't have.
          const g = r.grammar?.[i];
          const oneOf = g && !g.certain
            ? Object.entries(g.values)
                .map(([cat, vals]) => `${cat} ${vals.join(' or ')}`)
                .join(' · ')
            : undefined;
          const speaker = r.speakers?.[i] ?? undefined;
          add(r.work, r.meta.book, ch, { lang: 'grk', column: seg.column, line, ref: formatCite(r.work, seg.column, line), html: greekKwic(seg, [pos]), jumpUrl: jumpFor(r.work, r.meta.book, seg.column, line, undefined, kept), oneOf, speaker });
        }
      }
      if (r.engMatch) {
        const ts = translationsOf(r.work);
        const several = ts.length > 1;
        // A work the registry does not list still has its one translation.
        const hits: EngHit[] = r.engHits ?? [{ translation: ts[0]?.id ?? 'english', positions: [] }];
        // A section sits in one Stephanus page, so every translation's hit here
        // shares one instance: the same lines in each translator's words.
        const line = seg.greek[0]?.n ?? 1;
        const ch = lookup(seg.column, line);
        const rows: TransRow[] = [];
        for (const hit of hits) {
          const t = ts.find(x => x.id === hit.translation)
            ?? { id: hit.translation, slot: 'english' as const, short: hit.translation, name: hit.translation };
          const texts = translationTexts(seg, t, t.slot === 'overlay' ? turnsOf(pair, t.id) : undefined);
          const html = englishSnippet(texts, hit.positions, ctx.engTerms, ctx.engPhrase, ctx.engForms);
          if (html === null) continue;
          rows.push({
            translation: t.id,
            label: t.short,
            title: t.name,
            html,
            // Named wherever there is a choice, so a reader's saved choice of
            // the other translation does not open the hit in the wrong words.
            jumpUrl: jumpFor(r.work, r.meta.book, seg.column, line, several ? t.id : undefined),
            hits: engHitCount(hit),
          });
        }
        if (rows.length) {
          add(r.work, r.meta.book, ch, { lang: 'eng', column: seg.column, line, ref: formatCite(r.work, seg.column), html: rows[0].html, jumpUrl: rows[0].jumpUrl, rows });
        }
      }
    }

    for (const g of gmap.values()) g.instances.sort(bekkerCmp);
    const out = [...gmap.values()].sort((a, b) =>
      ((WORK_ORDER.get(a.work) ?? 0) - (WORK_ORDER.get(b.work) ?? 0)) || a.book - b.book || a.order - b.order);
    return { groups: out, failed: [...new Set(failed)] };
  }

  async function renderPage(i: number) {
    pageIdx = i;
    pageLoading = true;
    pageError = '';
    // A newer search (the back button can start one mid-load) replaces
    // `pages`; this page's books must not then overwrite its results.
    // A newer search or filter starts a new layout before its pages exist, so
    // the layout is checked as well as the pages.
    const set = pages;
    const layout = layoutRun;
    const stale = () => set !== pages || layout !== layoutRun;
    try {
      const { groups: g, failed } = await buildGroups(set[i] ?? [], searchCtx);
      if (stale()) return;
      groups = g;
      // Single-hit pages open by default; merged (multi-hit) start collapsed.
      expanded = new Set(groups.filter(x => x.instances.length === 1).map(x => x.key));
      if (failed.length) {
        pageError = `${failed.length} passage source${failed.length === 1 ? '' : 's'} on this page didn’t load — some hits may be missing.`;
      }
    } catch (err) {
      if (stale()) return;
      pageError = String(err);
      groups = [];
    } finally {
      if (!stale()) pageLoading = false;
    }
  }

  function goPage(i: number) {
    if (i < 0 || i >= pages.length || i === pageIdx || pageLoading) return;
    renderPage(i);
    if (typeof document !== 'undefined') {
      document.querySelector('.result-bar')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // ── The search in the address bar ──────────────────────────────────────────
  // Every search is written to the URL (see lib/search-url), so it can be
  // shared, bookmarked, reloaded, and stepped back through. The widened
  // "any inflection" results are not: they are a step taken from a search,
  // and the URL keeps the search they were taken from.
  const WORK_IDS = WORKS.map(w => w.id);
  let lastSearch: UrlSearch | null = null;   // the submitted search, as written

  function currentSearch(): UrlSearch {
    return {
      grk: grkQuery, eng: engQuery, grkMode, engMode, matchMode, accent: accentSensitive, langOp, engForms,
      works: WORK_IDS.filter(id => selectedWorks.has(id)),
      trans: null,
      workFilter: null,
      lemmas: [...soloLemma.picked],
      combo: comboActive ? {
        slots: comboEditors.filter(ed => comboSlot(ed, comboOrdered)).map(ed => ({
          kind: ed.kind, relation: ed.relation, text: ed.text, picked: [...ed.picked], grammar: { ...ed.grammar },
        })),
        window: comboWindow, unit: comboUnit, ordered: comboOrdered, crossTurn: comboCrossTurn,
      } : null,
      speaker: speakerFilter ?? null,
    };
  }

  function writeUrl(s: UrlSearch, how: 'push' | 'replace') {
    const qs = encodeSearchUrl(s, WORK_IDS);
    const search = qs ? `?${qs}` : '';
    // Searching again for the same thing adds no history entry. The address
    // may spell it differently (a ?q= arrival, say): rewrite that in place.
    if (how === 'push' && search === window.location.search) return;
    if (how === 'push' && encodeSearchUrl(decodeSearchUrl(window.location.search, WORK_IDS), WORK_IDS) === qs) how = 'replace';
    const url = `${window.location.pathname}${search}${window.location.hash}`;
    if (how === 'push') window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
  }

  // Sets every control from a URL, defaults included, so stepping back to a
  // plain search clears what a later one set.
  function applySearch(s: UrlSearch) {
    grkQuery = s.grk;
    engQuery = s.eng;
    grkMode = s.grkMode;
    engMode = s.engMode;
    matchMode = s.matchMode;
    accentSensitive = s.accent;
    langOp = s.langOp;
    engForms = s.engForms;
    selectedWorks = new Set(s.works);
    soloLemma = { ...newComboEditor('lemma'), picked: [...s.lemmas] };
    fillPickInfo([...s.lemmas, ...(s.combo?.slots.flatMap(slot => slot.picked) ?? [])]);
    const combo = s.combo;
    comboEditors = combo
      ? combo.slots.map(slot => ({ ...newComboEditor(slot.kind), relation: slot.relation, text: slot.text, picked: [...slot.picked], grammar: { ...slot.grammar } }))
      : [newComboEditor('lemma'), newComboEditor('form')];
    comboWindow = combo?.window ?? COMBO_WINDOW_DEFAULT;
    comboUnit = combo?.unit ?? 'words';
    comboOrdered = combo?.ordered ?? false;
    comboCrossTurn = combo?.crossTurn ?? true;
    speakerMode = s.speaker?.mode ?? 'anyone';
    speakerNames = new Set(s.speaker?.names ?? []);
    // A filter arriving in the address bar is shown, not hidden in a shut panel.
    if (s.speaker) speakerOpen = true;
  }

  // Runs whatever search the address bar holds; with none, clears the page.
  async function searchFromUrl() {
    const s = decodeSearchUrl(window.location.search, WORK_IDS);
    applySearch(s);
    // The reactive comboActive / soloLemmaActive / speakerFilter that doSearch
    // reads must catch up with the controls just set.
    await tick();
    if (hasSearch(s)) {
      await doSearch(undefined, { history: 'none', trans: s.trans, work: s.workFilter });
      return;
    }
    searchRun++;
    lastSearch = null;
    searched = false;
    loading = false;
    error = '';
    allResults = [];
    pages = [];
    groups = [];
    totalInstances = 0;
    transFilter = null;
    workFilter = null;
    variantNote = '';
    variantsShown = false;
    variantBusy = false;
  }

  // The command palette hands off ?g= (Greek) / ?e= (English); those, and
  // any search this page wrote, are run on load.
  const onPopState = () => { searchFromUrl(); };
  onMount(() => {
    window.addEventListener('popstate', onPopState);
    const s = decodeSearchUrl(window.location.search, WORK_IDS);
    if (hasSearch(s)) searchFromUrl();
  });
  onDestroy(() => {
    if (typeof window !== 'undefined') window.removeEventListener('popstate', onPopState);
  });

  async function doSearch(e?: Event, opts: { history?: 'push' | 'none'; trans?: string | null; work?: string | null } = {}) {
    e?.preventDefault();
    if (!grkQuery.trim() && !engQuery.trim() && !comboActive && !soloLemmaActive) return;
    const run = ++searchRun;
    lastSearch = currentSearch();
    if ((opts.history ?? 'push') === 'push') writeUrl(lastSearch, 'push');
    loading = true;
    error = '';
    failedWorks = [];
    unsearched = [];
    approximateTurns = [];
    variantNote = '';
    variantsShown = false;
    // It retires any inflection lookup still running, so frees its button.
    variantBusy = false;
    pageError = '';
    csvNote = '';
    searched = false;
    speakerNote = describeSpeakerFilter(speakerFilter);
    speakerNoteKey = speakerFilter ? rosterWanted : '';
    try {
      const works = WORKS.map(w => w.id).filter(id => selectedWorks.has(id));
      // Snapshot the submitted query for all deferred (per-page / CSV) rendering.
      searchCtx = {
        // Grammatical and combo queries name no single word, so there is
        // nothing for the reader to highlight on jump and no accent
        // post-filter to apply.
        grkQuery: comboActive ? '' : soloLemmaActive ? soloLemma.picked.join(' ') : grkQuery.trim(),
        engQuery: comboActive ? '' : engQuery.trim(),
        // The words as the index splits them: "coming-to-be" is three.
        engTerms: comboActive ? [] : englishQueryUnits(engQuery).flat(),
        // A picked lemma is a fold key, not the reader's spelling, so there is
        // no typed accent pattern to post-filter against.
        grkAccentTerms: !comboActive && !soloLemmaActive && accentSensitive
          ? grkQuery.trim().split(/\s+/).filter(Boolean).map(accentNorm)
          : [],
        engPhrase: engMode === 'phrase',
        engForms,
        langOp,
        speaker: speakerFilter,
      };
      const { results, failedWorks: failed, approximateTurns: approximate, unsearchedTranslations } = comboActive
        ? await searchCombo(comboSearchSlots, comboOptions, works)
        // Picked headwords are OR-ed: choosing two spellings of one word, or two
        // homonyms, asks for either, never for both in the same passage.
        // 'headword', not 'lemma': the picks ARE the headword keys. Under
        // 'lemma' each would be looked up as a surface again and widened to
        // every headword that spelling can belong to — ἤν back to εἰμί and ὅς —
        // which is exactly what the picker exists to rule out.
        : soloLemmaActive
          ? await search(soloLemma.picked.join(' '), engQuery, 'any', engMode, langOp, works, 'headword', engForms, speakerFilter)
          : await search(grkQuery, engQuery, grkMode, engMode, langOp, works, matchMode, engForms, speakerFilter);
      if (run !== searchRun) return;
      failedWorks = failed;
      approximateTurns = approximate ?? [];
      unsearched = (unsearchedTranslations ?? []).map(({ work, translation }) =>
        `${translationRef(work, translation)?.short ?? translation} (${getWork(work)?.title ?? work})`);
      allResults = results;
      // A translation named in the URL holds only if this search found it.
      const trans = opts.trans ?? null;
      transFilter = trans && results.some(r => r.engHits?.some(h => h.translation === trans)) ? trans : null;
      lastSearch.trans = transFilter;
      // So does a work, if it holds a hit.
      const work = opts.work ?? null;
      workFilter = work && results.some(r => r.work === work) ? work : null;
      lastSearch.workFilter = workFilter;
      if ((trans && !transFilter) || (work && !workFilter)) writeUrl(lastSearch, 'replace');
      transListOpen = false;
      workListOpen = false;
      searched = true;
      await showResults(results);
    } catch (err) {
      if (run === searchRun) error = err instanceof Error ? err.message : String(err);
    } finally {
      if (run === searchRun) loading = false;
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
      const { groups: allGroups, failed } = await buildGroups(shownResults, searchCtx);
      const origin = typeof location !== 'undefined' ? location.origin : '';
      // URL comes BEFORE the free-text Snippet (and Snippet is the LAST column)
      // on purpose. The snippet holds prose full of commas; we RFC-quote it, but
      // iPad Excel / Numbers don't reliably honour the quoting, so those commas
      // split the row — and since each snippet has a different comma count, the
      // URL landed in a different column on every row and stopped being clickable
      // (reported by a user). With the URL ahead of it, the link always sits in
      // one fixed, comma-free column; only the trailing snippet can spill, which
      // is harmless. Speaker and Translation sit with the other short, comma-free
      // columns: Speaker is filled for Greek hits under a speaker filter,
      // Translation for English hits.
      const rows: string[][] = [['Work', 'Book', 'Stephanus page', 'Citation', 'Language', 'Speaker', 'Translation', 'URL', 'Snippet']];
      for (const g of allGroups) {
        const w = getWork(g.work);
        const workTitle = w?.title ?? g.work;
        const book = w?.bookLabels[g.book - 1] ?? String(g.book);
        for (const inst of g.instances) {
          if (inst.rows) {
            // One row per translation: each is its own hit, in its own words.
            for (const row of inst.rows) {
              const t = translationRef(g.work, row.translation);
              rows.push([
                workTitle, String(book), g.chapter, inst.ref, 'English', '',
                t?.short ?? row.translation, origin + row.jumpUrl, stripHtml(row.html),
              ]);
            }
            continue;
          }
          rows.push([
            workTitle, String(book), g.chapter, inst.ref,
            inst.lang === 'grk' ? 'Greek' : 'English',
            inst.speaker ?? '', '',
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

  <!-- `glosses` is passed in, not read from scope: a snippet re-renders for a
       change to what it is handed, and the glosses arrive after the list. -->
  {#snippet lemmaPicker(editor: ComboEditor, groupLabel: string, glosses: Record<string, string[]>)}
    <div class="lp">
      {#each editor.picked as key}
        {@const info = pickInfo[key]}
        <!-- A picked word reads as headword, gloss and count; Change drops it
             and returns to the field. -->
        <div class="lpsel">
          <span class="hw" lang="grc">{info?.heads ?? key}</span>
          {#if info?.slug && glosses[info.slug]?.length}<i class="gl">{glosses[info.slug].slice(0, 2).join('; ')}</i>{/if}
          {#if info}<span class="ct">{info.count.toLocaleString('en')}</span>{/if}
          <button type="button" class="x" aria-label={`Change ${info?.heads ?? key} in ${groupLabel}`}
            on:click={() => toggleComboLemma(editor.id, key)}>Change</button>
        </div>
      {/each}
      <label class="lp-field" for={`lemma-${editor.id}`}>
        <span>{editor.picked.length ? 'Add another dictionary word' : 'Find a dictionary word'}</span>
        <input
          id={`lemma-${editor.id}`}
          lang="grc"
          type="search"
          value={editor.lemmaInput}
          on:input={(e) => searchLemmaChoices(editor.id, e.currentTarget.value)}
          autocomplete="off"
          autocorrect="off"
          autocapitalize="none"
          spellcheck="false"
        />
      </label>
      {#if editor.lemmaLoading}
        <p class="lp-status" aria-live="polite">Loading dictionary words…</p>
      {:else if editor.lemmaError}
        <p class="lp-status" role="alert">{editor.lemmaError}</p>
      {:else if editor.lemmaInput.trim() && editor.lemmaMatches.length === 0}
        <p class="lp-status">No dictionary word starts with that text.</p>
      {:else if editor.lemmaMatches.length}
        <!-- One choice per fold key, not per headword. The index is
             accent-folded, so ὅρος, ὄρος and ὀρός are a single key and no
             search can separate them; offering them as three choices would
             promise a distinction that does not exist. -->
        <ul class="lplist" aria-label={`Dictionary words for ${groupLabel}`}>
          {#each editor.lemmaMatches as match (match.key)}
            {@const heads = match.candidates.length ? match.candidates.map((c) => c.h).join(' · ') : match.key}
            {@const slug = match.candidates.find((c) => c.s)?.s}
            <li class:on={editor.picked.includes(match.key)} use:glossOnMount={slug}>
              <button type="button" aria-pressed={editor.picked.includes(match.key)}
                on:click={() => toggleComboLemma(editor.id, match.key, { heads, slug, count: match.count })}>
                <span class="hw" lang="grc">{heads}</span>
                <span class="gl">{#if !match.candidates.length}no headword recorded{:else if match.candidates.length > 1}searched together — the index cannot separate them{:else if slug && glosses[slug]?.length}{glosses[slug].slice(0, 2).join('; ')}{/if}</span>
                <span class="ct">{match.count.toLocaleString('en')}</span>
              </button>
            </li>
          {/each}
        </ul>
        {#if editor.lemmaCapped}
          <p class="lp-status">Showing the first 30 matches. Type more to narrow the list.</p>
        {/if}
      {/if}
    </div>
  {/snippet}


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
        disabled={comboActive || soloLemmaActive}
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
      <fieldset class="mode-group" title="Any form: type the word as it stands on the page and every form of it is found. Only as I typed it: the spelling you gave, and no other.">
        <legend>Match</legend>
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
        <a
          class="guide-link"
          href={`${BASE_URL}/advanced`}
          target="_blank"
          rel="noreferrer"
        >What these tools do</a>
      </div>
      {#if advancedOpen}
        <div id="advanced-tools" class="advanced-body">
          <details class="lemma-panel" bind:open={soloPanelOpen}>
            <summary>
              Single lemma <span class="d">every form of one dictionary word</span>
              {#if soloLemmaActive}<span class="combo-active">{soloLemma.picked.length} picked</span>{/if}
            </summary>
            <p class="lemma-panel-note">
              Every occurrence of one dictionary word, in all its forms. Pick the
              headword rather than typing a spelling, so you get the word you
              meant and not the ones that merely look like it.
              <a class="guide-link" href={`${BASE_URL}/advanced#lemma`} target="_blank" rel="noreferrer">What is this?</a>
              Picking more than one asks for any of them.
              This searches on its own — it ignores the Greek box above.
            </p>
            {@render lemmaPicker(soloLemma, 'the single lemma search', lemmaGlosses)}
            {#if soloLemmaActive}
              <button
                type="button"
                class="lemma-panel-clear"
                on:click={() => { soloLemma.picked = []; soloLemma = soloLemma; }}
              >Clear picked words</button>
            {/if}
          </details>

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

                  {#if slot.kind === 'phrase'}
                    <label class="combo-text-field" for={`combo-text-${slot.id}`}>
                      <span>The words, in order</span>
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
                  {:else if slot.kind === 'form'}
                    <label class="combo-text-field" for={`combo-text-${slot.id}`}>
                      <span>The word as written</span>
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
                  {:else if slot.kind === 'lemma'}
                    {@render lemmaPicker(slot, `term ${slotIndex + 1}`, lemmaGlosses)}
                  {:else}
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
      <fieldset class="mode-group" title="Any form: virtue also finds virtues and virtue’s, man finds men. Only as I typed it: the spelling you gave, and no other.">
        <legend>Match</legend>
        <label><input type="radio" name="engforms" value={true} bind:group={engForms} /> Any form of this word</label>
        <label><input type="radio" name="engforms" value={false} bind:group={engForms} /> Only as I typed it</label>
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

    <div class="works-panel speaker-panel" role="group" aria-label="Spoken by">
      <button
        type="button"
        class="works-trigger"
        aria-expanded={speakerOpen}
        on:click={() => (speakerOpen = !speakerOpen)}
      >
        <span class="works-label">Spoken by</span>
        <span class="works-summary">{speakerSummary}</span>
        <span class="works-caret">{speakerOpen ? 'Hide ▴' : 'Refine ▾'}</span>
      </button>

      {#if speakerOpen}
        <div class="works-body speaker-body">
          <fieldset class="mode-group speaker-mode">
            <legend>Keep words spoken by</legend>
            <label><input type="radio" name="speakermode" value="anyone" bind:group={speakerMode} /> Anyone</label>
            <label><input type="radio" name="speakermode" value="only" bind:group={speakerMode} /> Only these speakers</label>
            <label><input type="radio" name="speakermode" value="except" bind:group={speakerMode} /> Anyone but these</label>
          </fieldset>

          {#if speakerMode === 'anyone'}
            <p class="speaker-note">
              Every word in a dialogue has a speaker. Choose a mode to hold the
              search to one voice — <span lang="grc">ἀρετή</span> in Socrates'
              mouth only, or anywhere but.
              <a class="guide-link" href={`${BASE_URL}/advanced#speaker`} target="_blank" rel="noreferrer">What is this?</a>
            </p>
          {:else}
            {#if rosterLoading}
              <p class="speaker-note">Reading the cast of the selected works…</p>
            {:else if rosterError}
              <p class="speaker-note warn">
                The cast could not be loaded: {rosterError}
                <button type="button" class="retry-btn" on:click={() => loadRoster(rosterWanted)}>Retry</button>
              </p>
            {:else if !cast.length}
              <p class="speaker-note">
                None of the selected works carries speaker labels the filter can
                use, so there is nobody to choose.
                {#if unlabelledWorks.length}
                  {listNames(unlabelledWorks)} {unlabelledWorks.length > 1 ? 'are' : 'is'} narrated without
                  speaker labels.
                {/if}
                {#if narratedWorks.length}
                  {listNames(narratedWorks)} {narratedWorks.length > 1 ? 'are' : 'is'} reported by a narrator —
                  the text labels the frame, not the speeches inside it.
                {/if}
                Add a dialogue to the works above.
              </p>
            {:else}
              <div class="works-actions">
                <span class="speaker-count">{speakerNames.size ? `${speakerNames.size} chosen` : 'Pick one or more'}</span>
                <button type="button" class="works-action" on:click={clearSpeakers} disabled={speakerNames.size === 0}>Clear</button>
              </div>
              <div class="works-chips speaker-chips">
                {#each cast as s (s.name)}
                  <button
                    type="button"
                    class="work-chip"
                    class:on={speakerNames.has(s.name)}
                    aria-pressed={speakerNames.has(s.name)}
                    on:click={() => toggleSpeaker(s.name)}
                    title={`${s.turns} ${s.turns === 1 ? 'speech' : 'speeches'} across ${s.works} ${s.works === 1 ? 'work' : 'works'}`}
                  >{s.name} <span class="speaker-turns">{s.turns}</span></button>
                {/each}
              </div>
              <p class="speaker-note">
                Greek hits are held to the word; English hits to the passage,
                because the translation is aligned to the section, not the word.
                {#if unlabelledWorks.length}
                  {listNames(unlabelledWorks)} {unlabelledWorks.length > 1 ? 'are' : 'is'} narrated without
                  speaker labels and will be left out of a filtered search.
                {/if}
                {#if narratedWorks.length}
                  {listNames(narratedWorks)} {narratedWorks.length > 1 ? 'are' : 'is'} reported by a narrator —
                  the text labels the frame, not the speeches inside it — and will be left out too.
                {/if}
                {#if rosterFailedWorks.length}
                  The cast of {listNames(rosterFailedWorks)} did not load.
                {/if}
                <a class="guide-link" href={`${BASE_URL}/advanced#speaker`} target="_blank" rel="noreferrer">What is this?</a>
              </p>
            {/if}
          {/if}
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
      (<code>texnh</code> = τέχνη). <code>*</code> matches any run of characters; <code>?</code> matches exactly one.
      <a class="guide-link" href={`${BASE_URL}/advanced#wildcards`} target="_blank" rel="noreferrer">What is this?</a>
      Use either inside or at the end of a word. In English a <code>*</code> may also start a
      word (<code>*ness</code>); in Greek it marks a Beta Code capital there, so Greek has no suffix wildcard.
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

  <!-- Always in the page, so a screen reader hears it change: a live region
       added with its text already in it is usually not announced, and the
       visible count is rebuilt with every search. -->
  <p class="sr-only" role="status" aria-live="polite">{loading ? 'Searching…' : searched && !error ? countText : ''}</p>

  {#if error}
    <p class="search-error">{error}</p>
  {:else if searched}
    {#if failedWorks.length || unsearched.length || approximateTurns.length}
      <!-- Notices are rows: what kind, what happened, and what to do. -->
      <div class="sx-notes">
        {#if failedWorks.length}
          <div class="sx-note warn" role="alert">
            <span class="k">Warning</span>
            <span>{failedWorks.length === 1 ? 'The index for' : 'The indexes for'} {failedWorks.map((w) => getWork(w)?.title ?? w).join(', ')} did not load, so {failedWorks.length === 1 ? 'its' : 'their'} results are missing and the counts below may be short.</span>
            <button type="button" class="a" on:click={doSearch}>Try again</button>
          </div>
        {/if}
        {#if unsearched.length}
          <div class="sx-note warn" role="alert">
            <span class="k">Warning</span>
            <span>English was not searched in {unsearched.join(', ')}: {unsearched.length === 1 ? 'its index' : 'their indexes'} did not load.</span>
            <button type="button" class="a" on:click={doSearch}>Try again</button>
          </div>
        {/if}
        {#if approximateTurns.length}
          <div class="sx-note">
            <span class="k">Note</span>
            <span>Where a speech begins in {approximateTurns.map((w) => getWork(w)?.title ?? w).join(', ')} is recorded to the line of Greek rather than the word, so a hit at the very start of a speech may belong to the one before it.</span>
            <span></span>
          </div>
        {/if}
      </div>
    {/if}
    <div class="result-bar">
      <p class="result-count">{countText}</p>
      {#if canWiden && !variantsShown}
        <button type="button" class="export-btn" on:click={findVariants} disabled={variantBusy}
          title="ἦν δ’ ἐγώ also stands as ἦ δ’ ὅς — one formula, different endings">
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
    <!-- Where the hits fall: plain items, each with its count. Choosing one
         narrows the results to it; choosing it again lifts the narrowing. -->
    {#if workChoice}
      <div class="sx-row" role="group" aria-label="Show hits from one work">
        <span class="k">Works</span>
        {#each workCounts as wc, i}
          {#if i < WORK_CHIPS || workListOpen || wc.id === workFilter}
            <button type="button" class="i" class:on={workFilter === wc.id} aria-pressed={workFilter === wc.id}
              title={`Show only hits in the ${wc.title}${workFilter === wc.id ? ' (again for all)' : ''}`}
              on:click={() => setWorkFilter(wc.id)}>{wc.title}<small>{wc.n}</small></button>
          {/if}
        {/each}
        {#if workCounts.length > WORK_CHIPS}
          <button type="button" class="more" aria-expanded={workListOpen}
            on:click={() => (workListOpen = !workListOpen)}>
            {workListOpen ? 'fewer' : `${workCounts.length - WORK_CHIPS} more`}
          </button>
        {/if}
      </div>
    {/if}
    {#if transChoice}
      <div class="sx-row" role="group" aria-label="Show English hits from one translation">
        <span class="k">Translations</span>
        {#each transCounts as tc, i}
          {#if i < TRANS_CHIPS || transListOpen || tc.id === transFilter}
            <button type="button" class="i" class:on={transFilter === tc.id} aria-pressed={transFilter === tc.id}
              title={`Show only hits in ${tc.short}’s translation${transFilter === tc.id ? ' (again for all)' : ''}`}
              on:click={() => setTransFilter(tc.id)}>{tc.short}<small>{tc.n}</small></button>
          {/if}
        {/each}
        {#if transCounts.length > TRANS_CHIPS}
          <button type="button" class="more" aria-expanded={transListOpen}
            on:click={() => (transListOpen = !transListOpen)}>
            {transListOpen ? 'fewer' : `${transCounts.length - TRANS_CHIPS} more`}
          </button>
        {/if}
        {#if secondScope}<span class="note">{secondScope}</span>{/if}
      </div>
    {/if}
    {#if lemmaDeadEnd || speakerNote || variantNote || csvNote}
      <div class="sx-notes">
        {#if lemmaDeadEnd}
          <div class="sx-note">
            <span class="k">Note</span>
            <span>These words occur, but not together in one passage. Searching for the phrase in any inflection looks for them in the order you typed them, which is usually what an empty result means here.</span>
            <span></span>
          </div>
        {/if}
        {#if speakerNote}
          <div class="sx-note"><span class="k">Spoken by</span><span>{speakerNote}</span><span></span></div>
        {/if}
        {#if variantNote}
          <div class="sx-note"><span class="k">Note</span><span>{variantNote}</span><span></span></div>
        {/if}
        {#if csvNote}
          <div class="sx-note"><span class="k">Export</span><span>{csvNote}</span><span></span></div>
        {/if}
      </div>
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
              <span class="group-count">{groupHits(g)} {groupHits(g) === 1 ? 'instance' : 'instances'}</span>
            </button>

            {#if expanded.has(g.key)}
              <ul class="instance-list">
                {#each g.instances as inst}
                  <li class="instance">
                    <a class="inst-ref" href={inst.jumpUrl} target="_blank" rel="noopener" title="Open in reader (new tab)">{inst.ref}</a>
                    {#if inst.rows}
                      <!-- One passage in each translation that has the words,
                           stacked, each under its translator's name, which
                           opens the reader in that translation. -->
                      <div class="sx-tr">
                        {#each inst.rows as row}
                          <div>
                            <a class="lab" href={row.jumpUrl} target="_blank" rel="noopener" title={`Open in ${row.title} (new tab)`}>{row.label}</a>
                            <span class="inst-snippet" lang="en">
                              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                              {@html row.html}
                            </span>
                          </div>
                        {/each}
                      </div>
                    {:else}
                      <span class="inst-snippet" class:greek={inst.lang === 'grk'} lang={inst.lang === 'grk' ? 'grc' : 'en'}>
                        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                        {@html inst.html}
                      </span>
                    {/if}
                    {#if inst.speaker}
                      <span class="inst-speaker">{inst.speaker}</span>
                    {/if}
                    {#if inst.oneOf}
                      <span class="inst-oneof" title="The morphological analysis allows more than one reading of this form">{inst.oneOf}</span>
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

  /* --- Grammatical fields (inside a combo slot) ------------------------ */
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

  /* --- Combo search panel ----------------------------------------------- */
  .lemma-panel {
    margin: 0;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--input-bg);
    padding: 0.45rem 0.75rem;
    font-family: var(--font-ui);
  }
  .lemma-panel > summary {
    cursor: pointer;
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: .04em;
    color: var(--text-mid);
  }
  .lemma-panel-note {
    margin: 0.5rem 0;
    font-size: 0.8rem;
    line-height: 1.45;
    color: var(--text-mid);
    max-width: 62ch;
  }
  .lemma-panel-clear {
    margin-top: 0.6rem;
    font-family: var(--font-ui);
    font-size: 0.8rem;
    padding: 0.25rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--col-bg);
    color: var(--text);
    cursor: pointer;
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
  .combo-kind { margin-left: auto; }
  .combo-kind select,
  .combo-text-field input,
  .combo-option select,
  .combo-option input,
  .combo-grammar-grid select {
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
  .combo-grammar-grid select:focus {
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
  .combo-grammar-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem 1rem;
  }
  .combo-add { margin-top: 0.6rem; }
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

  /* Who spoke a matched Greek word, under a speaker filter. */
  .inst-speaker {
    display: inline-block;
    margin-left: 0.5rem;
    font-family: var(--font-ui);
    font-size: 0.72rem;
    font-weight: 600;
    letter-spacing: .02em;
    color: var(--text-mid);
    white-space: nowrap;
  }

  /* --- Spoken-by panel (shares the works selector's chrome) -------------- */
  .speaker-body { display: flex; flex-direction: column; gap: 0.5rem; padding-top: 0.6rem; }
  .speaker-mode { margin: 0; }
  .speaker-note {
    margin: 0;
    font-family: var(--font-ui);
    font-size: 0.78rem;
    line-height: 1.45;
    color: var(--text-mid);
    max-width: 62ch;
  }
  .speaker-note.warn { color: var(--error); display: flex; align-items: center; gap: 0.6rem; flex-wrap: wrap; }
  .speaker-count { font-family: var(--font-ui); font-size: 0.78rem; color: var(--text-mid); align-self: center; }
  .speaker-chips { padding-top: 0.15rem; }
  .speaker-turns {
    font-size: 0.68rem;
    color: var(--text-light);
    font-variant-numeric: tabular-nums;
  }
  .work-chip.on .speaker-turns { color: inherit; opacity: 0.8; }

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
  .retry-btn {
    font: inherit;
    color: var(--accent);
    background: none;
    border: none;
    padding: 0;
    text-decoration: underline;
    cursor: pointer;
  }

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
    .advanced-panel { margin-left: 0; }
    .combo-slot-head { flex-wrap: wrap; }
    .combo-kind { margin-left: 0; }
    .controls-row { gap: 0.5rem; }
    .search-btn { margin-left: 0; width: 100%; margin-top: 0.25rem; }
  }

  /* --- Search features: structure only; the redesign styles these. ------- */
  .sx-notes { display: grid; margin: 0.5rem 0; border-top: 1px solid var(--border); font-family: var(--font-ui); font-size: 0.85rem; }
  .sx-note { display: grid; grid-template-columns: 6rem 1fr auto; gap: 0.75rem; align-items: baseline; padding: 0.4rem 0; border-bottom: 1px solid var(--border); }
  .sx-note .k { font-size: 0.7rem; text-transform: uppercase; letter-spacing: .08em; color: var(--text-mid); }
  .sx-note.warn .k { color: var(--error); }
  .sx-note .a, .sx-row .i, .sx-row .more, .lplist button, .lpsel .x {
    font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; text-align: left;
  }
  .sx-note .a, .lpsel .x, .sx-row .more { color: var(--accent); }
  .sx-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.9rem; margin: 0 0 0.6rem; padding: 0.35rem 0; border-top: 1px solid var(--border); font-family: var(--font-ui); font-size: 0.85rem; }
  .sx-row .k { width: 7rem; font-size: 0.7rem; text-transform: uppercase; letter-spacing: .08em; color: var(--text-mid); }
  .sx-row .i small { margin-left: 0.3rem; color: var(--text-mid); font-variant-numeric: tabular-nums; }
  .sx-row .i.on { color: var(--accent); text-decoration: underline; }
  .sx-row .note { margin-left: auto; font-style: italic; color: var(--text-mid); }
  .sx-tr { display: grid; gap: 0.35rem; min-width: 0; }
  .sx-tr .lab { display: block; font-family: var(--font-ui); font-size: 0.68rem; text-transform: uppercase; letter-spacing: .08em; color: var(--text-mid); text-decoration: none; }
  .lp { display: grid; gap: 0.35rem; max-width: 40rem; }
  .lp-field { display: grid; gap: 0.2rem; font-family: var(--font-ui); font-size: 0.75rem; color: var(--text-mid); }
  .lp-field input { font: inherit; font-size: 1rem; padding: 0.3rem 0.4rem; border: 1px solid var(--border); background: var(--input-bg); color: var(--text); }
  .lplist { list-style: none; margin: 0; padding: 0; max-height: 14rem; overflow-y: auto; border: 1px solid var(--border); background: var(--input-bg); }
  .lplist li { border-bottom: 1px solid var(--border); }
  .lplist li:last-child { border-bottom: 0; }
  .lplist li.on { background: var(--mark-bg); }
  .lplist button { display: grid; grid-template-columns: minmax(8rem, auto) 1fr auto; gap: 0.75rem; align-items: baseline; width: 100%; padding: 0.3rem 0.5rem; }
  .lplist .hw, .lpsel .hw { font-family: var(--font-greek); }
  .lplist .gl, .lpsel .gl { font-style: italic; color: var(--text-mid); }
  .lplist .ct, .lpsel .ct { font-family: var(--font-ui); font-size: 0.75rem; color: var(--text-mid); font-variant-numeric: tabular-nums; }
  .lpsel { display: flex; align-items: baseline; gap: 0.75rem; padding: 0.25rem 0; border-bottom: 1px solid var(--border); }
  .lpsel .x { margin-left: auto; font-family: var(--font-ui); font-size: 0.75rem; }
  .lp-status { margin: 0; font-family: var(--font-ui); font-size: 0.75rem; color: var(--text-mid); }
  .lemma-panel .d { font-weight: 400; font-style: italic; letter-spacing: 0; color: var(--text-mid); }
</style>
