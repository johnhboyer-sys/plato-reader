<script lang="ts">
  // "Where else": every other place the selected run of Greek words stands,
  // from the stage 8 phrase index, by form or by dictionary word. Opened from
  // the reader's selection bar; styles in global.css (.where-else).
  import { betaToGreek } from '../lib/betacode';
  import {
    citationsFor,
    findOccurrences,
    foldKey,
    type Citation,
    type GreekStream,
  } from '../lib/corpus-tools';
  import { fetchAnalyses } from '../lib/data';
  import { loadOffsets } from '../lib/search';
  import { WORK_ORDER, getWork } from '../lib/works';

  export let keys: string[] = [];
  export let words = '';
  // The work the selection is in and its words' unfolded keys: with them, each
  // word's primary analysis orders the dictionary-word readings.
  export let work = '';
  export let tokenKeys: string[] = [];
  export let onClose: () => void = () => {};

  interface WorkHits { work: string; title: string; total: number; citations: Citation[] }
  // One per dictionary-word reading; by form, a single group with no heading.
  interface Group { key: string; total: number; works: WorkHits[] }

  const CITATION_CAP = 40;
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
  const fmt = new Intl.NumberFormat('en-US');

  let stream: GreekStream = 'form';
  let loading = true;
  let error = '';
  let groups: Group[] = [];
  let searched = 0;
  let totalReadings = 0;
  let request = 0;

  $: total = groups.reduce((n, g) => n + g.total, 0);
  $: workCount = new Set(groups.flatMap((g) => g.works.map((w) => w.work))).size;
  $: void run(stream, keys.join(' '));

  // Each word's headword in its primary analysis, null where unknown.
  async function primaries(): Promise<Array<string | null>> {
    if (!work || tokenKeys.length !== keys.length) return [];
    const analyses = await fetchAnalyses(work).catch(() => null);
    return tokenKeys.map((k) => {
      const first = analyses?.[k]?.[0];
      return first ? foldKey(first.lemma) : null;
    });
  }

  async function run(s: GreekStream, _sig: string) {
    const mine = ++request;
    loading = true;
    error = '';
    try {
      const found = await findOccurrences(s, keys, s === 'lemma' ? await primaries() : []);
      const next = await Promise.all(found.groups.map(async (g) => {
        const works = Object.keys(g.byWork).sort(
          (a, b) => (WORK_ORDER.get(a) ?? 1e9) - (WORK_ORDER.get(b) ?? 1e9),
        );
        return {
          key: g.key,
          total: g.count,
          works: await Promise.all(works.map(async (w) => {
            const globals = g.byWork[w];
            const offsets = await loadOffsets(w);
            return {
              work: w,
              title: getWork(w)?.title ?? w,
              total: globals.length,
              citations: citationsFor(w, offsets, globals.slice(0, CITATION_CAP), BASE),
            };
          })),
        };
      }));
      if (mine !== request) return;
      groups = next;
      searched = found.searched;
      totalReadings = found.total;
    } catch {
      if (mine !== request) return;
      groups = [];
      error = 'The phrase index could not be loaded.';
    } finally {
      if (mine === request) loading = false;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window on:keydown={onKey} />

<div class="where-else" role="dialog" aria-label="Where else">
  <div class="where-else-head">
    <h2 class="where-else-title"><span class="where-else-label">Where else</span> <span lang="grc">{words}</span></h2>
    <button type="button" class="where-else-close" aria-label="Close" on:click={onClose}>×</button>
  </div>
  <div class="xp-switch" role="group" aria-label="Match by">
    <button type="button" aria-pressed={stream === 'form'} on:click={() => (stream = 'form')}>As written</button>
    <button type="button" aria-pressed={stream === 'lemma'} on:click={() => (stream = 'lemma')}>Dictionary words</button>
  </div>
  {#if loading}
    <p class="where-else-status" aria-live="polite">Loading…</p>
  {:else if error}
    <p class="where-else-status" role="alert">{error}</p>
  {:else}
    {#if stream === 'lemma' && searched < totalReadings}
      <p class="where-else-cap">Searched {fmt.format(searched)} of {fmt.format(totalReadings)} readings</p>
    {/if}
    {#if !groups.length}
      <p class="where-else-status">Only here.</p>
    {/if}
    {#if stream === 'form' && groups.length}
      <p class="where-else-count" aria-live="polite">
        {fmt.format(total)} {total === 1 ? 'time' : 'times'} in {workCount} {workCount === 1 ? 'work' : 'works'}
      </p>
    {/if}
    {#each groups as g (g.key)}
      <section class="where-else-reading">
        {#if stream === 'lemma'}
          <h3><span lang="grc">{betaToGreek(g.key)}</span> <span class="n">{fmt.format(g.total)}</span></h3>
        {/if}
        {#each g.works as w (w.work)}
          <section class="where-else-work">
            <svelte:element this={stream === 'lemma' ? 'h4' : 'h3'}><span>{w.title}</span> <span class="n">{fmt.format(w.total)}</span></svelte:element>
            <ul class="where-else-cites">
              {#each w.citations as c}
                <li><a href={c.href}>{c.cite}</a></li>
              {/each}
            </ul>
            {#if w.citations.length < w.total}
              <p class="where-else-cap">{fmt.format(w.citations.length)} of {fmt.format(w.total)}</p>
            {/if}
          </section>
        {/each}
      </section>
    {/each}
  {/if}
</div>
