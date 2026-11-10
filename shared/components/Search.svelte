<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import {
    search,
    searchCombo,
    searchPhraseVariants,
    speakerRoster,
    greekFold,
    greekHitForms,
    greekHitGrammar,
    englishQueryUnits,
    englishWords,
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
    type HitForms,
    type HitGrammar,
    type Reading,
    pool,
  } from '../lib/search';
  import { englishMarked, englishSnippets, markWordsHtml, plainEnglish, translationTexts, turnTranslationTexts } from '../lib/english-hit';
  import {
    PAIR_GREEK_LINES, pairEnglishText, pairUnits, sectionEnglish, unitAtEnglish, unitAtGreek, unitEnglish, unitPieces,
    type PairIndex, type PairUnit,
  } from '../lib/paired-hit';
  import { engHitCount, hitCount, paginate } from '../lib/search-pages';
  import {
    fetchBook,
    fetchChapters,
    fetchSections,
    fetchLemmaPickerShard,
    fetchLemmaGlosses,
    type BookData,
    type Segment,
    type Token,
    type ChapterRef,
    type SectionRef,
    type LemmaCandidate,
  } from '../lib/data';
  import { WORKS, getWork, workPath, WORK_ORDER, WORK_GROUPS, searchableTranslations, type TranslationRef } from '../lib/works';
  import { formatCite, formatLocValue, schemeFor } from '../lib/citation';
  import { decodeSearchUrl, encodeSearchUrl, hasSearch, type UrlSearch } from '../lib/search-url';
  import { betaQueryToGreek, betaToGreek, liveGreek } from '../lib/betacode';
  import { formGroups } from '../lib/form-panel';
  import { lineRenderParts } from '../lib/speakers';
  import WordPopup from './WordPopup.svelte';
  import {
    ambiguityNote, compareForms, facetCounts, facetKeep, formatReading, formGroupsOf, hasFacets, orderHits, refine, withTicked,
    type Facets, type PageSize, type ResultContext, type ResultSort, type ResultView,
  } from '../lib/result-views';

  const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, '');

  // One match occurrence, located precisely enough to label and jump to.
  interface Instance {
    lang: 'grk' | 'eng';
    work: string;
    column: string;
    line: number;
    ref: string;       // e.g. "34b"
    html: string;      // KWIC snippet
    jumpUrl: string;
    // Greek hits: each word the instance holds (one, a proximity window's,
    // or a section's), for its note and its speaker.
    held?: HeldTok[];
    // Greek hits under a speaker filter: who is speaking at the matched words,
    // each once, in order.
    speaker?: string;
    // English only: one row per translation the query matched in this section,
    // in the work's own order, so where Lamb and Jowett render the same lines
    // their words sit together. An English instance's html/jumpUrl are its
    // first row's. A Greek instance carries rows when the English query matched
    // in the same aligned unit: one instance, each side with its marks.
    rows?: TransRow[];
    // The other language's side of the hit, from the same aligned unit
    // (lib/paired-hit): the English of a Greek hit, in one translation, or the
    // Greek of an English one. Neither is marked: no word of it matched.
    pairEnglish?: { text: string; label: string; title: string; jumpUrl: string };
    pairGreek?: string;   // HTML: its words are buttons, as a hit's are
    // The unit the hit stands in, and where in its section, for merging and
    // for order within a line.
    unit?: PairUnit;
    at?: number;
    // Greek hits: the segment the token stands in, for its readings, and the
    // token as printed and folded, for the form view (greekFold of the
    // surface is the form index's key).
    seg?: string;
    surface?: string;
    form?: string;
    // Greek hits: the tokens the instance counts, each a hit.
    toks?: number[];
    // Its Greek hits alone (the tokens above), never the English rows it
    // carries: what a form's frequency counts, in the sort and in hitsIn.
    grkHits?: number;
    // The hit's whole section, both sides (what "more" opens). Under the
    // whole-section context the instance is the section itself (`isSection`).
    whole?: SectionView;
    isSection?: boolean;
    // A whole section with hits of several forms: the section once for each
    // form, as the form and grammar views file it.
    forms?: Instance[];
  }
  // One Greek word a hit holds. `oneOf` is a grammatical search's note on it,
  // stated as one-of-N when the parse does not settle the reading; absent when
  // it does. `speaker`: who says it, under a speaker filter.
  interface HeldTok { pos: number; surface: string; oneOf?: string; speaker?: string }
  // A whole Stephanus section: its Greek with every Greek hit of the page
  // there marked (`held`), and its English in each translation that matched there,
  // marked; or, with none, one translation's unmarked.
  interface SectionView {
    seg: string;      // the section's segment id, for its words' readings
    greek: string;
    held: HeldTok[];
    rows: TransRow[];
    pair?: { text: string; label: string; title: string; jumpUrl: string };
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
    // That retires the search whose first page may still be loading, and with
    // it the only code that would end "Searching…": doSearch clears `loading`
    // for its own run alone.
    loading = false;
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
      unresolved = [];
      allResults = outcome.results;
      // The widened results are another search's: its forms are not these,
      // nor its readings.
      hitForms = null;
      formsFailed = null;
      excludedForms = new Set();
      resetGrammar();
      facets = {};
      if (view === 'grammar') needGrammar();
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
  // ~instances per page (whole Stephanus pages): the Page-size control, and
  // more for a list of citations alone.
  const pageTarget = (ps: PageSize) => (ps === 'c' ? 400 : Number(ps));
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
    grkQuery: string; engQuery: string; engUnits: string[][]; grkAccentTerms: string[];
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
    grkQuery: '', engQuery: '', engUnits: [], grkAccentTerms: [], engPhrase: false, engForms: false, langOp: 'and',
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
  // Greek words searched only as typed: the headword map did not load.
  let unresolved: string[] = [];
  const TRANS_CHIPS = 8;                    // shown before "more"

  function translationsOf(work: string): TranslationRef[] {
    const w = getWork(work);
    return w ? searchableTranslations(w) : [];
  }
  function translationRef(work: string, id: string): TranslationRef | undefined {
    return translationsOf(work).find(t => t.id === id);
  }

  // ── Forms ──────────────────────────────────────────────────────────────────
  // What the Greek result is made of: every form found, with its count and a
  // tick box (lib/form-panel). The forms are looked up once, after the search
  // (greekHitForms); setting some aside then filters the results in hand, as
  // the translator and work chips do, and asks the network for nothing.
  let hitForms: HitForms | null = null;        // the forms of the search on screen
  // The lookup failed: wholly (true), or for these works. Forms that could not
  // be read cannot be set aside, and the page says so rather than show hits
  // the address bar claims are gone.
  let formsFailed: true | string[] | null = null;
  let excludedForms = new Set<string>();       // set aside and applied (?xf=)
  let formTicks = new Set<string>();           // ticked in the panel, not yet applied
  let formListOpen = false;
  const FORM_CHIPS = 12;                       // shown per headword before "more"
  // Everything downstream reads the results through this: the hits left once
  // the forms set aside and those the grammar facets reject are gone.
  function withoutForms(results: SearchResult[]): SearchResult[] {
    return refine(results, { forms: hitForms ?? undefined, excluded: excludedForms, grammar: hitGrammar ?? undefined, facets }, searchCtx.langOp);
  }
  $: formResults = refine(allResults, { forms: hitForms ?? undefined, excluded: excludedForms, grammar: hitGrammar ?? undefined, facets }, searchCtx.langOp);
  // Counted before any form is set aside, so one set aside stays listed, and
  // within the translation and work chosen and the facets ticked, so the
  // counts add up to the Greek hits shown.
  $: keepFacet = facetKeep(hitGrammar, facets);
  $: formPanel = hitForms ? formGroups(narrowWork(narrow(allResults, transFilter, searchCtx), workFilter), hitForms, keepFacet) : [];
  $: formKeys = [...new Set(formPanel.flatMap(g => g.forms.map(f => f.form)))];
  $: formChoice = formKeys.length > 1 || excludedForms.size > 0;
  // Apply has something to do when the ticks differ from what is in force.
  $: formsDirty = formKeys.some(f => formTicks.has(f) === excludedForms.has(f));
  const resetFormTicks = () => {
    formTicks = new Set((hitForms ? [...new Set([...hitForms.byResult.values()].flat())] : []).filter(f => f && !excludedForms.has(f)));
  };
  function toggleFormTick(form: string) {
    if (formTicks.has(form)) formTicks.delete(form);
    else formTicks.add(form);
    formTicks = formTicks;
  }
  // Only the forms in view: another work's keep the ticks they had.
  function toggleAllForms() {
    const on = !formKeys.some(f => formTicks.has(f));
    for (const f of formKeys) { if (on) formTicks.add(f); else formTicks.delete(f); }
    formTicks = formTicks;
  }
  // Looks up the forms of the results on screen, under the match mode the
  // search was submitted with: the control may have moved since.
  let formsMode: MatchMode = 'lemma';
  async function loadForms(results: SearchResult[]) {
    let found: HitForms | null = null;
    try {
      found = await greekHitForms(results, searchCtx.grkQuery, formsMode);
    } catch (err) {
      console.warn('search: no form list —', err);
    }
    // Forms are positions in the results they were read for, so they are kept
    // exactly when those results are still the ones on screen. Not "when no
    // newer action has started": a widening that finds nothing leaves these
    // results up, and their forms are still wanted.
    if (results !== allResults) return;
    hitForms = found;
    formsFailed = !found ? true : found.failedWorks.length ? found.failedWorks : null;
    resetFormTicks();
    fillPickInfo([...new Set([...(found?.headwords.values() ?? [])].flat())]);
  }
  async function retryForms() {
    const results = allResults;
    await loadForms(results);
    if (results === allResults) showResults(allResults);
  }
  function applyForms() {
    // Forms outside the work in view keep the state they had.
    const inView = new Set(formKeys);
    excludedForms = new Set([
      ...[...excludedForms].filter(f => !inView.has(f)),
      ...formKeys.filter(f => !formTicks.has(f)),
    ]);
    // A filter, not a new search, as the translator chip is.
    if (lastSearch) writeUrl({ ...lastSearch, trans: transFilter, workFilter, xforms: [...excludedForms], view, facets, context, sort, pageSize }, 'replace');
    showResults(allResults);
  }
  // ── Views and grammar ──────────────────────────────────────────────────────
  // The hits of the page in view grouped by Stephanus page (the default), by
  // form, by work or with each form's readings; and narrowed by those
  // readings (lib/result-views). The readings are looked up once the grammar
  // view or a facet asks for them (greekHitGrammar); ticking a facet then
  // filters the results in hand, as the form panel does.
  const VIEWS: { id: ResultView; label: string }[] = [
    { id: 'page', label: 'By Stephanus page' },
    { id: 'form', label: 'By form' },
    { id: 'work', label: 'By work' },
    { id: 'grammar', label: 'Grammar' },
  ];
  let view: ResultView = 'page';
  // Settings of the results, not of the search: a new search keeps them.
  let context: ResultContext = '3';             // ?ctx=
  let sort: ResultSort = 'page';                // ?so=
  let pageSize: PageSize = '40';                // ?ps=
  let facets: Facets = {};                      // ticked (?gf=)
  let hitGrammar: HitGrammar | null = null;     // the readings of the search on screen
  // The lookup failed: wholly (true), or for these works. Their hits are not
  // narrowed, and the page says so.
  let grammarFailed: true | string[] | null = null;
  // The results a lookup was last started for, so none is asked for twice.
  let grammarAsked: SearchResult[] | null = null;
  let grammarPending: Promise<void> = Promise.resolve();
  const resetGrammar = () => { hitGrammar = null; grammarFailed = null; grammarAsked = null; };
  async function loadGrammar(results: SearchResult[]) {
    let found: HitGrammar | null = null;
    try {
      found = await greekHitGrammar(results);
    } catch (err) {
      console.warn('search: no grammar —', err);
    }
    // Readings are positions in the results they were read for, as forms are.
    if (results !== allResults) return;
    hitGrammar = found;
    grammarFailed = !found ? true : found.failedWorks.length ? found.failedWorks : null;
  }
  function needGrammar(): Promise<void> {
    if (grammarAsked !== allResults) {
      grammarAsked = allResults;
      grammarPending = loadGrammar(allResults);
    }
    return grammarPending;
  }
  async function retryGrammar() {
    const results = allResults;
    await loadGrammar(results);
    if (results === allResults) showResults(allResults);
  }
  // Regroups the page in view; the results and the pages stay as they are.
  function setView(next: ResultView) {
    popup = null;
    view = next;
    if (lastSearch) writeUrl({ ...lastSearch, trans: transFilter, workFilter, xforms: [...excludedForms], view, facets, context, sort, pageSize }, 'replace');
    if (view === 'grammar') needGrammar();
  }
  // How much text a hit shows. The pages stay as they are; the page in view
  // is drawn again.
  const CONTEXTS: { id: ResultContext; label: string }[] = [
    { id: '1', label: '1 line' },
    { id: '3', label: '3 lines' },
    { id: 's', label: 'Whole section' },
  ];
  function setContext(next: ResultContext) {
    if (next === context) return;
    context = next;
    if (lastSearch) writeUrl({ ...lastSearch, trans: transFilter, workFilter, xforms: [...excludedForms], view, facets, context, sort, pageSize }, 'replace');
    if (pages.length) renderPage(pageIdx);
  }
  // Hits per page, or citations alone. The pages are laid out again from the
  // results in hand, from the first.
  const PAGE_CHOICES: { id: PageSize; label: string }[] = [
    { id: '20', label: '20' },
    { id: '40', label: '40' },
    { id: '100', label: '100' },
    { id: 'c', label: 'Citations only' },
  ];
  let citeList: CiteGroup[] = [];      // the page in view, under citations only
  function setPageSize(next: PageSize) {
    if (next === pageSize) return;
    pageSize = next;
    if (lastSearch) writeUrl({ ...lastSearch, trans: transFilter, workFilter, xforms: [...excludedForms], view, facets, context, sort, pageSize }, 'replace');
    showResults(allResults);
  }
  // The hits opened to their whole section by "more", on the page in view.
  let more = new Set<Instance>();
  function toggleMore(inst: Instance) {
    if (more.has(inst)) more.delete(inst);
    else more.add(inst);
    more = more;
  }
  // The order of the page in view: within it only, so a sort never moves a
  // hit to another page (lib/result-views orderHits).
  const SORTS: { id: ResultSort; label: string }[] = [
    { id: 'page', label: 'Stephanus order' },
    { id: 'work', label: 'By work' },
    { id: 'form', label: 'By form' },
    { id: 'freq', label: 'By form frequency' },
  ];
  function setSort(next: ResultSort) {
    popup = null;
    sort = next;
    if (lastSearch) writeUrl({ ...lastSearch, trans: transFilter, workFilter, xforms: [...excludedForms], view, facets, context, sort, pageSize }, 'replace');
  }
  // A filter, not a new search, applied as soon as it is ticked.
  function toggleFacet(category: string, value: string) {
    const values = facets[category] ?? [];
    const next = values.includes(value) ? values.filter(v => v !== value) : [...values, value];
    const { [category]: _, ...rest } = facets;
    facets = next.length ? { ...rest, [category]: next } : rest;
    if (lastSearch) writeUrl({ ...lastSearch, trans: transFilter, workFilter, xforms: [...excludedForms], view, facets, context, sort, pageSize }, 'replace');
    showResults(allResults);
  }
  // Counted before the facets, so every value stays on offer, but after the
  // forms set aside and within the translation and work chosen.
  const formKeep = (forms: HitForms | null, excluded: Set<string>) => (r: SearchResult, i: number) => {
    const own = forms?.byResult.get(`${r.work}:${r.meta.id}`);
    return !own || !excluded.has(own[i]);
  };
  $: keepForm = formKeep(hitForms, excludedForms);
  $: facetRows = withTicked(
    hitGrammar ? facetCounts(narrowWork(narrow(allResults, transFilter, searchCtx), workFilter), hitGrammar, keepForm) : [],
    facets);
  const categoryLabel = (key: string) => GRAMMAR_CATEGORIES.find(c => c.key === key)?.label ?? key;
  // The readings of each Greek hit, by work, segment and token.
  $: grammarAt = (() => {
    const at = new Map<string, Reading[]>();
    for (const r of hitGrammar ? allResults : []) {
      hitGrammar!.byResult.get(`${r.work}:${r.meta.id}`)
        ?.forEach((readings, i) => at.set(`${r.work}:${r.meta.id}:${r.grkPositions[i]}`, readings));
    }
    return at;
  })();
  const readingsOf = (inst: Instance, at: Map<string, Reading[]>) =>
    inst.lang === 'grk' && inst.seg ? at.get(`${inst.work}:${inst.seg}:${inst.at}`) : undefined;
  // A word the facets pass on some of its readings and not others.
  function facetOneOf(inst: Instance, pos: number, at: Map<string, Reading[]>, ticked: Facets): string | undefined {
    // An English hit has no Greek word of its own; opened to its section, the
    // words marked there are the section's.
    const seg = inst.seg ?? inst.whole?.seg;
    const readings = hasFacets(ticked) && seg ? at.get(`${inst.work}:${seg}:${pos}`) : undefined;
    return readings && ambiguityNote(readings, ticked);
  }
  // What an instance says of its ambiguous words: the grammatical search's
  // note on each, else the facets'. A hit of one word, its note; of several
  // (a window, a section), each distinct note with the word it is about, so
  // the reader knows which. A hit opened with "more" keeps its own note and
  // adds those of the section's other hits, now marked in it.
  function noteOf(inst: Instance, at: Map<string, Reading[]>, ticked: Facets, open: boolean): string | undefined {
    const notes = (list: HeldTok[]) => list
      .map(h => ({ surface: h.surface, note: h.oneOf ?? facetOneOf(inst, h.pos, at, ticked) }))
      .filter(x => x.note);
    const own = inst.held ?? [];
    const out = own.length === 1 ? notes(own).map(x => x.note!) : notes(own).map(x => `${x.surface}: ${x.note}`);
    if (open && !inst.isSection) {
      const mine = new Set(own.map(h => h.pos));
      out.push(...notes((inst.whole?.held ?? []).filter(h => !mine.has(h.pos))).map(x => `${x.surface}: ${x.note}`));
    }
    return out.length ? [...new Set(out)].join(' · ') : undefined;
  }
  // Who speaks the words held, each once, in order.
  const speakersOf = (held: HeldTok[]) => [...new Set(held.map(h => h.speaker).filter(Boolean))].join(' · ') || undefined;
  const groupReadings = (g: ViewGroup, at: Map<string, Reading[]>) =>
    [...new Set(g.instances.flatMap(inst => (readingsOf(inst, at) ?? []).map(formatReading)))].join(' · ');
  // A group by form spans works, so its citations name theirs.
  const citeText = (inst: Instance, v: ResultView) =>
    v === 'form' || v === 'grammar' ? `${getWork(inst.work)?.abbr ?? inst.work} ${inst.ref}` : inst.ref;

  // A headword's key as the reader knows it: its dictionary form where the
  // picker data has it, else the key in Greek letters.
  const headLabel = (key: string, info: typeof pickInfo) => info[key]?.heads ?? betaToGreek(key);

  // Hits per translator, most first — the breakdown is itself an answer
  // (which translators use this word, and how often). Counted within the work
  // chosen below, if any, so the counts add up to the English hits shown.
  $: transCounts = (() => {
    const by = new Map<string, { id: string; short: string; n: number }>();
    for (const r of narrowWork(formResults, workFilter)) {
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
    const shown = narrowWork(formResults, workFilter);
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
    for (const r of narrow(formResults, transFilter, searchCtx)) {
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
    if (lastSearch) writeUrl({ ...lastSearch, trans: transFilter, workFilter, xforms: [...excludedForms], view, facets, context, sort, pageSize }, 'replace');
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
    // A filter that leaves no page draws none, so the card goes here too.
    popup = null;
    const run = ++layoutRun;
    const shown = narrowWork(narrow(withoutForms(results), transFilter, searchCtx), workFilter);
    totalInstances = shown.reduce((n, r) => n + hitCount(r), 0);
    shownResults = shown;
    // Pages are laid out from the index alone (a section's Stephanus page is
    // read off its column), so nothing is fetched before the first one.
    pages = paginate(shown, pageTarget(pageSize));
    if (run !== layoutRun) return;
    if (pages.length) await renderPage(0);
    // A retired page leaves pageLoading to the layout that retired it.
    else { groups = []; citeList = []; pageIdx = 0; pageLoading = false; }
  }

  function setTransFilter(id: string | null) {
    transFilter = transFilter === id ? null : id;
    // A filter, not a new search: it replaces the history entry rather than
    // adding one.
    if (lastSearch) writeUrl({ ...lastSearch, trans: transFilter, workFilter, xforms: [...excludedForms], view, facets, context, sort, pageSize }, 'replace');
    showResults(allResults);
  }

  // ── The side column ────────────────────────────────────────────────────────
  // What this search narrows or changes from the default, in the order of the
  // controls below it, each with the way to undo it. All but the speaker
  // filter are filters on the results in hand; that one is part of the search.
  type Chosen = { key: string; label: string; remove: () => void | Promise<void> };
  $: chosen = ((): Chosen[] => {
    const out: Chosen[] = [];
    if (workFilter) out.push({ key: 'wf', label: getWork(workFilter)?.title ?? workFilter, remove: () => setWorkFilter(workFilter) });
    if (transFilter) {
      const short = transCounts.find(t => t.id === transFilter)?.short ?? transFilter;
      out.push({ key: 't', label: short, remove: () => setTransFilter(transFilter) });
    }
    const n = excludedForms.size;
    if (n) out.push({ key: 'xf', label: `${n} form${n === 1 ? '' : 's'} set aside`, remove: restoreForms });
    for (const [category, values] of Object.entries(facets)) {
      for (const value of values) {
        out.push({ key: `gf:${category}.${value}`, label: `${categoryLabel(category)} ${value}`, remove: () => toggleFacet(category, value) });
      }
    }
    const sp = searchCtx.speaker;
    if (sp) {
      const names = listNames(sp.names);
      out.push({ key: 'sp', label: sp.mode === 'only' ? `${names} only` : `Anyone but ${names}`, remove: dropSpeaker });
    }
    if (view !== 'page') {
      out.push({ key: 'v', label: view === 'grammar' ? 'By grammar' : VIEWS.find(v => v.id === view)?.label ?? view, remove: () => setView('page') });
    }
    if (sort !== 'page') {
      const label = SORTS.find(so => so.id === sort)?.label ?? sort;
      out.push({ key: 'so', label: `Sorted ${label.charAt(0).toLowerCase()}${label.slice(1)}`, remove: () => setSort('page') });
    }
    if (context !== '3') out.push({ key: 'ctx', label: CONTEXTS.find(c => c.id === context)?.label ?? context, remove: () => setContext('3') });
    if (pageSize !== '40') {
      out.push({ key: 'ps', label: pageSize === 'c' ? 'Citations only' : `${pageSize} a page`, remove: () => setPageSize('40') });
    }
    return out;
  })();
  // Every form back in, as ticking them all and Apply would.
  function restoreForms() {
    excludedForms = new Set();
    resetFormTicks();
    if (lastSearch) writeUrl({ ...lastSearch, trans: transFilter, workFilter, xforms: [...excludedForms], view, facets, context, sort, pageSize }, 'replace');
    showResults(allResults);
  }
  // The speaker filter is part of the search, so lifting it searches again,
  // keeping the filters on the results.
  async function dropSpeaker() {
    // The search as it was submitted, less its speaker: the box may hold a
    // word typed since and never searched for, and that is not what the
    // results on screen, or the line being removed, are about.
    // The settings of the results stay as they now are (Clear all has just
    // reset them; applySearch would put the submitted ones back).
    const now = { view, sort, context, pageSize };
    // The results may be the widened ones ("any inflection"), a step taken
    // from the search: lifting the speaker must widen again for everyone, not
    // fall back to the search before the widening.
    const widened = variantsShown;
    if (lastSearch) applySearch(lastSearch);
    ({ view, sort, context, pageSize } = now);
    speakerMode = 'anyone';
    speakerNames = new Set();
    // The reactive speakerFilter that doSearch reads must catch up.
    await tick();
    if (widened) {
      searchCtx = { ...searchCtx, speaker: undefined };
      speakerNote = '';
      speakerNoteKey = '';
      if (lastSearch) {
        lastSearch = { ...lastSearch, speaker: null };
        writeUrl({ ...lastSearch, view, context, sort, pageSize }, 'replace');
      }
      await findVariants();
      return;
    }
    await doSearch(undefined, { trans: transFilter, work: workFilter, xforms: [...excludedForms], facets });
    // The search writes its address before it knows whether the work and the
    // translation still hold; written again, they are in it.
    if (lastSearch && searched) writeUrl({ ...lastSearch, trans: transFilter, workFilter, xforms: [...excludedForms], view, facets, context, sort, pageSize }, 'replace');
  }
  // Everything at once, with one new search at most.
  async function clearChosen() {
    workFilter = null;
    transFilter = null;
    excludedForms = new Set();
    resetFormTicks();
    facets = {};
    view = 'page';
    sort = 'page';
    context = '3';
    pageSize = '40';
    if (searchCtx.speaker) {
      await dropSpeaker();
    } else {
      if (lastSearch) writeUrl({ ...lastSearch, trans: transFilter, workFilter, xforms: [...excludedForms], view, facets, context, sort, pageSize }, 'replace');
      showResults(allResults);
    }
    sumEl?.focus();
  }
  // The button pressed goes with its line, so focus goes to the list.
  async function removeChosen(c: Chosen) {
    await c.remove();
    await tick();
    sumEl?.focus();
  }

  // On a narrow screen the column is a sheet over the page, opened by Refine:
  // focus goes into it, and back to Refine when it shuts.
  let sheetOpen = false;
  let sheetEl: HTMLElement | null = null;
  let sumEl: HTMLElement | null = null;
  let refineBtn: HTMLButtonElement | null = null;
  async function openSheet() {
    sheetOpen = true;
    await tick();
    sheetEl?.focus();
  }
  function closeSheet() {
    sheetOpen = false;
    refineBtn?.focus();
  }
  // The page behind an open sheet stays where it is: a wheel or swipe over
  // the backdrop would otherwise scroll it, and shutting the sheet would
  // leave the reader somewhere else.
  $: if (typeof document !== 'undefined') document.documentElement.style.overflow = sheetOpen ? 'hidden' : '';
  // Escape shuts the sheet; Tab stays inside it while it is open.
  function onSheetKey(e: KeyboardEvent) {
    if (!sheetOpen || !sheetEl) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSheet();
      return;
    }
    if (e.key !== 'Tab') return;
    const els = [...sheetEl.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])')];
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    const at = document.activeElement;
    if (!sheetEl.contains(at) || (e.shiftKey && (at === first || at === sheetEl)) || (!e.shiftKey && at === last)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  }

  // ── Accent-sensitive Greek matching ────────────────────────────────────────
  // The indexes are accent-folded (λόγος and λογός share a key), which is the
  // right default and stays the default. The toggle offers strict matching as
  // an instance-level post-filter: the index still finds the folded hits, then
  // each matched surface token must carry the query's exact diacritics. Strict
  // semantics, stated on the control: a query typed WITHOUT accents then only
  // matches genuinely unaccented tokens.
  let accentSensitive = false;
  // NFC + lowercase + final-sigma normalisation, diacritics KEPT. The elision
  // mark folds as greekFold folds it: the text stores ' and, in a few words, ’.
  const accentNorm = (s: string) =>
    s.normalize('NFC').toLowerCase().replace(/ς/g, 'σ').replace(/[’ʼ]/g, "'");
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
  // One plain line (John, 2026-11-09): who the results are held to, and the
  // one thing their reader must be told, that narrated works are not among
  // them. A filtered search skips those silently, and a Republic with no hits
  // would otherwise read as "Socrates never says it". Which works, and the
  // rest of the fine print, is in the Spoken-by panel.
  function describeSpeakerFilter(filter: SpeakerFilter | undefined): string {
    if (!filter) return '';
    const who = listNames(filter.names);
    let note = filter.mode === 'only' ? `${who} only.` : `Anyone but ${who}.`;
    // Only from a roster that describes this search's works; a stale one would
    // claim an exclusion that did not happen, and saying nothing is better.
    if (rosterFresh && (unlabelledWorks.length || narratedWorks.length)) {
      note += ' Narrated works are left out: a speaker’s words cannot be picked out in them.';
    }
    return note;
  }

  // The page's hits as the view groups them. A section is a work and book
  // (page view), a work (work view), or the whole page (form and grammar
  // views); the groups within keep the instances in corpus order.
  interface ViewGroup { key: string; label: string; greek?: boolean; bekker?: string; instances: Instance[] }
  interface ViewSection { key: string; work?: string; book?: number; groups: ViewGroup[] }
  function sectionsFor(groups: ChapterGroup[], v: ResultView, by: ResultSort): ViewSection[] {
    // The sort orders the page's hits before the view groups them; a form is
    // counted over the whole page.
    const title = (work: string) => getWork(work)?.title ?? work;
    // A form's frequency is its Greek hits: an English row a hit carries is
    // no occurrence of the form.
    const itemOf = (inst: Instance) => ({ inst, work: inst.work, form: inst.lang === 'grk' ? inst.form : undefined, surface: inst.surface, hits: hitsIn(inst), grk: inst.grkHits ?? 0 });
    const freq = new Map<string, number>();
    for (const g of groups) for (const inst of g.instances) {
      if (inst.lang === 'grk' && inst.form) freq.set(inst.form, (freq.get(inst.form) ?? 0) + (inst.grkHits ?? 0));
    }
    const ordered = (list: Instance[], s: ResultSort) => orderHits(list.map(itemOf), s, title, freq).map(x => x.inst);
    if (v === 'form' || v === 'grammar') {
      // The groups by form A–Z under "by form", else most hits first; under
      // "by work" the hits in each group by work.
      const items = groups.flatMap(g => g.instances.flatMap(inst => inst.forms ?? [inst]).map(itemOf));
      const formed = formGroupsOf(by === 'work' ? orderHits(items, 'work', title) : items);
      if (by === 'form') formed.sort((a, b) => (a.form === null ? 1 : 0) - (b.form === null ? 1 : 0) || (a.form && b.form ? compareForms(a.form, b.form) : 0));
      return [{
        key: v,
        groups: formed.map(fg => ({
          key: fg.form === null ? `${v}::english` : `${v}:f:${fg.form}`,
          label: fg.form === null ? 'English' : fg.surfaces.join(' · '),
          greek: fg.form !== null,
          instances: fg.items.map(item => item.inst),
        })),
      }];
    }
    // groups arrive in corpus order (buildGroups), so sections and groups
    // are made in the order they are met.
    const sections = new Map<string, ViewSection>();
    for (const g of groups) {
      const w = getWork(g.work);
      const id = v === 'work' ? g.work : `${g.work}:${g.book}`;
      const sec = sections.get(id)
        ?? sections.set(id, { key: `${v}:${id}`, work: g.work, book: v === 'work' ? undefined : g.book, groups: [] }).get(id)!;
      if (v === 'page') {
        sec.groups.push({ key: `page:${g.key}`, label: `${groupUnitLabel(g.work)} ${g.chapter}`, bekker: g.bekker, instances: g.instances });
        continue;
      }
      const key = `work:${g.work}:${g.book}`;
      let vg = sec.groups.find(x => x.key === key);
      if (!vg) {
        const label = (w?.bookLabels.length ?? 0) > 1 ? `Book ${w!.bookLabels[g.book - 1] ?? g.book}` : (w?.title ?? g.work);
        vg = { key, label, instances: [] };
        sec.groups.push(vg);
      }
      vg.instances.push(...g.instances);
    }
    for (const sec of sections.values()) {
      for (const vg of sec.groups) if (by === 'form' || by === 'freq') vg.instances = ordered(vg.instances, by);
    }
    const list = [...sections.values()];
    return by === 'work' ? list.sort((a, b) => title(a.work!).localeCompare(title(b.work!))) : list;
  }
  $: viewSections = sectionsFor(groups, view, sort);
  // Single-hit groups open by default; merged (multi-hit) ones start collapsed.
  $: expanded = new Set(viewSections.flatMap(sec => sec.groups).filter(g => g.instances.length === 1).map(g => g.key));

  // A shut group is not in the page, so it would not print: every group is
  // opened for printing, and the ones the reader had shut are shut after.
  let openBeforePrint: Set<string> | null = null;
  function openForPrint() {
    openBeforePrint = new Set(expanded);
    expanded = new Set(viewSections.flatMap(sec => sec.groups.map(g => g.key)));
  }
  function closeAfterPrint() {
    if (openBeforePrint) expanded = openBeforePrint;
    openBeforePrint = null;
  }

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

  // What an instance counts for: each Greek word it holds (one, or a
  // proximity window's or a section's); an English one, each word its
  // translations matched (see hitCount in lib/search-pages, which counts the
  // total and lays out pages from the index alone).
  const hitsIn = (inst: Instance) => (inst.rows?.reduce((n, row) => n + row.hits, 0) ?? 0)
    + (inst.lang === 'grk' ? inst.grkHits ?? 0 : inst.rows ? 0 : 1);
  const groupHits = (g: { instances: Instance[] }) => g.instances.reduce((n, inst) => n + hitsIn(inst), 0);

  // The reader's address for a hit. Carry the SUBMITTED queries so the reader
  // can highlight them; loc scrolls to the section. Use the snapshot (ctx),
  // not live input state.
  function jumpLinks(ctx: SearchCtx) {
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
    return (work: string, book: number, column: string, line: number, trans?: string, hits?: number[]) =>
      `${BASE_URL}${workPath(work, book)}?${base}${base ? '&' : ''}`
      + `${trans ? `trans=${encodeURIComponent(trans)}&` : ''}`
      + `${hits?.length ? `hlt=${column}:${hits.join(',')}&` : ''}loc=${formatLocValue(work, column, line)}`;
  }

  // Citations only: each section with hits and its count, read off the
  // results alone, so no book is fetched. By work and book, in corpus order.
  interface CiteGroup { key: string; work: string; book: number; cites: { column: string; ref: string; href: string; n: number }[] }
  function citationsFor(results: SearchResult[], ctx: SearchCtx): CiteGroup[] {
    const jump = jumpLinks(ctx);
    const out = new Map<string, CiteGroup>();
    for (const r of results) {
      const n = hitCount(r);
      if (!n) continue;
      const key = `${r.work}:${r.meta.book}`;
      const g = out.get(key) ?? out.set(key, { key, work: r.work, book: r.meta.book, cites: [] }).get(key)!;
      const column = r.meta.column;
      const known = g.cites.find(c => c.column === column);
      if (known) { known.n += n; continue; }
      // An English-only hit in one translation opens the reader in it, where
      // the work offers a choice.
      const hits = r.engHits ?? [];
      const trans = !r.grkMatch && hits.length === 1 && translationsOf(r.work).length > 1 ? hits[0].translation : undefined;
      g.cites.push({ column, ref: formatCite(r.work, column), href: jump(r.work, r.meta.book, column, 1, trans, r.grkMatch ? r.grkPositions : undefined), n });
    }
    return [...out.values()];
  }

  // Build the Stephanus-page groups for a slice of results: load the books and
  // outlines they touch (bounded concurrency), then assemble and sort. A failed
  // book or outline fetch is evicted (see data.ts) and its work:book key
  // collected in `failed` — NOT swallowed as a successful empty result — so the
  // caller can show an incomplete-results notice and offer a retry.
  async function buildGroups(
    results: SearchResult[],
    ctx: SearchCtx,
    context: ResultContext,
  ): Promise<{ groups: ChapterGroup[]; failed: string[]; segs: Map<string, Segment> }> {
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

    // The aligned units of each book (lib/paired-hit), built once.
    const pairIx = new Map<string, PairIndex>();                  // work:book
    const pairsOf = (pair: string, work: string) => {
      let ix = pairIx.get(pair);
      if (!ix) { ix = pairUnits(books.get(pair)!, translationsOf(work)); pairIx.set(pair, ix); }
      return ix;
    };

    // A translation's texts for a segment, each with the section its words
    // lie in: cut by unit where they can be (unitPieces), else as the index
    // counted them, in the segment's own section. The same words in the same
    // order either way, so the index's word positions count through them.
    const piecesOf = (pair: string, ix: PairIndex, seg: Segment, t: Pick<TranslationRef, 'id' | 'slot'>) =>
      unitPieces(ix, seg, t)?.map(piece => ({ text: piece.text, section: piece.unit.section }))
      ?? translationTexts(seg, t, t.slot === 'overlay' ? turnsOf(pair, t.id) : undefined).map(text => ({ text, section: seg.column }));
    // The English words the results hold, by piece (`${pair}:${translation}:
    // ${segment}:${piece}`), each as its place in its piece: a section's whole
    // text marks these, not every word the query would match there.
    const held = new Map<string, Set<number>>();

    const gmap = new Map<string, ChapterGroup>();
    const add = (work: string, book: number, ch: { chapter: string; bekker: string; order: number }, inst: Instance) => {
      const key = `${work}:${book}:${ch.chapter}`;
      let g = gmap.get(key);
      if (!g) { g = { key, work, book, chapter: ch.chapter, bekker: ch.bekker, order: ch.order, instances: [] }; gmap.set(key, g); }
      g.instances.push(inst);
    };

    const jumpFor = jumpLinks(ctx);

    // Every instance is made first and placed in its group afterwards: a
    // Greek and an English hit in one unit become one instance, and the two
    // may come from different results (a turn-aligned translation is indexed
    // under the section its turn starts in, wherever its words fall).
    const made: { work: string; book: number; inst: Instance }[] = [];
    // Context either side of a hit: words of Greek, characters of English.
    const greekReach = context === '1' ? 4 : 12;
    const englishReach = context === '1' ? 50 : 140;
    const grkByUnit = new Map<PairUnit, Instance[]>();
    const engByUnit = new Map<PairUnit, Instance>();
    const firstLine = (unit: PairUnit) => unit.greek[0]?.n ?? 1;

    for (const r of results) {
      const pair = `${r.work}:${r.meta.book}`;
      const seg = segMap.get(`${r.work}:${r.meta.id}`);
      if (!seg || !lookups.has(pair)) continue;
      const ix = pairsOf(pair, r.work);
      if (r.grkMatch) {
        // Flattened surface tokens, for the accent post-filter and each hit's
        // form (positions are token indices — the same flattening greekKwic uses).
        const toks: string[] = [];
        for (const line of seg.greek) for (const tok of line.tokens) toks.push(tok.t);
        const kept = r.grkPositions.filter(pos => !ctx.grkAccentTerms.length
          || accentTokenMatch(toks[pos] ?? '', ctx.grkAccentTerms));
        const keep = new Set(kept);
        // A proximity hit is one instance per window, its terms marked
        // together; a word search, one per word. Each window is cut as the
        // accent filter cuts the positions.
        const windows = r.windows?.map(w => w.filter(p => keep.has(p))).filter(w => w.length);
        const hits = windows?.length ? windows : kept.map(pos => [pos]);
        for (const own of hits) {
          const pos = own[0];
          const line = lineOfPosition(seg, pos);
          // Every word of the hit, a window's later terms as much as its first.
          // r.grammar runs parallel to grkPositions on a grammatical search.
          // Where the parse doesn't settle the reading, say so on the hit
          // rather than letting the match imply a certainty it doesn't have.
          const held = own.map((p): HeldTok => {
            const i = r.grkPositions.indexOf(p);
            const g = r.grammar?.[i];
            const oneOf = g && !g.certain
              ? Object.entries(g.values)
                  .map(([cat, vals]) => `${cat} ${vals.join(' or ')}`)
                  .join(' · ')
              : undefined;
            return { pos: p, surface: toks[p] ?? '', oneOf, speaker: r.speakers?.[i] ?? undefined };
          });
          const speaker = speakersOf(held);
          const unit = unitAtGreek(ix, seg, pos);
          const surface = toks[pos];
          const inst: Instance = { lang: 'grk', work: r.work, seg: r.meta.id, surface, form: greekFold(surface ?? ''), column: seg.column, line, ref: formatCite(r.work, seg.column, line), html: windows?.length
            ? greekKwic(r.work, seg, kept, greekReach, [own[0], own[own.length - 1]])
            : greekKwic(r.work, seg, [pos], greekReach),
            toks: own, grkHits: own.length, jumpUrl: jumpFor(r.work, r.meta.book, seg.column, line, undefined, kept), held, speaker, unit, at: pos };
          made.push({ work: r.work, book: r.meta.book, inst });
          (grkByUnit.get(unit) ?? grkByUnit.set(unit, []).get(unit)!).push(inst);
        }
      }
      if (r.engMatch) {
        const ts = translationsOf(r.work);
        const several = ts.length > 1;
        // A work the registry does not list still has its one translation.
        const hits: EngHit[] = r.engHits ?? [{ translation: ts[0]?.id ?? 'english', positions: [] }];
        for (const hit of hits) {
          const t = ts.find(x => x.id === hit.translation)
            ?? { id: hit.translation, slot: 'english' as const, short: hit.translation, name: hit.translation };
          // The translation's texts here, cut so that each lies in one unit
          // where they can be: the same words in the same order, and a passage
          // then never runs on into another unit's.
          const texts = piecesOf(pair, ix, seg, t).map(piece => piece.text);
          // The matched words, by the unit each stands in: every unit is an
          // instance of its own, beside the Greek it translates. With nothing
          // to mark, the passage's head stands for the section.
          const marked = englishMarked(texts, hit.positions, ctx.engUnits, ctx.engPhrase, ctx.engForms);
          const starts: number[] = [];
          texts.reduce((n, text) => { starts.push(n); return n + englishWords(text).length; }, 0);
          for (const w of marked) {
            let k = starts.length - 1;
            while (k > 0 && starts[k] > w) k--;
            const key = `${pair}:${t.id}:${seg.id}:${k}`;
            (held.get(key) ?? held.set(key, new Set()).get(key)!).add(w - starts[k]);
          }
          const byUnit = new Map<PairUnit, number[]>();
          for (const w of marked) {
            const unit = unitAtEnglish(ix, seg, t, w);
            (byUnit.get(unit) ?? byUnit.set(unit, []).get(unit)!).push(w);
          }
          if (!marked.length) byUnit.set(unitAtEnglish(ix, seg, t, 0), []);
          // What the hit counts for is the index's to say (engHitCount). Where
          // the marks are the index's positions, each unit counts its own;
          // otherwise the whole count goes on the first row.
          const counted = new Map<number, number>();
          for (const p of hit.positions) counted.set(p, (counted.get(p) ?? 0) + 1);
          const exact = marked.length > 0 && marked.length === counted.size && marked.every(w => counted.has(w));
          let k = 0;
          for (const [unit, words] of byUnit) {
            const n = exact ? words.reduce((sum, w) => sum + counted.get(w)!, 0) : k ? 0 : engHitCount(hit);
            k++;
            const line = firstLine(unit);
            // A row for each passage the words fall in; the count goes on the first.
            const rows = englishSnippets(texts, hit.positions, ctx.engUnits, ctx.engPhrase, ctx.engForms, words.length ? words : undefined, englishReach)
              .map((html, j): TransRow => ({
                translation: t.id,
                label: t.short,
                title: t.name,
                html,
                // Named wherever there is a choice, so a reader's saved choice of
                // the other translation does not open the hit in the wrong words.
                jumpUrl: jumpFor(r.work, r.meta.book, unit.section, line, several ? t.id : undefined),
                hits: j ? 0 : n,
              }));
            if (!rows.length) continue;
            // Every translation's hit in one unit shares one instance: the
            // same lines in each translator's words.
            let inst = engByUnit.get(unit);
            if (!inst) {
              inst = { lang: 'eng', work: r.work, column: unit.section, line, ref: formatCite(r.work, unit.section), html: '', jumpUrl: '', rows: [], unit, at: unit.first };
              engByUnit.set(unit, inst);
              made.push({ work: r.work, book: r.meta.book, inst });
            }
            inst.rows!.push(...rows);
          }
        }
      }
    }

    // One unit, one instance: an English hit joins the first Greek hit of its
    // unit; alone, it shows the unit's Greek.
    const firstGrk = new Map<PairUnit, Instance>();
    for (const [unit, list] of grkByUnit) firstGrk.set(unit, list.reduce((a, b) => (b.at! < a.at! ? b : a)));
    const merged = new Set<Instance>();
    for (const { work, book, inst } of made) {
      if (inst.lang !== 'eng') continue;
      const ts = translationsOf(work);
      const order = (id: string) => ts.findIndex(t => t.id === id);
      inst.rows!.sort((a, b) => order(a.translation) - order(b.translation));
      inst.html = inst.rows![0].html;
      inst.jumpUrl = inst.rows![0].jumpUrl;
      const grk = firstGrk.get(inst.unit!);
      if (grk) { grk.rows = inst.rows; merged.add(inst); }
      else {
        const seg = books.get(`${work}:${book}`)?.segments.find(x => x.column === inst.unit!.section);
        inst.pairGreek = (seg && pairGreekHtml(work, seg, inst.unit!)) || undefined;
      }
    }
    for (const { work, book, inst } of made) {
      if (merged.has(inst)) continue;
      // A Greek hit shows its unit's English, once: under the first hit of the
      // unit. In the translation the reader narrowed to, else the reference
      // translation, which may borrow from the turn beside it in the section.
      if (inst.lang === 'grk' && !inst.rows && firstGrk.get(inst.unit!) === inst) {
        const ix = pairsOf(`${work}:${book}`, work);
        const ts = translationsOf(work);
        const ref = ts.find(t => t.slot === 'english') ?? ts[0];
        const chip = ts.find(t => t.id === transFilter);
        for (const [t, near] of [[chip, false], [ref, false], [ref, true]] as const) {
          const text = t ? pairEnglishText(unitEnglish(ix, inst.unit!, t.id, near)) : '';
          if (!t || !text) continue;
          inst.pairEnglish = {
            text, label: t.short, title: t.name,
            jumpUrl: jumpFor(work, book, inst.unit!.section, firstLine(inst.unit!), ts.length > 1 ? t.id : undefined),
          };
          break;
        }
      }
    }

    // The whole section of every hit, both sides at once: what "more" opens,
    // and under the whole-section context the instance itself, one for each
    // section and holding all its hits, so the Greek and the English widen
    // together (John, 2026-11-09: "Both, to the section").
    const placed = made.filter(m => !merged.has(m.inst));
    const bySection = new Map<string, { work: string; book: number; column: string; insts: Instance[] }>();
    for (const { work, book, inst } of placed) {
      const key = `${work}:${book}:${inst.column}`;
      (bySection.get(key) ?? bySection.set(key, { work, book, column: inst.column, insts: [] }).get(key)!).insts.push(inst);
    }
    for (const { work, book, column, insts } of bySection.values()) {
      const pair = `${work}:${book}`;
      const seg = books.get(pair)!.segments.find(x => x.column === column);
      if (!seg) continue;
      const ix = pairsOf(pair, work);
      const ts = translationsOf(work);
      const line = seg.greek[0]?.n ?? 1;
      const grks = insts.filter(inst => inst.lang === 'grk').sort((a, b) => a.at! - b.at!);
      const positions = grks.flatMap(inst => inst.toks ?? [inst.at!]).sort((a, b) => a - b);
      // Each translation that matched here, in the work's order, with every
      // word it matched here.
      const matched = new Map<string, number>();
      for (const row of insts.flatMap(inst => inst.rows ?? [])) matched.set(row.translation, (matched.get(row.translation) ?? 0) + row.hits);
      // A translation's text here is its pieces that lie in this section,
      // wherever the index filed them, in order.
      const sectionHtml = (t: TranslationRef) => books.get(pair)!.segments
        .flatMap(s => piecesOf(pair, ix, s, t).map((piece, k) => ({ ...piece, key: `${pair}:${t.id}:${s.id}:${k}` })))
        .filter(piece => piece.section === column)
        .map(piece => markWordsHtml(piece.text, held.get(piece.key) ?? new Set()).trim())
        .filter(Boolean).join(' ');
      const rows = ts.filter(t => matched.has(t.id)).map((t): TransRow => ({
        translation: t.id, label: t.short, title: t.name,
        html: sectionHtml(t),
        jumpUrl: jumpFor(work, book, column, line, ts.length > 1 ? t.id : undefined),
        hits: matched.get(t.id)!,
      }));
      // The section's English unmarked: as under a Greek hit, in the
      // translator chip in force, else the reference.
      let unmarked: SectionView['pair'];
      const ref = ts.find(t => t.slot === 'english') ?? ts[0];
      const chip = ts.find(t => t.id === transFilter);
      for (const t of [chip, ref]) {
        const text = t ? plainEnglish(sectionEnglish(ix, seg, t)).trim() : '';
        if (!t || !text) continue;
        unmarked = { text, label: t.short, title: t.name, jumpUrl: jumpFor(work, book, column, line, ts.length > 1 ? t.id : undefined) };
        break;
      }
      const heldOf = (list: Instance[]) => list.flatMap(inst => inst.held ?? []).sort((a, b) => a.pos - b.pos);
      const view: SectionView = { seg: seg.id, greek: sectionGreekHtml(work, seg, new Set(positions)), held: heldOf(grks), rows, pair: rows.length ? undefined : unmarked };
      for (const inst of insts) inst.whole = view;
      if (context !== 's') continue;
      // The section as one instance, holding the Greek hits `held` and
      // showing `whole`.
      const sectionInst = (held: Instance[], whole: SectionView): Instance => {
        const toks = held.flatMap(inst => inst.toks ?? [inst.at!]).sort((a, b) => a - b);
        return {
          lang: held.length ? 'grk' : 'eng', work, column, line, ref: formatCite(work, column),
          html: whole.greek, jumpUrl: toks.length ? jumpFor(work, book, column, line, undefined, toks) : whole.rows[0]?.jumpUrl ?? jumpFor(work, book, column, line),
          rows: whole.rows.length ? whole.rows : undefined, pairEnglish: whole.pair, whole, isSection: true,
          toks, grkHits: toks.length, seg: seg.id, at: toks[0] ?? 0, surface: held[0]?.surface, form: held[0]?.form,
          held: whole.held, speaker: speakersOf(whole.held),
        };
      };
      const inst = sectionInst(grks, view);
      // The form views file a section once for each form among its hits,
      // with that form's hits marked and counted, so no form is lost under
      // another's. The English goes on the first, so it is counted once; the
      // others show the section's English unmarked, as a Greek hit does.
      const byForm = new Map<string, Instance[]>();
      for (const g of grks) (byForm.get(g.form ?? '') ?? byForm.set(g.form ?? '', []).get(g.form ?? '')!).push(g);
      if (byForm.size > 1) {
        inst.forms = [...byForm.values()].map((held, k) => sectionInst(held, {
          seg: seg.id,
          greek: sectionGreekHtml(work, seg, new Set(held.flatMap(g => g.toks ?? [g.at!]))),
          held: heldOf(held),
          rows: k ? [] : rows,
          pair: k || !rows.length ? unmarked : undefined,
        }));
      }
      add(work, book, lookups.get(pair)!(column, line), inst);
    }
    if (context !== 's') {
      for (const { work, book, inst } of placed) add(work, book, lookups.get(`${work}:${book}`)!(inst.column, inst.line), inst);
    }

    for (const g of gmap.values()) g.instances.sort(bekkerCmp);
    const out = [...gmap.values()].sort((a, b) =>
      ((WORK_ORDER.get(a.work) ?? 0) - (WORK_ORDER.get(b.work) ?? 0)) || a.book - b.book || a.order - b.order);
    return { groups: out, failed: [...new Set(failed)], segs: segMap };
  }

  async function renderPage(i: number) {
    // The card is a word of the hits on screen: it goes with them.
    popup = null;
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
    if (pageSize === 'c') {
      groups = [];
      citeList = citationsFor(set[i] ?? [], searchCtx);
      pageLoading = false;
      return;
    }
    try {
      const { groups: g, failed, segs } = await buildGroups(set[i] ?? [], searchCtx, context);
      if (stale()) return;
      // Again here: a word of the old page may have been opened while this
      // one's books were loading.
      popup = null;
      groups = g;
      citeList = [];
      more = new Set();
      pageSegs = segs;
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
      document.querySelector('.sx-layout')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      xforms: [],
      lemmas: [...soloLemma.picked],
      combo: comboActive ? {
        slots: comboEditors.filter(ed => comboSlot(ed, comboOrdered)).map(ed => ({
          kind: ed.kind, relation: ed.relation, text: ed.text, picked: [...ed.picked], grammar: { ...ed.grammar },
        })),
        window: comboWindow, unit: comboUnit, ordered: comboOrdered, crossTurn: comboCrossTurn,
      } : null,
      speaker: speakerFilter ?? null,
      view,
      facets: {},
      context,
      sort,
      pageSize,
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
    view = s.view;
    context = s.context;
    sort = s.sort;
    pageSize = s.pageSize;
    speakerMode = s.speaker?.mode ?? 'anyone';
    speakerNames = new Set(s.speaker?.names ?? []);
    // A filter arriving in the address bar is shown, not hidden in a shut panel.
    if (s.speaker) speakerOpen = true;
  }

  // Runs whatever search the address bar holds; with none, clears the page.
  async function searchFromUrl() {
    popup = null;
    const s = decodeSearchUrl(window.location.search, WORK_IDS);
    applySearch(s);
    // The reactive comboActive / soloLemmaActive / speakerFilter that doSearch
    // reads must catch up with the controls just set.
    await tick();
    if (hasSearch(s)) {
      await doSearch(undefined, { history: 'none', trans: s.trans, work: s.workFilter, xforms: s.xforms, facets: s.facets });
      return;
    }
    searchRun++;
    lastSearch = null;
    searched = false;
    // The sheet refined results that are gone; left open, it would cover the
    // next search's.
    sheetOpen = false;
    loading = false;
    error = '';
    allResults = [];
    pages = [];
    groups = [];
    totalInstances = 0;
    transFilter = null;
    workFilter = null;
    hitForms = null;
    formsFailed = null;
    excludedForms = new Set();
    resetGrammar();
    facets = {};
    variantNote = '';
    variantsShown = false;
    variantBusy = false;
  }

  // The command palette hands off ?g= (Greek) / ?e= (English); those, and
  // any search this page wrote, are run on load.
  const onPopState = () => { searchFromUrl(); };
  // Widened past the sheet's breakpoint, the column is beside the hits again.
  const onWide = (e: MediaQueryListEvent) => { if (e.matches) sheetOpen = false; };
  let wideQuery: MediaQueryList | undefined;
  onMount(() => {
    window.addEventListener('popstate', onPopState);
    wideQuery = window.matchMedia?.('(min-width: 1100px)');
    wideQuery?.addEventListener?.('change', onWide);
    const s = decodeSearchUrl(window.location.search, WORK_IDS);
    if (hasSearch(s)) searchFromUrl();
  });
  onDestroy(() => {
    if (typeof window !== 'undefined') window.removeEventListener('popstate', onPopState);
    wideQuery?.removeEventListener?.('change', onWide);
    if (typeof document !== 'undefined') document.documentElement.style.overflow = '';
  });

  async function doSearch(e?: Event, opts: { history?: 'push' | 'none'; trans?: string | null; work?: string | null; xforms?: string[]; facets?: Facets } = {}) {
    e?.preventDefault();
    if (!grkQuery.trim() && !engQuery.trim() && !comboActive && !soloLemmaActive) return;
    popup = null;
    const run = ++searchRun;
    lastSearch = currentSearch();
    // A new search starts with every form in; one read from the address bar
    // keeps the forms it names.
    hitForms = null;
    formsFailed = null;
    formsMode = soloLemmaActive ? 'headword' : matchMode;
    excludedForms = new Set(opts.xforms ?? []);
    lastSearch.xforms = [...excludedForms];
    formListOpen = false;
    // Likewise no facet is ticked, in whatever view the reader is in.
    resetGrammar();
    facets = opts.facets ?? {};
    lastSearch.facets = facets;
    if ((opts.history ?? 'push') === 'push') writeUrl(lastSearch, 'push');
    loading = true;
    error = '';
    failedWorks = [];
    unsearched = [];
    unresolved = [];
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
        engUnits: comboActive ? [] : englishQueryUnits(engQuery),
        // A picked lemma is a fold key, not the reader's spelling, so there is
        // no typed accent pattern to post-filter against.
        // Beta Code is converted first: it arrives as typed from the address
        // bar, or from the box with the β toggle off.
        grkAccentTerms: !comboActive && !soloLemmaActive && accentSensitive
          ? grkQuery.trim().split(/\s+/).filter(Boolean).map(t => accentNorm(betaQueryToGreek(t)))
          : [],
        engPhrase: engMode === 'phrase',
        engForms,
        langOp,
        speaker: speakerFilter,
      };
      const { results, failedWorks: failed, approximateTurns: approximate, unsearchedTranslations, unresolvedTerms } = comboActive
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
      unresolved = unresolvedTerms ?? [];
      unsearched = (unsearchedTranslations ?? []).map(({ work, translation }) =>
        `${translationRef(work, translation)?.short ?? translation} (${getWork(work)?.title ?? work})`);
      // New results: whatever was read for the old ones goes with them, here
      // and not only when the search began, since a lookup for the old
      // results may have landed while this search was out.
      hitForms = null;
      formsFailed = null;
      resetGrammar();
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
      // The readings of the hits, for the grammar view or the facets. Like
      // the forms, the first page waits for them only if a facet is ticked.
      const grammar = view === 'grammar' || hasFacets(facets) ? needGrammar() : null;
      // The forms of a word search (a proximity search names no one word).
      // They come after the results unless some are set aside already, when
      // the first page must wait for them.
      if (searchCtx.grkQuery) {
        const forms = loadForms(results);
        if (excludedForms.size) await forms;
        if (run !== searchRun) return;
      }
      if (grammar && hasFacets(facets)) {
        await grammar;
        if (run !== searchRun) return;
      }
      await showResults(results);
    } catch (err) {
      if (run === searchRun) error = err instanceof Error ? err.message : String(err);
    } finally {
      if (run === searchRun) loading = false;
    }
  }

  // Greek keyword-in-context: a window of surface tokens around the match,
  // with the matched token(s) highlighted. Positions come from the index.
  // `reach` is the words shown either side (the Context control). With
  // `span`, a proximity window's first and last term, the passage runs from
  // `reach` words before the one to `reach` after the other, and the span is
  // shaded; every one of `positions` in the passage is marked.
  function greekKwic(work: string, seg: Segment, positions: number[], reach: number, span?: [number, number]): string {
    const n = segTokens(seg).length;
    if (!positions.length) return greekWords(work, seg, 0, Math.min(n, 2 * reach + 1), new Set());
    const [first, last] = span ?? [positions[0], positions[0]];
    return greekWords(work, seg, Math.max(0, first - reach), Math.min(n, last + reach + 1), new Set(positions), span);
  }

  // A segment's Greek tokens in the order the index counts them.
  const segTokens = (seg: Segment): Token[] => seg.greek.flatMap(line => line.tokens);

  // Every Greek word of a hit is a button that opens its card (WordPopup),
  // naming the token the one click handler on the results looks up.
  const wordButton = (work: string, seg: Segment, i: number, inner: string) =>
    `<button type="button" class="gw" data-w="${attr(work)}" data-s="${attr(seg.id)}" data-i="${i}">${inner}</button>`;

  // Tokens `from` to `to` (not included) of a segment as words, the `marked`
  // ones in <mark>, with "…" where the text is cut.
  function greekWords(work: string, seg: Segment, from: number, to: number, marked: Set<number>, span?: [number, number]): string {
    const toks = segTokens(seg);
    let html = '';
    for (let i = from; i < to; i++) {
      const w = esc(toks[i].t);
      if (i > from) html += ' ';
      if (i === span?.[0]) html += '<span class="prox">';
      html += wordButton(work, seg, i, marked.has(i) ? `<mark>${w}</mark>` : w);
      if (i === span?.[1]) html += '</span>';
    }
    if (from > 0) html = '… ' + html;
    if (to < toks.length) html += ' …';
    return html;
  }

  // A whole section's Greek as the page has it: every line, punctuation kept,
  // each word a button, the `marked` ones in <mark>. A window of words reads
  // well enough without its stops; a whole section does not.
  function sectionGreekHtml(work: string, seg: Segment, marked: Set<number>): string {
    const index = new Map<Token, number>();
    segTokens(seg).forEach((tok, i) => index.set(tok, i));
    return joinLines(seg.greek.map(line => lineRenderParts(line.text, line.tokens).map(part => {
      if (part.kind === 'text') return esc(part.text);
      if (part.kind !== 'token') return '';
      const i = index.get(part.tok)!;
      const w = esc(part.text);
      return wordButton(work, seg, i, marked.has(i) ? `<mark>${w}</mark>` : w);
    }).join('').trim()).filter(Boolean));
  }

  // Printed lines as running text: joined by a space, except where a line
  // opens with the stop that belongs to the last word of the line before it;
  // then each word held to its stops (keepStops).
  const joinLines = (lines: string[]) =>
    keepStops(lines.reduce((html, line) => html + (html && !/^[,.;:·!?)\]’]/.test(line) ? ' ' : '') + line, ''));

  // A word button is a box, and a line may break at a box's edge, which would
  // send a comma to the head of the next line on its own. Each word is held
  // together with the stops and brackets written against it.
  const WORD_AND_STOPS = /([^\s<>]*)(<button type="button" class="gw"[^>]*>(?:<mark>)?[^<]*(?:<\/mark>)?<\/button>)([^\s<]*)/g;
  const keepStops = (html: string) => html.replace(WORD_AND_STOPS,
    (all, before: string, word: string, after: string) => (before || after ? `<span class="nb">${all}</span>` : all));

  // The Greek printed under an English hit: the unit's first PAIR_GREEK_LINES
  // lines as pairGreekText cuts them, punctuation kept, each word a button.
  function pairGreekHtml(work: string, seg: Segment, unit: PairUnit): string {
    const index = new Map<Token, number>();
    segTokens(seg).forEach((tok, i) => index.set(tok, i));
    const spans = unit.greek.filter(span => span.text);
    const lines = spans.slice(0, PAIR_GREEK_LINES).map(span => {
      const line = seg.greek.find(l => l.n === span.n);
      if (!line) return esc(span.text);
      const toks = line.tokens.filter(tok => tok.o >= span.from && tok.o < span.to);
      return lineRenderParts(line.text.slice(span.from, span.to), toks)
        .map(part => part.kind === 'token' ? wordButton(work, seg, index.get(part.tok)!, esc(part.text))
          : part.kind === 'text' ? esc(part.text) : '')
        .join('').trim();
    });
    return joinLines(lines) + (spans.length > PAIR_GREEK_LINES ? ' …' : '');
  }

  // ── The word card ──────────────────────────────────────────────────────────
  // One WordPopup for the page, as the reader mounts it; it loads the work's
  // analyses itself on first use. The page's segments are kept so a click can
  // hand it the book's own token.
  let pageSegs = new Map<string, Segment>();   // work:segment id
  let popup: { work: string; token: Token; anchor: { x: number; y: number } } | null = null;
  // One listener on the results, not one per word.
  function wordClicks(node: HTMLElement) {
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('button.gw');
      if (!el) return;
      const { w, s: id, i } = el.dataset;
      const seg = pageSegs.get(`${w}:${id}`);
      const token = seg ? segTokens(seg)[Number(i)] : undefined;
      if (!w || !token) return;
      const rect = el.getBoundingClientRect();
      popup = { work: w, token, anchor: { x: rect.left, y: rect.bottom } };
    };
    node.addEventListener('click', onClick);
    return { destroy: () => node.removeEventListener('click', onClick) };
  }

  function esc(s: string): string {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  const attr = (s: string) => esc(s).replace(/"/g, '&quot;');

  // Bekker order within a chapter: page number, then column half (a < b), then
  // line. Sorting by line alone mis-orders hits that span two columns of one
  // chapter (e.g. 1097b3 before 1097a15). Works for grk and eng instances alike.
  function bekkerCmp(a: Instance, b: Instance): number {
    const pa = parseInt(a.column, 10) || 0;
    const pb = parseInt(b.column, 10) || 0;
    if (pa !== pb) return pa - pb;
    const ha = a.column.slice(-1), hb = b.column.slice(-1);
    if (ha !== hb) return ha < hb ? -1 : 1;
    return a.line - b.line || (a.at ?? 0) - (b.at ?? 0);
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
      // A row per hit, whatever the page shows.
      const { groups: allGroups, failed } = await buildGroups(shownResults, searchCtx, '3');
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
          // A Greek hit, then one row per translation: each is its own hit,
          // in its own words. An instance may hold both.
          if (inst.lang === 'grk' || !inst.rows) {
            rows.push([
              workTitle, String(book), g.chapter, inst.ref,
              inst.lang === 'grk' ? 'Greek' : 'English',
              inst.speaker ?? '', '',
              origin + inst.jumpUrl,
              stripHtml(inst.html),
            ]);
          }
          for (const row of inst.rows ?? []) {
            const t = translationRef(g.work, row.translation);
            rows.push([
              workTitle, String(book), g.chapter, inst.ref, 'English', '',
              t?.short ?? row.translation, origin + row.jumpUrl, stripHtml(row.html),
            ]);
          }
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

  // ── The field: Greek, English or Both ───────────────────────────────────────
  //
  // One field searches one language; Both shows the second. Switching empties
  // the box that goes out of view, so a hidden box never searches, and a query
  // that arrives in a hidden box (a URL, a step back) brings it into view.
  type Lang = 'greek' | 'english' | 'both';
  const LANGS: { v: Lang; l: string }[] = [
    { v: 'greek', l: 'Greek' },
    { v: 'english', l: 'English' },
    { v: 'both', l: 'Both' },
  ];
  let lang: Lang = 'greek';
  function setLang(next: Lang) {
    if (next === 'greek') engQuery = '';
    if (next === 'english') grkQuery = '';
    lang = next;
  }
  $: if (engQuery.trim() && lang === 'greek') lang = grkQuery.trim() ? 'both' : 'english';
  $: if (grkQuery.trim() && lang === 'english') lang = engQuery.trim() ? 'both' : 'greek';

  // "β Beta Code": with the toggle on, the Greek box turns Beta Code into
  // Greek as you type (lo/gos → λόγος), caret kept. Off on every visit: a
  // toggle that outlived the visit would quietly turn the next query Greek.
  // Greek and Both only: it converts the Greek field alone, never the English
  // one, and the English tab hides it.
  let betaMode = false;
  let grkInput: HTMLInputElement;

  function toggleBeta() {
    betaMode = !betaMode;
    if (betaMode && lang !== 'english' && grkQuery) grkQuery = liveGreek(grkQuery);
    grkInput?.focus();
  }

  // An IME or a phone keyboard that composes whole words (Gboard) is
  // converted when the word is committed, never mid-composition; an undo or
  // redo is left as it restores.
  function onGreekInput(e: Event) {
    const ie = e as InputEvent;
    if (ie.isComposing || ie.inputType === 'historyUndo' || ie.inputType === 'historyRedo') return;
    convertGreekBox(e.currentTarget as HTMLInputElement);
  }

  function convertGreekBox(el: HTMLInputElement) {
    if (!betaMode || lang === 'english') return;
    const raw = el.value;
    const converted = liveGreek(raw);
    if (converted === raw) return;
    let caret = liveGreek(raw.slice(0, el.selectionStart ?? raw.length)).length;
    // A mark typed after the caret joins the letter before it; where the two
    // do not precompose, step past the mark rather than split them.
    while (caret < converted.length && /\p{M}/u.test(converted[caret])) caret++;
    el.value = converted;
    grkQuery = converted;
    el.setSelectionRange(caret, caret);
  }

  // The menus read "Match all words ▾", "In all works ▾".
  const modeLabel = (m: SearchMode) => MODE_OPTS.find((o) => o.v === m)?.l ?? m;
  const lower1 = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

  // The option menus are <details>: one open at a time, closed by a click
  // elsewhere or by Escape, which hands focus back to the menu's own button.
  function closeOtherOpts(e: Event) {
    const el = e.currentTarget as HTMLDetailsElement;
    if (!el.open) return;
    for (const m of document.querySelectorAll<HTMLDetailsElement>('.sopt .opt[open]')) if (m !== el) m.open = false;
  }
  function onWindowClick(e: MouseEvent) {
    for (const m of document.querySelectorAll<HTMLDetailsElement>('.sopt .opt[open]')) {
      if (!m.contains(e.target as Node)) m.open = false;
    }
  }
  function onWindowKey(e: KeyboardEvent) {
    onSheetKey(e);
    onHelpKey(e);
    if (e.key !== 'Escape') return;
    const m = document.querySelector<HTMLDetailsElement>('.sopt .opt[open]');
    if (!m) return;
    m.open = false;
    m.querySelector('summary')?.focus();
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


<svelte:window on:keydown={onWindowKey} on:click={onWindowClick} on:beforeprint={openForPrint} on:afterprint={closeAfterPrint} />

<main class="search-page">
  <form class="search-form" on:submit={doSearch} novalidate>

    <!-- One field and the switch for what it searches: Greek, English, or Both
         (two fields). The box out of view is kept empty (setLang), and a URL or
         a step back that fills it brings it into view. -->
    <div class="sq">
      <div class="sq-row" hidden={lang === 'english'}>
        <svg class="sq-glass" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>
        <label class="query-label" class:sr-only={lang !== 'both'} for="grk-input">Greek</label>
        <input
          id="grk-input"
          class="query-input greek-input"
          lang="grc"
          type="search"
          placeholder="τέχνη or texnh, fronhsis*, …"
          bind:value={grkQuery}
          bind:this={grkInput}
          on:input={onGreekInput}
          on:compositionend={(e) => convertGreekBox(e.currentTarget as HTMLInputElement)}
          on:keydown={onEnter}
          autocomplete="off"
          autocorrect="off"
          autocapitalize="none"
          spellcheck="false"
          disabled={comboActive || soloLemmaActive}
        />
      </div>
      <div class="sq-row" hidden={lang === 'greek'}>
        <svg class="sq-glass" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>
        <label class="query-label" class:sr-only={lang !== 'both'} for="eng-input">English</label>
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
      <div class="lang-switch" role="group" aria-label="Search in">
        {#each LANGS as l}
          <button type="button" aria-pressed={lang === l.v} on:click={() => setLang(l.v)}>{l.l}</button>
        {/each}
        {#if lang !== 'english'}
          <button type="button" class="tog" aria-pressed={betaMode} on:click={toggleBeta} title="Type Beta Code, see Greek: lo/gos becomes λόγος as you type"><span lang="grc">β</span> Beta Code</button>
        {/if}
      </div>
    </div>

    <!-- The options, as one line of menus: text on a dotted underline. -->
    <div class="sopt">
      {#if lang !== 'english'}
        <details class="opt" on:toggle={closeOtherOpts}>
          <summary>{lang === 'both' ? 'Greek match' : 'Match'} <b>{lower1(modeLabel(grkMode))}<svg class="opt-caret" width="8" height="5" viewBox="0 0 10 6" aria-hidden="true" fill="currentColor"><path d="M0 0l5 6 5-6z"/></svg></b></summary>
          <fieldset class="opt-panel">
            <legend class="sr-only">Greek match</legend>
            {#each MODE_OPTS as opt}
              <label class="ck"><input type="radio" name="grkmode" value={opt.v} bind:group={grkMode} /><span>{opt.l}</span></label>
            {/each}
          </fieldset>
        </details>
        <details class="opt" on:toggle={closeOtherOpts}>
          <summary>{lang === 'both' ? 'Greek form' : 'Form'} <b>{matchMode === 'lemma' ? 'any form' : 'as typed'}<svg class="opt-caret" width="8" height="5" viewBox="0 0 10 6" aria-hidden="true" fill="currentColor"><path d="M0 0l5 6 5-6z"/></svg></b></summary>
          <fieldset class="opt-panel" title="Any form: type the word as it stands on the page and every form of it is found. Only as I typed it: the spelling you gave, and no other.">
            <legend class="sr-only">Greek form</legend>
            <label class="ck"><input type="radio" name="matchmode" value="lemma" bind:group={matchMode} /><span>Any form of this word</span></label>
            <label class="ck"><input type="radio" name="matchmode" value="form" bind:group={matchMode} /><span>Only as I typed it</span></label>
          </fieldset>
        </details>
        <details class="opt" on:toggle={closeOtherOpts}>
          <summary>Accents <b>{accentSensitive ? 'exact' : 'ignored'}<svg class="opt-caret" width="8" height="5" viewBox="0 0 10 6" aria-hidden="true" fill="currentColor"><path d="M0 0l5 6 5-6z"/></svg></b></summary>
          <fieldset class="opt-panel" title="Match diacritics exactly: λόγος and λογός become different queries. A query typed without accents then only matches unaccented tokens.">
            <legend class="sr-only">Accents</legend>
            <label class="ck"><input type="checkbox" bind:checked={accentSensitive} /><span>Match accents exactly</span></label>
          </fieldset>
        </details>
      {/if}
      {#if lang !== 'greek'}
        <details class="opt" on:toggle={closeOtherOpts}>
          <summary>{lang === 'both' ? 'English match' : 'Match'} <b>{lower1(modeLabel(engMode))}<svg class="opt-caret" width="8" height="5" viewBox="0 0 10 6" aria-hidden="true" fill="currentColor"><path d="M0 0l5 6 5-6z"/></svg></b></summary>
          <fieldset class="opt-panel">
            <legend class="sr-only">English match</legend>
            {#each MODE_OPTS as opt}
              <label class="ck"><input type="radio" name="engmode" value={opt.v} bind:group={engMode} /><span>{opt.l}</span></label>
            {/each}
          </fieldset>
        </details>
        <details class="opt" on:toggle={closeOtherOpts}>
          <summary>{lang === 'both' ? 'English form' : 'Form'} <b>{engForms ? 'any form' : 'as typed'}<svg class="opt-caret" width="8" height="5" viewBox="0 0 10 6" aria-hidden="true" fill="currentColor"><path d="M0 0l5 6 5-6z"/></svg></b></summary>
          <fieldset class="opt-panel" title="Any form: virtue also finds virtues and virtue’s, man finds men. Only as I typed it: the spelling you gave, and no other.">
            <legend class="sr-only">English form</legend>
            <label class="ck"><input type="radio" name="engforms" value={true} bind:group={engForms} /><span>Any form of this word</span></label>
            <label class="ck"><input type="radio" name="engforms" value={false} bind:group={engForms} /><span>Only as I typed it</span></label>
          </fieldset>
        </details>
      {/if}
      <!-- A picked headword is the Greek side too, with the Greek box empty. -->
      {#if lang === 'both' || (soloLemmaActive && engQuery.trim())}
        <details class="opt" on:toggle={closeOtherOpts}>
          <summary>Combine <b>{langOp === 'and' ? 'both queries' : 'either query'}<svg class="opt-caret" width="8" height="5" viewBox="0 0 10 6" aria-hidden="true" fill="currentColor"><path d="M0 0l5 6 5-6z"/></svg></b></summary>
          <fieldset class="opt-panel op-group">
            <legend class="sr-only">Greek + English</legend>
            <label class="ck" title="Only passages matching both queries"><input type="radio" name="op" value="and" bind:group={langOp} /><span>Both queries</span></label>
            <label class="ck" title="Passages matching either query"><input type="radio" name="op" value="or" bind:group={langOp} /><span>Either query</span></label>
          </fieldset>
        </details>
      {/if}
      <button
        type="button"
        class="works-trigger opt-btn"
        aria-expanded={worksOpen}
        aria-controls="works-panel"
        on:click={() => { worksOpen = !worksOpen; if (worksOpen) speakerOpen = false; }}
      >In <b>{lower1(worksSummary)}<svg class="opt-caret" width="8" height="5" viewBox="0 0 10 6" aria-hidden="true" fill="currentColor"><path d="M0 0l5 6 5-6z"/></svg></b></button>
      <button
        type="button"
        class="works-trigger opt-btn"
        aria-expanded={speakerOpen}
        aria-controls="speaker-panel"
        on:click={() => { speakerOpen = !speakerOpen; if (speakerOpen) worksOpen = false; }}
      >Spoken by <b>{lower1(speakerSummary)}<svg class="opt-caret" width="8" height="5" viewBox="0 0 10 6" aria-hidden="true" fill="currentColor"><path d="M0 0l5 6 5-6z"/></svg></b></button>
      <button
        type="button"
        class="advanced-trigger"
        aria-expanded={advancedOpen}
        aria-controls="advanced-tools"
        on:click={toggleAdvanced}
      >Advanced<span class="sr-only"> search</span> <span aria-hidden="true">{advancedOpen ? '▴' : '▾'}</span></button>
      <button type="submit" class="search-btn" disabled={loading}>
        {loading ? 'Searching…' : 'Search'}
      </button>
    </div>

    <p class="sx-hint">
      <code>*</code> any letters, inside or at the end of a word · <code>?</code> one letter ·
      Greek or <button type="button" class="link-btn" on:click={openHelp} aria-haspopup="dialog" title="How to type Greek">Beta Code</button>
      (<code>texnh</code> = <span lang="grc">τέχνη</span>) ·
      <a class="guide-link" href={`${BASE_URL}/advanced#wildcards`} target="_blank" rel="noreferrer">How search works</a>
    </p>

    {#if advancedOpen}
      <div id="advanced-tools" class="advanced-body">
        <p class="advanced-guide"><a class="guide-link" href={`${BASE_URL}/advanced`} target="_blank" rel="noreferrer">What these tools do</a></p>
          <details class="lemma-panel" bind:open={soloPanelOpen}>
            <summary>
              <span class="n" aria-hidden="true">Α</span>
              <span class="t">Single lemma</span> <span class="d">every form of one dictionary word</span>
              {#if soloLemmaActive}<span class="combo-active">{soloLemma.picked.length} picked</span>{/if}
              <span class="tog" aria-hidden="true">{soloPanelOpen ? 'Close ▴' : 'Open ▾'}</span>
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
              <span class="n" aria-hidden="true">Β</span>
              <span class="t">Words near each other</span>
              {#if comboActive}<span class="combo-active">{comboSearchSlots.length} terms ready</span>{/if}
              <span class="tog" aria-hidden="true">{comboPanelOpen ? 'Close ▴' : 'Open ▾'}</span>
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

    <div id="works-panel" class="works-panel" role="group" aria-label="Works to search" hidden={!worksOpen}>
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

    <div id="speaker-panel" class="works-panel speaker-panel" role="group" aria-label="Spoken by" hidden={!speakerOpen}>
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
                {#if approxRosterWorks.length}
                  Where a speech begins in {listNames(approxRosterWorks)} is recorded to the line rather
                  than the word, so a match at the very edge of a speech may belong to the one beside it.
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

        <h3>Wildcards</h3>
        <p class="help-sub">
          <code>*</code> matches any run of characters; <code>?</code> matches exactly one letter.
          Use either inside or at the end of a word. In English a <code>*</code> may also start a
          word (<code>*ness</code>); in Greek it marks a Beta Code capital there, so Greek has no
          suffix wildcard.
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
    <!-- The controls of the results in one place: a column beside the hits on
         a wide screen, held under the site header; on a narrow one a sheet
         opened by Refine (John, 2026-11-09: "Controls + summary"). -->
    <div class="sx-layout">
      <div class="sx-side">
        <div class="result-bar">
          <p class="result-count">{countText}</p>
          <button type="button" class="sx-refine" bind:this={refineBtn} aria-haspopup="dialog" aria-expanded={sheetOpen}
            on:click={openSheet}>Refine{chosen.length ? ` · ${chosen.length}` : ''}</button>
        </div>
        {#if sheetOpen}
          <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
          <div class="sx-scrim" on:click={closeSheet}></div>
        {/if}
        <aside class="sx-panel" class:open={sheetOpen} bind:this={sheetEl} aria-label="Refine results" tabindex="-1"
          role={sheetOpen ? 'dialog' : undefined} aria-modal={sheetOpen ? 'true' : undefined}>
          {#if sheetOpen}
            <div class="sx-sheet-head">
              <span class="k">Refine</span>
              <button type="button" class="sx-close" on:click={closeSheet}>Close</button>
            </div>
          {/if}
          <!-- What narrows or changes the results, each undone by its ×. -->
          <div class="sx-sum" role="group" aria-labelledby="sx-sum-k" tabindex="-1" bind:this={sumEl}>
            <span class="k" id="sx-sum-k">This search</span>
            {#if chosen.length}
              <ul>
                {#each chosen as c (c.key)}
                  <li>
                    <span>{c.label}</span>
                    <button type="button" class="x" aria-label={`Remove ${c.label}`} on:click={() => removeChosen(c)}>×</button>
                  </li>
                {/each}
              </ul>
              {#if chosen.length > 1}
                <button type="button" class="sx-clear" on:click={clearChosen}>Clear all</button>
              {/if}
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
          <!-- What the Greek result is made of. A tick box each; Apply drops the
               unticked forms from the hits and from every count above. -->
          {#if formChoice}
            <div class="sx-row sx-forms" role="group" aria-label="Greek forms found">
              <span class="k">Forms</span>
              {#each formPanel as group}
                <span class="fx-group">
                  {#if group.headword}<span class="fx-head" lang="grc">{headLabel(group.headword, pickInfo)}</span>{/if}
                  {#each group.forms as f, i}
                    {#if i < FORM_CHIPS || formListOpen || !formTicks.has(f.form)}
                      <label class="fx">
                        <input type="checkbox" checked={formTicks.has(f.form)} on:change={() => toggleFormTick(f.form)} />
                        <span lang="grc">{betaToGreek(f.form)}</span> <small>{f.count}</small>
                      </label>
                    {/if}
                  {/each}
                </span>
              {/each}
              {#if formPanel.some(g => g.forms.length > FORM_CHIPS)}
                <button type="button" class="more" aria-expanded={formListOpen}
                  on:click={() => (formListOpen = !formListOpen)}>
                  {formListOpen ? 'fewer' : `${formPanel.reduce((n, g) => n + Math.max(0, g.forms.length - FORM_CHIPS), 0)} more`}
                </button>
              {/if}
              <button type="button" class="more" on:click={toggleAllForms}>
                {formKeys.some(f => formTicks.has(f)) ? 'Deselect all' : 'Select all'}
              </button>
              <button type="button" class="more fx-apply" on:click={applyForms}
                disabled={!formsDirty || !formKeys.some(f => formTicks.has(f))}>Apply</button>
            </div>
          {/if}
          <!-- How the hits are grouped: the same hits each way. A list of
               citations has nothing to group, order or widen. -->
          {#if totalInstances > 0 && pageSize !== 'c'}
            <div class="sx-row sx-views" role="group" aria-label="Group the hits">
              <span class="k">Group by</span>
              {#each VIEWS as v}
                <button type="button" class="i" class:on={view === v.id} aria-pressed={view === v.id}
                  on:click={() => setView(v.id)}>{v.label}</button>
              {/each}
            </div>
            <div class="sx-row sx-views" role="group" aria-label="Sort">
              <span class="k">Sort</span>
              {#each SORTS as so}
                <button type="button" class="i" class:on={sort === so.id} aria-pressed={sort === so.id}
                  on:click={() => setSort(so.id)}>{so.label}</button>
              {/each}
            </div>
            <div class="sx-row sx-views sx-inline" role="group" aria-label="Context">
              <span class="k">Context</span>
              {#each CONTEXTS as c}
                <button type="button" class="i" class:on={context === c.id} aria-pressed={context === c.id}
                  on:click={() => setContext(c.id)}>{c.label}</button>
              {/each}
            </div>
          {/if}
          {#if totalInstances > 0}
            <div class="sx-row sx-views sx-inline" role="group" aria-label="Hits per page">
              <span class="k">Per page</span>
              {#each PAGE_CHOICES as ps}
                <button type="button" class="i" class:on={pageSize === ps.id} aria-pressed={pageSize === ps.id}
                  on:click={() => setPageSize(ps.id)}>{ps.label}</button>
              {/each}
            </div>
          {/if}
          <!-- The readings present among the Greek hits, a tick box each, applied
               as ticked. Shown in the grammar view, and wherever one is ticked. -->
          {#if facetRows.length && (view === 'grammar' || hasFacets(facets))}
            <div class="sx-row sx-facets" role="group" aria-label="Narrow by grammar">
              <span class="k">Grammar</span>
              {#each facetRows as fc}
                <span class="gx-group">
                  <span class="gx-head">{categoryLabel(fc.category)}</span>
                  {#each fc.values as v}
                    <label class="fx">
                      <input type="checkbox" checked={facets[fc.category]?.includes(v.value) ?? false}
                        aria-label={`${categoryLabel(fc.category)} ${v.value}`}
                        on:change={() => toggleFacet(fc.category, v.value)} />
                      <span>{v.value}</span> <small>{v.count}</small>
                    </label>
                  {/each}
                </span>
              {/each}
            </div>
          {/if}
          {#if (canWiden && !variantsShown) || totalInstances > 0}
            <div class="sx-tools">
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
          {/if}
        </aside>
      </div>
      <div class="sx-main">
        {#if failedWorks.length || formsFailed || grammarFailed || unsearched.length || unresolved.length || approximateTurns.length}
          <!-- Notices are rows: what kind, what happened, and what to do. -->
          <div class="sx-notes">
            {#if failedWorks.length}
              <div class="sx-note warn" role="alert">
                <span class="k">Warning</span>
                <span>{failedWorks.length === 1 ? 'The index for' : 'The indexes for'} {failedWorks.map((w) => getWork(w)?.title ?? w).join(', ')} did not load, so {failedWorks.length === 1 ? 'its' : 'their'} results are missing and the counts below may be short.</span>
                <button type="button" class="a" on:click={doSearch}>Try again</button>
              </div>
            {/if}
            {#if formsFailed}
              <div class="sx-note warn" role="alert">
                <span class="k">Warning</span>
                <span>{formsFailed === true
                  ? 'The list of forms did not load'
                  : `The forms in ${formsFailed.map((w) => getWork(w)?.title ?? w).join(', ')} did not load`}{!excludedForms.size ? '.'
                    : formsFailed === true ? ', so the forms set aside are still among the hits.'
                    : `, so forms set aside may still be among ${formsFailed.length === 1 ? 'its' : 'their'} hits.`}</span>
                <button type="button" class="a" on:click={retryForms}>Try again</button>
              </div>
            {/if}
            {#if grammarFailed}
              <div class="sx-note warn" role="alert">
                <span class="k">Warning</span>
                <span>{grammarFailed === true
                  ? 'The grammar of this result did not load'
                  : `The grammar in ${grammarFailed.map((w) => getWork(w)?.title ?? w).join(', ')} did not load`}{hasFacets(facets) ? ', so the hits are not narrowed.' : '.'}</span>
                <button type="button" class="a" on:click={retryGrammar}>Try again</button>
              </div>
            {/if}
            {#if unsearched.length}
              <div class="sx-note warn" role="alert">
                <span class="k">Warning</span>
                <span>English was not searched in {unsearched.join(', ')}: {unsearched.length === 1 ? 'its index' : 'their indexes'} did not load.</span>
                <button type="button" class="a" on:click={doSearch}>Try again</button>
              </div>
            {/if}
            {#if unresolved.length}
              <div class="sx-note warn" role="alert">
                <span class="k">Warning</span>
                <span>The list of dictionary forms did not load, so {unresolved.join(', ')} {unresolved.length === 1 ? 'was' : 'were'} searched only as typed, not in every form: results may be missing.</span>
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

        {#if pageSize === 'c'}
          <div class="sx-results">
            {#each citeList as cg (cg.key)}
              <section class="book-section cite-group">
                <h2 class="book-header">
                  <span class="work-name">{getWork(cg.work)?.title ?? cg.work}</span>
                  {#if (getWork(cg.work)?.bookLabels.length ?? 0) > 1}
                    <span class="book-name">Book {getWork(cg.work)?.bookLabels[cg.book - 1] ?? cg.book}</span>
                  {/if}
                </h2>
                <p class="cite-list">
                  {#each cg.cites as c}
                    <a class="cite" href={c.href} target="_blank" rel="noopener" title="Open in reader (new tab)">{c.ref}{#if c.n > 1}{' '}<small>×{c.n}</small>{/if}</a>
                  {/each}
                </p>
              </section>
            {/each}
          </div>
        {/if}
        <div class="sx-results" use:wordClicks>
        {#each viewSections as sec (sec.key)}
          <section class="book-section">
            {#if sec.work}
              <h2 class="book-header">
                <span class="work-name">{getWork(sec.work)?.title ?? sec.work}</span>
                {#if sec.book !== undefined}
                  <span class="book-name">Book {getWork(sec.work)?.bookLabels[sec.book - 1] ?? sec.book}</span>
                {/if}
              </h2>
            {/if}

            {#each sec.groups as g (g.key)}
              <div class="chapter-group">
                <button class="group-head" on:click={() => toggle(g.key)} aria-expanded={expanded.has(g.key)}>
                  <span class="caret">{expanded.has(g.key) ? '▾' : '▸'}</span>
                  <span class="group-label" class:grc={g.greek} lang={g.greek ? 'grc' : undefined}>{g.label}</span>
                  {#if g.bekker}<span class="group-bekker">{g.bekker}</span>{/if}
                  {#if view === 'grammar' && g.greek}<span class="group-readings">{groupReadings(g, grammarAt)}</span>{/if}
                  <span class="group-count">{groupHits(g)} {groupHits(g) === 1 ? 'instance' : 'instances'}</span>
                </button>

                {#if expanded.has(g.key)}
                  <ul class="instance-list">
                    {#each g.instances as inst}
                      {@const oneOf = noteOf(inst, grammarAt, facets, more.has(inst))}
                      {@const whole = inst.isSection || more.has(inst) ? inst.whole : undefined}
                      <li class="instance">
                        <a class="inst-ref" href={inst.jumpUrl} target="_blank" rel="noopener" title="Open in reader (new tab)">{citeText(inst, view)}</a>
                        <div class="inst-body">
                          {#if whole}
                            <!-- The whole section, Greek and English together. -->
                            <span class="inst-snippet greek" lang="grc">
                              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                              {@html whole.greek}
                            </span>
                            {#if whole.rows.length}
                              <div class="sx-tr">
                                {#each whole.rows as row}
                                  <div>
                                    <a class="lab" href={row.jumpUrl} target="_blank" rel="noopener" title={`Open in ${row.title} (new tab)`}>{row.label}</a>
                                    <span class="inst-snippet" lang="en">
                                      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                                      {@html row.html}
                                    </span>
                                  </div>
                                {/each}
                              </div>
                            {:else if whole.pair}
                              <div class="inst-pair" lang="en">
                                <a class="lab" href={whole.pair.jumpUrl} target="_blank" rel="noopener" title={`Open in ${whole.pair.title} (new tab)`}>{whole.pair.label}</a>
                                <span class="inst-pair-text">{whole.pair.text}</span>
                              </div>
                            {/if}
                          {:else}
                          {#if inst.lang === 'grk' || !inst.rows}
                            <span class="inst-snippet" class:greek={inst.lang === 'grk'} lang={inst.lang === 'grk' ? 'grc' : 'en'}>
                              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                              {@html inst.html}
                            </span>
                          {/if}
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
                          {/if}
                          <!-- The other language's side of the same aligned unit. -->
                          {#if inst.pairEnglish}
                            <div class="inst-pair" lang="en">
                              <a class="lab" href={inst.pairEnglish.jumpUrl} target="_blank" rel="noopener" title={`Open in ${inst.pairEnglish.title} (new tab)`}>{inst.pairEnglish.label}</a>
                              <span class="inst-pair-text">{inst.pairEnglish.text}</span>
                            </div>
                          {:else if inst.pairGreek}
                            <div class="inst-pair greek" lang="grc">
                              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                              {@html inst.pairGreek}
                            </div>
                          {/if}
                          {/if}
                          {#if !inst.isSection && inst.whole}
                            <button type="button" class="inst-more" aria-expanded={more.has(inst)}
                              on:click={() => toggleMore(inst)}>{more.has(inst) ? 'less' : 'more'}</button>
                          {/if}
                        </div>
                        {#if inst.speaker}
                          <span class="inst-speaker">{inst.speaker}</span>
                        {/if}
                        {#if oneOf}
                          <span class="inst-oneof" title="The morphological analysis allows more than one reading of this form">{oneOf}</span>
                        {/if}
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            {/each}
          </section>
        {/each}
        </div>

        {#if pages.length > 1}
          <nav class="pager pager-bottom" aria-label="Result pages">
            <button type="button" class="pager-btn" on:click={() => goPage(pageIdx - 1)} disabled={pageIdx === 0 || pageLoading}>‹ Prev</button>
            <span class="pager-status">{pageLoading ? 'Loading…' : `Page ${pageIdx + 1} of ${pages.length}`}</span>
            <button type="button" class="pager-btn" on:click={() => goPage(pageIdx + 1)} disabled={pageIdx >= pages.length - 1 || pageLoading}>Next ›</button>
          </nav>
        {/if}
      </div>
    </div>
  {/if}
</main>

{#if popup}
  <WordPopup work={popup.work} token={popup.token} anchor={popup.anchor} onClose={() => (popup = null)} />
{/if}
<style>
  /* The search page in the chosen design and the "Search features" tab of the
     mockups: one underlined field with the Greek / English / Both switch, one
     line of menus on dotted underlines, then the Advanced sections, the Works
     and Spoken-by panels, and the results on ruled rows. House rules: square
     corners, rules not boxes, Gentium for everything read, Geologica Light only
     in capitals, colour from the tokens, the highlight #d9e2f4 for search marks. */
  .search-page {
    max-width: 80rem;
    margin: 0 auto;
    padding: 3rem 3.5rem 3rem;
    font-family: var(--font-english);
    color: var(--text);
  }

  /* ── The field ──────────────────────────────────────────────────────────── */
  .sq {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.75rem 1.5rem;
  }
  .sq-row {
    grid-column: 1;
    display: flex;
    align-items: center;
    gap: 1rem;
    height: 4rem;
    border-bottom: 2px solid var(--text);
    color: var(--text-mid);
  }
  .sq-row[hidden] { display: none; }
  .sq-row:focus-within { border-bottom-color: var(--accent); }
  .sq-glass { flex: none; }
  .query-label {
    flex: none;
    width: 4.5rem;
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.6875rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-mid);
  }
  .query-input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: none;
    border-radius: 0;
    background: none;
    font-family: var(--font-greek);
    font-size: 1.875rem;
    color: var(--text);
  }
  .query-input::placeholder { color: var(--text-mid); opacity: 1; }
  .query-input:focus { outline: none; }
  .query-input:disabled { opacity: 0.5; }
  /* Greek · English · Both: capitals, a 2px underline under the current one. */
  .lang-switch { grid-column: 2; grid-row: 1; display: flex; gap: 0.875rem; }
  .lang-switch button {
    padding: 0 0 0.1875rem;
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    background: none;
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.75rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-mid);
    cursor: pointer;
  }
  .lang-switch button:hover { color: var(--accent); }
  .lang-switch [aria-pressed="true"] { color: var(--text); border-bottom-color: var(--text); }
  /* Same face as the language tabs. β stays in the Greek face; the label does not wrap. */
  .lang-switch .tog { white-space: nowrap; }
  /* The tabs are set in capitals; β must stay lower case, or it reads as a Latin B. */
  .lang-switch .tog span { font-family: var(--font-greek); text-transform: none; letter-spacing: 0; }

  /* ── The options line ───────────────────────────────────────────────────── */
  /* Menus read as text on a dotted underline; their panels open under the line,
     from its left edge, never wider than it. */
  .sopt {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.75rem 1.75rem;
    margin-top: 0.875rem;
    font-size: 1rem;
    color: var(--text-mid);
  }
  .opt > summary, .opt-btn {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    color: var(--text-mid);
    list-style: none;
    cursor: pointer;
  }
  .opt > summary::-webkit-details-marker { display: none; }
  .opt b, .opt-btn b { font-weight: 400; color: var(--text); border-bottom: 1px dotted var(--text); }
  .opt > summary:hover b, .opt-btn:hover b,
  .opt[open] > summary b, .opt-btn[aria-expanded="true"] b { color: var(--accent); border-bottom-color: var(--accent); }
  .opt > summary:focus-visible, .opt-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .opt-caret { margin-left: 0.3125rem; vertical-align: 0.1em; color: var(--text-mid); }
  .opt-panel {
    position: absolute;
    top: calc(100% + 0.5rem);
    left: 0;
    z-index: 20;
    display: grid;
    gap: 0.5rem;
    min-width: 13rem;
    max-width: 100%;
    margin: 0;
    padding: 0.875rem 1rem;
    border: 1px solid var(--text);
    background: var(--page-bg);
    box-shadow: 0 10px 24px -12px rgba(0, 0, 0, 0.4);
    color: var(--text);
  }
  /* A choice: a square ink box, a blue square inside when chosen. The square
     is painted on the box, not put inside it: a box with a child takes its
     baseline from the child, and in a row aligned by baseline (the speaker
     filter's) the chosen box then sits lower than the empty ones. */
  .ck, .combo-check, .mode-group label { display: inline-flex; align-items: center; gap: 0.5rem; color: var(--text); cursor: pointer; }
  .ck input, .combo-check input, .mode-group input {
    appearance: none;
    flex: none;
    width: 0.9375rem;
    height: 0.9375rem;
    margin: 0;
    border: 1.5px solid var(--text);
    border-radius: 0;
    background: none;
    cursor: pointer;
  }
  .ck input:checked, .combo-check input:checked, .mode-group input:checked {
    background: linear-gradient(var(--accent), var(--accent)) center / 0.5rem 0.5rem no-repeat;
  }
  .ck input:focus-visible, .combo-check input:focus-visible, .mode-group input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .advanced-trigger {
    margin-left: auto;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
  }
  .advanced-trigger:hover { text-decoration: underline; text-underline-offset: 0.2em; }
  /* The primary button: an ink fill with stone text. */
  .search-btn {
    padding: 0.625rem 1.25rem;
    border: 1px solid var(--text);
    border-radius: 0;
    background: var(--text);
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.75rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--page-bg);
    cursor: pointer;
  }
  .search-btn:hover:not(:disabled) { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
  .search-btn:disabled { opacity: 0.6; cursor: default; }

  .sx-hint { max-width: 42.5rem; margin: 0.75rem 0 0; font-size: 0.875rem; color: var(--text-mid); }
  .search-page code, .help-modal code { font-family: var(--font-english); font-style: italic; font-size: 1em; color: var(--text); }
  .link-btn {
    padding: 0;
    border: none;
    border-bottom: 1px solid var(--accent);
    background: none;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
  }
  .guide-link { color: var(--text-mid); text-decoration: none; border-bottom: 1px solid var(--border); }
  .guide-link:hover { color: var(--accent); border-bottom-color: var(--accent); }

  /* ── Advanced: Α Single lemma, Β Words near each other ─────────────────── */
  .advanced-body { margin-top: 1.375rem; }
  .advanced-guide { margin: 0; text-align: right; font-size: 0.875rem; }
  .lemma-panel, .combo-panel { margin-top: 1.375rem; padding-top: 0.875rem; border-top: 1px solid var(--text); }
  .lemma-panel + .combo-panel { margin-top: 1.625rem; }
  .lemma-panel > summary, .combo-panel > summary {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.25rem 0.75rem;
    list-style: none;
    cursor: pointer;
  }
  .lemma-panel > summary::-webkit-details-marker, .combo-panel > summary::-webkit-details-marker { display: none; }
  .lemma-panel > summary:focus-visible, .combo-panel > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  summary .n { font-family: var(--font-caps); font-weight: 300; font-size: 1.375rem; color: var(--accent); }
  summary .t { font-size: 1.3125rem; }
  .lemma-panel .d { font-size: 0.875rem; font-style: italic; color: var(--text-mid); }
  summary .tog, .combo-active {
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.6875rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  summary .tog { margin-left: auto; color: var(--text-mid); }
  .combo-active { color: var(--accent); }
  .lemma-panel-note, .combo-note { max-width: 42.5rem; margin: 0.625rem 0 0; font-size: 0.9375rem; line-height: 1.55; color: var(--text-mid); }
  .lemma-panel-clear, .combo-add, .works-action, .retry-btn {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
  }
  .lemma-panel-clear { margin-top: 0.75rem; }
  .lemma-panel-clear:hover, .combo-add:hover, .works-action:hover:not(:disabled), .retry-btn:hover { text-decoration: underline; text-underline-offset: 0.2em; }

  /* The headword picker: an underlined field; its list is the one floating
     panel here (1px ink edge, a small shadow); a pick reads headword, gloss,
     count and "Change". */
  .lp { position: relative; display: grid; gap: 0.5rem; max-width: 42.5rem; margin-top: 0.75rem; }
  .lp-field { display: grid; gap: 0.25rem; }
  .lp-field > span, .combo-text-field > span, .grammar-field > span {
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.6875rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-mid);
  }
  .lp-field input, .combo-text-field input {
    height: 2.75rem;
    padding: 0;
    border: none;
    border-bottom: 2px solid var(--text);
    border-radius: 0;
    background: none;
    font-family: var(--font-greek);
    font-size: 1.375rem;
    color: var(--text);
  }
  .lp-field input:focus, .combo-text-field input:focus { outline: none; border-bottom-color: var(--accent); }
  .lp-status { margin: 0; font-size: 0.875rem; font-style: italic; color: var(--text-mid); }
  /* top: 100% puts it under the field: an absolute child of a grid with no
     offset sits at the grid's top, over the field it serves. */
  .lplist {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 25;
    max-height: 18rem;
    overflow-y: auto;
    margin: 0.25rem 0 0;
    padding: 0;
    list-style: none;
    border: 1px solid var(--text);
    background: var(--page-bg);
    box-shadow: 0 10px 24px -12px rgba(0, 0, 0, 0.4);
  }
  .lplist li { border-bottom: 1px solid var(--border); }
  .lplist li:last-child { border-bottom: 0; }
  .lplist li.on { background: var(--greek-active); }
  .lplist button, .lpsel .x {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .lplist button {
    display: grid;
    grid-template-columns: 9.375rem minmax(0, 1fr) 4.375rem;
    gap: 0.75rem;
    align-items: baseline;
    width: 100%;
    padding: 0.5rem 0.875rem;
    font-size: 0.9375rem;
    color: var(--text);
  }
  .lplist button:hover .hw, .lplist button:focus-visible .hw { color: var(--accent); }
  .lplist button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .lplist .hw, .lpsel .hw { font-family: var(--font-greek); }
  .lplist .hw { font-size: 1.1875rem; }
  .lplist .gl, .lpsel .gl { font-style: italic; color: var(--text-mid); }
  .lplist .ct, .lpsel .ct { font-family: var(--font-caps); font-weight: 300; font-size: 0.75rem; color: var(--text-mid); font-variant-numeric: tabular-nums; }
  .lplist .ct { text-align: right; }
  .lpsel { display: flex; align-items: baseline; gap: 0.875rem; min-height: 2.75rem; border-bottom: 2px solid var(--text); font-size: 1.375rem; }
  .lpsel .gl { font-size: 1rem; }
  .lpsel .x {
    margin-left: auto;
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.6875rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
  }

  /* Words near each other: one ruled row per term. */
  .combo-slots { margin-top: 0.5rem; }
  .combo-slot { padding: 0.75rem 0; border-bottom: 1px solid var(--border); }
  .combo-slot-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.75rem 1.5rem; }
  .combo-slot-number {
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.75rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .combo-kind, .combo-option { display: inline-flex; align-items: baseline; gap: 0.375rem; font-size: 0.9375rem; color: var(--text-mid); }
  /* Selects read as menus: text on a dotted underline with a small caret. */
  .combo-kind select, .grammar-field select, .combo-option select {
    padding: 0 0.875rem 0 0;
    border: none;
    border-bottom: 1px dotted var(--text);
    border-radius: 0;
    background: transparent url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2359616c'/%3E%3C/svg%3E") no-repeat right 0.0625rem center;
    font: inherit;
    color: var(--text);
    cursor: pointer;
    appearance: none;
  }
  :global(:root[data-theme="dark"]) .combo-kind select,
  :global(:root[data-theme="dark"]) .grammar-field select,
  :global(:root[data-theme="dark"]) .combo-option select {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%2398a1ad'/%3E%3C/svg%3E");
  }
  .combo-kind select:disabled { color: var(--text-mid); border-bottom-color: transparent; }
  .combo-kind select:focus-visible, .grammar-field select:focus-visible, .combo-option select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .combo-remove {
    margin-left: auto;
    padding: 0;
    border: none;
    background: none;
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.6875rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-mid);
    cursor: pointer;
  }
  .combo-remove:hover:not(:disabled) { color: var(--accent); }
  .combo-remove:disabled { opacity: 0.4; cursor: default; }
  .combo-text-field { display: grid; gap: 0.25rem; max-width: 42.5rem; margin-top: 0.625rem; }
  .combo-grammar-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr)); gap: 0.75rem 1rem; margin-top: 0.75rem; }
  .grammar-field { display: grid; gap: 0.125rem; font-size: 0.9375rem; }
  .combo-add { margin-top: 0.75rem; }
  .combo-add:disabled { color: var(--text-mid); opacity: 0.6; cursor: default; }
  .combo-proximity { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.75rem 1.875rem; padding-top: 1rem; font-size: 1rem; }
  .combo-window input {
    width: 2.75rem;
    padding: 0;
    border: none;
    border-bottom: 2px solid var(--text);
    border-radius: 0;
    background: none;
    font: inherit;
    text-align: center;
    color: var(--text);
  }
  .combo-window input:focus { outline: none; border-bottom-color: var(--accent); }
  .combo-window input:disabled { opacity: 0.5; }

  /* ── Works and Spoken by: panels under the options line ────────────────── */
  .works-panel { margin-top: 1.125rem; padding-top: 0.875rem; border-top: 1px solid var(--text); }
  .works-panel[hidden] { display: none; }
  .works-actions { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem 1.25rem; }
  .works-action, .scope-btn, .speaker-count {
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.6875rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .works-action:disabled { color: var(--text-mid); opacity: 0.5; cursor: default; }
  .speaker-count { color: var(--text-mid); }
  /* Authorship: a capitals switch, the current scope underlined. */
  .works-auth { display: flex; flex-wrap: wrap; gap: 0.5rem 1.25rem; margin-top: 0.875rem; }
  .auth-btn {
    padding: 0 0 0.1875rem;
    border: none;
    border-bottom: 2px solid transparent;
    background: none;
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.75rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-mid);
    cursor: pointer;
  }
  .auth-btn:hover:not(:disabled) { color: var(--accent); }
  .auth-btn.on { color: var(--text); border-bottom-color: var(--text); }
  .auth-btn:disabled { opacity: 0.4; cursor: default; }
  .auth-count { margin-left: 0.3125rem; font-variant-numeric: tabular-nums; }
  .works-group { margin-top: 1rem; }
  .works-group-head { display: flex; align-items: baseline; gap: 1rem; padding-bottom: 0.375rem; border-bottom: 1px solid var(--border); }
  .works-group-name { font-size: 1.0625rem; }
  .works-group-scope { display: flex; gap: 1rem; margin-left: auto; }
  .scope-btn { padding: 0; border: none; background: none; color: var(--text-mid); cursor: pointer; }
  .scope-btn:hover, .scope-btn.on { color: var(--accent); }
  /* Each work a square check and its name: no chips. */
  .works-chips { display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); gap: 0.125rem 1rem; margin-top: 0.5rem; }
  .work-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0;
    border: none;
    background: none;
    font: inherit;
    font-size: 0.9375rem;
    text-align: left;
    color: var(--text);
    cursor: pointer;
  }
  .work-chip::before {
    content: '';
    flex: none;
    box-sizing: border-box;
    width: 0.9375rem;
    height: 0.9375rem;
    border: 1.5px solid var(--text);
  }
  .work-chip.on::before { background: linear-gradient(var(--accent), var(--accent)) center / 0.5rem 0.5rem no-repeat; }
  .work-chip:hover { color: var(--accent); }
  .work-chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .speaker-turns { margin-left: 0.25rem; font-family: var(--font-caps); font-weight: 300; font-size: 0.75rem; color: var(--text-mid); font-variant-numeric: tabular-nums; }
  .mode-group { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem 1.5rem; margin: 0; padding: 0; border: none; }
  .mode-group legend {
    float: left;
    margin-right: 1rem;
    padding: 0;
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.6875rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-mid);
  }
  .speaker-note, .search-note { max-width: 42.5rem; margin: 0.75rem 0 0; font-size: 0.9375rem; line-height: 1.55; color: var(--text-mid); }
  .speaker-note.warn, .search-note.warn, .search-error { color: var(--accent-2); }
  .speaker-chips { margin-top: 0.75rem; }

  /* ── How to type Greek ─────────────────────────────────────────────────── */
  .help-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 4rem 1rem;
    overflow-y: auto;
    background: rgba(0, 0, 0, 0.45);
  }
  .help-modal {
    width: 100%;
    max-width: 36rem;
    padding: 1.5rem 1.75rem 1.75rem;
    border: 1px solid var(--text);
    background: var(--page-bg);
    box-shadow: 0 12px 40px -14px rgba(0, 0, 0, 0.45);
    color: var(--text);
  }
  .help-modal:focus { outline: none; }
  .help-head { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; }
  .help-head h2 { margin: 0; font-family: var(--font-english); font-size: 1.5rem; font-weight: 400; }
  .help-close { padding: 0; border: none; background: none; font-size: 1.5rem; line-height: 1; color: var(--text-mid); cursor: pointer; }
  .help-close:hover { color: var(--text); }
  .help-modal h3 { margin: 1.25rem 0 0.375rem; font-family: var(--font-english); font-size: 1.0625rem; font-weight: 400; }
  .help-intro, .help-sub, .help-foot { margin: 0.625rem 0 0; font-size: 0.9375rem; line-height: 1.55; color: var(--text-mid); }
  .help-note { font-size: 0.875rem; font-style: italic; color: var(--text-mid); }
  .help-modal strong { font-weight: 400; font-style: italic; }
  .beta-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(6rem, 1fr)); gap: 0 1rem; margin: 0.75rem 0 0; border-top: 1px solid var(--text); }
  .beta-cell { display: grid; grid-template-columns: auto auto; justify-content: start; align-items: baseline; column-gap: 0.5rem; padding: 0.375rem 0; border-bottom: 1px solid var(--border); }
  .beta-key { font-style: italic; }
  .beta-grk, .mark-ex, .ex-grk { font-family: var(--font-greek); font-size: 1.125rem; }
  .beta-name {
    grid-column: 1 / -1;
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.625rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-mid);
  }
  .mark-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr)); gap: 0.25rem 0.75rem; margin: 0; padding: 0; list-style: none; font-size: 0.9375rem; }
  .mark-list .beta-name { display: inline; }
  .example-list { display: grid; gap: 0.25rem; margin: 0; padding: 0; list-style: none; font-size: 0.9375rem; }
  .ex-arrow { color: var(--text-mid); }

  /* ── Results ───────────────────────────────────────────────────────────── */
  .search-error { margin: 1.5rem 0 0; }
  /* Notices are ruled rows: what kind, what happened, what to do. */
  .sx-notes { display: grid; margin: 1.375rem 0 0; border-top: 1px solid var(--text); }
  .sx-note {
    display: grid;
    grid-template-columns: 6.875rem minmax(0, 1fr) auto;
    gap: 1rem;
    align-items: baseline;
    padding: 0.625rem 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.9375rem;
  }
  .sx-note .k, .sx-note .a {
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.6875rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }
  .sx-note .k { color: var(--text-mid); }
  .sx-note.warn .k { color: var(--accent-2); }
  .sx-note .a { padding: 0; border: none; background: none; color: var(--accent); cursor: pointer; }
  /* The hits and their controls. On a wide screen the controls are a column
     beside the hits; on a narrow one a sheet, opened from the bar over them. */
  /* Paging scrolls here: clear of the site header. */
  .sx-layout { margin-top: 1.375rem; scroll-margin-top: 5rem; }
  .result-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.5rem 1rem; }
  .result-count { margin: 0; font-size: 1.25rem; }
  .sx-refine {
    min-height: 2.5rem;
    padding: 0 1rem;
    border: 1px solid var(--text);
    background: none;
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.75rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text);
    cursor: pointer;
  }
  .sx-refine:hover { color: var(--accent); border-color: var(--accent); }
  .sx-panel:focus, .sx-sum:focus { outline: none; }
  .export-btn {
    padding: 0;
    border: none;
    background: none;
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.6875rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--accent);
    cursor: pointer;
  }
  .export-btn:hover:not(:disabled) { text-decoration: underline; text-underline-offset: 0.2em; }
  .export-btn:disabled { color: var(--text-mid); cursor: default; }
  .result-guide { font-size: 0.875rem; }
  /* The summary: what this search narrows or changes, a ruled line each. */
  .sx-sum { margin-top: 0.875rem; padding: 0.75rem 0 0.75rem; border-top: 1px solid var(--text); }
  .sx-sum ul { margin: 0.25rem 0 0; padding: 0; list-style: none; }
  .sx-sum li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    min-height: 2.5rem;
    border-bottom: 1px solid var(--border);
    color: var(--accent);
  }
  .sx-sum .x {
    flex: none;
    width: 2.5rem;
    height: 2.5rem;
    margin-right: -0.75rem;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    font-size: 1.25rem;
    line-height: 1;
    color: var(--text-mid);
    cursor: pointer;
  }
  .sx-sum .x:hover { color: var(--accent); }
  .sx-clear {
    min-height: 2.5rem;
    padding: 0;
    border: none;
    background: none;
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.6875rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--accent);
    cursor: pointer;
  }
  .sx-clear:hover { text-decoration: underline; text-underline-offset: 0.2em; }
  /* Each control a block: its label above, its options below. */
  .sx-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    margin: 0;
    padding: 0.75rem 0;
    border-top: 1px solid var(--border);
    font-size: 1rem;
  }
  .sx-row .k, .sx-sum .k, .sx-sheet-head .k {
    display: block;
    flex: 0 0 100%;
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.6875rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-mid);
  }
  .sx-row .i, .sx-row .more {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  /* Works and Translations: a list, the name left and its count right. */
  .sx-row .i {
    display: flex;
    flex: 0 0 100%;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    min-height: 2.5rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border);
    color: var(--text);
  }
  .sx-row .i:hover { color: var(--accent); }
  .sx-row .i small { font-family: var(--font-caps); font-weight: 300; font-size: 0.75rem; color: var(--text-mid); font-variant-numeric: tabular-nums; }
  .sx-row .i.on { color: var(--accent); box-shadow: inset 0 -2px 0 var(--accent); }
  .sx-row .i.on small { color: var(--accent); }
  .sx-row .more { min-height: 2.5rem; margin-right: 1.25rem; color: var(--accent); white-space: nowrap; }
  .sx-row .note { flex: 0 0 100%; margin-top: 0.375rem; font-size: 0.8125rem; font-style: italic; color: var(--text-mid); }
  /* The form panel: under each headword a tick box per form, each a 40px
     target; under them all, "more", Select all and Apply on one line. */
  /* Centred, not on the baseline: a form's label would take its baseline from
     its tick box, and the headwords would sit below the forms. */
  .sx-forms { align-items: center; }
  .sx-forms .fx-group, .sx-facets .gx-group { display: flex; flex: 0 0 100%; flex-direction: column; }
  .sx-forms .fx-head { margin-top: 0.5rem; font-family: var(--font-greek); font-style: italic; color: var(--text-mid); }
  .sx-forms .fx, .sx-facets .fx {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.5rem;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
  }
  .sx-forms .fx { font-family: var(--font-greek); }
  .sx-forms .fx input, .sx-facets .fx input { flex: none; width: 1.125rem; height: 1.125rem; margin: 0; accent-color: var(--accent); }
  .sx-forms .fx small, .sx-facets .fx small { margin-left: auto; font-family: var(--font-caps); font-weight: 300; font-size: 0.75rem; color: var(--text-mid); font-variant-numeric: tabular-nums; }
  .sx-forms .fx-apply:disabled { color: var(--text-mid); cursor: default; }
  /* Group by and Sort are lists, as Works is. Context and Per page, short,
     keep their options on one line, divided by thin rules. */
  .sx-inline .i {
    display: inline-block;
    flex: none;
    margin-right: 0.875rem;
    padding: 0.5rem 0.875rem 0.5rem 0;
    border-bottom: none;
    border-right: 1px solid var(--border);
  }
  .sx-inline .i:last-of-type { margin-right: 0; padding-right: 0; border-right: none; }
  .sx-facets .gx-head { margin-top: 0.5rem; font-family: var(--font-caps); font-weight: 300; font-size: 0.75rem; letter-spacing: 0.08em; color: var(--text-mid); }
  /* Export and the inflection search, at the foot of the column. */
  .sx-tools { display: flex; flex-direction: column; align-items: flex-start; padding: 0.5rem 0; border-top: 1px solid var(--border); }
  .sx-tools .export-btn { min-height: 2.5rem; text-align: left; }
  .sx-tools .result-guide { display: inline-flex; align-items: center; min-height: 2.5rem; }
  @media (min-width: 1100px) {
    .sx-layout { display: grid; grid-template-columns: 18rem minmax(0, 1fr); column-gap: 3rem; align-items: start; }
    /* Held under the site header (4rem and its rule) while the hits scroll,
       with a scroll of its own when it is taller than the window. */
    .sx-side {
      position: sticky;
      top: calc(4rem + 1px + 1.5rem);
      max-height: calc(100vh - 4rem - 1px - 3rem);
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .sx-refine { display: none; }
    .sx-main > :first-child { margin-top: 0; }
  }
  @media (max-width: 1099.98px) {
    .result-bar { padding-bottom: 0.75rem; border-bottom: 1px solid var(--text); }
    .sx-panel { display: none; }
    /* The sheet: as the option menus' on a phone, from the foot of the page. */
    .sx-panel.open {
      position: fixed;
      right: 0;
      bottom: 0;
      left: 0;
      z-index: 1001;
      display: block;
      max-width: 40rem;
      max-height: 85vh;
      margin: 0 auto;
      padding: 0 1.25rem 1.5rem;
      overflow-y: auto;
      overscroll-behavior: contain;
      border: 1px solid var(--text);
      border-bottom: none;
      background: var(--page-bg);
      box-shadow: 0 -12px 40px -14px rgba(0, 0, 0, 0.45);
      color: var(--text);
    }
    .sx-scrim { position: fixed; inset: 0; z-index: 1000; background: rgba(0, 0, 0, 0.45); }
    .sx-sheet-head {
      position: sticky;
      top: 0;
      z-index: 1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--text);
      background: var(--page-bg);
    }
    .sx-sheet-head .k { flex: none; }
    .sx-close {
      min-height: 3rem;
      padding: 0 0 0 1rem;
      border: none;
      background: none;
      font-family: var(--font-caps);
      font-weight: 300;
      font-size: 0.75rem;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--accent);
      cursor: pointer;
    }
    .sx-sum { margin-top: 0; border-top: none; }
  }
  .pager {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 1.5rem;
    margin: 1.375rem 0 0;
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.75rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-mid);
  }
  .pager-btn { padding: 0; border: none; background: none; font: inherit; letter-spacing: inherit; text-transform: inherit; color: var(--text); cursor: pointer; }
  .pager-btn:hover:not(:disabled) { color: var(--accent); }
  .pager-btn:disabled { opacity: 0.4; cursor: default; }
  .pager-bottom { margin-top: 1.75rem; }
  /* Hits by work and book, then by Stephanus page, on ruled rows. */
  .book-section { margin-top: 1.75rem; }
  .book-header {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    margin: 0;
    padding-top: 0.625rem;
    border-top: 1px solid var(--text);
    font-family: var(--font-english);
    font-size: 1.25rem;
    font-weight: 400;
  }
  .book-name {
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.6875rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-mid);
  }
  .chapter-group { border-bottom: 1px solid var(--border); }
  .group-head {
    display: flex;
    align-items: baseline;
    gap: 0.875rem;
    width: 100%;
    padding: 0.625rem 0;
    border: none;
    background: none;
    font: inherit;
    text-align: left;
    color: var(--text);
    cursor: pointer;
  }
  .group-head:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .group-head .caret { width: 0.75rem; font-size: 0.75rem; color: var(--text-mid); }
  .group-label {
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 1rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .group-bekker { font-family: var(--font-caps); font-weight: 300; font-size: 0.8125rem; color: var(--text-mid); }
  /* A form's spellings are Greek, and capitals would lose their accents. */
  .group-label.grc { font-family: var(--font-greek); letter-spacing: 0; text-transform: none; }
  .group-readings { font-size: 0.875rem; color: var(--text-mid); }
  .group-count { font-size: 0.875rem; font-style: italic; color: var(--text-mid); }
  .instance-list { margin: 0; padding: 0 0 0.5rem; list-style: none; }
  .instance {
    display: grid;
    grid-template-columns: 7.5rem minmax(0, 1fr);
    gap: 0.25rem 1.75rem;
    padding: 0.875rem 0;
    border-top: 1px solid var(--border);
  }
  .inst-ref {
    grid-column: 1;
    padding-top: 0.3rem;
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.8125rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    text-decoration: none;
    color: var(--accent);
  }
  .inst-ref:hover { text-decoration: underline; text-underline-offset: 0.2em; }
  .inst-body { grid-column: 2; grid-row: 1 / span 3; display: grid; gap: 0.5rem; min-width: 0; }
  .inst-snippet { font-size: 1.0625rem; line-height: 1.6; }
  .inst-snippet.greek { font-family: var(--font-greek); font-size: 1.1875rem; }
  .sx-tr { display: grid; gap: 0.5rem; min-width: 0; }
  .sx-tr > div { font-size: 1rem; line-height: 1.5; }
  .inst-pair { font-size: 1rem; line-height: 1.5; }
  .inst-pair.greek { font-family: var(--font-greek); font-size: 1.0625rem; line-height: 1.6; }
  .sx-tr .lab, .inst-pair .lab {
    display: block;
    margin-bottom: 0.0625rem;
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.65625rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    text-decoration: none;
    color: var(--text-mid);
  }
  .sx-tr .lab:hover, .inst-pair .lab:hover { color: var(--accent); }
  .inst-speaker {
    grid-column: 1;
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.6875rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-mid);
  }
  .inst-oneof { grid-column: 1; font-size: 0.8125rem; font-style: italic; color: var(--text-mid); }
  /* Search marks: the highlight token, square. */
  .inst-snippet :global(mark), .sx-tr :global(mark) { padding: 0 1px; background: var(--mark-bg); color: inherit; }
  /* A Greek word of a hit: a button that reads as the text, and opens its
     card. On a touch screen its hit area grows to 40px square without
     moving the line: a pseudo-element, not padding. */
  .inst-body :global(.nb) { white-space: nowrap; }
  .inst-body :global(.gw) {
    position: relative;
    display: inline;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    line-height: inherit;
    color: inherit;
    cursor: pointer;
  }
  .inst-body :global(.gw:hover) { background: var(--greek-active); }
  /* A proximity hit: the stretch from its first term to its last, tinted;
     the marks inside keep their own colour. */
  .inst-body :global(.prox) { background: var(--greek-active); box-shadow: 0 0 0 1px var(--greek-active); }
  /* The shade and a mark are one colour, so a term inside it is underlined. */
  .inst-body :global(.prox mark) { box-shadow: inset 0 -2px 0 var(--accent); }
  /* Citations only: the sections in a running list, each a link. */
  .cite-list { display: flex; flex-wrap: wrap; gap: 0 1.25rem; margin: 0.5rem 0 0; }
  .cite { display: inline-block; min-height: 2.5rem; line-height: 2.5rem; color: var(--text); text-decoration: none; font-variant-numeric: tabular-nums; }
  .cite:hover { color: var(--accent); }
  .cite small { color: var(--text-mid); }
  /* "more" / "less" on one hit: a quiet text button, 40px tall. */
  .inst-more {
    justify-self: start;
    min-height: 2.5rem;
    padding: 0;
    border: 0;
    background: none;
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.75rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--accent);
    cursor: pointer;
  }
  .inst-body :global(.gw:focus-visible) { outline: 2px solid var(--accent); outline-offset: 1px; }
  @media (pointer: coarse) {
    .inst-body :global(.gw::after) {
      content: '';
      position: absolute;
      left: 50%;
      top: 50%;
      width: max(100%, 40px);
      height: 40px;
      transform: translate(-50%, -50%);
    }
  }

  /* ── Phones ────────────────────────────────────────────────────────────── */
  @media (max-width: 680px) {
    .search-page { padding: 1.5rem 1.25rem 2.5rem; }
    .sq { grid-template-columns: minmax(0, 1fr); }
    .sq-row { height: 3.125rem; }
    .query-input { font-size: 1.25rem; }
    .lang-switch { grid-column: 1; grid-row: auto; display: grid; grid-template-columns: repeat(3, 1fr); text-align: center; }
    .lang-switch .tog { grid-column: 1 / -1; }
    .lang-switch button { border-bottom-color: var(--border); padding-bottom: 0.375rem; }
    .lang-switch [aria-pressed="true"] { border-bottom-color: var(--text); }
    .sopt { gap: 0.625rem 1.25rem; font-size: 0.9375rem; }
    .advanced-trigger { margin-left: 0; }
    .search-btn { width: 100%; }
    .opt-panel { position: fixed; top: auto; bottom: 0; left: 0; right: 0; max-height: 70vh; overflow-y: auto; }
    .lplist { position: static; margin-top: 0.375rem; box-shadow: none; }
    .lplist button { grid-template-columns: 6.875rem minmax(0, 1fr) 3.125rem; padding: 0.5rem 0.625rem; }
    .lplist .hw { font-size: 1.0625rem; }
    .lp-field input, .combo-text-field input, .lpsel { font-size: 1.1875rem; }
    .combo-grammar-grid { grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr)); }
    .works-chips { grid-template-columns: repeat(auto-fill, minmax(9.5rem, 1fr)); }
    .sx-note { grid-template-columns: minmax(0, 1fr); gap: 0.125rem; }
    .instance { grid-template-columns: minmax(0, 1fr); gap: 0.375rem; }
    .inst-ref, .inst-body, .inst-speaker, .inst-oneof { grid-column: 1; grid-row: auto; }
    .inst-snippet { font-size: 1rem; }
    .inst-snippet.greek { font-size: 1.0625rem; }
    .sx-tr > div, .inst-pair { font-size: 0.875rem; }
    .inst-pair.greek { font-size: 1rem; }
  }
</style>
