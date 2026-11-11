<script lang="ts">
  // Compare two works: the two- to five-word phrases both use, from the stage 8
  // occurrence files, with each work's Stephanus citations side by side.
  // Styles in global.css (.cw-).
  import { betaToGreek } from '../lib/betacode';
  import { fetchNgramOccurrences } from '../lib/data';
  import {
    GREEK_FUNCTION_LEMMATA,
    citationsFor,
    contentWords,
    grammaticalForms,
    sharedPhrases,
    type Citation,
    type GreekStream,
    type SharedPhrase,
  } from '../lib/corpus-tools';
  import { loadOffsets, type Offsets } from '../lib/search';
  import { WORKS, getWork } from '../lib/works';

  // The occurrence files stage 8 wrote, per stream ("t-2" = t.json's 2-word
  // phrases), read off the built directory by the page.
  export let occFiles: Partial<Record<GreekStream, string[]>> = {};

  type Sort = 'count' | 'length' | 'alphabetical';

  const PAGE_SIZE = 50;
  const CITATION_CAP = 20;
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
  const fmt = new Intl.NumberFormat('en-US');

  let workA = '';
  let workB = '';
  let stream: GreekStream = 'form';
  let hideCommon = true;
  let sort: Sort = 'count';
  let page = 0;

  // The loaded occurrence files, per stream: loaded once, kept for the visit.
  const loaded: Partial<Record<GreekStream, Array<Record<string, Record<string, number[]>>>>> = {};
  let files: Array<Record<string, Record<string, number[]>>> | null = null;
  let loading = false;
  let error = '';
  let request = 0;
  let offsets: Record<string, Offsets> = {};
  // The grammatical words among the shared phrases' words (corpus-tools).
  let grammatical: ReadonlySet<string> = GREEK_FUNCTION_LEMMATA;

  $: ready = !!workA && !!workB && workA !== workB;
  $: if (ready) void load(stream, workA, workB);
  $: rows = ready && files ? sharedPhrases(files, workA, workB) : [];
  $: shown = rows
    .filter((r) => !hideCommon || contentWords(r.key, grammatical) > 0)
    .sort((x, y) => compare(x, y, sort));
  $: pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  $: if (page >= pageCount) page = pageCount - 1;
  $: pageRows = shown.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  $: titleA = getWork(workA)?.title ?? workA;
  $: titleB = getWork(workB)?.title ?? workB;

  function compare(x: SharedPhrase, y: SharedPhrase, how: Sort): number {
    if (how === 'length') return y.n - x.n || x.key.localeCompare(y.key);
    if (how === 'alphabetical') return x.key.localeCompare(y.key);
    return (y.a.length + y.b.length) - (x.a.length + x.b.length) || x.key.localeCompare(y.key);
  }

  async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    }));
  }

  async function load(s: GreekStream, a: string, b: string) {
    const mine = ++request;
    error = '';
    page = 0;
    try {
      if (!loaded[s]) {
        files = null;
        loading = true;
        const out: Array<Record<string, Record<string, number[]>>> = [];
        await pool(occFiles[s] ?? [], 6, async (stem) => {
          const [letter, n] = stem.split('-');
          out.push(await fetchNgramOccurrences(s, letter, Number(n)));
        });
        loaded[s] = out;
      }
      const [oa, ob] = await Promise.all([loadOffsets(a), loadOffsets(b)]);
      // By form, a written word is grammatical by its headwords; by dictionary
      // word, the keys are headwords already.
      let gram: ReadonlySet<string> = GREEK_FUNCTION_LEMMATA;
      if (s === 'form') {
        const words = new Set<string>();
        for (const row of sharedPhrases(loaded[s]!, a, b)) for (const w of row.key.split(' ')) words.add(w);
        gram = await grammaticalForms(words);
      }
      if (mine !== request) return;
      offsets = { ...offsets, [a]: oa, [b]: ob };
      grammatical = gram;
      files = loaded[s]!;
    } catch {
      if (mine !== request) return;
      error = 'The phrase index could not be loaded.';
    } finally {
      if (mine === request) loading = false;
    }
  }

  function cites(work: string, globals: number[]): Citation[] {
    const o = offsets[work];
    return o ? citationsFor(work, o, globals.slice(0, CITATION_CAP), BASE) : [];
  }
</script>

{#snippet side(work: string, globals: number[])}
  {@const list = cites(work, globals)}
  <td data-work={work}>
    <span class="cw-n">{fmt.format(globals.length)}</span>
    <ul class="cw-cites">
      {#each list as c}<li><a href={c.href}>{c.cite}</a></li>{/each}
    </ul>
    {#if list.length < globals.length}
      <span class="cw-n">{fmt.format(list.length)} of {fmt.format(globals.length)}</span>
    {/if}
  </td>
{/snippet}

<div class="cw xp-body">
  <div class="cw-pick">
    <label class="cw-field">
      <span>First work</span>
      <select value={workA} on:change={(e) => (workA = e.currentTarget.value)}>
        <option value="">Choose…</option>
        {#each WORKS as w}<option value={w.id}>{w.title}</option>{/each}
      </select>
    </label>
    <label class="cw-field">
      <span>Second work</span>
      <select value={workB} on:change={(e) => (workB = e.currentTarget.value)}>
        <option value="">Choose…</option>
        {#each WORKS as w}<option value={w.id}>{w.title}</option>{/each}
      </select>
    </label>
  </div>
  <div class="cw-ctl">
    <div class="xp-switch" role="group" aria-label="Count phrases by">
      <button type="button" aria-pressed={stream === 'form'} on:click={() => (stream = 'form')}>As written</button>
      <button type="button" aria-pressed={stream === 'lemma'} on:click={() => (stream = 'lemma')}>Dictionary words</button>
    </div>
    <label class="cw-field cw-inline">
      <span>Sort</span>
      <select value={sort} on:change={(e) => { sort = e.currentTarget.value as Sort; page = 0; }}>
        <option value="count">frequency</option>
        <option value="length">length</option>
        <option value="alphabetical">alphabetical</option>
      </select>
    </label>
    <label class="cw-check">
      <input type="checkbox" bind:checked={hideCommon} on:change={() => (page = 0)} />
      <span>Hide phrases of common words only</span>
    </label>
  </div>

  {#if !ready}
    <p class="cw-status">{workA && workA === workB ? 'Choose two different works.' : 'Choose two works.'}</p>
  {:else if loading || !files}
    <p class="cw-status" aria-live="polite">Loading the phrase index…</p>
  {:else if error}
    <p class="cw-status" role="alert">{error}</p>
  {:else}
    <p class="xp-meta cw-count" aria-live="polite">
      {fmt.format(shown.length)} shared {shown.length === 1 ? 'phrase' : 'phrases'}
    </p>
    {#if shown.length}
      <table class="cw-table">
        <thead>
          <tr><th scope="col">Phrase</th><th scope="col">{titleA}</th><th scope="col">{titleB}</th></tr>
        </thead>
        <tbody>
          {#each pageRows as r (r.key)}
            <tr>
              <th scope="row"><span lang="grc">{betaToGreek(r.key)}</span></th>
              {@render side(workA, r.a)}
              {@render side(workB, r.b)}
            </tr>
          {/each}
        </tbody>
      </table>
      {#if pageCount > 1}
        <nav class="cw-pager" aria-label="Shared phrase pages">
          <button type="button" on:click={() => (page -= 1)} disabled={page === 0}>‹ Previous</button>
          <span>Page {page + 1} of {pageCount}</span>
          <button type="button" on:click={() => (page += 1)} disabled={page >= pageCount - 1}>Next ›</button>
        </nav>
      {/if}
    {/if}
  {/if}
</div>
