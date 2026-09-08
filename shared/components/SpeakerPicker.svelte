<script lang="ts">
  // The speaker control, shared by the search page and the phrase index.
  //
  // One component rather than two copies, because what makes this control
  // correct is not its markup: it is that the two reserved ids read as
  // different things, that the list is ordered by tokens rather than turns,
  // and that the coverage gap is stated before a query runs. Two copies of
  // that drift, and the drift is invisible until someone is misled.
  //
  // Everything here is built from /data/speaker-registry.json (6.6 KB) alone.
  // No speaker column is fetched to draw the picker — a column is only read
  // once a query actually needs to attribute a token.
  import { onMount } from 'svelte';
  import { fetchSpeakerRegistry, worksWithoutSpeakers, type SpeakerRegistry } from '../lib/data';
  import { SPEAKER_NONE, SPEAKER_UNKNOWN } from '../lib/search';
  import { getWork } from '../lib/works';

  export let selected: string[] = [];
  export let mode: 'include' | 'exclude' = 'include';
  // The page sets this when another tool owns the query (a combo search, or the
  // English phrase stream), with a sentence saying why.
  export let disabled = false;
  export let disabledNote = '';
  export let idPrefix = 'speaker';
  // What a filtered query cannot reach, so the page can repeat it beside its
  // results without fetching the registry a second time.
  export let uncovered: string[] = [];
  export let uncoveredTokens = 0;

  interface Row {
    value: string;      // the filter member, exactly as search.ts names it
    label: string;      // what the reader sees
    hint?: string;
    tokens: number;
    turns: number;
    works: number;
  }

  const countFormat = new Intl.NumberFormat('en-US');

  let registry: SpeakerRegistry | null = null;
  let loading = true;
  let error = '';
  let named: Row[] = [];
  let reserved: Row[] = [];
  let corpusTokens = 0;

  async function load() {
    try {
      registry = await fetchSpeakerRegistry();
      corpusTokens = registry.tokens;
      // Prominence means TOKENS, not turns. Turns vary wildly in length — a
      // narrator's single turn can outweigh hundreds of one-word assents — so
      // ordering by turns would bury the voices that do most of the talking.
      named = Object.entries(registry.speakers)
        .map(([label, counts]) => ({
          value: label,
          label,
          tokens: counts.tokens,
          turns: counts.turns,
          works: Object.keys(counts.works).length,
        }))
        .sort((a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label));

      // The two reserved ids are DIFFERENT answers and are never folded
      // together, nor into "not Socrates". Neither is called "unknown": one is
      // "nobody is speaking", the other is "somebody is, unnamed".
      reserved = [
        {
          value: SPEAKER_NONE,
          label: 'Narration, not a speech',
          hint: 'Words outside any labelled speech — a narrator’s frame, front matter, '
            + 'and every word of the works below.',
          tokens: registry.reserved.none.tokens,
          turns: registry.reserved.none.turns,
          works: Object.keys(registry.reserved.none.works).length,
        },
        {
          value: SPEAKER_UNKNOWN,
          label: 'A speech the text leaves unnamed',
          hint: 'Somebody is speaking and the source does not say who. In Lysis and '
            + 'Parmenides that is every speech in the work.',
          tokens: registry.reserved.unknown.tokens,
          turns: registry.reserved.unknown.turns,
          works: Object.keys(registry.reserved.unknown.works).length,
        },
      ];

      uncovered = worksWithoutSpeakers(registry);
      uncoveredTokens = uncovered.reduce(
        (sum, work) => sum + (registry!.reserved.none.works[work]?.tokens ?? 0),
        0,
      );
    } catch {
      error = 'The speaker list could not be loaded.';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  $: active = selected.length > 0;
  $: uncoveredTitles = uncovered.map((work) => getWork(work)?.title ?? work);
  $: uncoveredShare = corpusTokens
    ? Math.round((uncoveredTokens / corpusTokens) * 100)
    : 0;

  function clear() {
    selected = [];
  }

  // fetchSpeakerRegistry evicts its own failures from the cache, so a retry is
  // a real second request rather than a replay of the rejection.
  function retry() {
    error = '';
    loading = true;
    void load();
  }
</script>

<fieldset class="speaker-picker" class:disabled aria-describedby={`${idPrefix}-coverage`}>
  <legend>Speaker</legend>

  {#if disabled}
    <p class="speaker-note">{disabledNote}</p>
  {:else if loading}
    <p class="speaker-note" aria-live="polite">Loading the speaker list…</p>
  {:else if error}
    <p class="speaker-note error" role="alert">
      {error}
      <button type="button" class="speaker-retry" on:click={retry}>Retry</button>
    </p>
  {:else}
    <!-- Include vs exclude, spelled out. "Only these" and "everyone except
         these" are opposite questions and the difference has to be readable at
         a glance, not inferred from a plus or a minus. -->
    <div class="speaker-mode" role="radiogroup" aria-label="How to use the chosen speakers">
      <label>
        <input type="radio" name={`${idPrefix}-mode`} value="include" bind:group={mode} />
        Only these speakers
      </label>
      <label>
        <input type="radio" name={`${idPrefix}-mode`} value="exclude" bind:group={mode} />
        Everyone except these
      </label>
    </div>

    <div class="speaker-options">
      {#each named as row (row.value)}
        <label title={`${countFormat.format(row.turns)} turns in ${row.works} ${row.works === 1 ? 'work' : 'works'}`}>
          <input type="checkbox" value={row.value} bind:group={selected} />
          <span class="speaker-name">{row.label}</span>
          <span class="speaker-count">{countFormat.format(row.tokens)}</span>
        </label>
      {/each}
    </div>

    <div class="speaker-reserved">
      {#each reserved as row (row.value)}
        <label>
          <input type="checkbox" value={row.value} bind:group={selected} />
          <span>
            <span class="speaker-name">{row.label}</span>
            <span class="speaker-count">{countFormat.format(row.tokens)}</span>
            <small>{row.hint}</small>
          </span>
        </label>
      {/each}
    </div>

    <!-- Coverage, stated BEFORE a query runs. The registry alone can say which
         works have no speaker attribution, so there is no excuse for waiting
         until a result set has quietly dropped a fifth of the corpus. -->
    <p id={`${idPrefix}-coverage`} class="speaker-coverage" class:live={active}>
      {#if uncovered.length}
        A speaker filter cannot reach {uncoveredTitles.join(', ')} —
        {countFormat.format(uncoveredTokens)} words, about {uncoveredShare}% of the
        Greek. Those works are narrated: the speech in them is reported inside
        the narration rather than labelled, so there is nobody to match. With a
        speaker chosen they are left out of the search entirely, and the results
        say so.
      {:else}
        Every work carries speaker attribution.
      {/if}
    </p>

    {#if active}
      <button type="button" class="speaker-clear" on:click={clear}>
        Clear speakers ({selected.length})
      </button>
    {/if}
  {/if}
</fieldset>

<style>
  .speaker-picker {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
    font-family: var(--font-ui);
  }

  .speaker-picker legend {
    font-family: var(--font-ui);
    font-size: 0.76rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: var(--text-mid);
    margin-bottom: 0.3rem;
  }

  .speaker-picker.disabled {
    opacity: 0.75;
  }

  .speaker-mode {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 1rem;
    margin-bottom: 0.45rem;
  }

  .speaker-mode label {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.82rem;
    color: var(--text);
    cursor: pointer;
  }

  /* Two scrolled columns, like the work filter — a list box would need a
     modifier key nobody is told about, and one stray click would throw the
     whole selection away. */
  .speaker-options {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.1rem 0.75rem;
    max-height: 9.5rem;
    padding: 0.35rem 0.5rem;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--input-bg);
  }

  .speaker-options label {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.78rem;
    line-height: 1.5;
    color: var(--text);
    cursor: pointer;
  }

  .speaker-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .speaker-count {
    font-size: 0.7rem;
    font-variant-numeric: tabular-nums;
    color: var(--text-mid);
  }

  .speaker-reserved {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    margin-top: 0.45rem;
    padding: 0.45rem 0.5rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--col-bg);
  }

  .speaker-reserved label {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: 0.4rem;
    font-size: 0.78rem;
    color: var(--text);
    cursor: pointer;
  }

  .speaker-reserved small {
    display: block;
    margin-top: 0.1rem;
    font-size: 0.72rem;
    line-height: 1.4;
    color: var(--text-mid);
  }

  .speaker-note,
  .speaker-coverage {
    margin: 0.45rem 0 0;
    font-size: 0.76rem;
    line-height: 1.5;
    color: var(--text-mid);
    max-width: 62ch;
  }

  .speaker-note {
    margin-top: 0;
  }

  /* Once a filter is on, the gap stops being background and becomes part of
     the answer, so it is given the weight of one. */
  .speaker-coverage.live {
    color: var(--text);
    border-left: 2px solid var(--accent);
    padding-left: 0.6rem;
  }

  .error {
    color: var(--text);
  }

  .speaker-clear,
  .speaker-retry {
    margin-top: 0.5rem;
    padding: 0.25rem 0.55rem;
    font-family: var(--font-ui);
    font-size: 0.74rem;
    font-weight: 600;
    color: var(--accent);
    background: var(--input-bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
  }

  .speaker-retry {
    margin: 0 0 0 0.5rem;
    font-weight: 400;
  }

  input:focus-visible,
  button:focus-visible {
    outline: 2px solid var(--accent-light);
    outline-offset: 2px;
  }

  @media (max-width: 650px) {
    .speaker-options {
      grid-template-columns: 1fr;
    }
  }
</style>
