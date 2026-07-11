<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { fetchColumns, resolveBekker, type ColumnRef } from '../lib/data';
  import { schemeFor, formatLocValue } from '../lib/citation';
  import { getWork, workPath } from '../lib/works';

  export let work: string = 'EN';
  // Navigation strategy: the site leaves this unset and navigates the tab;
  // the desktop shell passes a callback (a Tauri window has no URL routing).
  // `line` is null for a scheme with no user-facing lines (stephanus) or for
  // a bare-column jump on any scheme.
  export let onJump: ((book: number, column: string, line: number | null) => void) | null = null;
  // Hosts that mount more than one instance per page must pass distinct ids
  // (the site's ReaderShell mounts two) or the label/input pairing collides.
  // Deterministic prop rather than a generated id: this component is
  // server-rendered, so a random/counter id would break hydration.
  export let inputId = 'bekker-input';

  $: workMeta = getWork(work);
  // Scheme-aware citation grammar/copy: bekker/busse take a line ("1097a15"),
  // stephanus is page+letter only ("34b") — see shared/lib/citation.ts. This
  // makes the jump box work for any work's citation scheme, not just Bekker's.
  $: citeScheme = schemeFor(work);

  let open = false;
  let value = '';
  let error = '';
  let columns: Record<string, ColumnRef[]> | null = null;
  let inputEl: HTMLInputElement | undefined;

  // Preload the column index so the first lookup is instant; re-preload when
  // the shell switches works under us (desktop).
  onMount(() => { preload(); });
  $: if (work) preload();
  function preload() {
    columns = null;
    fetchColumns(work).then(c => (columns = c)).catch(() => {});
  }

  async function openBox() {
    open = true;
    error = '';
    await tick();
    inputEl?.focus();
  }

  function closeBox() {
    open = false;
    error = '';
    value = '';
  }

  async function go() {
    error = '';
    // Scheme-aware: accepts a bare column ("34b") for any scheme, and a
    // column+line citation ("1097a15"/"1097a:15") only for a scheme with
    // user-facing lines — a stephanus work rejects "34b12" rather than
    // silently truncating it (see shared/lib/citation.ts).
    const ref = citeScheme.parseLocation(value);
    if (!ref) {
      error = `Enter a ${citeScheme.label.toLowerCase()}, ${citeScheme.jumpPlaceholder}`;
      return;
    }
    const cols = columns ?? (await fetchColumns(work).catch(() => null));
    if (!cols) { error = 'Could not load the index — try again'; return; }
    const book = resolveBekker(cols, ref.column, ref.line);
    if (book == null) {
      error = `${ref.column} is not in the ${workMeta?.title ?? 'text'}`;
      return;
    }
    if (onJump) {
      closeBox();
      onJump(book, ref.column, ref.line);
      return;
    }
    // Same-tab navigation; the reader snaps to the nearest line if exact is absent.
    window.location.href = `${import.meta.env.BASE_URL.replace(/\/$/, '')}${workPath(work, book)}?loc=${formatLocValue(work, ref.column, ref.line)}`;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); closeBox(); }
  }
</script>

{#if !open}
  <button class="bekker-toggle" on:click={openBox} title="Look up a {citeScheme.label}">
    Go to {citeScheme.label}
  </button>
{:else}
  <form class="bekker-jump" on:submit|preventDefault={go} role="search">
    <label class="bekker-label" for={inputId}>{citeScheme.label}</label>
    <input
      id={inputId}
      type="text"
      bind:this={inputEl}
      bind:value
      on:keydown={onKey}
      on:input={() => (error = '')}
      placeholder={citeScheme.jumpPlaceholder}
      aria-label="Jump to a {citeScheme.label}"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
    />
    <button type="submit">Go</button>
    <button type="button" class="bekker-close" on:click={closeBox} aria-label="Close">✕</button>
    {#if error}<span class="bekker-err" role="alert">{error}</span>{/if}
  </form>
{/if}
