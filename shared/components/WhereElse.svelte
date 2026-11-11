<script lang="ts">
  // "Where else": every other place the selected run of Greek words stands,
  // from the stage 8 phrase index, by form or by dictionary word. Opened from
  // the reader's selection bar; styles in global.css (.where-else).
  import { betaToGreek } from '../lib/betacode';
  import {
    citationsFor,
    findOccurrences,
    type Citation,
    type GreekStream,
  } from '../lib/corpus-tools';
  import { loadOffsets } from '../lib/search';
  import { WORK_ORDER, getWork } from '../lib/works';

  export let keys: string[] = [];
  export let words = '';
  export let onClose: () => void = () => {};

  interface Group { work: string; title: string; total: number; citations: Citation[] }

  const CITATION_CAP = 40;
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
  const fmt = new Intl.NumberFormat('en-US');

  let stream: GreekStream = 'form';
  let loading = true;
  let error = '';
  let groups: Group[] = [];
  let readings: string[] = [];
  let request = 0;

  $: total = groups.reduce((n, g) => n + g.total, 0);
  $: void run(stream, keys.join(' '));

  async function run(s: GreekStream, _sig: string) {
    const mine = ++request;
    loading = true;
    error = '';
    try {
      const found = await findOccurrences(s, keys);
      const works = Object.keys(found.byWork).sort(
        (a, b) => (WORK_ORDER.get(a) ?? 1e9) - (WORK_ORDER.get(b) ?? 1e9),
      );
      const next = await Promise.all(works.map(async (work) => {
        const globals = found.byWork[work];
        const offsets = await loadOffsets(work);
        return {
          work,
          title: getWork(work)?.title ?? work,
          total: globals.length,
          citations: citationsFor(work, offsets, globals.slice(0, CITATION_CAP), BASE),
        };
      }));
      if (mine !== request) return;
      groups = next;
      readings = found.readings;
    } catch {
      if (mine !== request) return;
      groups = [];
      readings = [];
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
  {:else if !groups.length}
    <p class="where-else-status">Only here.</p>
  {:else}
    <p class="where-else-count" aria-live="polite">
      {fmt.format(total)} {total === 1 ? 'time' : 'times'} in {groups.length} {groups.length === 1 ? 'work' : 'works'}
      {#if stream === 'lemma'}<span class="where-else-readings" lang="grc">{readings.map((r) => betaToGreek(r)).join(' · ')}</span>{/if}
    </p>
    {#each groups as g (g.work)}
      <section class="where-else-work">
        <h3><span>{g.title}</span> <span class="n">{fmt.format(g.total)}</span></h3>
        <ul class="where-else-cites">
          {#each g.citations as c}
            <li><a href={c.href}>{c.cite}</a></li>
          {/each}
        </ul>
        {#if g.citations.length < g.total}
          <p class="where-else-cap">{fmt.format(g.citations.length)} of {fmt.format(g.total)}</p>
        {/if}
      </section>
    {/each}
  {/if}
</div>
