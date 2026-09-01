<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { lookupWord, fetchLemmata, fetchLsjHeads,
    type Analysis, type LsjEntry, type LemmaRef, type LsjHead } from '../lib/data';
  import { betaToGreek } from '../lib/betacode';
  import { renderLsjEntry } from '../lib/html';

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
    lexId++;
    lookupWord(w, k, { withLsj: useLocalLexicon })
      .then(r => { if (id !== reqId) return; analyses = r.analyses; lsj = r.lsj; })
      .catch(e => { if (id !== reqId) return; error = String(e); })
      .finally(() => { if (id === reqId) loading = false; });
  }

  // ── The dictionary entry ────────────────────────────────────────────────
  // Served by grammata (grammar-site's deploy), not rendered here: one grammata
  // deploy updates every reader site. Do not vendor, proxy, pin or cache-bust
  // this URL — its deploys ARE the update mechanism — and do not style anything
  // inside the container: the widget's CSS comes from grammata's design system
  // and changes with it.
  const GRAMMATA_LOOKUP = 'https://grammata.pages.dev/t8/lookup.js';
  // Plato ships no packaged desktop app today, so this is always false and the
  // website never fetches a shard. Kept as the same expression aristotle uses
  // so an offline build would keep rendering bundled shards without a rewrite.
  const useLocalLexicon =
    typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

  type LookupFn = (
    word: string,
    el: HTMLElement,
    opts?: { lang?: string; key?: string },
  ) => Promise<void>;

  let lexLoader: Promise<LookupFn> | null = null;
  function loadLookup(): Promise<LookupFn> {
    // @vite-ignore keeps the remote specifier out of the bundle graph — Vite
    // cannot resolve an https: import at build time and would fail the build.
    if (!lexLoader) lexLoader = import(/* @vite-ignore */ GRAMMATA_LOOKUP).then(m => m.lookup);
    return lexLoader;
  }
  // Its own counter, not loadWord's: the two requests resolve independently and
  // a slow earlier entry must not land in the container after a newer click.
  let lexId = 0;

  // Headword + homograph letter for every LSJ key, so the website never pulls a
  // whole letter shard just to spell a word. Absent manifest = the betaToGreek
  // fallback below, which is why nothing here throws.
  let heads: Record<string, LsjHead> = {};
  fetchLsjHeads().then(m => { heads = m; }).catch(() => {});

  // The lemma-page manifest (loaded once, cached): lets each analysis card offer
  // a "see all N occurrences" link into /lemma/<slug>, but only for lemmata that
  // actually have a page. Absent manifest = no links, popup unchanged.
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  let lemmata: Record<string, LemmaRef> = {};
  fetchLemmata().then(m => { lemmata = m; }).catch(() => {});
  // ── Cards are keyed by DICTIONARY ENTRY, not by Morpheus lemma ──────────
  // An analysis can name several LSJ entries. Keying on the entry means its
  // parses join each of those entries' cards, no card ever names more than one
  // entry, and there is no unresolved-parent card that opens nothing.
  const DIALECTS = ['attic', 'epic', 'doric', 'ionic', 'aeolic', 'homeric'];

  // Plato is Attic, so Attic is the unmarked default and never printed (John's
  // ruling 2026-08-30). A form with NO Attic reading is worth doubting, so it
  // says what it IS limited to. Cuts on Attic's PRESENCE, not on how many
  // dialects are named: "(attic)" alone would otherwise flag (meaningless
  // here) and "(epic ionic)" would otherwise stay silent — exactly backwards.
  function splitParse(parse: string): { text: string; dialect: string } {
    const m = /\(([^)]*)\)\s*$/.exec(parse ?? '');
    if (!m) return { text: (parse ?? '').trim(), dialect: '' };
    const named = m[1].split(/\s+/).filter(w => DIALECTS.includes(w));
    if (named.length === 0) return { text: (parse ?? '').trim(), dialect: '' };
    const text = parse.slice(0, m.index).trim();
    if (named.includes('attic')) return { text, dialect: '' };
    return { text, dialect: named.length === 1 ? `${named[0]} only` : named.join(' ') };
  }

  // LSJ marks its own homographs — νέω (A), νέω (B) — in the entry text itself.
  // Read that, never derive it from the key's trailing digit: the digit
  // disagrees on real entries, and many numbered keys carry no letter at all,
  // which must show nothing rather than a letter LSJ never printed.
  function homograph(html: string | undefined): string {
    if (!html) return '';
    const m = /^\s*\S+\s*\(([A-Z])\)/.exec(html.replace(/<[^>]+>/g, ''));
    return m ? m[1] : '';
  }

  interface EntryCard {
    id: string;
    lsjKey: string;          // '' when this analysis names no LSJ entry
    head: string;
    hom: string;             // LSJ's own homograph letter, '' when unmarked
    gloss: string;
    // Whether `gloss` came from an analysis naming this entry ALONE. An
    // analysis can fan out across several entries carrying the gloss of only
    // one of them, and first-wins then mislabels the rest.
    glossExact: boolean;
    rows: { text: string; dialect: string }[];
    ref: LemmaRef | null;
  }

  $: cards = (() => {
    const out: EntryCard[] = [];
    const byId = new Map<string, EntryCard>();
    for (const a of analyses) {
      const keys = a.lsj && a.lsj.length ? a.lsj : [''];
      // An analysis naming exactly one entry describes THAT entry; one naming
      // several is unresolved and its gloss belongs to none in particular.
      const exact = keys.length === 1;
      for (const k of keys) {
        const id = k || `lemma:${a.lemma}`;
        let card = byId.get(id);
        if (!card) {
          // Manifest first (website: no shard fetched at all), then the shard
          // (an offline build, which has it in hand), then the transliteration.
          const meta = k ? heads[k] : undefined;
          const entry = k ? lsj.find(e => e.key === k) : undefined;
          card = {
            id,
            lsjKey: k,
            head: meta?.head || entry?.head || betaToGreek(a.lemma),
            hom: meta?.hom ?? homograph(entry?.html),
            gloss: a.gloss,
            glossExact: exact,
            rows: [],
            ref: (k && lemmata[k]) || null,
          };
          byId.set(id, card);
          out.push(card);
        }
        // Precedence, in order:
        //  - a non-empty exact gloss always wins, even over an earlier exact:
        //    first-exact-wins leaves a card blank when the first of two
        //    analyses of the same entry carries no gloss.
        //  - an empty exact still marks the card exact, and CLEARS a gloss that
        //    came from a fan-out: blank is honest where the fanned-out gloss is
        //    simply another verb's meaning.
        //  - a fan-out gloss only ever fills a hole, and never overwrites.
        if (exact) {
          if (a.gloss) card.gloss = a.gloss;
          else if (!card.glossExact) card.gloss = '';
          card.glossExact = true;
        } else if (!card.glossExact && !card.gloss && a.gloss) {
          card.gloss = a.gloss;
        }
        const row = splitParse(a.parse);
        // Drop rows this card already carries: an analysis naming several
        // entries repeats its parse into all of them.
        if (!card.rows.some(r => r.text === row.text && r.dialect === row.dialect)) {
          card.rows.push(row);
        }
      }
    }
    return out;
  })();

  // Which card's entry is open. One at a time: the panel is narrow and the
  // reader came for one definition, not a stack. Nothing is fetched for a
  // reader who wanted only the parse.
  let openId = '';
  // Reset when the sidebar switches word in place, or the previous word's entry
  // would sit open under a new set of cards.
  $: if (token) openId = '';

  function toggleCard(card: EntryCard, el: HTMLElement | undefined) {
    openId = openId === card.id ? '' : card.id;
    if (openId && !useLocalLexicon && el) renderLexicon(el, card.head, card.lsjKey);
  }

  async function renderLexicon(el: HTMLElement, word: string, key: string) {
    const my = ++lexId;
    try {
      const lookup = await loadLookup();
      if (my !== lexId) return;
      // PASS THE KEY, never the surface form. A surface form makes the widget
      // re-analyse from scratch and discard the disambiguation already done
      // here — εἰσὶ returns ἵημι, εἰμί and εἶμι, so the entry under a card
      // reading "εἰμί" would be a different verb. With a key it skips its own
      // analysis entirely, and the word argument is ignored.
      await lookup(key ? '' : word, el, key ? { lang: 'grc', key } : { lang: 'grc' });
      // Re-checked after the await: the reader may have moved on mid-render.
      if (my !== lexId) return;
    } catch (e) {
      // A failed module load is the only case the widget cannot report itself
      // (it renders its own loading, not-found and network-failure states).
      if (my === lexId) el.textContent = 'Word data is not available here.';
      console.error('[grammata] lookup failed', e);
    }
  }

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
      {#each cards as card (card.id)}
        <div class="analysis-card" class:card-open={openId === card.id}>
          <button
            type="button"
            class="card-face"
            aria-expanded={openId === card.id}
            on:click={(e) => toggleCard(card, (e.currentTarget as HTMLElement)
              .parentElement?.querySelector('.grammata-mount') as HTMLElement)}
          >
            <span class="lemma" lang="grc">{card.head}{#if card.hom}<span class="lemma-hom" lang="en"> ({card.hom})</span>{/if}</span>
            <span class="gloss">{card.gloss}</span>
            <dl class="parse-rows">
              {#each card.rows as row}
                <dt>{row.text}</dt>
                <dd>{row.dialect}</dd>
              {/each}
            </dl>
            <span class="card-open-hint">
              <span class="card-arrow" aria-hidden="true">▸</span>
              {openId === card.id ? 'Hide LSJ definition' : 'Show LSJ definition'}
            </span>
          </button>

          {#if card.ref}
            <a class="lemma-link" href={`${base}/lemma/${card.ref.slug}/`}>
              Appears {card.ref.count.toLocaleString()}× across Plato
              <span class="lemma-link-arr" aria-hidden="true">→</span>
            </a>
          {/if}

          <div class="card-entry" hidden={openId !== card.id}>
            {#if useLocalLexicon}
              {#if card.lsjKey && lsj.find(e => e.key === card.lsjKey)}
                <!-- eslint-disable-next-line svelte/no-at-html-tags — sanitized by renderLsjEntry -->
                {@html renderLsjEntry(lsj.find(e => e.key === card.lsjKey)!.html, { base })}
              {:else}
                <div class="popup-loading">No dictionary entry for this form.</div>
              {/if}
            {:else}
              <div class="grammata-mount"></div>
            {/if}
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>

<!-- No <style> block here on purpose. Reader pages load global.css and nothing
     else, so a component style block ships NOWHERE — it works in `astro dev`,
     which is how .lemma-link went unstyled in production while every local
     check passed. The popup's styles live in global.css under
     "word popup: analysis cards". -->

