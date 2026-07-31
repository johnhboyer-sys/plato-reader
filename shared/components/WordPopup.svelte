<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { lookupWord, fetchLemmata, type Analysis, type LsjEntry, type LemmaRef } from '../lib/data';
  import { betaToGreek } from '../lib/betacode';

  export let work: string = 'EN';
  export let token: { t: string; k: string };
  export const anchor: { x: number; y: number } = { x: 0, y: 0 };
  export let onClose: () => void;
  // Compare mode packs three columns into the reading measure; on a tablet the
  // right-margin reserve would crush them, so there the panel drops to a bottom
  // sheet (like the phone layout) and the text keeps full width. See the
  // .word-sidebar.as-sheet block in global.css.
  export let asSheet: boolean = false;

  let dialogEl: HTMLDivElement;
  let previousFocus: HTMLElement | null = null;
  let analyses: Analysis[] = [];
  let lsj: LsjEntry[] = [];
  let loading = true;
  let error = '';
  // Resolved synchronously at instantiation (this component only ever mounts
  // client-side, on a word click) so the intro transition picks the right
  // direction: mobile rises from the bottom, desktop slides in from the right.
  // Reading it in onMount would be too late — Svelte evaluates transition
  // params when the element mounts, before onMount runs.
  const isMobile = typeof window !== 'undefined'
    && window.matchMedia('(max-width: 680px)').matches;
  // Whether we render as a bottom sheet: always on phones, and on tablets when
  // the caller is in compare mode (asSheet) — matches the CSS in global.css.
  const asSheetHere = typeof window !== 'undefined'
    && (isMobile || (asSheet && window.matchMedia('(min-width: 681px) and (max-width: 1100px)').matches));
  // Honour the OS "reduce motion" setting: the fly-in is decorative, so collapse
  // it to an instant appearance. (The CSS @media query can't reach Svelte's JS
  // transitions, so it's gated here too.)
  const reduceMotion = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Reactive on token.k: clicking another Greek word while the panel is open
  // swaps the analysis in place (no remount, no reflow). The request id guards
  // against out-of-order responses when the reader clicks quickly.
  let reqId = 0;
  $: loadWord(work, token.k);
  function loadWord(w: string, k: string) {
    const id = ++reqId;
    loading = true;
    error = '';
    lookupWord(w, k)
      .then(r => { if (id !== reqId) return; analyses = r.analyses; lsj = r.lsj; })
      .catch(e => { if (id !== reqId) return; error = String(e); })
      .finally(() => { if (id === reqId) loading = false; });
  }

  // The lemma-page manifest (loaded once, cached): lets each analysis card offer
  // a "see all N occurrences" link into /lemma/<slug>, but only for lemmata that
  // actually have a page. Absent manifest = no links, popup unchanged.
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  let lemmata: Record<string, LemmaRef> = {};
  fetchLemmata().then(m => { lemmata = m; }).catch(() => {});
  // A card's lemma page keys off its primary LSJ key (matching the concordance).
  const lemmaRef = (a: Analysis): LemmaRef | null =>
    (a.lsj[0] && lemmata[a.lsj[0]]) || null;

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  // Close on a completed click outside the panel — EXCEPT on a Greek token,
  // whose own click handler swaps the popup to the new word. (A blocking
  // backdrop here would swallow that click and force close-then-reopen, with
  // two page reflows; see the bug report of 2026-07-29.) A click, not a
  // pointerdown: on touch screens a scroll drag begins with a press on the
  // text, and that must not dismiss the panel.
  // Clicks inside the reader's other overlays (command palette, footnote
  // popup body, settings, help, the copy-citation button) belong to those
  // layers — the word panel must not treat them as "outside" and vanish
  // behind them. The footnote MARKER and the Bekker-info toggle are NOT in
  // the list: John's ruling 2026-07-29 — a click that raises another popup
  // (footnote, Bekker note, print menu) closes the word panel. Their
  // handlers stopPropagation(), which is why the listener below runs in the
  // capture phase — a bubble listener would never see those clicks.
  const KEEP_OPEN =
    '.word-sidebar, .tok, .cp-backdrop, .footnote-popup, '
    + '.settings-sidebar, .settings-backdrop, '
    + '.help-modal, .help-backdrop, .copy-cite-btn';
  function onOutsideClick(e: MouseEvent) {
    const t = e.target as HTMLElement | null;
    if (!t || t.closest(KEEP_OPEN)) return;
    // A text-selection drag ends in a click on the ancestor; selecting Greek
    // (e.g. for the append-citation copy) must not dismiss the panel. (A later
    // unrelated click clears the selection at mousedown, so a lingering
    // selection does not pin the panel open.)
    if (window.getSelection()?.toString()) return;
    onClose();
  }

  onMount(() => {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setTimeout(() => dialogEl?.focus({ preventScroll: true }), 0);
  });

  onDestroy(() => {
    // preventScroll: the reader pins its own scroll position across the close
    // reflow; letting focus() scroll to the old word snaps the page around.
    previousFocus?.focus({ preventScroll: true });
  });
</script>

<svelte:window on:keydown={onKey} on:click|capture={onOutsideClick} />

<!-- Desktop: slide-in sidebar. Mobile / tablet-compare: bottom sheet. Both via CSS. -->
<div
  class="word-sidebar"
  class:as-sheet={asSheet}
  bind:this={dialogEl}
  transition:fly={reduceMotion ? { duration: 0 } : asSheetHere ? { y: 600, duration: 260, opacity: 1 } : { x: 420, duration: 220, opacity: 1 }}
  role="dialog"
  aria-label="Word analysis"
  tabindex="-1"
>
  <div class="word-sidebar-head">
    <span class="popup-surface" lang="grc">{token.t}</span>
    <button class="settings-close" on:click={onClose} aria-label="Close">×</button>
  </div>
  <div class="word-sidebar-body">
    {#if loading}
      <div class="popup-loading">Looking up…</div>
    {:else if error}
      <div class="popup-loading">Error: {error}</div>
    {:else if analyses.length === 0}
      <div class="popup-loading">No analysis found for this form.</div>
    {:else}
      {#each analyses as a}
        <div class="analysis-card">
          <div class="lemma" lang="grc">{a.lsj[0] ? lsj.find(e => e.key === a.lsj[0])?.head ?? betaToGreek(a.lemma) : betaToGreek(a.lemma)}</div>
          <div class="gloss">{a.gloss}</div>
          <div class="parse">{a.parse}</div>
          {#if lemmaRef(a)}
            <a class="lemma-link" href={`${base}/lemma/${lemmaRef(a)!.slug}/`}>
              Appears {lemmaRef(a)!.count.toLocaleString()}× across Plato
              <span class="lemma-link-arr" aria-hidden="true">→</span>
            </a>
          {/if}
        </div>
      {/each}
      {#if lsj.length > 0}
        <div class="lsj-section">
          <div class="lsj-label">LSJ</div>
          {#each lsj as entry}
            <div class="lsj-entry">
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              {@html entry.html}
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  /* "See all occurrences" link into the lemma page — the popup's one bridge to
     the deeper reference view. Sits at the foot of each analysis card. */
  .lemma-link {
    display: inline-flex; align-items: center; gap: 0.35em;
    margin-top: 0.5rem; font-family: var(--font-ui); font-size: 0.8rem;
    font-weight: 600; color: var(--accent); text-decoration: none;
  }
  .lemma-link:hover { text-decoration: underline; }
  .lemma-link-arr { transition: transform .1s ease; }
  .lemma-link:hover .lemma-link-arr { transform: translateX(2px); }
</style>
