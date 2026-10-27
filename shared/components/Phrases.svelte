<script lang="ts">
  import { onMount } from 'svelte';
  import {
    decodeOffsets,
    fetchEnglishSegments,
    fetchNgramOccurrences,
    fetchNgramShard,
    type NgramRow,
    type NgramStream,
  } from '../lib/data';
  import { betaToGreek } from '../lib/betacode';
  import { formatCite, formatLocValue } from '../lib/citation';
  import {
    VARIANT_READING_CAP,
    greekFold,
    lemmaOptions,
    lemmaReadings,
    offsetRef,
    type Offsets,
  } from '../lib/search';
  import { WORKS, getWork, workPath } from '../lib/works';

  type SortMode = 'score' | 'frequency' | 'length' | 'alphabetical';

  interface PhraseItem {
    key: string;
    row: NgramRow;
  }

  // What the typed prefix resolves to: the shards to read and, in each, the key
  // prefixes that count as a match. One letter and one prefix for the surface
  // and English streams; for dictionary forms, one prefix per reading of the
  // typed words, and those readings do not all live in the same shard.
  interface Plan {
    key: string;                 // stream + typed prefix, the signature it answers
    stream: NgramStream;
    // An empty prefix list on a letter means every phrase in that shard.
    byLetter: Array<{ letter: string; prefixes: string[] }>;
    readings: string[][];        // dictionary forms only; [] when nothing was widened
    cappedFrom: number;          // 0 unless the fan-out was truncated
  }

  // Plato is cited by Stephanus page + section ("34b") and by nothing finer, so
  // a citation is the segment's column and there is no line to name — for the
  // Greek as much as for the English.
  interface Citation {
    cite: string;
    book: number;
    href: string;
  }

  interface WorkCitations {
    id: string;
    title: string;
    total: number;
    citations: Citation[];
    error?: string;
  }

  interface PhraseDetails {
    loading: boolean;
    error: string;
    works: WorkCitations[];
  }

  // Which shards exist, per stream. Passed in by the page, which reads the
  // built n-gram directory: a shard's letter is a fact about the corpus, and a
  // browse button for a letter no rebuild kept would 404.
  export let letters: Partial<Record<NgramStream, string[]>> = {};

  const DEFAULT_LETTER = 'p';
  // The three the guide works through, so the page and the explainer teach the
  // same phrases rather than each inventing its own. Glosses carry no counts:
  // a count typed here would be a number nothing regenerates.
  const EXAMPLES = [
    { beta: "hn d' egw", greek: 'ἦν δ’ ἐγώ', gloss: 'said I — Socrates narrating' },
    { beta: 'panu men oun', greek: 'πάνυ μὲν οὖν', gloss: 'certainly — the assenting reply' },
    { beta: 'ws epos eipein', greek: 'ὡς ἔπος εἰπεῖν', gloss: 'so to speak' },
  ];
  // Chosen the same way: real rows, each standing in many works so it is Plato
  // recurring rather than one translator's habit.
  const ENGLISH_EXAMPLES = [
    { beta: 'what do you mean', greek: 'what do you mean', gloss: 'the question that drives a dialogue' },
    { beta: 'for the sake of', greek: 'for the sake of', gloss: 'purpose, ends, the good' },
    { beta: 'by all means', greek: 'by all means', gloss: 'assent' },
  ];

  // Distinctiveness ranks the English badly. English builds its grammar out of
  // small words in fixed order — "in the case of" is nearly the only order those
  // four ever take — so the measure reads them as inseparable and they take the
  // whole top of the list.
  //
  // This filters the DEFAULT VIEW; it changes no score and hides nothing the
  // reader cannot unhide. Strictly grammatical words only: nothing that could
  // carry weight in Plato — no soul, good, just, form, being, knowledge.
  const FUNCTION_WORDS = new Set(`a an the this that these those which who whom whose what
    and or but nor if then than as so because although though while whereas
    of in on at to for from by with without within into upon about against
    among between through during over under above below across along
    is are was were be been being am do does did done have has had having
    will would shall should may might can could must let
    it its he she they them their his her our your my we you i one
    not no nor never ever also too very much more most less least
    there here now when where how why some any all both each every other another same`
    .split(/\s+/));

  function contentWords(phrase: string): number {
    let n = 0;
    for (const w of phrase.split(' ')) if (!FUNCTION_WORDS.has(w)) n++;
    return n;
  }

  // The shard a phrase lives in, by its first letter — the same rule stage 8
  // sharded it with. Taken from the phrase itself, never from the typed box: a
  // widened query reads several shards at once, and a row's citations must be
  // fetched from the shard that actually holds it.
  function shardLetter(phrase: string): string {
    const first = phrase[0] ?? '';
    return first >= 'a' && first <= 'z' ? first : '_';
  }
  const PAGE_SIZE = 50;
  const CITATION_CAP = 40;
  const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, '');
  const WORK_ORDER = new Map(WORKS.map((work, index) => [work.id, index]));
  const countFormat = new Intl.NumberFormat('en-US');
  const scoreFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

  let mounted = false;
  let stream: NgramStream = 'form';
  let prefix = '';
  let lengths: number[] = [2, 3, 4, 5];
  let minCount = 2;
  let selectedWorks: string[] = [];
  let sort: SortMode = 'score';
  let hideCommon = true;
  let page = 0;

  let plan: Plan = { key: '', stream: 'form', byLetter: [], readings: [], cappedFrom: 0 };
  let planLoading = false;
  let requestedPlanKey = '';
  let planRequest = 0;

  // One entry per shard the plan asks for, in its order.
  let loadedShards: Array<Record<string, NgramRow>> = [];
  let loadedShardSignature = '';
  let shardLoading = false;
  let shardError = '';
  let requestedShardSignature = '';
  let shardRequest = 0;

  let requestedWorkSignature = '';
  let loadedWorkSignature = '';
  let matchingWorkPhrases: Set<string> | null = null;
  let workFilterLoading = false;
  let workFilterError = '';
  let workRequest = 0;

  let expanded = new Set<string>();
  let details: Record<string, PhraseDetails> = {};

  const offsetsCache = new Map<string, Promise<Offsets>>();

  // The index is keyed on accent-folded Beta Code, but nobody should have to
  // know that: fold whatever is typed, Greek or Latin. greekFold drops every
  // character it does not recognise — including the spaces between a phrase's
  // words — so it has to run per word and the words be rejoined.
  $: isEnglish = stream === 'english';
  $: isLemma = stream === 'lemma';
  $: browseLetters = letters[stream] ?? [];
  $: normalizedPrefix = isEnglish
    ? prefix.trim().toLowerCase().replace(/[^a-z' ]+/g, '').replace(/\s+/g, ' ')
    : prefix
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .map(greekFold)
      .filter(Boolean)
      .join(' ');
  $: letter = normalizedPrefix ? shardLetter(normalizedPrefix) : DEFAULT_LETTER;
  $: minimum = Number.isFinite(minCount) ? Math.max(2, Math.floor(minCount)) : 2;
  $: selectedLengthKey = [...lengths].sort((a, b) => a - b).join(',');
  $: selectedWorkKey = [...selectedWorks].sort().join(',');

  $: planKey = `${stream}|${normalizedPrefix}`;
  $: if (mounted && planKey !== requestedPlanKey) {
    void makePlan(planKey, stream, normalizedPrefix, letter);
  }

  // Nothing downstream may act on a plan that answers an older query.
  $: activePlan = plan.key === planKey ? plan : null;
  $: shardSignature = activePlan
    ? `${activePlan.stream}/${activePlan.byLetter.map((b) => b.letter).join(',')}`
    : '';

  $: if (mounted && shardSignature && shardSignature !== requestedShardSignature) {
    void loadShards(shardSignature, activePlan!);
  }

  $: scan = loadedShardSignature === shardSignature && activePlan
    ? scanShards(activePlan, loadedShards, lengths, minimum, isEnglish && hideCommon)
    : { rows: [] as PhraseItem[], matched: [] as string[] };
  $: localRows = scan.rows;

  // The work filter reads occurrence files, one per shard letter per length.
  // Only the letters that actually produced rows are worth fetching: widening
  // ἦν asks for three shards and two of them are routinely dead ends.
  $: matchedLetters = [...new Set(localRows.map((item) => shardLetter(item.key)))].sort();
  $: workSignature = selectedWorks.length && matchedLetters.length
    ? `${stream}/${matchedLetters.join(',')}|${selectedLengthKey}|${selectedWorkKey}`
    : '';

  $: if (mounted && workSignature !== requestedWorkSignature) {
    void loadWorkFilter(
      workSignature,
      stream,
      [...matchedLetters],
      [...lengths],
      [...selectedWorks],
    );
  }

  $: filteredRows = selectedWorks.length === 0
    ? localRows
    : loadedWorkSignature === workSignature && matchingWorkPhrases
      ? localRows.filter((item) => matchingWorkPhrases?.has(item.key))
      : [];

  $: shardBadge = (activePlan?.byLetter ?? [{ letter }])
    .map((b) => b.letter.toUpperCase())
    .join(', ');
  $: widened = activePlan?.readings.length ? activePlan : null;

  // The readings for the line under the box: the ones that produced rows, not
  // the ones that were tried — ἦν licenses five headwords and most are dead
  // ends. Listed rather than counted, because a reader has to be able to see
  // that ἦν was read as εἰμί; long lists are cut off rather than allowed to
  // bury the page.
  const READINGS_SHOWN = 6;
  $: matchedReadings = widened
    ? scan.matched.slice(0, READINGS_SHOWN).map((p) => betaToGreek(p))
    : [];
  $: matchedRest = widened ? Math.max(0, scan.matched.length - READINGS_SHOWN) : 0;
  $: triedReadings = widened
    ? widened.readings.slice(0, READINGS_SHOWN).map((r) => betaToGreek(r.join(' ')))
    : [];
  $: triedRest = widened ? Math.max(0, widened.readings.length - READINGS_SHOWN) : 0;

  $: sortedRows = [...filteredRows].sort((a, b) => comparePhrases(a, b, sort));
  $: pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  $: if (page >= pageCount) page = pageCount - 1;
  $: pageRows = sortedRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  $: shownFrom = sortedRows.length ? page * PAGE_SIZE + 1 : 0;
  $: shownTo = Math.min((page + 1) * PAGE_SIZE, sortedRows.length);

  onMount(() => {
    mounted = true;
  });

  function comparePhrases(a: PhraseItem, b: PhraseItem, mode: SortMode): number {
    if (mode === 'frequency') {
      return b.row[1] - a.row[1] || b.row[2] - a.row[2] || a.key.localeCompare(b.key);
    }
    if (mode === 'length') {
      return a.row[0] - b.row[0] || b.row[2] - a.row[2] || a.key.localeCompare(b.key);
    }
    if (mode === 'alphabetical') return a.key.localeCompare(b.key);
    return b.row[2] - a.row[2] || b.row[1] - a.row[1] || a.key.localeCompare(b.key);
  }

  // A single word is left alone. The letter buttons below type into the same
  // box, and widening one letter would quietly move the browse elsewhere: h is
  // the surface of ἡ, whose headword is ὁ, so browsing H would show the O shard.
  function widenable(prefixText: string): boolean {
    return prefixText.length > 1;
  }

  /** Which shards to read for the typed prefix, and what counts as a match.
   *
   * The dictionary-form index is keyed on headwords, so the phrase a reader has
   * in front of them matches nothing typed literally: ἦν δ' ἐγώ is stored as
   * ἠμί δέ ἐγώ, and knowing that is exactly the knowledge the index is supposed
   * to save them. So resolve each typed word to the headwords it can belong to
   * and match every reading of the phrase.
   *
   * A word the map does not record falls back to itself — that is the fragment
   * still being typed, and it is what keeps the list narrowing as a reader types.
   * A word the map DOES record is left to its headwords alone: a dictionary form
   * is always among its own headwords (ὁ maps to ὁ and ὅ), so adding it back
   * changes no result and can cost a whole extra shard — τό is not a headword of
   * anything, and reading it literally fetches megabytes with nothing in them.
   */
  async function makePlan(
    key: string,
    nextStream: NgramStream,
    prefixText: string,
    fallbackLetter: string,
  ) {
    const request = ++planRequest;
    requestedPlanKey = key;
    const literal: Plan = {
      key,
      stream: nextStream,
      byLetter: [{
        letter: prefixText ? shardLetter(prefixText) : fallbackLetter,
        prefixes: prefixText ? [prefixText] : [],
      }],
      readings: [],
      cappedFrom: 0,
    };

    if (nextStream !== 'lemma' || !widenable(prefixText)) {
      plan = literal;
      planLoading = false;
      return;
    }

    planLoading = true;
    try {
      const terms = prefixText.split(' ');
      const options = await lemmaOptions(terms);
      if (request !== planRequest) return;
      // No map, or no headword recorded for any word: match what was typed,
      // which is what this page did before widening existed.
      if (!options || options.every((o) => !o.length)) {
        plan = literal;
        return;
      }
      const perTerm = terms.map((term, i) => (options[i].length ? options[i] : [term]));
      const { readings, total } = lemmaReadings(perTerm, VARIANT_READING_CAP);
      const byLetter = new Map<string, string[]>();
      for (const reading of readings) {
        const l = shardLetter(reading[0]);
        const prefixes = byLetter.get(l) ?? [];
        prefixes.push(reading.join(' '));
        byLetter.set(l, prefixes);
      }
      plan = {
        key,
        stream: nextStream,
        byLetter: [...byLetter].map(([l, prefixes]) => ({ letter: l, prefixes })),
        readings,
        cappedFrom: total > readings.length ? total : 0,
      };
    } catch {
      if (request !== planRequest) return;
      plan = literal;
    } finally {
      if (request === planRequest) planLoading = false;
    }
  }

  async function loadShards(signature: string, forPlan: Plan) {
    const request = ++shardRequest;
    requestedShardSignature = signature;
    shardLoading = true;
    shardError = '';
    page = 0;
    expanded = new Set();
    try {
      const next = await Promise.all(
        forPlan.byLetter.map((b) => fetchNgramShard(forPlan.stream, b.letter)),
      );
      if (request !== shardRequest) return;
      loadedShards = next;
      loadedShardSignature = signature;
    } catch {
      if (request !== shardRequest) return;
      loadedShards = [];
      loadedShardSignature = '';
      const shown = forPlan.byLetter.map((b) => b.letter.toUpperCase()).join(', ');
      shardError = forPlan.byLetter.length > 1
        ? `The ${shown} phrase shards could not be loaded.`
        : `The ${shown} phrase shard could not be loaded.`;
    } finally {
      if (request === shardRequest) shardLoading = false;
    }
  }

  /** The rows that pass every filter, and the readings that produced them.
   *
   * One pass, because a shard holds tens of thousands of phrases and the prefix
   * test is per reading. Each shard is only tested against the readings that
   * begin with its own letter, which is what keeps the fan-out from multiplying
   * the work.
   */
  function scanShards(
    forPlan: Plan,
    shards: Array<Record<string, NgramRow>>,
    keepLengths: number[],
    minimumCount: number,
    dropCommon: boolean,
  ): { rows: PhraseItem[]; matched: string[] } {
    const rows: PhraseItem[] = [];
    const seenMatch = new Set<string>();
    forPlan.byLetter.forEach(({ prefixes }, i) => {
      const shard = shards[i];
      if (!shard) return;
      for (const [key, row] of Object.entries(shard)) {
        let hit = '';
        if (prefixes.length) {
          for (const p of prefixes) if (key.startsWith(p)) { hit = p; break; }
          if (!hit) continue;
        }
        if (!keepLengths.includes(row[0])) continue;
        if (row[1] < minimumCount) continue;
        if (dropCommon && contentWords(key) < 2) continue;
        rows.push({ key, row });
        if (hit) seenMatch.add(hit);
      }
    });
    // In the order the readings were generated, not the order the shards happen
    // to be iterated, so the note under the box does not reshuffle itself.
    const matched = forPlan.readings
      .map((r) => r.join(' '))
      .filter((p) => seenMatch.has(p));
    return { rows, matched };
  }

  async function loadWorkFilter(
    signature: string,
    nextStream: NgramStream,
    nextLetters: string[],
    nextLengths: number[],
    works: string[],
  ) {
    const request = ++workRequest;
    requestedWorkSignature = signature;
    loadedWorkSignature = '';
    matchingWorkPhrases = null;
    workFilterError = '';

    if (!signature) {
      workFilterLoading = false;
      return;
    }

    workFilterLoading = true;
    try {
      const occurrences = await Promise.all(
        nextLetters.flatMap((l) =>
          [...nextLengths]
            .sort((a, b) => a - b)
            .map((n) => fetchNgramOccurrences(nextStream, l, n)),
        ),
      );
      if (request !== workRequest) return;
      const matches = new Set<string>();
      for (const occurrenceShard of occurrences) {
        for (const [phrase, byWork] of Object.entries(occurrenceShard)) {
          if (works.some((work) => work in byWork)) matches.add(phrase);
        }
      }
      matchingWorkPhrases = matches;
      loadedWorkSignature = signature;
      page = 0;
    } catch {
      if (request !== workRequest) return;
      workFilterError = 'The extra occurrence data needed for this work filter could not be loaded.';
    } finally {
      if (request === workRequest) workFilterLoading = false;
    }
  }

  function retryShard() {
    requestedShardSignature = '';
  }

  function retryWorkFilter() {
    requestedWorkSignature = '';
  }

  function clampMinimum() {
    minCount = minimum;
    page = 0;
  }

  function clearWorks() {
    selectedWorks = [];
    page = 0;
  }

  // Keyed by the row's OWN shard letter, so an expanded widened row cannot
  // collide with a row of the same spelling reached from another shard.
  function phraseId(item: PhraseItem): string {
    return `${stream}-${shardLetter(item.key)}-${item.row[0]}-${item.key.replace(/[^a-z0-9_-]+/g, '-')}`;
  }

  function togglePhrase(item: PhraseItem) {
    const id = phraseId(item);
    const next = new Set(expanded);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
      if (!details[id]) void loadPhraseDetails(id, item);
    }
    expanded = next;
  }

  function fetchWorkOffsets(work: string): Promise<Offsets> {
    const cached = offsetsCache.get(work);
    if (cached) return cached;
    const promise = fetch(`${BASE_URL}/data/${work}/search/offsets.json`).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<Offsets>;
    });
    promise.catch(() => {
      if (offsetsCache.get(work) === promise) offsetsCache.delete(work);
    });
    offsetsCache.set(work, promise);
    return promise;
  }

  // Bound the offsets burst: a common phrase can span most of the corpus.
  async function pool<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>) {
    let next = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        await fn(items[index], index);
      }
    });
    await Promise.all(workers);
  }

  async function loadPhraseDetails(id: string, item: PhraseItem) {
    details = { ...details, [id]: { loading: true, error: '', works: [] } };
    try {
      const occurrenceShard = await fetchNgramOccurrences(
        stream,
        shardLetter(item.key),
        item.row[0],
      );
      const byWork = occurrenceShard[item.key];
      if (!byWork) throw new Error('Phrase missing from its occurrence shard');

      const entries = Object.entries(byWork).sort(
        ([a], [b]) => (WORK_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER) -
          (WORK_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER),
      );
      const groups: WorkCitations[] = entries.map(([work, deltas]) => ({
        id: work,
        title: getWork(work)?.title ?? work,
        total: deltas.length,
        citations: [],
      }));

      const englishSegments = isEnglish ? await fetchEnglishSegments() : null;

      await pool(entries, 6, async ([work, deltas], index) => {
        try {
          // Both languages resolve to a Stephanus section and stop there. The
          // English is aligned one block per segment; the Greek is indexed per
          // token, but Plato has no user-facing line, so the extra precision
          // has nothing to say.
          let citations: Citation[];
          if (englishSegments) {
            const segs = englishSegments[work] ?? [];
            citations = decodeOffsets(deltas)
              .map((global) => {
                let found: (typeof segs)[number] | null = null;
                for (const seg of segs) {
                  if (seg.base > global) break;
                  found = seg;
                }
                return found;
              })
              .filter((seg): seg is (typeof segs)[number] => seg !== null)
              .slice(0, CITATION_CAP)
              .map((seg) => ({
                cite: formatCite(work, seg.column),
                book: seg.book,
                href: `${BASE_URL}${workPath(work, seg.book)}?loc=${formatLocValue(work, seg.column)}`,
              }));
          } else {
            const offsets = await fetchWorkOffsets(work);
            citations = decodeOffsets(deltas)
              .map((global) => offsetRef(offsets, global))
              .filter((ref): ref is NonNullable<typeof ref> => ref !== null)
              .slice(0, CITATION_CAP)
              .map((ref) => ({
                cite: formatCite(work, ref.column),
                book: ref.book,
                href: `${BASE_URL}${workPath(work, ref.book)}?loc=${formatLocValue(work, ref.column)}`,
              }));
          }
          groups[index] = { ...groups[index], citations };
        } catch {
          groups[index] = {
            ...groups[index],
            error: 'Citations for this work could not be resolved.',
          };
        }
      });

      details = { ...details, [id]: { loading: false, error: '', works: groups } };
    } catch {
      details = {
        ...details,
        [id]: {
          loading: false,
          error: 'Occurrences for this phrase could not be loaded.',
          works: [],
        },
      };
    }
  }

  // The two switches stand for the three streams: Greek or English, and for
  // Greek, the words as written or the dictionary words behind them. Coming
  // back to Greek restores the Greek choice last made.
  let lastGreek: NgramStream = 'form';
  function setStream(next: NgramStream) {
    if (next !== 'english') lastGreek = next;
    stream = next;
    page = 0;
  }

  // What the Length and Works menus read when closed: "any", "2, 3"; "all
  // works", "Meno", "3 works".
  $: lengthLabel = lengths.length === 4 ? 'any'
    : lengths.length === 0 ? 'none'
    : [...lengths].sort((a, b) => a - b).join(', ');
  $: worksLabel = selectedWorks.length === 0 ? 'all works'
    : selectedWorks.length === 1 ? (getWork(selectedWorks[0])?.title ?? '1 work')
    : `${selectedWorks.length} works`;

  // The menus are <details>: one open at a time, closed by a click elsewhere
  // or by Escape, which hands focus back to the menu's own button.
  function closeOtherMenus(e: Event) {
    const el = e.currentTarget as HTMLDetailsElement;
    if (!el.open) return;
    for (const m of document.querySelectorAll<HTMLDetailsElement>('.ctl-menu[open]')) if (m !== el) m.open = false;
  }
  function onWindowClick(e: MouseEvent) {
    for (const m of document.querySelectorAll<HTMLDetailsElement>('.ctl-menu[open]')) {
      if (!m.contains(e.target as Node)) m.open = false;
    }
  }
  function onWindowKey(e: KeyboardEvent) {
    if (e.key !== 'Escape') return;
    const m = document.querySelector<HTMLDetailsElement>('.ctl-menu[open]');
    if (!m) return;
    m.open = false;
    m.querySelector('summary')?.focus();
  }
</script>

<svelte:window on:click={onWindowClick} on:keydown={onWindowKey} />

<div class="phrases-page xp-body">
  <section aria-labelledby="phrase-filters">
    <h2 id="phrase-filters" class="sr-only">Filter the index</h2>

    <label class="xp-field" for="phrase-prefix">
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>
      <input
        id="phrase-prefix"
        type="search"
        placeholder="Phrase starts with: panu men oun"
        aria-label="Phrase starts with"
        bind:value={prefix}
        on:input={() => page = 0}
        autocomplete="off"
        autocorrect="off"
        autocapitalize="none"
        spellcheck="false"
      />
    </label>
    <p class="xp-note">
      {#if isEnglish}
        Type the English words as they stand in the translation.
      {:else if isLemma}
        Type Greek or plain letters, as the words stand on the page: this list
        stores <span lang="grc">ἦν δ’ ἐγώ</span> as
        <span lang="grc">ἠμί δέ ἐγώ</span>, and either finds it.
      {:else}
        Type Greek or plain letters — <span lang="grc">πάνυ μέν</span> and
        <code>panu men</code> both work. Accents are ignored.
      {/if}
      {#if normalizedPrefix && !widened}Matching <code>{normalizedPrefix}</code>.{/if}
    </p>

    <!-- The cap disclosure does NOT depend on a row having matched. A capped
         query that matches nothing is the case where the reader most needs it:
         no rows and no notice reads as "this phrase is not in Plato", when what
         actually happened is that readings were dropped before anything was
         looked up. -->
    {#if widened && (matchedReadings.length || widened.cappedFrom)}
      <p class="xp-note" aria-live="polite">
        {#if matchedReadings.length}
          Reading these words as
          {#each matchedReadings as reading, i}<span lang="grc">{reading}</span>{i < matchedReadings.length - 1 ? ', ' : ''}{/each}{#if matchedRest} and {countFormat.format(matchedRest)} more{/if}.
        {/if}
        {#if widened.cappedFrom}
          These words have {countFormat.format(widened.cappedFrom)} readings in
          all; only the first {VARIANT_READING_CAP} were tried, so this is not
          the whole of what they could mean.
        {/if}
      </p>
    {/if}

    <!-- One line of controls: two switches in capitals, then menus that read
         as text on a dotted underline. -->
    <div class="ctl">
      <div class="xp-switch" role="group" aria-label="Language">
        <button type="button" aria-pressed={!isEnglish} on:click={() => setStream(lastGreek)}>Greek</button>
        <button type="button" aria-pressed={isEnglish} on:click={() => setStream('english')}>English</button>
      </div>
      {#if !isEnglish}
        <div class="xp-switch" role="group" aria-label="Count phrases by">
          <button type="button" aria-pressed={stream === 'form'} on:click={() => setStream('form')}>As written</button>
          <button type="button" aria-pressed={stream === 'lemma'} on:click={() => setStream('lemma')}>Dictionary words</button>
        </div>
      {/if}
      <label class="ctl-item" for="phrase-sort">
        Sort
        <span class="ctl-sel">
          <select id="phrase-sort" class="ctl-select" bind:value={sort} on:change={() => page = 0}>
            <option value="score">distinctiveness</option>
            <option value="frequency">frequency</option>
            <option value="length">length</option>
            <option value="alphabetical">alphabetical</option>
          </select>
          <svg class="ctl-caret" width="8" height="5" viewBox="0 0 10 6" aria-hidden="true" fill="currentColor"><path d="M0 0l5 6 5-6z"/></svg>
        </span>
      </label>
      <details class="ctl-menu" on:toggle={closeOtherMenus}>
        <summary>Length <b>{lengthLabel}<svg class="ctl-caret" width="8" height="5" viewBox="0 0 10 6" aria-hidden="true" fill="currentColor"><path d="M0 0l5 6 5-6z"/></svg></b></summary>
        <fieldset class="ctl-panel">
          <legend class="sr-only">Phrase length, in words</legend>
          {#each [2, 3, 4, 5] as n}
            <label class="ck">
              <input type="checkbox" value={n} bind:group={lengths} on:change={() => page = 0} />
              <span>{n} words</span>
            </label>
          {/each}
        </fieldset>
      </details>
      <label class="ctl-item" for="phrase-minimum">
        At least
        <input
          id="phrase-minimum"
          class="ctl-number"
          type="number"
          min="2"
          step="1"
          bind:value={minCount}
          on:input={() => page = 0}
          on:change={clampMinimum}
        />
        times
      </label>
      <details class="ctl-menu" on:toggle={closeOtherMenus}>
        <summary>In <b>{worksLabel}<svg class="ctl-caret" width="8" height="5" viewBox="0 0 10 6" aria-hidden="true" fill="currentColor"><path d="M0 0l5 6 5-6z"/></svg></b></summary>
        <div class="ctl-panel works-panel">
          <!-- Checkboxes, not a multi-select list. Picking two works out of 36 in a
               list box takes a modifier key nobody is told about, and one stray
               click throws the whole selection away. -->
          <fieldset class="work-list" aria-describedby="work-filter-note">
            <legend class="sr-only">Work</legend>
            {#each WORKS as work}
              <label class="ck">
                <input
                  type="checkbox"
                  value={work.id}
                  bind:group={selectedWorks}
                  on:change={() => page = 0}
                />
                <span>{work.title}</span>
              </label>
            {/each}
          </fieldset>
          <p id="work-filter-note" class="xp-note">
            No selection includes every dialogue. Tick one or more to keep phrases
            found in any of them. This filter needs an extra occurrence fetch for
            each selected phrase length, and one more for each shard the words are
            read in.
          </p>
          {#if selectedWorks.length}
            <button type="button" class="xp-btn o clear-works" on:click={clearWorks}>
              Clear work filter ({selectedWorks.length})
            </button>
          {/if}
        </div>
      </details>
      {#if isEnglish}
        <label class="ck">
          <input type="checkbox" bind:checked={hideCommon} on:change={() => page = 0} />
          <span>Hide phrases of common words only</span>
        </label>
      {/if}
      <a class="ctl-help" href={`${BASE_URL}/advanced#phrases`} target="_blank" rel="noreferrer">How to read this list</a>
    </div>
    {#if isEnglish}
      <p class="xp-note">
        English builds its grammar from small words in fixed order, so
        <em>of the</em> and <em>it is</em> outrank anything Plato says.
        This hides them; it changes no count and no score.
      </p>
    {/if}
  </section>

  <section class="results" aria-labelledby="phrase-results">
    <h2 id="phrase-results" class="sr-only">Recurrent phrases</h2>
    <div class="xp-meta results-head">
      {#if !shardLoading && !workFilterLoading && !shardError && !workFilterError}
        <span aria-live="polite">
          Showing {countFormat.format(shownFrom)}–{countFormat.format(shownTo)}
          of {countFormat.format(sortedRows.length)} matching phrases.
        </span>
      {/if}
      <span class="loaded-shard">{stream === 'form' ? 'Surface' : stream === 'lemma' ? 'Lemma' : 'English'} · {shardBadge}</span>
    </div>

    <p class="xp-note">
      Distinctiveness measures how much more often the phrase occurs than its
      words appearing independently would predict. It only orders the list; it
      never removes anything.
    </p>

    {#if !normalizedPrefix}
      <div class="phrase-start">
        <p>
          Every run of two to five words that Plato uses more than once, counted.
          Start with one of these, or type a phrase above.
          {#if isEnglish}
            These are the translations, so a phrase standing in one dialogue
            alone is that translator's habit; one standing in many is Plato
            recurring. The <em>Works</em> column tells them apart.
          {/if}
        </p>
        <ul class="phrase-examples">
          {#each (isEnglish ? ENGLISH_EXAMPLES : EXAMPLES) as ex}
            <li>
              <button type="button" class="phrase-example" on:click={() => { prefix = ex.beta; page = 0; }}>
                <span lang={isEnglish ? 'en' : 'grc'}>{ex.greek}</span>
                <small>{ex.gloss}</small>
              </button>
            </li>
          {/each}
        </ul>
        {#if browseLetters.length}
          <p class="phrase-start-browse">
            Or browse phrases beginning with a letter:
            {#each browseLetters as l}
              <button type="button" class="letter-button" on:click={() => { prefix = l; page = 0; }}>{l}</button>
            {/each}
          </p>
        {/if}
      </div>
    {:else if planLoading}
      <p class="status" aria-live="polite">Looking up the forms of these words…</p>
    {:else if shardLoading || !activePlan}
      <p class="status" aria-live="polite">
        Loading the {shardBadge} phrase
        {(activePlan?.byLetter.length ?? 1) > 1 ? 'shards' : 'shard'}…
      </p>
    {:else if shardError}
      <div class="status error" role="alert">
        {shardError}
        <button type="button" class="text-button" on:click={retryShard}>Retry</button>
      </div>
    {:else if workFilterLoading}
      <p class="status" aria-live="polite">Loading occurrence data for the work filter…</p>
    {:else if workFilterError}
      <div class="status error" role="alert">
        {workFilterError}
        <button type="button" class="text-button" on:click={retryWorkFilter}>Retry</button>
      </div>
    {:else if sortedRows.length === 0}
      <p class="status">
        No phrases match these filters. Try a shorter prefix, a lower count, or
        another dialogue.
        {#if widened && !matchedReadings.length}
          No reading of these words recurs in the corpus. Tried
          {#each triedReadings as reading, i}<span lang="grc">{reading}</span>{i < triedReadings.length - 1 ? ', ' : ''}{/each}{#if triedRest} and {countFormat.format(triedRest)} more{/if}.
        {/if}
      </p>
    {:else}
      <div class="column-head" aria-hidden="true">
        <span>Phrase</span>
        <span class="wide">Words</span>
        <span>Count</span>
        <span>Works</span>
        <span class="wide">Score</span>
        <span></span>
      </div>

      <ul class="phrase-list">
        {#each pageRows as item (item.key)}
          {@const id = phraseId(item)}
          {@const isExpanded = expanded.has(id)}
          {@const itemDetails = details[id]}
          <li class:expanded={isExpanded}>
            <button
              id={`phrase-button-${id}`}
              type="button"
              class="phrase-row"
              aria-expanded={isExpanded}
              aria-controls={`phrase-details-${id}`}
              on:click={() => togglePhrase(item)}
            >
              <span class="phrase-name">
                {#if isEnglish}
                  <span class="phrase-english">{item.key}</span>
                {:else}
                  <span class="phrase-greek" lang="grc">{betaToGreek(item.key)}</span>
                  <span class="phrase-key">{item.key}</span>
                {/if}
              </span>
              <span class="metric wide" data-label="Words">{item.row[0]}</span>
              <span class="metric" data-label="Count">{countFormat.format(item.row[1])}</span>
              <span class="metric" data-label="Works">{item.row[3]}</span>
              <span class="metric score wide" data-label="Score">{scoreFormat.format(item.row[2])}</span>
              <svg class="caret" width="10" height="6" viewBox="0 0 10 6" aria-hidden="true" fill="currentColor"><path d="M0 0l5 6 5-6z"/></svg>
            </button>

            {#if isExpanded}
              <div
                id={`phrase-details-${id}`}
                class="phrase-details"
                role="region"
                aria-labelledby={`phrase-button-${id}`}
              >
                {#if item.row[4]}
                  <p class="crossing-note">
                    {countFormat.format(item.row[4])}
                    {item.row[4] === 1 ? ' occurrence crosses' : ' occurrences cross'}
                    from one speaker's turn into the next.
                  </p>
                {/if}

                {#if itemDetails?.loading}
                  <p class="detail-status" aria-live="polite">Resolving citations from the corpus offsets…</p>
                {:else if itemDetails?.error}
                  <p class="detail-status error" role="alert">{itemDetails.error}</p>
                {:else if itemDetails}
                  {#each itemDetails.works as group}
                    <section class="work-citations" aria-labelledby={`phrase-${id}-${group.id}`}>
                      <div class="work-heading">
                        <h3 id={`phrase-${id}-${group.id}`}>{group.title}</h3>
                        <span>{countFormat.format(group.total)}</span>
                      </div>
                      {#if group.error}
                        <p class="detail-status error">{group.error}</p>
                      {:else}
                        <ul class="citation-list">
                          {#each group.citations as citation}
                            <li><a href={citation.href}>{citation.cite}</a></li>
                          {/each}
                        </ul>
                        {#if group.citations.length < group.total}
                          <p class="cap-note">
                            Showing {countFormat.format(group.citations.length)}
                            of {countFormat.format(group.total)} occurrences.
                          </p>
                        {/if}
                      {/if}
                    </section>
                  {/each}
                {/if}
              </div>
            {/if}
          </li>
        {/each}
      </ul>

      {#if pageCount > 1}
        <nav class="pager" aria-label="Phrase result pages">
          <button
            type="button"
            on:click={() => page -= 1}
            disabled={page === 0}
            aria-label="Previous phrase page"
          >‹ Previous</button>
          <span>Page {page + 1} of {pageCount}</span>
          <button
            type="button"
            on:click={() => page += 1}
            disabled={page >= pageCount - 1}
            aria-label="Next phrase page"
          >Next ›</button>
        </nav>
      {/if}
    {/if}
  </section>
</div>

<style>
  /* The phrase index ("More pages" in the design): the prefix field, one line
     of controls, then a ruled table with the figures in Geologica at the right.
     The head (ΦΡΑΣΕΙΣ, title, intro) is the page's, in phrases.astro. */
  .phrases-page section + section { margin-top: 0.5rem; }
  .phrases-page code { font-family: var(--font-english); font-style: italic; font-size: 1em; }

  .ctl {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.875rem 1.625rem;
    margin-top: 1.375rem;
    font-size: 0.9375rem;
    color: var(--text-mid);
  }
  .ctl-item { display: inline-flex; align-items: baseline; gap: 0.375rem; }
  /* The sort menu: the native select, set as text on a dotted underline. */
  .ctl-sel { position: relative; display: inline-flex; align-items: baseline; color: var(--text); border-bottom: 1px dotted var(--text); }
  .ctl-sel .ctl-caret { position: absolute; right: 0; top: 50%; translate: 0 -40%; pointer-events: none; }
  .ctl-caret { margin-left: 0.3125rem; vertical-align: 0.1em; color: var(--text-mid); }
  .ctl-select {
    padding: 0 0.875rem 0 0;
    border: none;
    border-radius: 0;
    background: none;
    font: inherit;
    color: var(--text);
    cursor: pointer;
    appearance: none;
  }
  .ctl-select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .ctl-number {
    width: 3.25rem;
    padding: 0;
    border: none;
    border-bottom: 2px solid var(--text);
    border-radius: 0;
    background: none;
    font: inherit;
    color: var(--text);
    text-align: center;
  }
  .ctl-number:focus { outline: none; border-bottom-color: var(--accent); }
  .ctl-menu { position: relative; }
  .ctl-menu > summary { list-style: none; cursor: pointer; }
  .ctl-menu > summary::-webkit-details-marker { display: none; }
  .ctl-menu > summary b { font-weight: 400; color: var(--text); border-bottom: 1px dotted var(--text); }
  .ctl-menu > summary:hover b { color: var(--accent); border-bottom-color: var(--accent); }
  .ctl-menu > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  /* A menu's panel floats: stone, a 1px ink edge and the menus' shadow. */
  .ctl-panel {
    position: absolute;
    top: calc(100% + 0.5rem);
    left: 0;
    z-index: 20;
    display: grid;
    gap: 0.5rem;
    min-width: 11rem;
    margin: 0;
    padding: 0.875rem 1rem;
    border: 1px solid var(--text);
    background: var(--page-bg);
    box-shadow: 0 10px 24px -12px rgba(0, 0, 0, 0.4);
    color: var(--text);
  }
  .works-panel { width: min(34rem, calc(100vw - 2.5rem)); }
  .work-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    gap: 0.375rem 1rem;
    max-height: 18rem;
    overflow-y: auto;
    margin: 0;
    padding: 0;
    border: none;
  }
  .clear-works { justify-self: start; }
  /* A check: a square ink box, a blue square inside when ticked. */
  .ck { display: inline-flex; align-items: center; gap: 0.5rem; color: var(--text); cursor: pointer; }
  .ck input {
    appearance: none;
    flex: none;
    display: inline-grid;
    place-content: center;
    width: 0.9375rem;
    height: 0.9375rem;
    margin: 0;
    border: 1.5px solid var(--text);
    border-radius: 0;
    background: none;
    cursor: pointer;
  }
  .ck input:checked::before { content: ''; width: 0.5rem; height: 0.5rem; background: var(--accent); }
  .ck input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .ctl-help { margin-left: auto; color: var(--text-mid); text-decoration: none; border-bottom: 1px solid var(--border); }
  .ctl-help:hover { color: var(--accent); border-bottom-color: var(--accent); }

  .results-head { justify-content: space-between; margin-top: 1.75rem; }
  .loaded-shard {
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.6875rem;
    letter-spacing: var(--caps-tracking);
    text-transform: uppercase;
  }

  .phrase-start { margin-top: 1.5rem; max-width: 42.5rem; }
  .phrase-start > p { margin: 0; font-size: 1.0625rem; line-height: 1.6; }
  .phrase-examples { margin: 1rem 0 0; padding: 0; list-style: none; border-top: 1px solid var(--text); }
  .phrase-example {
    display: grid;
    gap: 0.125rem;
    width: 100%;
    padding: 0.75rem 0;
    border: none;
    border-bottom: 1px solid var(--border);
    background: none;
    font: inherit;
    text-align: left;
    color: var(--text);
    cursor: pointer;
  }
  .phrase-example span { font-family: var(--font-greek); font-size: 1.3125rem; }
  .phrase-example small { font-size: 0.875rem; font-style: italic; color: var(--text-mid); }
  .phrase-example:hover span { color: var(--accent); }
  .phrase-start-browse { margin: 1.25rem 0 0; font-size: 1rem; color: var(--text-mid); }
  .letter-button {
    margin: 0 0.125rem;
    padding: 0 0.25rem;
    border: none;
    background: none;
    font-family: var(--font-english);
    font-size: 1.0625rem;
    color: var(--accent);
    cursor: pointer;
  }
  .letter-button:hover { text-decoration: underline; }

  .status { margin: 1.5rem 0 0; font-size: 1.0625rem; color: var(--text-mid); }
  .status.error, .detail-status.error { color: var(--error); }
  .text-button {
    margin-left: 0.5rem;
    padding: 0;
    border: none;
    border-bottom: 1px solid var(--accent);
    background: none;
    font: inherit;
    color: var(--accent);
    cursor: pointer;
  }

  /* The table: a header in capitals over an ink rule, then ruled rows; the
     phrase in Gentium at the left, the figures in Geologica at the right. */
  .column-head, .phrase-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 4.5rem 5.5rem 4.5rem 6rem 1.25rem;
    gap: 1rem;
    align-items: baseline;
  }
  .column-head {
    margin-top: 1.125rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--text);
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.6875rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    text-align: right;
    color: var(--text-mid);
  }
  .column-head span:first-child { text-align: left; }
  .phrase-list { margin: 0; padding: 0; list-style: none; }
  .phrase-list > li { border-bottom: 1px solid var(--border); }
  .phrase-list > li.expanded { background: var(--col-bg); }
  .phrase-row {
    width: 100%;
    padding: 0.75rem 0;
    border: none;
    background: none;
    font: inherit;
    text-align: right;
    color: var(--text);
    cursor: pointer;
  }
  .phrase-name { display: grid; gap: 0.125rem; text-align: left; }
  .phrase-greek, .phrase-english { font-family: var(--font-greek); font-size: 1.3125rem; line-height: 1.3; }
  .phrase-key { font-size: 0.875rem; font-style: italic; color: var(--text-mid); }
  .phrase-row:hover .phrase-greek, .phrase-row:hover .phrase-english { color: var(--accent); }
  .phrase-row:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .metric {
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.9375rem;
    font-variant-numeric: tabular-nums;
  }
  .caret { align-self: center; justify-self: end; color: var(--text-mid); transition: transform 0.12s ease; }
  .expanded .caret { transform: rotate(180deg); }

  .phrase-details { padding: 0 1rem 1.25rem; }
  .crossing-note, .detail-status, .cap-note { margin: 0.5rem 0 0; font-size: 0.875rem; font-style: italic; color: var(--text-mid); }
  .work-citations { margin-top: 0.875rem; }
  .work-heading { display: flex; align-items: baseline; gap: 0.75rem; }
  .work-heading h3 { margin: 0; font-family: var(--font-english); font-size: 1rem; font-weight: 400; }
  .work-heading span { font-family: var(--font-caps); font-weight: 300; font-size: 0.8125rem; color: var(--text-mid); }
  .citation-list { display: flex; flex-wrap: wrap; gap: 0.25rem 0.875rem; margin: 0.375rem 0 0; padding: 0; list-style: none; }
  .citation-list a {
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.8125rem;
    letter-spacing: 0.04em;
    color: var(--accent);
    text-decoration: none;
  }
  .citation-list a:hover { text-decoration: underline; }

  .pager {
    display: flex;
    align-items: baseline;
    justify-content: center;
    gap: 1.5rem;
    margin-top: 1.5rem;
    font-family: var(--font-caps);
    font-weight: 300;
    font-size: 0.75rem;
    letter-spacing: var(--caps-tracking);
    text-transform: uppercase;
    color: var(--text-mid);
  }
  .pager button {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    color: var(--text);
    cursor: pointer;
  }
  .pager button:hover:not(:disabled) { color: var(--accent); }
  .pager button:disabled { color: var(--text-mid); opacity: 0.5; cursor: default; }

  /* Phones: Phrase, Count and Works, as the design's phone page sets them. */
  @media (max-width: 680px) {
    .ctl { gap: 0.75rem 1.25rem; }
    .ctl-help { margin-left: 0; }
    .ctl-panel { position: fixed; top: auto; bottom: 0; left: 0; right: 0; max-height: 70vh; overflow-y: auto; }
    .works-panel { width: auto; }
    .column-head, .phrase-row { grid-template-columns: minmax(0, 1fr) 4.5rem 3.5rem 1rem; gap: 0.75rem; }
    .wide { display: none; }
    .phrase-greek, .phrase-english { font-size: 1.125rem; }
    .metric { font-size: 0.8125rem; }
  }
</style>
