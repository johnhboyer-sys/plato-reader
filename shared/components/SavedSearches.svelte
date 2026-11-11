<script lang="ts">
  // The Saved page (PR 8, ruling 4): the searches kept in this browser by
  // the results' Save button. Each opens, renames, takes a note, deletes and
  // copies its link; the list exports to and imports from a JSON file.
  // Store: lib/saved-searches.ts. Styles: global.css, "Saved searches".
  import { onMount, tick } from 'svelte';
  import {
    deleteSaved, exportSaved, importSaved, listSaved, noteSaved, renameSaved, type SavedSearch,
  } from '../lib/saved-searches';

  let list: SavedSearch[] | null = [];
  let ready = false;
  let status = '';
  let editing: { id: string; field: 'name' | 'note' } | null = null;
  let draft = '';
  let copyId: string | null = null;
  let fileInput: HTMLInputElement;

  const reload = () => { list = listSaved(); };
  onMount(() => { reload(); ready = true; });

  const absolute = (url: string) => new URL(url, window.location.origin).href;
  const shown = (iso: string) =>
    new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  async function edit(e: SavedSearch, field: 'name' | 'note') {
    editing = { id: e.id, field };
    draft = field === 'name' ? e.name : e.note;
    await tick();
    document.getElementById(`sv-edit-${e.id}`)?.focus();
  }
  function commit() {
    if (!editing) return;
    if (editing.field === 'name') renameSaved(editing.id, draft);
    else noteSaved(editing.id, draft);
    editing = null;
    reload();
  }
  function remove(e: SavedSearch) {
    deleteSaved(e.id);
    status = `Deleted “${e.name}”.`;
    reload();
  }
  async function copy(e: SavedSearch) {
    copyId = null;
    try {
      await navigator.clipboard.writeText(absolute(e.url));
      status = 'Link copied.';
    } catch {
      // No clipboard: show the link, selected, to copy by hand.
      copyId = e.id;
      status = '';
      await tick();
      const box = document.getElementById(`sv-link-${e.id}`) as HTMLInputElement | null;
      box?.focus();
      box?.select();
    }
  }
  function download() {
    if (!list) return;
    const blob = new Blob([exportSaved(list)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'plato-saved-searches.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }
  async function upload() {
    const file = fileInput.files?.[0];
    if (!file) return;
    const r = importSaved(await file.text());
    fileInput.value = '';
    status = r === null
      ? 'That file is not a saved-searches file.'
      : `Imported ${r.imported} search${r.imported === 1 ? '' : 'es'}${r.skipped ? `; skipped ${r.skipped}` : ''}.`;
    reload();
  }
</script>

<div class="saved-page">
  {#if !ready}
    <p class="sv-label">&nbsp;</p>
  {:else if list === null}
    <p class="sv-label">Saved searches are unavailable in this browser.</p>
  {:else}
    <p class="sv-label">Kept in this browser.</p>
    <div class="sv-tools">
      <button type="button" class="sv-btn" on:click={download} disabled={!list.length}>Export</button>
      <button type="button" class="sv-btn" on:click={() => fileInput.click()}>Import</button>
      <input class="sr-only" type="file" accept="application/json,.json" tabindex="-1" aria-label="Import file"
        bind:this={fileInput} on:change={upload} />
    </div>
    <p class="sv-status" role="status">{status}</p>
    {#if list.length === 0}
      <p class="sv-empty">No saved searches.</p>
    {:else}
      <ul class="sv-list">
        {#each list as e (e.id)}
          <li class="sv-item">
            {#if editing?.id === e.id && editing.field === 'name'}
              <form class="sv-edit" on:submit|preventDefault={commit}>
                <input id={`sv-edit-${e.id}`} class="sv-input" bind:value={draft} aria-label="Name" />
                <button type="submit" class="sv-btn">Done</button>
                <button type="button" class="sv-btn" on:click={() => (editing = null)}>Cancel</button>
              </form>
            {:else}
              <h2 class="sv-name">{e.name}</h2>
            {/if}
            <p class="sv-date">Saved {shown(e.date)}</p>
            {#if editing?.id === e.id && editing.field === 'note'}
              <form class="sv-edit" on:submit|preventDefault={commit}>
                <textarea id={`sv-edit-${e.id}`} class="sv-input" rows="3" bind:value={draft} aria-label="Note"></textarea>
                <button type="submit" class="sv-btn">Done</button>
                <button type="button" class="sv-btn" on:click={() => (editing = null)}>Cancel</button>
              </form>
            {:else if e.note}
              <p class="sv-note">{e.note}</p>
            {/if}
            {#if copyId === e.id}
              <input id={`sv-link-${e.id}`} class="sv-input" readonly value={absolute(e.url)} aria-label="Link" />
            {/if}
            <div class="sv-actions" role="group" aria-label={e.name}>
              <a class="sv-btn" href={e.url}>Open</a>
              <button type="button" class="sv-btn" on:click={() => edit(e, 'name')}>Rename</button>
              <button type="button" class="sv-btn" on:click={() => edit(e, 'note')}>Note</button>
              <button type="button" class="sv-btn" on:click={() => copy(e)}>Copy link</button>
              <button type="button" class="sv-btn" on:click={() => remove(e)}>Delete</button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>
