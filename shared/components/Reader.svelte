<script lang="ts">
  import { onMount, onDestroy, afterUpdate, tick } from 'svelte';
  import { fade } from 'svelte/transition';
  import { fetchBook, parseBekker, parseLocation, fetchSidenotes, fetchFigures, type Segment, type GreekLine, type Token, type BookData, type RossPiece } from '../lib/data';
  import { schemeFor, formatCite } from '../lib/citation';
  import { lineRenderParts, buildFlowRows, buildEnglishTurnBlocks, labelSuppression, type SpeakerEvent, type LineRenderPart, type FlowRow, type EnglishTurnBlock } from '../lib/speakers';
  import { assignSpeakerSlots, collectDisplayOrder } from '../lib/speaker-colors';
  import { greekFold } from '../lib/search';
  import { highlightPrefixMatches } from '../lib/text';
  import { getWork, visibleTranslations, bookLabel as workBookLabel, HOUSE_AUTHOR, type TranslationRef } from '../lib/works';
  import { touchRecent } from '../lib/resume';
  import WordPopup from './WordPopup.svelte';
  import FootnotePopup from './FootnotePopup.svelte';

  export let work: string = 'EN';
  export let bookNum: number = 1;
  // The book's segments, read at build time and passed by ReaderShell.astro so
  // the reading text is server-rendered into the static HTML (crawlable, instant
  // paint) and the island hydrates over it. When absent (e.g. a future dynamic
  // mount), the reader falls back to fetching the JSON in onMount as before.
  export let bookData: BookData | null = null;
  // Optional per-chapter section titles {chapter: title} for this book, passed
  // by ReaderShell from chapter-titles.json. Shown in the chapter heading in
  // place of "Chapter N" (used by non-Bekker works like the Isagoge).
  export let chapterTitles: Record<string, string> = {};
  // The whole-work speaker-display roster (all books), passed by ReaderShell so
  // speaker-name colours are stable across books and match the landing cast
  // list. Null on hosts that mount a single book without it (desktop).
  export let speakerRoster: string[] | null = null;

  const workMeta = getWork(work);
  // The citation scheme this work is cited by (bekker / busse / stephanus) — the
  // single dispatch point for every scheme-conditional below, in place of
  // scattered string tests. See shared/lib/citation.ts.
  const cscheme = schemeFor(work);
  // Non-Bekker works (e.g. Porphyry's Isagoge) are cited by Busse page, not a
  // Bekker column:line. For them the reader relabels the column reference (p. N),
  // hides the per-line Greek numbers and the interpolated English gutter, and
  // titles each section from chapterTitles instead of "Chapter N".
  const busse = cscheme.id === 'busse';
  // Stephanus works (Plato) are cited by page+letter only (17a); there are no
  // user-facing Greek line numbers, and each segment shows its section token in
  // the gutter. Speaker turns are rendered as inline lead-ins (see speakers.ts).
  const stephanus = cscheme.id === 'stephanus';
  // Suppress the per-line Greek numerals whenever the scheme has no user-facing
  // lines (stephanus), or a busse work that opts in via hideLineNumbers.
  const hideLineNums = !cscheme.hasUserFacingLines
    || (busse && workMeta?.citation?.hideLineNumbers === true);
  // Analytical sidenotes ({N: text}) for a busse work, floated into a right rail.
  let sidenotesData: Record<string, string> = {};
  if (busse) fetchSidenotes(work).then(d => { sidenotesData = d; }).catch(() => {});
  // Diagrams ({N: html}) rendered inline at [[figN]] markers (Tree of Porphyry).
  let figuresData: Record<string, string> = {};
  if (busse) fetchFigures(work).then(d => { figuresData = d; }).catch(() => {});
  const translations = workMeta ? visibleTranslations(workMeta) : [];
  // The reader can render any number of translations. The primary parallel
  // chunk is the 'english' slot; every other translation is a chapter-anchored
  // overlay read from its segment field (ross / third / overlays[id]).
  // `secondaries` is the ordered list of non-primary translations.
  const engSlot = translations.find(t => t.slot === 'english');
  const thirdSlot = translations.find(t => t.slot === 'third');  // bears footnotes/tables
  // The translation(s) whose prose carries [^label] footnote markers
  // (Ostwald's third slot, a primary like the Isagoge's Owen, or — Phase 4B —
  // any imported overlay whose file carried a footnotes block, flagged via
  // the same TranslationRef.footnotes bit by desktop/src/lib/imports.ts's
  // installHooks). Every such id's column renders the markers and opens the
  // footnote popup. thirdSlot is ALWAYS included (not just as a fallback when
  // nothing is explicitly flagged) so an import gaining footnotes:true never
  // silently un-flags Ostwald — this generalizes the old single-id
  // `fnTransId` without changing behavior for any existing work (today,
  // across the whole corpus, this set never has more than one member: either
  // the one explicitly-flagged translation, or thirdSlot — never both, since
  // no work currently combines them).
  const fnTransIds = new Set([
    ...translations.filter(t => t.footnotes).map(t => t.id),
    ...(thirdSlot ? [thirdSlot.id] : []),
  ]);
  const secondaries = translations.filter(t => t.slot !== 'english');
  const canCompare = translations.length >= 2;
  // Overlay pieces for a translation in a segment, selected by its slot.
  const piecesFor = (seg: Segment, t: TranslationRef | undefined | null): RossPiece[] => {
    if (!t) return [];
    if (t.slot === 'ross') return seg.ross ?? [];
    if (t.slot === 'third') return seg.third ?? [];
    if (t.slot === 'overlay') return seg.overlays?.[t.id] ?? [];
    return [];
  };
  const transById = (id: string | null | undefined): TranslationRef | null =>
    id ? (translations.find(t => t.id === id) ?? null) : null;

  // §Phase-4B-revised (John's call 2026-07-06): an imported translation's own
  // converter-derived chapter title is this edition's editorial paratext, not
  // work-level chrome — it renders as a small unaligned heading INSIDE that
  // import's own overlay column (see transFlow below), never merged into the
  // shared chapterTitles heading map above. Resolved through a window-level
  // hook installed by desktop/src/lib/imports.ts's installHooks(), the same
  // site-shared pattern __ARISTOTLE_IMPORT_FOOTNOTE_HOOK__ uses (see
  // FootnotePopup.svelte) — this component is SHARED with the static site
  // build, which never installs the hook, so the lazy read below is always
  // undefined there: inert, byte-identical rendering. Render-only: sourced
  // from ImportRecord.titles, never written into any offset-bearing text
  // stream, so no anchor ever shifts.
  function importChapterTitle(transId: string, chapter: string | null): string {
    if (!chapter) return '';
    const hook = (globalThis as {
      __ARISTOTLE_IMPORT_TITLE_HOOK__?: (work: string, id: string, book: number, chapter: string) => string | null;
    }).__ARISTOTLE_IMPORT_TITLE_HOOK__;
    return (hook ? hook(work, transId, bookNum, chapter) : null) ?? '';
  }

  // Compare mode shows two translations side by side; which two is chosen in the
  // settings sidebar. Defaults: primary + first secondary. Persisted per work.
  let compareLeft: string = engSlot?.id ?? translations[0]?.id ?? 'english';
  let compareRight: string = secondaries[0]?.id ?? translations[1]?.id ?? compareLeft;
  const CMPL_KEY = `reader-cmpl-${work}`;
  const CMPR_KEY = `reader-cmpr-${work}`;
  function saveCompare() {
    try { localStorage.setItem(CMPL_KEY, compareLeft); localStorage.setItem(CMPR_KEY, compareRight); } catch {}
  }
  // The two columns must differ — two identical translations is never useful.
  // Pick the first other translation to fill the freed side.
  function otherTrans(exclude: string): string {
    return translations.find(t => t.id !== exclude)?.id ?? exclude;
  }
  function pickCompareLeft() {
    if (compareLeft === compareRight) compareRight = otherTrans(compareLeft);
    saveCompare(); setTrans('compare');
  }
  function pickCompareRight() {
    if (compareRight === compareLeft) compareLeft = otherTrans(compareRight);
    saveCompare(); setTrans('compare');
  }

  // Seeded from the build-time prop so SSR renders the text; stays empty (and
  // `loading` true) only in the fetch-fallback path.
  let segments: Segment[] = bookData?.segments ?? [];
  // Global turn flow of a dialogue book (stephanus): drives the turn-row
  // rendering; null keeps the section-segment rendering.
  let turnFlow = bookData?.turnFlow ?? null;
  let loading = !bookData;
  let error = '';
  // OS "reduce motion" preference — gates the JS fade transitions below, which
  // the CSS @media (prefers-reduced-motion) query can't reach. Set in onMount.
  let reduceMotion = false;

  // Search jump-in: highlight query terms + scroll to a line (?hlg=&hle=&loc=).
  let hlGrkFolds: string[] = [];
  let hlEngTerms: string[] = [];
  let targetId: string | null = null;

  // Which translation fills the English column: a translation id from the
  // registry (its slot decides what renders) or 'compare' = both slots side by
  // side. Persisted per work (works carry different translations).
  // First-load translation: the work's preferred default if it names one (and
  // it's actually visible in this build), else the primary 'english' slot. A
  // saved choice or ?trans= query param overrides this in onMount.
  const defaultTrans = translations.find(t => t.id === workMeta?.defaultTranslation)?.id;
  let trans: string = defaultTrans ?? engSlot?.id ?? translations[0]?.id ?? 'english';
  // The translation ids currently on screen: the single selection, or the two
  // compare columns. Drives the gutter disclaimer and the citation strip.
  $: shownTransIds = trans === 'compare' ? [compareLeft, compareRight] : [trans];
  // Whether a translation carries any approximate (interpolated) Bekker ticks in
  // a segment — overlays whose gutter is fully anchored show none, so the note
  // is suppressed for them.
  const transApprox = (seg: Segment, id: string): boolean => {
    const t = transById(id);
    if (!t) return false;
    if (t.slot === 'english') return !!seg.english?.bekker?.some((x) => !x.real);
    return piecesFor(seg, t).some((p) => p.bekker?.some((x) => !x.real));
  };
  $: hasApproxTicks = view !== 'greek'
    && segments.some((seg) => shownTransIds.some((id) => transApprox(seg, id)));
  const TRANS_KEY = `reader-trans-${work}`;
  const CITE_KEY  = 'reader-cite-copy';
  // The "ℹ︎ Bekker numbers" popover (upright = fixed, italic = estimate).
  let bekkerInfoOpen = false;
  let citeCopy = true;
  function saveCiteCopy() { try { localStorage.setItem(CITE_KEY, String(citeCopy)); } catch {} }

  // ── Speaker-name colourisation ───────────────────────────────────────────
  // OFF by default. When on, each distinct speaker in the current dialogue gets
  // one of a small palette of complementary hues (--spk-* in global.css),
  // applied to the .speaker lead-in NAME only — never the speech text. Once the
  // slot is stamped on the span as data-spk, the whole effect is CSS, so the
  // toggle merely flips a container class (.spk-color) with no re-render.
  const SPK_KEY = 'reader-spkcolor';
  // On by default; a reader who turns it off has that choice remembered
  // (onMount reads SPK_KEY, which only exists once they've toggled it).
  let spkColor = true;
  function saveSpkColor() { try { localStorage.setItem(SPK_KEY, String(spkColor)); } catch {} }
  // display → palette slot for every NAMED speaker in this book's turn flow
  // (turns, embedded `et` speeches, folded `sub` speeches). Slot assignment is
  // shared with the landing-page cast list (shared/lib/speaker-colors) so a
  // speaker gets the same hue in both. Unattributed em-dash turns have no
  // display and are never coloured.
  // Prefer the whole-work roster (passed by ReaderShell.astro) so a speaker's
  // colour is stable across every book AND matches the landing cast list; fall
  // back to the current book alone when no roster is supplied (e.g. the desktop
  // shell, which mounts a single book).
  $: spkSlots = assignSpeakerSlots(
    speakerRoster && speakerRoster.length ? speakerRoster : collectDisplayOrder([turnFlow]),
  );
  // The last single-translation choice, remembered so leaving compare mode
  // returns to it (and so the picker has something to display in compare).
  let lastSingle: string = trans;
  function setTrans(t: string) {
    trans = t;
    if (t !== 'compare') lastSingle = t;
    try { localStorage.setItem(TRANS_KEY, t); } catch {}
  }
  // The dropdowns select WHICH translation; mode (single vs compare) is chosen
  // in the settings sidebar. Picking a translation always means "show me this
  // one" — including from compare mode, which it exits.
  $: pickValue = trans === 'compare' ? lastSingle : trans;
  function onPick(e: Event) {
    setTrans((e.currentTarget as HTMLSelectElement).value);
  }

  // ── Settings sidebar ──────────────────────────────────────────────────────
  let settingsOpen = false;
  const FS_KEY = `reader-fs-${work}`;
  const LH_KEY = `reader-lh-${work}`;
  const COLW_KEY = `reader-colw-${work}`;
  // Base CSS values from global.css; scale as multipliers (1.0 = default).
  const FS_GREEK_BASE = 1.05;
  const FS_ENG_BASE   = 1.08;
  const LH_GREEK_BASE = 1.7;
  const LH_ENG_BASE   = 1.72;
  let fsScale = 1.0;
  let lhScale = 1.0;
  // Column-width scale: multiplies the layout's width caps (reader measure,
  // mono-view column measure) via --colw-scale; 1.0 = the stock layout.
  let colScale = 1.0;
  $: fsGreek = (FS_GREEK_BASE * fsScale).toFixed(3);
  $: fsEng   = (FS_ENG_BASE   * fsScale).toFixed(3);
  $: lhGreek = (LH_GREEK_BASE * lhScale).toFixed(3);
  $: lhEng   = (LH_ENG_BASE   * lhScale).toFixed(3);

  // The settings drawer is `inert` when closed (see the <aside> below), so it's
  // out of the tab order there. When open it needs the modal dance: move focus
  // in, trap Tab, and restore focus to the opener on close.
  let settingsEl: HTMLElement | undefined;
  let settingsReturnFocus: HTMLElement | null = null;
  function settingsFocusables(): HTMLElement[] {
    return settingsEl
      ? Array.from(settingsEl.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )).filter((el) => el.offsetParent !== null)
      : [];
  }
  function onSettingsKey(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const f = settingsFocusables();
    if (!f.length) { e.preventDefault(); settingsEl?.focus(); return; }
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function closeSettings() {
    if (!settingsOpen) return;
    settingsOpen = false;
    window.dispatchEvent(new CustomEvent('settings-state', { detail: { open: false } }));
    // Restore focus to the header toggle that opened the drawer.
    (settingsReturnFocus ?? document.querySelector<HTMLElement>('.settings-toggle'))?.focus();
    settingsReturnFocus = null;
  }
  function openSettings() {
    if (settingsOpen) return;
    settingsReturnFocus = document.activeElement as HTMLElement | null;
    settingsOpen = true;
    window.dispatchEvent(new CustomEvent('settings-state', { detail: { open: true } }));
    // Wait for the drawer to un-inert, then focus its close button.
    tick().then(() => (settingsEl?.querySelector('.settings-close') as HTMLElement | null)?.focus());
  }
  function saveFs() { try { localStorage.setItem(FS_KEY, String(fsScale)); } catch {} }
  function saveLh() { try { localStorage.setItem(LH_KEY, String(lhScale)); } catch {} }
  function saveColw() { try { localStorage.setItem(COLW_KEY, String(colScale)); } catch {} }
  function resetSettings() {
    fsScale = 1.0; lhScale = 1.0; colScale = 1.0; citeCopy = true; spkColor = true;
    try {
      localStorage.removeItem(FS_KEY); localStorage.removeItem(LH_KEY);
      localStorage.removeItem(COLW_KEY); localStorage.removeItem(CITE_KEY);
      localStorage.removeItem(SPK_KEY);
    } catch {}
  }

  // ── Citation shown in the controls strip ─────────────────────────────────
  // The strip is filled with the bibliographic provenance so it reads as a
  // header, not a lone toggle. The Greek source comes from the registry; the
  // translation citation from the currently-selected translation. `short` forms
  // ("Ross (1908)") sit beside the controls in bilingual view; the full forms
  // fill the otherwise-empty bar in Greek-only / English-only.
  const greekSrc = workMeta?.greekSource;
  $: selectedTrans = trans === 'compare'
    ? null
    : (translations.find(t => t.id === trans) ?? null);
  const yearOf = (s: string) => { const m = s.match(/(\d{4})/); return m ? m[1] : ''; };
  const citeShort = (t: { short: string; name: string } | null | undefined) => {
    if (!t) return '';
    const y = yearOf(t.name);
    return y ? `${t.short} (${y})` : t.short;
  };
  // Bilingual strip: short Greek source · short translation (omit either if absent).
  $: pairText = [greekSrc?.short, citeShort(selectedTrans)].filter(Boolean).join(' · ');

  type View = 'both' | 'greek' | 'english';
  let view: View = 'both';
  async function setView(v: View) {
    view = v;
    try { localStorage.setItem('reader-view', v); } catch {}
    // The tracked anchors differ by view (Greek lines vs. whole columns), so
    // rebuild the scroll-spy once the DOM reflects the new view.
    await tick();
    if (spyArmed) setupScrollSpy();
  }

  // Print / Save-as-PDF: hand the currently-rendered view to the browser's
  // native print engine. The @media print stylesheet (global.css) strips the
  // app chrome, sets page breaks, and reveals a print-only title. We print the
  // on-screen view as-is, so Both / Greek / English all work via existing CSS.
  function printReader() {
    if (typeof window === 'undefined') return;
    window.print();
  }

  // Print a single chapter by temporarily hiding all seg-rows and chapter heads
  // that don't belong to the selected chapter, then restoring after print.
  function printSingleChapter(ch: string) {
    if (typeof window === 'undefined') return;
    const toRestore: { el: HTMLElement; was: string }[] = [];
    const hide = (el: HTMLElement) => {
      toRestore.push({ el, was: el.style.display });
      el.style.display = 'none';
    };
    document.querySelectorAll<HTMLElement>('.seg-row[data-chapter]').forEach(el => {
      if (el.dataset.chapter !== ch) hide(el);
    });
    document.querySelectorAll<HTMLElement>('.chapter-head').forEach(el => {
      const m = el.id.match(/^ch-\d+-(.+)$/);
      if (!m || m[1] !== ch) hide(el);
    });
    // Hide segments where every row was hidden (so the lone seg-ref doesn't print).
    document.querySelectorAll<HTMLElement>('.segment').forEach(seg => {
      const rows = seg.querySelectorAll<HTMLElement>('.seg-row[data-chapter]');
      if (rows.length > 0 && Array.from(rows).every(r => r.style.display === 'none')) hide(seg);
    });
    window.addEventListener('afterprint', () => {
      toRestore.forEach(({ el, was }) => { el.style.display = was; });
    }, { once: true });
    window.print();
  }

  // Print-menu dropdown state (chapter selector shown when book has > 1 chapter).
  let printMenuOpen = false;
  function togglePrintMenu(e: MouseEvent) {
    e.stopPropagation();
    if (printMenuOpen) { printMenuOpen = false; return; }
    printMenuOpen = true;
    document.addEventListener('click', () => { printMenuOpen = false; }, { once: true });
  }

  // Book label for chapter headings, the live context strip, and print —
  // multi-book works only, using the work's own numbering (Roman for EN).
  $: bookLabel = workMeta && workMeta.books > 1 ? `Book ${workBookLabel(workMeta, bookNum)}` : '';
  $: bekRange = segments.length
    ? (segments.length > 1
        ? `${segments[0].column}–${segments[segments.length - 1].column}`
        : segments[0].column)
    : '';
  // Masthead pieces (critical-edition design): author eyebrow + work title;
  // the full source citation(s) adapted to the printed view live in the footer.
  $: printCite = view === 'greek'
    ? (greekSrc?.full ? `Greek text: ${greekSrc.full}` : '')
    : view === 'english'
      ? (selectedTrans?.name ? `Translation: ${selectedTrans.name}` : '')
      : [greekSrc?.full ? `Greek text: ${greekSrc.full}` : '',
         selectedTrans?.name ? `Translation: ${selectedTrans.name}` : '']
          .filter(Boolean).join('   ·   ');

  // Segments annotated with a running currentChapter so every block — including
  // continuation blocks that don't open a new chapter — knows which chapter it
  // belongs to. Used for per-chapter print filtering via data-chapter attributes.
  $: enrichedSegments = (() => {
    let runCh = '';
    return segments.map(seg => {
      const blocks = splitSegment(seg);
      return {
        seg,
        blocks: blocks.map(b => {
          if (b.chapter) runCh = b.chapter;
          return { ...b, currentChapter: runCh } as EnrichedBlock;
        }),
      };
    });
  })();

  // Ordered list of distinct chapter identifiers present in the loaded book.
  // Empty-string entries (no chapter assignment yet) are filtered out.
  $: chaptersInBook = [...new Set(
    enrichedSegments.flatMap(s => s.blocks.map(b => b.currentChapter)).filter(Boolean)
  )];

  // ── Live URL tracking (aquinas.cc style) ─────────────────────────────────
  // As the reader scrolls, rewrite the location hash to the Bekker citation at
  // the top of the reading area, so any position is a citable link. Line-level
  // when the Greek column is visible (our lineation is canonical Bekker);
  // column-level in English-only view (its line numbers are interpolated
  // estimates). history.replaceState keeps this out of back-history and avoids
  // jumping the scroll. We arm the spy only on the first user scroll so an
  // opened #citation link isn't overwritten before the reader actually moves.
  let spyObserver: IntersectionObserver | null = null;
  let spyState = new Map<Element, number | null>();
  let spyArmed = false;
  let lastCite = '';
  let suppressArmUntil = 0;   // ignore scroll-events from our own programmatic scrolls
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;

  function citeOf(el: Element): string | null {
    // Compose through the work's citation scheme so the hash reads as a real
    // citation: "1094a15" (bekker line), "17a" (stephanus — the line is dropped,
    // never "17a5"). formatCite is byte-identical to the old concatenation for
    // schemes with user-facing lines.
    const lm = el.id.match(/^L(.+)-(\d+)$/);   // greek line: L{col}-{n}
    if (lm) return formatCite(work, lm[1], Number(lm[2]));
    const cm = el.id.match(/^col-(.+)$/);       // segment/tick: col-{column} → {column}
    if (cm) return formatCite(work, cm[1]);
    // English-view row tick of the turn flow (no id — the Greek tick owns
    // col-{token}); the section token rides a data attribute instead.
    const dt = el.getAttribute('data-etick');
    return dt ? formatCite(work, dt) : null;
  }

  function updateHash(cite: string | null) {
    if (!cite || cite === lastCite) return;
    lastCite = cite;
    try { history.replaceState(history.state, '', `#${cite}`); } catch {}
    // Remember the last position per work so the work-switcher can resume here.
    try { localStorage.setItem(`reader-loc-${work}`, cite); } catch {}
  }

  // ── Live book/chapter context in the sticky controls strip ───────────────
  // Chapter heads scroll away with the text (they sit inside segments, so
  // CSS sticky can't carry them across segment boundaries); the strip shows
  // the label of the last chapter head above the reading line instead, so
  // the reader always knows where they are. Sampled on scroll, rAF-throttled.
  let liveChapter = '';
  let ctxRaf = 0;
  function updateChapterContext() {
    const strip = document.querySelector('.reader-controls');
    const boundary = (strip?.getBoundingClientRect().bottom ?? 100) + 12;
    let label = '';
    for (const h of document.querySelectorAll('.chapter-head .chapter-label')) {
      if (h.getBoundingClientRect().top <= boundary) label = h.textContent?.trim() ?? '';
      else break;
    }
    liveChapter = label;
  }
  function onCtxScroll() {
    if (ctxRaf) return;
    ctxRaf = requestAnimationFrame(() => { ctxRaf = 0; updateChapterContext(); });
  }

  function setupScrollSpy() {
    spyObserver?.disconnect();
    spyState = new Map();
    const greekVisible = view === 'greek' || view === 'both';
    // English-only view has no Greek lines to observe: section segments carry
    // ids in the segment layout; in the turn flow the row-level English ticks
    // ([data-etick]) stand in for them.
    const els = Array.from(document.querySelectorAll(
      greekVisible ? '.greek-line[id]' : '.segment[id], [data-etick]'));
    if (!els.length) return;
    const headerH = Math.round(document.querySelector('.page-header')?.getBoundingClientRect().height ?? 60);
    // The reading area starts below the sticky header AND the sticky controls
    // strip pinned beneath it, so the detection band begins at the strip's bottom.
    const ctrlBottom = document.querySelector('.reader-controls')?.getBoundingClientRect().bottom ?? 0;
    const topInset = Math.max(headerH, Math.round(ctrlBottom));
    // Detection band: a strip just below the sticky chrome. The intersecting
    // anchor highest on screen is the line currently at the top of the reading area.
    spyObserver = new IntersectionObserver((entries) => {
      for (const e of entries) spyState.set(e.target, e.isIntersecting ? e.boundingClientRect.top : null);
      let best: Element | null = null;
      let bestTop = Infinity;
      for (const [el, top] of spyState) {
        if (top != null && top < bestTop) { bestTop = top; best = el; }
      }
      if (best) updateHash(citeOf(best));
    }, { rootMargin: `-${topInset + 8}px 0px -82% 0px`, threshold: 0 });
    els.forEach((el) => spyObserver!.observe(el));
  }

  // Arm on the first genuine user scroll. Scroll events from our own
  // programmatic jumps (citation/search) fall inside the suppression window and
  // are ignored, so an opened #citation stays put until the reader moves.
  function onScrollArm() {
    if (Date.now() < suppressArmUntil) return;
    window.removeEventListener('scroll', onScrollArm);
    spyArmed = true;
    setupScrollSpy();
  }

  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (spyArmed) setupScrollSpy(); }, 200);
  }

  // Open at a Bekker citation from the URL hash: the exact Greek line if it's
  // present and visible, otherwise the owning column. Instant (no animation) so
  // it doesn't stream scroll-events, and suppressed so it doesn't self-arm.
  function scrollToCitation(column: string, line: number | null) {
    suppressArmUntil = Date.now() + 800;
    // A null line (a lineless-scheme citation like "17a", or any column-only
    // reference) targets the whole segment; otherwise the exact Greek line if
    // it's present and visible, else its owning column.
    const lineEl = line != null ? document.getElementById(`L${column}-${line}`) : null;
    if (lineEl && (lineEl as HTMLElement).offsetParent !== null) {
      lineEl.scrollIntoView({ behavior: 'auto', block: 'center' });
    } else {
      // col-{column} is the section segment (segment layout) or the section's
      // Greek gutter tick (turn flow). A hidden tick (English-only view hides
      // the Greek cells) falls back to the row-level English tick.
      const colEl = document.getElementById(`col-${column}`);
      const target = colEl && (colEl as HTMLElement).offsetParent !== null
        ? colEl
        : document.querySelector(`[data-etick="${column}"]`) ?? colEl;
      target?.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
  }

  let _onToggleSettings: () => void;
  let _onCloseSettings: () => void;

  onDestroy(() => {
    spyObserver?.disconnect();
    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', onScrollArm);
      window.removeEventListener('scroll', onCtxScroll);
      window.removeEventListener('resize', onResize);
      if (_onToggleSettings) window.removeEventListener('toggle-settings', _onToggleSettings);
      if (_onCloseSettings)  window.removeEventListener('close-settings',  _onCloseSettings);
      document.removeEventListener('mouseup', checkCopyBtn);
      document.removeEventListener('selectionchange', onSelectionChange);
    }
  });

  function isHit(surface: string): boolean {
    if (!hlGrkFolds.length) return false;
    const f = greekFold(surface);
    return f.length > 0 && hlGrkFolds.some(q => f.startsWith(q));
  }
  function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function highlightEng(text: string): string {
    // Sidenote [[sN]] and figure [[figN]] markers are rendered elsewhere (the
    // right rail / an inline figure), so strip them from the prose flow.
    text = text.replace(/\s*\[\[(?:s|fig)\d+\]\]\s*/g, ' ');
    if (!hlEngTerms.length) return esc(text);
    return highlightPrefixMatches(text, hlEngTerms);
  }
  // §Phase-3 B5: the printed number is stored as `display`; identity is the
  // (scope, number) pair encoded in the label — continuous scope's label IS
  // the display digits (label === display, zero-change case), while a scoped
  // label ("2.3.1") or a star/dagger glyph carries its display as the
  // trailing component. Pure function of the label alone, so both Reader
  // (button text) and FootnotePopup (popup header) can compute it locally
  // without threading an extra value through the marker string itself.
  function fnDisplay(label: string): string {
    if (label === '*' || label === '†') return label;
    const i = label.lastIndexOf('.');
    return i === -1 ? label : label.slice(i + 1);
  }
  // A footnote-bearing translation (Ostwald's third slot, the Isagoge's Owen,
  // or — Phase 4B — an imported overlay; see fnTransIds above) carries inline
  // `[^label]` footnote references; turn each into a clickable superscript.
  // §B4.2: the label is the full scope-qualified identity (continuous scope:
  // plain digits, unchanged from before); the button only ever displays the
  // printed number. `data-fn-trans` records which translation's footnote map
  // to resolve against (§B4.3/4.4) — needed once more than one translation on
  // the page can carry footnotes. A delegated click handler on the column
  // reads both data attributes and opens the footnote popup.
  function renderThird(text: string, transId: string): string {
    // The marker <button> is an atomic inline box, and engines may take a
    // line-break opportunity at its edge even with no space — WKWebView
    // orphans the superscript onto the next line ("pair, | ¹ one thing").
    // Glue it to the word it annotates with a nowrap wrapper. The capture
    // deliberately stops at whitespace, tag brackets, and entities so it can
    // never swallow a fragment of highlightEng's own markup; if a tag abuts
    // the marker the wrapper just holds the marker alone (no worse than
    // before).
    return highlightEng(text).replace(
      /([^\s<>&]*)\[\^([\w.*†]+)\]/g,
      (_m, lead: string, label: string) => {
        const display = fnDisplay(label);
        return `<span class="fn-anchor">${lead}<button type="button" class="fn-marker" data-fn="${label}" data-fn-trans="${transId}" aria-label="Footnote ${display}">${display}</button></span>`;
      },
    );
  }

  // A segment renders as one or more blocks split at chapter boundaries.
  // `chapter` is non-null on the block that begins a new chapter (heading shown).
  // Every English slot (primary / Ross / third) lays out as flowing prose with
  // its Bekker numbers floated into the margin at their exact offsets (see
  // flowParts). A GreekLine may be a partial slice of a real line (cont = its
  // tail half, after a mid-line chapter split): it suppresses the repeated id.
  type RLine = GreekLine & { cont?: boolean };
  interface Block { chapter: string | null; bekker: string; lines: RLine[]; flow: FlowPart[]; oflows: Record<string, FlowPart[]>; otables: Record<string, { n: number; rows: string[][] }[]>; sidenotes: number[]; figs: number[]; }
  // EnrichedBlock annotates each block with the chapter it belongs to (tracking
  // across segments so continuation blocks know their chapter too).
  interface EnrichedBlock extends Block { currentChapter: string; }
  // A flowing-prose part: either a text run (n null) or a Bekker margin marker
  // (text null) placed at an exact mid-sentence offset — no row break.
  interface FlowPart { text: string | null; n: number | null; real: boolean; para?: boolean; }

  // The char position where token `w` begins in a line's text (0 at the start,
  // text.length at/after the end), so a cut preserves the verbatim
  // punctuation/sigla between words on the correct side.
  function tokenPos(line: GreekLine, w: number): number {
    if (w <= 0) return 0;
    if (w >= line.tokens.length) return line.text.length;
    let ptr = 0;
    for (let i = 0; i < w; i++) {
      const idx = line.text.indexOf(line.tokens[i].t, ptr);
      if (idx >= 0) ptr = idx + line.tokens[i].t.length;
    }
    const cut = line.text.indexOf(line.tokens[w].t, ptr);
    return cut >= 0 ? cut : ptr;
  }

  // The sub-line covering tokens [fromW, toW) — used to split a Greek line at a
  // chapter boundary that falls mid-line (most chapters start mid-line). A
  // partial tail (fromW>0) is marked `cont` so the line number/id isn't repeated.
  function lineSlice(line: GreekLine, fromW: number, toW: number): RLine {
    fromW = Math.max(0, fromW);
    toW = Math.min(line.tokens.length, toW);
    if (fromW === 0 && toW === line.tokens.length) return line;
    let text = line.text.slice(tokenPos(line, fromW), tokenPos(line, toW));
    if (fromW > 0) text = text.replace(/^\s+/, '');
    if (toW < line.tokens.length) text = text.replace(/\s+$/, '');
    return { n: line.n, text, tokens: line.tokens.slice(fromW, toW), cont: fromW > 0 };
  }

  // Flowing prose with Bekker numbers floated into the margin at their EXACT
  // offsets (no row break, no in-text number, no sentence-boundary snapping).
  // Used for precisely-placed translations like the gloss-aligned Ross.
  function flowParts(text: string, ticks: { n: number; real: boolean; off: number }[], paraOffsets: number[] = []): FlowPart[] {
    const ts = [
      ...ticks.map(t => ({ ...t, para: false })),
      ...paraOffsets.map(off => ({ n: 0, real: false, off, para: true })),
    ].sort((a, b) => a.off - b.off || Number(a.para) - Number(b.para));
    const parts: FlowPart[] = [];
    let cur = 0;
    const addText = (s: string) => {
      const segs = s.split('\n');
      for (let i = 0; i < segs.length; i++) {
        if (i > 0) parts.push({ text: '\n', n: null, real: false });
        if (segs[i]) parts.push({ text: segs[i], n: null, real: false });
      }
    };
    for (const t of ts) {
      const off = Math.max(0, Math.min(t.off, text.length));
      if (off > cur) { addText(text.slice(cur, off)); cur = off; }
      if (t.para) {
        parts.push({ text: null, n: null, real: false, para: true });
      } else {
        parts.push({ text: null, n: t.n, real: t.real });
      }
    }
    if (cur < text.length) addText(text.slice(cur));
    return parts;
  }

  // A standalone tick span is absolutely positioned with no `top`, so its
  // static position decides which line it reads against — and a marker box
  // sitting BETWEEN two text runs attaches to the END of the previous
  // rendered line whenever the marked word starts a new one. The tick then
  // shows a full rendered line (visually a sentence) too early, at every
  // column width. Merging each tick into the FOLLOWING text run as its first
  // child pins its static position to the first line box of the text it
  // marks. (It also keeps `.para-br + .bk-seg` adjacency intact when a tick
  // lands exactly on a paragraph start.) Ticks with an attached table — or
  // with no following text run — keep the standalone rendering.
  type RenderPart = FlowPart & { tick?: { n: number; real: boolean } };
  function attachTicks(parts: FlowPart[], tableNs: Set<number> = new Set()): RenderPart[] {
    const isText = (p: FlowPart | undefined): p is FlowPart => !!p && p.text !== null && p.text !== '\n';
    const isBreak = (p: FlowPart | undefined): boolean => !!p && (p.text === '\n' || p.para === true);
    const out: RenderPart[] = [];
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      const isTick = part.text === null && part.n !== null && !part.para;
      if (isTick && part.n !== null && !tableNs.has(part.n)) {
        const next = parts[i + 1];
        if (isText(next)) {
          out.push({ ...next, tick: { n: part.n, real: part.real } });
          i += 1;
          continue;
        }
        // A tick coinciding with a paragraph boundary marks the paragraph's
        // OPENING word: emit the break first, then the opener carrying the
        // tick (leaving the tick standalone before the <br> re-creates the
        // previous-line attachment this helper exists to prevent).
        if (isBreak(next) && isText(parts[i + 2])) {
          out.push(next);
          out.push({ ...parts[i + 2], tick: { n: part.n, real: part.real } });
          i += 2;
          continue;
        }
      }
      out.push(part);
    }
    return out;
  }

  // Split a line into clickable words, the verbatim text between them, and (for
  // Stephanus dialogues) speaker lead-in labels spliced in at each turn offset.
  // The tokens hold bare words (for the popup lookup); the line `text` keeps the
  // original punctuation AND the OCT editorial sigla ( ) [ ] < > † " — so the
  // gaps render as plain, non-clickable text, preserving the critical edition.
  // The position math lives in shared/lib/speakers.ts (see lineRenderParts):
  // with no speaker events it is byte-identical to the old token/gap split.
  const speakerEvents = (seg: Segment, line: RLine): SpeakerEvent[] =>
    // Speaker offsets are char positions in the FULL line, so they only apply to
    // a whole (non-`cont`) line; stephanus never splits lines (no chapters), but
    // guard anyway so a sliced line can't attach an event at a shifted offset.
    line.cont ? [] : (seg.speakers ?? []).filter((s) => s.line === line.n);

  // Clickable parts for a table cell (same shape as a line: text + tokens;
  // tables carry no speaker turns).
  function cellParts(cell: { text: string; tokens: Token[] }): LineRenderPart[] {
    return lineRenderParts(cell.text, cell.tokens);
  }

  // Turn-flow rows for a dialogue book (the pipeline emitted turnFlow): the
  // whole book renders as one continuous flow of turn rows — each speaker's
  // statement level with its translation, Stephanus sections as gutter ticks
  // (see speakers.ts buildFlowRows). Null for narrated books / non-stephanus
  // works, which render the segment array exactly as before. Reactive because
  // a fetch-mounted reader receives segments + turnFlow after onMount.
  let flowRows: FlowRow[] | null = null;
  $: flowRows =
    stephanus && turnFlow?.turns?.length
      ? buildFlowRows(segments, turnFlow)
      : null;
  // A narrated work's paragraph-anchored flow (Republic, Apology, Charmides,
  // Letters, Lovers): the same flow renderer, but rows are paragraphs (no
  // speaker — the em-dash fallback lead-in is suppressed) with English
  // paragraph breaks (`ep`), optional embedded dialogue (`et`), and optional
  // one-sided sub-speeches (`sub`). See flowRowsView.
  $: paraFlow = turnFlow?.kind === 'para';

  // Redundant-label suppression. When a single speaker's speech is split into a
  // new row — a section-boundary split whose Greek runs on, or a folded
  // one-sided continuation (`sub`) — the pipeline re-emits the speaker name, so
  // the reader would print e.g. "Soc." twice in a row for an unbroken speech
  // (Meno 70b→c). Print convention drops the name when the same speaker
  // continues: walk the rows in render order tracking who holds the floor, and
  // flag a lead-in / sub label as redundant when it repeats the current
  // speaker's same printed label (see labelSuppression in shared/lib/speakers).
  // Dialogue flows only — narrated `et` blocks carry no canonical speaker.
  $: rowMeta = paraFlow || !flowRows ? [] : labelSuppression(flowRows);

  // English turn blocks for a narrated work's said-bearing chunk (no turnFlow):
  // each turn is its own paragraph block with its lead-in — how print editions
  // set unaligned speeches — never an inline splice, so a label can't glue to
  // the previous sentence (speakers.ts buildEnglishTurnBlocks, pure + tested).
  function englishTurnBlocks(seg: Segment): EnglishTurnBlock[] {
    return buildEnglishTurnBlocks(seg.english?.text ?? '', seg.english?.turns ?? []);
  }
  // Embedded-dialogue blocks for a paragraph-flow row carrying `et` (english.turns
  // nested inside a narrated paragraph). buildEnglishTurnBlocks gives the speaker
  // structure; we re-anchor each trimmed block inside the row's English (indexOf
  // from a moving pointer — trim only strips surrounding whitespace, so the block
  // is a genuine substring) so any paragraph breaks (`ep`) fall in the right block
  // as block-local offsets. Lets ep + et coexist without dropping either.
  type EtBlock = EnglishTurnBlock & { ep: number[] };
  function etBlocks(
    english: string,
    et: { o: number; s: string | null; d: string | null }[],
    ep: number[] | null | undefined,
  ): EtBlock[] {
    const blocks = buildEnglishTurnBlocks(
      english,
      et.map((e) => ({ offset: e.o, speaker: e.s, display: e.d })),
    );
    let ptr = 0;
    return blocks.map((b) => {
      const found = b.text ? english.indexOf(b.text, ptr) : -1;
      const rawStart = found < 0 ? ptr : found;
      ptr = rawStart + b.text.length;
      const bep = (ep ?? [])
        .map((o) => o - rawStart)
        .filter((o) => o > 0 && o < b.text.length);
      return { ...b, ep: bep };
    });
  }
  const isUnpairedDialogue = (seg: Segment): boolean =>
    stephanus && !!seg.english?.turns?.length;
  // Group a block's Greek lines into render items: runs of table rows (lines
  // carrying `cells`, e.g. the De Int 22a modal square) become one table; other
  // lines render individually.
  type GreekItem = { table: false; line: RLine } | { table: true; rows: RLine[] };
  function greekItems(lines: RLine[]): GreekItem[] {
    const items: GreekItem[] = [];
    let run: RLine[] = [];
    for (const l of lines) {
      if (l.cells && l.cells.length) { run.push(l); continue; }
      if (run.length) { items.push({ table: true, rows: run }); run = []; }
      items.push({ table: false, line: l });
    }
    if (run.length) items.push({ table: true, rows: run });
    return items;
  }

  function splitSegment(seg: Segment): Block[] {
    const greek = seg.greek;
    const text = seg.english?.text ?? '';
    const allTicks = seg.english?.bekker ?? [];
    const allParas = (seg.english?.markers ?? [])
      .filter(m => m.kind === 'paragraph')
      .map(m => m.offset);
    // The primary English slice [a, b) as flowing prose: its Bekker ticks
    // (rebased into the slice) are floated into the margin at their EXACT char
    // offsets — no sentence-snapping, no row break — so a mid-sentence Bekker
    // number renders where it actually falls instead of jumping to the next
    // sentence start (which the older snapped-row gutter did). The secondary
    // Ross slot uses the same flow model.
    const flowFor = (a: number, b: number): FlowPart[] => {
      const slice = text.slice(a, b);
      const ticks = allTicks
        .filter(t => t.offset >= a && t.offset < b)
        .map(t => ({ n: t.n, real: t.real, off: t.offset - a }))
        .sort((x, y) => x.off - y.off);
      const paras = allParas
        .filter(off => off > a && off < b)
        .map(off => off - a);
      return flowParts(slice, ticks, paras);
    };
    // Sidenote numbers ([[sN]] markers) falling in the primary English slice
    // [a, b) — the reader floats these into the right rail (busse works).
    const sidesIn = (a: number, b: number): number[] =>
      [...text.slice(a, b).matchAll(/\[\[s(\d+)\]\]/g)].map(m => Number(m[1]));
    // Diagram numbers ([[figN]] markers) in the slice — rendered inline as figures.
    const figsIn = (a: number, b: number): number[] =>
      [...text.slice(a, b).matchAll(/\[\[fig(\d+)\]\]/g)].map(m => Number(m[1]));
    // Overlay slices for each secondary translation, paired to blocks: the
    // continuation slice (a chapter begun in an earlier column) and one per
    // chapter that starts here. Each lays out as flowing prose with its Bekker
    // numbers floated into the margin at exact offsets. Keyed by translation id
    // so any number of overlays render (the 'third'/footnote-bearing one also
    // carries diagram tables).
    const secPieces = secondaries.map((t) => ({ t, pieces: piecesFor(seg, t) }));
    const flowOf = (p: RossPiece | undefined): FlowPart[] =>
      (!p || !p.text) ? [] : flowParts(p.text, (p.bekker ?? []).map(t => ({ n: t.n, real: t.real, off: t.offset })));
    const pieceCont = (pieces: RossPiece[]) => pieces.find(p => p.cont) ?? pieces[0];
    const pieceFor = (pieces: RossPiece[], chapter: string | null) =>
      pieces.find(p => !p.cont && p.chapter === chapter);
    // {transId: flow} + {transId: tables} for a block, picking each overlay's
    // continuation slice or the slice for `chapter` (null → continuation).
    const overlaysFor = (chapter: string | null): { oflows: Record<string, FlowPart[]>; otables: Record<string, { n: number; rows: string[][] }[]> } => {
      const oflows: Record<string, FlowPart[]> = {};
      const otables: Record<string, { n: number; rows: string[][] }[]> = {};
      for (const { t, pieces } of secPieces) {
        const p = chapter === null ? pieceCont(pieces) : pieceFor(pieces, chapter);
        oflows[t.id] = flowOf(p);
        if (p?.tables?.length) otables[t.id] = p.tables;
      }
      return { oflows, otables };
    };

    const starts = (seg.chapterStarts ?? []).slice()
      .sort((a, b) => a.beforeLine - b.beforeLine || (a.wordIndex || 0) - (b.wordIndex || 0));
    if (!starts.length) return [{ chapter: null, bekker: '', lines: greek, flow: flowFor(0, text.length), sidenotes: sidesIn(0, text.length), figs: figsIn(0, text.length), ...overlaysFor(null) }];

    const lineIdx = (beforeLine: number) => {
      const i = greek.findIndex(l => l.n >= beforeLine);
      return i === -1 ? greek.length : i;
    };
    // Each chapter boundary is a cut at (line index, word index within the line).
    const bounds = starts.map(s => ({
      chapter: s.chapter, bekker: s.bekker, engOffset: s.engOffset,
      idx: lineIdx(s.beforeLine), word: s.wordIndex || 0,
    }));

    // The Greek lines spanning a block from cut (idxA,wA) to cut (idxB,wB),
    // splitting the boundary lines mid-line where wA/wB > 0.
    const linesFor = (idxA: number, wA: number, idxB: number, wB: number): RLine[] => {
      if (idxA >= greek.length) return [];
      if (idxA === idxB) {                       // block lies within one line
        const sl = lineSlice(greek[idxA], wA, wB);
        return sl.tokens.length || sl.text.trim() ? [sl] : [];
      }
      const res: RLine[] = [];
      for (let i = idxA; i < idxB && i < greek.length; i++) {
        res.push(i === idxA && wA > 0 ? lineSlice(greek[i], wA, greek[i].tokens.length) : greek[i]);
      }
      if (wB > 0 && idxB < greek.length) res.push(lineSlice(greek[idxB], 0, wB));
      return res;
    };

    const blocks: Block[] = [];
    const first = bounds[0];
    // Lines/English before the first chapter start continue the previous chapter.
    if (first.idx > 0 || first.word > 0 || starts[0].engOffset > 0) {
      blocks.push({
        chapter: null, bekker: '',
        lines: linesFor(0, 0, first.idx, first.word),
        flow: flowFor(0, starts[0].engOffset), sidenotes: sidesIn(0, starts[0].engOffset), figs: figsIn(0, starts[0].engOffset), ...overlaysFor(null),
      });
    }
    for (let i = 0; i < bounds.length; i++) {
      const b = bounds[i];
      const next = bounds[i + 1];
      const engTo = next ? next.engOffset : text.length;
      blocks.push({
        chapter: b.chapter, bekker: b.bekker,
        lines: linesFor(b.idx, b.word, next ? next.idx : greek.length, next ? next.word : 0),
        flow: flowFor(b.engOffset, engTo), sidenotes: sidesIn(b.engOffset, engTo), figs: figsIn(b.engOffset, engTo), ...overlaysFor(b.chapter),
      });
    }
    return blocks;
  }

  // Active popup state
  let popup: { token: Token; anchor: { x: number; y: number } } | null = null;
  // Active footnote popup (footnote-bearing translations' `[^label]`
  // markers). Opens on hover, with a short close-delay so the cursor can
  // travel from the marker into the popup without it vanishing; click/Enter
  // also open it (touch + keyboard). §B4.3: carries `transId` (from the
  // marker's `data-fn-trans`) alongside the label, so FootnotePopup knows
  // WHICH translation's footnote map to resolve `n` against.
  let footnote: { n: string; transId: string; anchor: { x: number; y: number } } | null = null;
  // A click PINS the popup open (it stays until you dismiss it); hover opens it
  // transiently with a short close delay. Pinning makes click-to-read reliable.
  let fnPinned = false;
  let fnCloseTimer: ReturnType<typeof setTimeout> | null = null;
  function cancelFnClose() {
    if (fnCloseTimer) { clearTimeout(fnCloseTimer); fnCloseTimer = null; }
  }
  function scheduleFnClose() {
    if (fnPinned) return;            // a clicked (pinned) note ignores hover-out
    cancelFnClose();
    fnCloseTimer = setTimeout(() => { footnote = null; fnCloseTimer = null; }, 180);
  }
  function showFootnote(marker: Element, pin = false) {
    cancelFnClose();
    if (pin) fnPinned = true;
    const n = marker.getAttribute('data-fn') ?? '';
    const transId = marker.getAttribute('data-fn-trans') ?? '';
    if (footnote?.n === n && footnote?.transId === transId) return;
    const r = marker.getBoundingClientRect();
    footnote = { n, transId, anchor: { x: r.left, y: r.bottom } };
  }
  function onFootnoteOver(e: MouseEvent) {
    const marker = (e.target as HTMLElement | null)?.closest?.('.fn-marker');
    if (marker) showFootnote(marker);
  }
  function onFootnoteOut(e: MouseEvent) {
    if ((e.target as HTMLElement | null)?.closest?.('.fn-marker')) scheduleFnClose();
  }
  function onFootnoteFocus(e: FocusEvent) {
    const marker = (e.target as HTMLElement | null)?.closest?.('.fn-marker');
    if (marker) showFootnote(marker);
  }
  function onFootnoteBlur(e: FocusEvent) {
    if ((e.target as HTMLElement | null)?.closest?.('.fn-marker')) scheduleFnClose();
  }
  function onFootnoteClick(e: MouseEvent | KeyboardEvent) {
    const marker = (e.target as HTMLElement | null)?.closest?.('.fn-marker');
    if (!marker) return;
    if (e instanceof KeyboardEvent && e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    showFootnote(marker, true);
  }
  function closeFootnote() { cancelFnClose(); fnPinned = false; footnote = null; }
  // Click anywhere outside the marker/popup dismisses a pinned note; same
  // for the Bekker-numbers info popover.
  function onDocPointerDown(e: MouseEvent) {
    const t = e.target as HTMLElement | null;
    if (bekkerInfoOpen && !t?.closest?.('.bekker-info')) bekkerInfoOpen = false;
    if (!fnPinned) return;
    if (t?.closest?.('.fn-marker') || t?.closest?.('.footnote-popup')) return;
    closeFootnote();
  }

  onMount(async () => {
    reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Remember which book of this work was last open, for the work switcher —
    // and stamp the work's recency so hosts can offer "continue reading".
    try { localStorage.setItem(`reader-book-${work}`, String(bookNum)); } catch {}
    touchRecent(work);

    // Restore font-size / line-height prefs.
    const savedFs = (() => { try { return localStorage.getItem(FS_KEY); } catch { return null; } })();
    if (savedFs) { const v = parseFloat(savedFs); if (!isNaN(v)) fsScale = v; }
    const savedLh = (() => { try { return localStorage.getItem(LH_KEY); } catch { return null; } })();
    if (savedLh) { const v = parseFloat(savedLh); if (!isNaN(v)) lhScale = v; }
    const savedColw = (() => { try { return localStorage.getItem(COLW_KEY); } catch { return null; } })();
    if (savedColw) { const v = parseFloat(savedColw); if (!isNaN(v)) colScale = v; }
    const savedCite = (() => { try { return localStorage.getItem(CITE_KEY); } catch { return null; } })();
    if (savedCite !== null) citeCopy = savedCite === 'true';
    const savedSpk = (() => { try { return localStorage.getItem(SPK_KEY); } catch { return null; } })();
    if (savedSpk !== null) spkColor = savedSpk === 'true';

    // Settings sidebar events (dispatched by ReaderShell.astro and Escape handler).
    _onToggleSettings = () => { settingsOpen ? closeSettings() : openSettings(); };
    _onCloseSettings  = () => { if (settingsOpen) closeSettings(); };
    window.addEventListener('toggle-settings', _onToggleSettings);
    window.addEventListener('close-settings',  _onCloseSettings);
    const params = new URLSearchParams(window.location.search);
    hlGrkFolds = (params.get('hlg') ?? '').trim().split(/\s+/).filter(Boolean)
      .map(t => greekFold(t.replace(/\*/g, ''))).filter(Boolean);
    hlEngTerms = (params.get('hle') ?? '').trim().split(/\s+/).filter(Boolean);
    const loc = params.get('loc');
    let locCol = '';
    let locLine: number | null = null;
    if (loc) {
      // Parse through the work's citation scheme, so a column-only value ("17a")
      // yields line === null and targets the segment — never the malformed
      // "L17a-undefined" the old unconditional split-on-':' produced.
      const parsed = parseLocation(work, loc);
      if (parsed) {
        locCol = parsed.column;
        locLine = parsed.line;
        targetId = locLine != null ? `L${locCol}-${locLine}` : `col-${locCol}`;
      }
    }
    // Restore saved view, but a jump-in (loc/highlight) forces bilingual so the
    // target Greek line is on screen.
    if (loc || hlGrkFolds.length) {
      view = 'both';
    } else {
      const saved = (() => { try { return localStorage.getItem('reader-view'); } catch { return null; } })();
      if (saved === 'greek' || saved === 'english' || saved === 'both') view = saved;
      // No saved choice: a phone defaults to English only (the bilingual columns
      // are cramped on a narrow screen); desktop stays bilingual. The toggle —
      // and any saved choice — overrides this on either.
      else if (window.matchMedia('(max-width: 680px)').matches) view = 'english';
    }
    const validTrans = new Set([...translations.map(t => t.id), ...(canCompare ? ['compare'] : [])]);
    const savedTrans = (() => { try { return localStorage.getItem(TRANS_KEY); } catch { return null; } })();
    if (savedTrans && validTrans.has(savedTrans)) trans = savedTrans;
    // A restored single choice is also the one "leave compare" returns to.
    if (trans !== 'compare') lastSingle = trans;
    // Restore the chosen compare pair (set in the settings sidebar).
    const transIds = new Set(translations.map(t => t.id));
    const savedL = (() => { try { return localStorage.getItem(CMPL_KEY); } catch { return null; } })();
    const savedR = (() => { try { return localStorage.getItem(CMPR_KEY); } catch { return null; } })();
    if (savedL && transIds.has(savedL)) compareLeft = savedL;
    if (savedR && transIds.has(savedR)) compareRight = savedR;
    // A stale/duplicate persisted pair (or a one-translation default colliding)
    // must not yield two identical columns.
    if (compareLeft === compareRight) compareRight = otherTrans(compareLeft);
    // The home index links can preselect a view/translation via query params.
    const qView = params.get('view');
    if (qView === 'greek' || qView === 'both' || qView === 'english') view = qView;
    const qTrans = params.get('trans');
    if (qTrans && validTrans.has(qTrans)) { trans = qTrans; if (view === 'greek') view = 'both'; }
    try {
      // Already seeded from the build-time prop in the normal (SSR) path; only
      // fetch when the reader was mounted without it.
      if (!bookData) {
        const data = await fetchBook(work, bookNum);
        segments = data.segments;
        turnFlow = data.turnFlow ?? null;
      }
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
      // After Svelte renders, scroll to the jumped-to line (loc), a Bekker
      // citation in the hash, or a plain element-id hash.
      const hash = window.location.hash.slice(1);
      setTimeout(() => {
        if (targetId) {
          let el = document.getElementById(targetId);
          // Snap to the nearest existing line in the column if the exact
          // citation line isn't a Greek line break (e.g. mid-line citations).
          // Queried by line-id prefix, not by segment nesting, so it works in
          // both the section-segment layout and the turn flow (where a
          // section's lines aren't nested under its col-{token} tick).
          if (!el && locCol && locLine != null) {
            let best: Element | null = null;
            let bestDist = Infinity;
            document.querySelectorAll(`.greek-line[id^="L${CSS.escape(locCol)}-"]`).forEach((node) => {
              const m = node.id.match(/-(\d+)$/);
              if (!m) return;
              const d = Math.abs(Number(m[1]) - locLine);
              if (d < bestDist) { bestDist = d; best = node; }
            });
            if (best) { el = best as HTMLElement; targetId = (best as HTMLElement).id; }
          }
          if (el) { suppressArmUntil = Date.now() + 1500; el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        } else if (hash) {
          const ref = parseBekker(hash);
          if (ref) {
            scrollToCitation(ref.column, ref.line);
            lastCite = `${ref.column}${ref.line}`;
            // Tint the cited line so a shared link makes the passage obvious.
            targetId = `L${ref.column}-${ref.line}`;
          } else {
            // Column-level citations (the scroll-spy writes bare "#1107a" when
            // the Greek column is hidden) target the segment element col-<col>.
            // Instant, like scrollToCitation: a smooth animation started during
            // hydration gets canceled by layout churn and strands the reader at
            // the top.
            let el = document.getElementById(hash) ?? document.getElementById(`col-${hash}`);
            // A hidden target (the turn flow's Greek gutter tick in
            // English-only view) falls back to the row-level English tick.
            if (el && (el as HTMLElement).offsetParent === null) {
              el = (document.querySelector(`[data-etick="${CSS.escape(hash)}"]`) as HTMLElement) ?? el;
            }
            if (el) {
              suppressArmUntil = Date.now() + 1500;
              el.scrollIntoView({ behavior: 'auto', block: 'start' });
            }
          }
        }
        // Begin live URL tracking once the reader actually scrolls (programmatic
        // jumps above are suppressed), so an opened #citation isn't overwritten.
        window.addEventListener('scroll', onScrollArm, { passive: true });
        window.addEventListener('scroll', onCtxScroll, { passive: true });
        window.addEventListener('resize', onResize);
        document.addEventListener('mouseup', checkCopyBtn);
        document.addEventListener('selectionchange', onSelectionChange);
        updateChapterContext();
      }, 0);
    }
  });

  // Opening/closing the word sidebar changes the reader body's width (it gains
  // padding-right to clear the panel), which reflows the text and shifts every
  // line vertically — so the passage the reader was looking at jumps. Pin a
  // given element to its current screen position by compensating scroll on each
  // frame for the duration of the width transition. MUST be called BEFORE the
  // `popup` state change so startTop is captured in the pre-reflow layout.
  function pinAcrossReflow(el: HTMLElement | null) {
    if (!el || typeof window === 'undefined') return;
    const startTop = el.getBoundingClientRect().top;
    suppressArmUntil = Date.now() + 500;   // don't let our scrolls arm the spy
    const until = Date.now() + 360;        // padding-right transition is 0.22s
    const step = () => {
      const delta = el.getBoundingClientRect().top - startTop;
      if (Math.abs(delta) >= 0.5) window.scrollBy(0, delta);
      if (Date.now() < until) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // The line currently at the top of the reading area — the fallback anchor to
  // keep fixed when the sidebar closes after the clicked word has scrolled away.
  function topAnchor(): HTMLElement | null {
    const ctrlBottom = document.querySelector('.reader-controls')?.getBoundingClientRect().bottom ?? 0;
    const inset = ctrlBottom + 8;
    const greekVisible = view === 'greek' || view === 'both';
    const els = document.querySelectorAll<HTMLElement>(
      greekVisible ? '.greek-line[id]' : '.segment[id], .turn-flow .seg-row');
    let best: HTMLElement | null = null, bestDiff = Infinity;
    for (const el of els) {
      const diff = Math.abs(el.getBoundingClientRect().top - inset);
      if (diff < bestDiff) { bestDiff = diff; best = el; }
    }
    return best;
  }

  function inViewport(el: HTMLElement): boolean {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
  }

  // The word whose click opened the sidebar — pinned again on close so the
  // passage lands back exactly where it opened (symmetric), unless the reader
  // scrolled it out of view, in which case we keep the current top line fixed.
  let pinnedTok: HTMLElement | null = null;

  function handleTokenClick(e: MouseEvent, token: Token | null) {
    if (!token) return;
    e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    // Only the first open reflows the body (adds .word-open); switching words
    // while the sidebar is already open changes nothing about the layout.
    if (!popup) { pinnedTok = el; pinAcrossReflow(el); }
    popup = { token, anchor: { x: rect.left, y: rect.bottom } };
  }

  function closePopup() {
    if (popup) pinAcrossReflow(pinnedTok && inViewport(pinnedTok) ? pinnedTok : topAnchor());
    popup = null;
    pinnedTok = null;
  }

  // ── Keyboard access to Greek tokens ──────────────────────────────────────
  // Analysable tokens are a huge set (thousands per book), so putting every one
  // in the tab order would be hostile to keyboard and screen-reader users.
  // Instead we use a roving tabindex: exactly one token is tabbable; arrow keys
  // move focus token-to-token; Enter/Space opens its analysis. The reader body
  // is the scope so navigation can't wander into chrome.
  let readerBodyEl: HTMLElement | undefined;
  function ensureRovingTab() {
    if (!readerBodyEl) return;
    if (readerBodyEl.querySelector('.tok[tabindex="0"]')) return;
    const first = readerBodyEl.querySelector<HTMLElement>('.tok');
    first?.setAttribute('tabindex', '0');
  }
  afterUpdate(ensureRovingTab);

  function onTokenKey(e: KeyboardEvent, token: Token) {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      handleTokenClick(e as unknown as MouseEvent, token);
      return;
    }
    const step: Record<string, number | 'first' | 'last'> = {
      ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: 'first', End: 'last',
    };
    if (!(e.key in step)) return;
    e.preventDefault();
    const cur = e.currentTarget as HTMLElement;
    const toks = Array.from(readerBodyEl?.querySelectorAll<HTMLElement>('.tok') ?? []);
    const i = toks.indexOf(cur);
    if (i < 0) return;
    const move = step[e.key];
    const j = move === 'first' ? 0
      : move === 'last' ? toks.length - 1
      : Math.min(toks.length - 1, Math.max(0, i + move));
    if (j === i) return;
    cur.setAttribute('tabindex', '-1');
    toks[j].setAttribute('tabindex', '0');
    toks[j].focus();
  }

  // Show line number only for multiples of 5 (and line 1). Suppressed entirely
  // for non-Bekker works whose synthetic line numbers aren't meaningful.
  function showLineNum(n: number): string {
    if (hideLineNums) return '';
    if (n === 1 || n % 5 === 0) return String(n);
    return '';
  }

  // ── Copy-with-citation helpers ────────────────────────────────────────────
  function nearestGreekLine(node: Node): HTMLElement | null {
    let n: Node | null = node;
    while (n && n !== document.body) {
      if (n instanceof HTMLElement && n.classList.contains('greek-line')) return n;
      n = n.parentNode;
    }
    return null;
  }
  // A Greek-line id → its citation string, composed through the work's scheme:
  // L1094a-3 / L1094a-3-c → "1094a3" (bekker), L17a-5 → "17a" (stephanus — the
  // line is dropped, so a same-section selection cites just the section token).
  function idToCite(id: string): string | null {
    const m = id.match(/^L(.+?)-(\d+)(?:-c)?$/);
    return m ? formatCite(work, m[1], Number(m[2])) : null;
  }

  function greekCiteForRange(range: Range): string | null {
    const startLine = nearestGreekLine(range.startContainer);
    const endLine   = nearestGreekLine(range.endContainer);
    if (!startLine && !endLine) return null;
    const s = startLine ? idToCite(startLine.id) : null;
    const f = endLine   ? idToCite(endLine.id)   : null;
    const abbr = workMeta?.abbr ?? '';
    return (s && f && s !== f) ? `(${abbr} ${s}–${f})` : `(${abbr} ${s ?? f})`;
  }

  function handleCopy(e: ClipboardEvent) {
    if (!citeCopy) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const text = sel.toString().trim();
    if (!text) return;
    const range = sel.getRangeAt(0);
    const cite = greekCiteForRange(range);
    if (!cite) return; // English-only selection; wait for alignment
    e.clipboardData?.setData('text/plain', text + '\n' + cite);
    e.preventDefault();
  }

  // ── Floating copy button (appears on Greek text selection) ────────────────
  let copyBtnPos: { x: number; y: number } | null = null;

  function checkCopyBtn() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) { copyBtnPos = null; return; }
    const range = sel.getRangeAt(0);
    if (!nearestGreekLine(range.startContainer) && !nearestGreekLine(range.endContainer)) {
      copyBtnPos = null; return;
    }
    const rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) { copyBtnPos = null; return; }
    copyBtnPos = { x: rect.right, y: rect.top };
  }

  function onSelectionChange() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) copyBtnPos = null;
  }

  function clickCopyBtn() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) { copyBtnPos = null; return; }
    const text = sel.toString().trim();
    const cite = greekCiteForRange(sel.getRangeAt(0));
    const full = cite ? text + '\n' + cite : text;
    navigator.clipboard.writeText(full).catch(() => {});
    copyBtnPos = null;
  }
</script>

<!-- View toggle and Print control are rendered in the reader header on desktop
     and inside the ⚙ Settings sidebar on mobile (CSS scopes which is visible).
     Top-level snippets keep a single source of markup and one printMenuOpen. -->
{#snippet viewToggle()}
  <div class="view-toggle" role="group" aria-label="Reading view">
    <button class:active={view === 'greek'} aria-pressed={view === 'greek'} on:click={() => setView('greek')}>Greek</button>
    <button class:active={view === 'both'} aria-pressed={view === 'both'} on:click={() => setView('both')}>Both</button>
    <button class:active={view === 'english'} aria-pressed={view === 'english'} on:click={() => setView('english')}>English</button>
  </div>
{/snippet}

{#snippet printControl()}
  {#if chaptersInBook.length > 1}
    <div class="print-menu">
      <button class="print-btn" on:click={togglePrintMenu} title="Print or save as PDF" aria-label="Print or save as PDF">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 9V2h12v7" />
          <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
          <rect x="6" y="14" width="12" height="8" />
        </svg>
        <span class="print-btn-label">Print</span>
        <svg class="print-chevron" viewBox="0 0 10 6" width="8" height="5" fill="currentColor" aria-hidden="true"><path d="M0 0l5 6 5-6z"/></svg>
      </button>
      {#if printMenuOpen}
        <div class="print-dropdown">
          <button class="print-dd-item" on:click={() => { printMenuOpen = false; printReader(); }}>Full book</button>
          <div class="print-dd-sep" role="separator"></div>
          {#each chaptersInBook as ch}
            <button class="print-dd-item" on:click={() => { printMenuOpen = false; printSingleChapter(ch); }}>
              {#if bookLabel}{bookLabel}, {/if}Chapter {ch}
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <button class="print-btn" on:click={printReader} title="Print or save as PDF" aria-label="Print or save as PDF">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M6 9V2h12v7" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <rect x="6" y="14" width="12" height="8" />
      </svg>
      <span class="print-btn-label">Print</span>
    </button>
  {/if}
{/snippet}

{#if loading}
  <p style="padding:2rem;font-family:system-ui;color:#888">Loading Book {bookNum}…</p>
{:else if error}
  <p style="padding:2rem;color:red">{error}</p>
{:else}
  {#snippet greekToks(parts: LineRenderPart[])}{#each parts as part}{#if part.kind === 'token'}<span
        class="tok"
        class:active={popup?.token === part.tok}
        class:hit={isHit(part.text)}
        role="button"
        tabindex="-1"
        aria-label="Analyse {part.text}"
        aria-haspopup="dialog"
        on:click={(e) => handleTokenClick(e, part.tok)}
        on:keydown={(e) => onTokenKey(e, part.tok)}
      >{part.text}</span>{:else if part.kind === 'speaker'}<span class="speaker" class:speaker-dash={part.dash} lang="grc">{part.label}</span>{:else}{part.text}{/if}{/each}{/snippet}
  {#snippet chapterHead(block: Block)}
    <div class="chapter-head" id="ch-{bookNum}-{block.chapter}">
      <span class="chapter-label">{#if bookLabel}<span class="chapter-book">{bookLabel},&nbsp;</span>{/if}Chapter {block.chapter}{#if chapterTitles[block.chapter ?? '']}: {chapterTitles[block.chapter ?? '']}{/if}</span>
      {#if block.bekker && !busse}<span class="chapter-bekker">({block.bekker})</span>{/if}
    </div>
  {/snippet}

  <!-- One English column for a translation: the primary's flow (block.flow) or
       an overlay's (block.oflows[id]), as flowing prose with margin-floated
       Bekker numbers. The footnote/table-bearing translation ('third' slot)
       uses renderThird + clickable `[^N]` markers + diagram tables; the rest
       use plain highlightEng. Works for any number of translations. -->
  {#snippet transFlow(block: Block, transId: string)}
    {@const flow = transId === engSlot?.id ? block.flow : (block.oflows[transId] ?? [])}
    {#if flow.length}
      {@const chTitle = importChapterTitle(transId, block.chapter)}
      <!-- An imported translation's chapter-opening title: a SIBLING before
           .ross-prose, not its first child — (a) inside .ross-prose it pushed
           the English prose one line below the Greek (John's review of
           631ff971); the Greek column gets a matching invisible spacer
           instead (see the .greek-col markup below), so Greek line 1 and
           English prose line 1 stay flush and the title takes its own space
           above; (b) the offset walkers (annotations.ts proseOffsetAt,
           emphasis-paint.ts proseText) root at col.querySelector('.ross-prose')
           and exclude only .bk-num/.eng-table, so title text INSIDE
           .ross-prose would leak into captured offsets — as a sibling they
           never see it, keeping the render-only/no-offset-shift guarantee
           structural. -->
      {#if chTitle}<div class="ross-chapter-title">{chTitle}</div>{/if}
      {#if fnTransIds.has(transId)}
        <div
          class="ross-prose"
          on:mouseover={onFootnoteOver}
          on:mouseout={onFootnoteOut}
          on:focus={onFootnoteFocus}
          on:blur={onFootnoteBlur}
          on:focusin={onFootnoteFocus}
          on:focusout={onFootnoteBlur}
          on:click={onFootnoteClick}
          on:keydown={onFootnoteClick}
          role="presentation"
        >
          {#each attachTicks(flow, new Set((block.otables[transId] ?? []).map(t => t.n))) as part}
            {#if part.text === '\n'}
              <br class="para-br" />
            {:else if part.text !== null}
              <span class="bk-seg"
                >{#if part.tick}<span class="bk-num" class:approx={!part.tick.real}>{part.tick.n}</span
                  >{/if}<!-- eslint-disable-next-line svelte/no-at-html-tags -->{@html renderThird(part.text, transId)}</span>
            {:else if part.para}
              <br class="para-br" />
            {:else}
              <span class="bk-num" class:approx={!part.real}>{part.n}</span>
              {#each (block.otables[transId] ?? []).filter(t => t.n === part.n) as tbl}
                <table class="eng-table"><tbody>
                  {#each tbl.rows as trow}
                    <tr>{#each trow as cell}<td>{cell}</td>{/each}</tr>
                  {/each}
                </tbody></table>
              {/each}
            {/if}
          {/each}
        </div>
      {:else}
        <div class="ross-prose">
          {#each attachTicks(flow) as part}
            {#if part.text === '\n'}
              <br class="para-br" />
            {:else if part.text !== null}
              <span class="bk-seg"
                >{#if part.tick}<span class="bk-num" class:approx={!part.tick.real}>{part.tick.n}</span
                  >{/if}<!-- eslint-disable-next-line svelte/no-at-html-tags -->{@html highlightEng(part.text)}</span>
            {:else if part.para}
              <br class="para-br" />
            {:else}
              <span class="bk-num" class:approx={!part.real}>{part.n}</span>
            {/if}
          {/each}
        </div>
      {/if}
    {/if}
  {/snippet}

  <!-- The turn flow of a dialogue book: one row per speaker turn, the whole
       book long — each speaker's Greek statement level with its English
       translation (Tier-0 alignment). Stephanus sections are gutter TICKS, not
       layout containers: each section's first Greek line floats its token in
       the center gutter (Both view) / left gutter (Greek-only), and the tick
       element carries the col-{token} citation anchor (deep links, outline
       nav, scroll-spy, resume). In English-only view the Greek cells are
       hidden, so each row also carries no-id [data-etick] markers in the left
       gutter for the sections starting within it (row-level approximation —
       English tick precision is deferred Tier 1+). One-sided residual rows
       (unpaired turns) render in place with the other cell empty. -->
  <!-- Narrated paragraph prose: the row's English with `ep` paragraph breaks
       rendered as <br class="para-br"> (reusing flowParts/attachTicks — no
       Bekker ticks are passed here, so only the paragraph breaks and any hard
       newlines survive). flowParts clamps each break offset into the slice, so
       a break landing exactly on a turn/tick offset can't over-run the text. -->
  {#snippet paraProse(text: string, ep: number[] | null | undefined)}
    {#each attachTicks(flowParts(text, [], ep ?? [])) as part}
      {#if part.text === '\n'}
        <br class="para-br" />
      {:else if part.text !== null}
        <span class="bk-seg"><!-- eslint-disable-next-line svelte/no-at-html-tags -->{@html highlightEng(part.text)}</span>
      {:else if part.para}
        <br class="para-br" />
      {/if}
    {/each}
  {/snippet}

  <!-- One row's PRIMARY-translation English cell body (et embed / dialogue turn
       + folded subs). Factored out of the turn-flow english column so it can
       render in EITHER compare column when that column shows the primary. -->
  {#snippet primaryEng(row: FlowRow, ri: number)}
    {#if paraFlow && row.et && row.et.length}
      <div class="ross-prose turn-eng turn-stack">
        {#each etBlocks(row.english ?? '', row.et, row.ep) as b}
          <p class="turn-para">{#if !b.lead}{#if b.display}<span class="speaker" data-spk={spkSlots.get(b.display)}>{b.display}</span>{:else}<span class="speaker speaker-dash">—</span>{/if}{/if}{@render paraProse(b.text, b.ep)}</p>
        {/each}
      </div>
    {:else}
      {#if row.english}
        <div class="ross-prose turn-eng">
          {#if !paraFlow && !row.lead}{#if row.display}{#if !rowMeta[ri]?.hideLead}<span class="speaker" data-spk={spkSlots.get(row.display)}>{row.display}</span>{/if}{:else}<span class="speaker speaker-dash">—</span>{/if}{/if}{@render paraProse(row.english, row.ep)}{#each row.englishCont as c}<p class="turn-cont">{@render paraProse(c.text, c.ep)}</p>{/each}</div>
      {/if}
      {#if row.sub && row.sub.length}
        <div class="ross-prose turn-eng turn-stack">
          {#each row.sub as s, si}
            <p class="turn-para">{#if s.d}{#if !rowMeta[ri]?.hideSub[si]}<span class="speaker" data-spk={spkSlots.get(s.d)}>{s.d}</span>{:else}<span class="speaker speaker-dash">—</span>{/if}{/if}{@render paraProse(s.e, s.ep)}</p>
          {/each}
        </div>
      {:else if paraFlow && !row.english && !row.lead}
        <div class="ross-prose turn-eng"><span class="eng-missing" aria-hidden="true">—</span></div>
      {/if}
    {/if}
  {/snippet}

  <!-- One row's ALTERNATE-translation cell (turn-by-turn compare). The turn
       aligner gives each alternate one per-turn slice (alt[id] = {e, ep}), so
       this is just the row's speaker lead-in + that slice, or an em-dash where
       the alternate has no matching turn. No et/sub structure — alternates
       carry plain per-turn prose. Label suppression mirrors the primary (same
       speaker sequence) so the two columns stay visually parallel. -->
  {#snippet altEng(row: FlowRow, ri: number, id: string)}
    {@const a = row.alt?.[id]}
    <div class="ross-prose turn-eng">
      {#if !paraFlow && !row.lead}{#if row.display}{#if !rowMeta[ri]?.hideLead}<span class="speaker" data-spk={spkSlots.get(row.display)}>{row.display}</span>{/if}{:else}<span class="speaker speaker-dash">—</span>{/if}{/if}{#if a && a.e}{@render paraProse(a.e, a.ep)}{:else}<span class="eng-missing" title="No aligned passage in this translation"><span class="sr-only">No aligned passage in this translation.</span><span aria-hidden="true">—</span></span>{/if}</div>
  {/snippet}

  {#snippet flowRowsView(rows: FlowRow[])}
    <div class="turn-flow" class:para-flow={paraFlow} class:spk-color={spkColor}>
      {#each rows as row, ri}
        <!-- Which translation the (single / left) English column shows: the
             selected id, or the left compare id in compare mode. -->
        {@const leftId = trans === 'compare' ? compareLeft : trans}
        <div class="seg-row turn-row" class:turn-lead={row.lead} class:turn-residual={!row.lead && !row.paired}>
          <!-- Each turn row is a single speaker, so the Greek siglum (ΣΩ.) is
               coloured to match the row's English name via the column's data-spk
               (see .greek-col[data-spk] rules in global.css). -->
          <div class="greek-col" lang="grc" data-spk={row.display ? spkSlots.get(row.display) : undefined}>
            {#each row.greek as gl}
              <!-- Only the line's opening slice carries its id: a line split by
                   several turns (Parmenides' dash runs) yields multiple cont
                   slices, and repeating an -c id per slice would duplicate
                   ids. Cont slices aren't citation targets, so they get none. -->
              <div class="greek-line" id={gl.cont ? undefined : `L${gl.col}-${gl.n}`} class:target={!gl.cont && targetId === `L${gl.col}-${gl.n}`} class:cont={gl.cont}>
                {#if gl.tick}<span class="sect-tick" id="col-{gl.tick}">{gl.tick}</span>{/if}
                <span class="line-num">{gl.cont ? '' : showLineNum(gl.n)}</span>
                <span class="line-text" lang="grc">{@render greekToks(gl.parts)}</span>
              </div>
            {/each}
          </div>
          <div class="english-col" data-trans={leftId}>
            {#if trans === 'compare'}<div class="col-label">{transById(compareLeft)?.short ?? 'English'}</div>{/if}
            {#each row.ticks as t}<span class="sect-tick eng-tick" data-etick={t} aria-hidden="true">{t}</span>{/each}
            <!-- The (single / left) column shows the primary translation inline
                 (its full et/dialogue/sub structure) or, for an alternate id,
                 the aligner's per-turn slice via altEng. -->
            {#if leftId !== engSlot?.id}{@render altEng(row, ri, leftId)}{:else if paraFlow && row.et && row.et.length}
              <!-- Narrated embedded-dialogue row (para flow, `et`): the row's
                   English is english.turns nested inside a narrated paragraph —
                   set as a .turn-stack of labelled blocks (em-dash when the
                   lead-in is null), any `ep` breaks rebased per block. -->
              <div class="ross-prose turn-eng turn-stack">
                {#each etBlocks(row.english ?? '', row.et, row.ep) as b}
                  <p class="turn-para">{#if !b.lead}{#if b.display}<span class="speaker" data-spk={spkSlots.get(b.display)}>{b.display}</span>{:else}<span class="speaker speaker-dash">—</span>{/if}{/if}{@render paraProse(b.text, b.ep)}</p>
                {/each}
              </div>
            {:else}
              {#if row.english}
                <!-- The row's own English: dialogue rows keep their speaker
                     lead-in (em-dash for an unattributed turn); paragraph rows
                     (kind==='para') have no speaker, so the em-dash fallback is
                     suppressed. BOTH render `ep` paragraph breaks — pipeline B2
                     gives dialogue turns internal breaks too (Timaeus/Phaedo
                     long speeches), not just para flows. -->
                <div class="ross-prose turn-eng">
                  {#if !paraFlow && !row.lead}{#if row.display}{#if !rowMeta[ri]?.hideLead}<span class="speaker" data-spk={spkSlots.get(row.display)}>{row.display}</span>{/if}{:else}<span class="speaker speaker-dash">—</span>{/if}{/if}{@render paraProse(row.english, row.ep)}{#each row.englishCont as c}<p class="turn-cont">{@render paraProse(c.text, c.ep)}</p>{/each}</div>
              {/if}
              {#if row.sub && row.sub.length}
                <!-- One-sided English speeches folded under this row (pipeline
                     B4 residual redesign — dialogue flows AND para flows): a
                     stack of labelled blocks under the row's Greek. Usually the
                     row's `e` is null and this stack IS the English cell; when
                     the row also carries English (a narration lead, e.g. Lysis
                     203a) the stack follows it. Lead-in span when a printed
                     display exists; em-dash otherwise (genuine speaker turns —
                     Fowler's prose embeds the "he said" attributions). -->
                <div class="ross-prose turn-eng turn-stack">
                  {#each row.sub as s, si}
                    <p class="turn-para">{#if s.d}{#if !rowMeta[ri]?.hideSub[si]}<span class="speaker" data-spk={spkSlots.get(s.d)}>{s.d}</span>{/if}{:else}<span class="speaker speaker-dash">—</span>{/if}{@render paraProse(s.e, s.ep)}</p>
                  {/each}
                </div>
              {:else if paraFlow && !row.english && !row.lead}
                <!-- Defensive: a para-flow row with Greek but NO English content
                     (e null, sub null/empty) is malformed pipeline output — the
                     contract says every para row carries e or sub. Render an
                     intentional untranslated marker instead of a silently blank
                     cell (the blank-cell defect this round eliminates). Dialogue
                     flows are exempt: a Greek-only residual with a blank English
                     cell is their normal pre-B4 shape. -->
                <div class="ross-prose turn-eng"><span class="eng-missing" aria-hidden="true">—</span></div>
              {/if}
            {/if}
          </div>
          <!-- Right compare column: the second chosen translation, turn-by-turn
               beside the first (hidden in Greek-only). Either column may be the
               primary or an alternate — pick the renderer by id. -->
          {#if trans === 'compare' && view !== 'greek'}
            <div class="ross-col" data-trans={compareRight}>
              <div class="col-label">{transById(compareRight)?.short ?? ''}</div>
              {#if compareRight === engSlot?.id}{@render primaryEng(row, ri)}{:else}{@render altEng(row, ri, compareRight)}{/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/snippet}

  <div class="reader-body view-{view} trans-{trans}" role="main"
    bind:this={readerBodyEl}
    class:busse={busse}
    class:stephanus={stephanus}
    class:word-open={!!popup}
    style="--fs-greek:{fsGreek}rem;--fs-english:{fsEng}rem;--lh-greek:{lhGreek};--lh-english:{lhEng};--colw-scale:{colScale};--fs-scale:{fsScale}"
    on:copy={handleCopy}>
    <div class="reader-controls">
      {#if liveChapter}
        <span class="rc-context">{liveChapter}</span>
      {/if}
      <div class="rc-cite">
        {#if view === 'greek'}
          {#if greekSrc}<span class="rc-greek">{greekSrc.full}</span>{/if}
        {:else if trans === 'compare'}
          {#if view === 'both'}<span class="rc-col-spacer" aria-hidden="true"></span>{/if}
          <span class="rc-col-name">{citeShort(transById(compareLeft))}</span>
          <span class="rc-col-name">{citeShort(transById(compareRight))}</span>
        {:else if view === 'both'}
          <span class="rc-pair">{pairText}</span>
        {:else if selectedTrans}
          <span class="rc-full">{selectedTrans.name}</span>
        {/if}
      </div>
      <div class="rc-controls">
        {#if view !== 'greek' && translations.length === 1}
          <span class="rc-trans-abbr">{citeShort(translations[0])}</span>
        {/if}
        {#if translations.length > 1}
          <!-- Desktop translation picker, beside the view toggle. On mobile this
               is hidden (see global.css) and the same control lives in the
               ⚙ Settings sidebar instead. -->
          <select class="rc-trans-select" value={pickValue} on:change={onPick} aria-label="English translation">
            {#each translations as t}
              <option value={t.id}>{t.name}</option>
            {/each}
          </select>
        {/if}
        <!-- Desktop only — on mobile these live in the ⚙ Settings sidebar. -->
        <div class="rc-desktop-controls">
          {@render viewToggle()}
          {@render printControl()}
        </div>
      </div>
    </div>
    <!-- Print-only masthead (hidden on screen): author eyebrow, work title with
         its Greek title alongside, and the source citation. -->
    <div class="print-head" aria-hidden="true">
      <div class="print-eyebrow">{workMeta?.author ?? HOUSE_AUTHOR}</div>
      <div class="print-titleline">
        <span class="print-title">{workMeta?.title ?? ''}</span>
        {#if workMeta?.greekTitle}<span class="print-title-gk">{workMeta.greekTitle}</span>{/if}
      </div>
      {#if printCite}<div class="print-cite">{printCite}</div>{/if}
    </div>
    {#if hasApproxTicks && !busse}
      <!-- The estimate disclaimer stays one click away, not a paragraph of
           front matter: the honesty lives in the ticks themselves (upright vs
           italic grey); this explains the convention on demand. -->
      <div class="bekker-info">
        <button
          type="button"
          class="bekker-info-btn"
          aria-expanded={bekkerInfoOpen}
          on:click|stopPropagation={() => (bekkerInfoOpen = !bekkerInfoOpen)}
        >ℹ︎ Bekker numbers</button>
        {#if bekkerInfoOpen}
          <div class="bekker-info-pop" role="note" transition:fade={{ duration: reduceMotion ? 0 : 120 }}>
            Greek line numbers are exact. The translations carry no Bekker
            numbers of their own, so those beside the English are aligned to
            the Greek: <span class="bk-fixed">upright</span> = fixed (anchored
            to this point in the text), <span class="bk-approx">italic grey</span>
            = approximate (interpolated estimate).
          </div>
        {/if}
      </div>
    {/if}
    {#if flowRows}
      <!-- Dialogue book: the continuous turn flow replaces the per-section
           segment blocks; Stephanus tokens float as gutter ticks. -->
      {@render flowRowsView(flowRows)}
    {:else}
    {#each enrichedSegments as {seg, blocks} (seg.id)}
      {@const leadChapter = blocks[0]?.chapter ? blocks[0] : null}
      <div class="segment" id="col-{seg.column}">
        <!-- A chapter that opens this column heads the segment, ABOVE the column
             reference (the column ref is a marker within the chapter, not a
             heading over it). Mid-column chapter starts render inline below. -->
        {#if leadChapter}{@render chapterHead(leadChapter)}{/if}
        {#if !busse}
          <div class="seg-ref">
            {seg.column}
          </div>
        {/if}

        {#each blocks as block, bi}
          <!-- If the on-screen primary translation (English cell of this row)
               opens this chapter with an imported title, the Greek column gets
               an invisible spacer of the same one-line height (see
               .ross-chapter-title-spacer in global.css) so both columns are
               pushed down equally: title above, Greek line 1 flush with
               English prose line 1. Same gates as the visible title in
               transFlow (chapter start + that import's flow present here);
               skipped in greek-only view (no title shown → no gap). Compare
               mode aligns Greek to the LEFT column; the right column's own
               title still renders in its cell via transFlow. -->
          {@const spacerTransId = trans === 'compare' ? compareLeft : trans}
          {@const spacerFlow = spacerTransId === engSlot?.id ? block.flow : (block.oflows[spacerTransId] ?? [])}
          {@const spacerTitle = view !== 'greek' && spacerFlow.length ? importChapterTitle(spacerTransId, block.chapter) : ''}
          {#if block.chapter && !(bi === 0 && leadChapter)}
            {@render chapterHead(block)}
          {/if}
          <div class="seg-row" data-chapter={block.currentChapter}>
            <!-- Greek column -->
            <div class="greek-col" lang="grc">
              {#if spacerTitle}<div class="ross-chapter-title ross-chapter-title-spacer" aria-hidden="true">{spacerTitle}</div>{/if}
              {#each greekItems(block.lines) as item}
                {#if item.table}
                  <!-- Greek inline table (the TLG ⎪ column square, e.g. De Int 22a). -->
                  <table class="greek-table"><tbody>
                    {#each item.rows as row}
                      <tr id={`L${seg.column}-${row.n}`} class:target={targetId === `L${seg.column}-${row.n}`}>
                        <td class="line-num">{showLineNum(row.n)}</td>
                        {#each (row.cells ?? []) as cell}
                          <td class="line-text" lang="grc">{@render greekToks(cellParts(cell))}</td>
                        {/each}
                      </tr>
                    {/each}
                  </tbody></table>
                {:else}
                  <div class="greek-line" id={item.line.cont ? `L${seg.column}-${item.line.n}-c` : `L${seg.column}-${item.line.n}`} class:target={!item.line.cont && targetId === `L${seg.column}-${item.line.n}`} class:cont={item.line.cont}>
                    <span class="line-num">{item.line.cont ? '' : showLineNum(item.line.n)}</span>
                    <span class="line-text" lang="grc">{@render greekToks(lineRenderParts(item.line.text, item.line.tokens, speakerEvents(seg, item.line)))}</span>
                  </div>
                {/if}
              {/each}
            </div>

            <!-- English column: the selected translation (single view), or the
                 left compare column. Prose laid out beside its Bekker-line
                 gutter — real anchors full weight, estimates lighter/italic. -->
            <div class="english-col" data-trans={trans === 'compare' ? compareLeft : trans}>
              {#if trans === 'compare'}<div class="col-label">{transById(compareLeft)?.short ?? 'English'}</div>{/if}
              {#if isUnpairedDialogue(seg)}
                <!-- A dialogue segment whose turns did not reconcile (and a
                     narrated work's said-bearing chunk): the English renders as
                     a STACK of turn paragraphs — each speech its own block with
                     its small-caps lead-in (em-dash for an unattributed turn),
                     the leading pre-turn continuation an unlabeled block. Block
                     boundaries, not inline splices, so a label can never butt
                     against the previous sentence. -->
                <div class="ross-prose turn-eng turn-stack">
                  {#each englishTurnBlocks(seg) as b}
                    <p class="turn-para">{#if !b.lead}{#if b.display}<span class="speaker">{b.display}</span>{:else}<span class="speaker speaker-dash">—</span>{/if}{/if}<!-- eslint-disable-next-line svelte/no-at-html-tags -->{@html highlightEng(b.text)}</p>
                  {/each}
                </div>
              {:else}
              {@render transFlow(block, trans === 'compare' ? compareLeft : trans)}
              {/if}
              <!-- Inline diagrams ([[figN]] markers), e.g. the Tree of Porphyry. -->
              {#if busse && view !== 'greek' && block.figs.length}
                {#each block.figs as fig}
                  {#if figuresData[String(fig)]}<!-- eslint-disable-next-line svelte/no-at-html-tags -->{@html figuresData[String(fig)]}{/if}
                {/each}
              {/if}
            </div>

            <!-- Right compare column: the second chosen translation beside the
                 first (hidden in Greek-only). -->
            {#if trans === 'compare' && view !== 'greek'}
              <div class="ross-col" data-trans={compareRight}>
                <div class="col-label">{transById(compareRight)?.short ?? ''}</div>
                {@render transFlow(block, compareRight)}
              </div>
            {/if}

            <!-- Analytical sidenotes (Owen's marginal notes), floated into a
                 right rail on desktop; on mobile they fall inline below the
                 English (hidden in Greek-only view). -->
            {#if busse && view !== 'greek' && block.sidenotes.length}
              <aside class="sidenote-rail">
                {#each block.sidenotes as sn}
                  {#if sidenotesData[String(sn)]}<p class="sidenote">{sidenotesData[String(sn)]}</p>{/if}
                {/each}
              </aside>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
    {/if}
  </div>
{/if}

<aside class="settings-sidebar" class:open={settingsOpen} aria-label="Reader settings" aria-hidden={!settingsOpen} inert={!settingsOpen} bind:this={settingsEl} on:keydown={onSettingsKey}>
  <div class="settings-head">
    <span class="settings-title">Settings</span>
    <button type="button" class="settings-close" on:click={closeSettings} aria-label="Close settings">×</button>
  </div>
  <div class="settings-body">
    <!-- Mobile-only: on desktop the view toggle and print control live in the
         reader header (see .settings-mobile-only in global.css). -->
    <div class="settings-section settings-mobile-only">
      <div class="settings-section-label">View</div>
      {@render viewToggle()}
    </div>
    {#if translations.length > 1}
      <!-- Mobile-only: on desktop the picker sits beside the view toggle in the
           header (see .settings-trans in global.css). -->
      <div class="settings-section settings-trans">
        <div class="settings-section-label">Translation</div>
        <!-- svelte-ignore a11y-label-has-associated-control -->
        <label>
          <select class="settings-select" value={pickValue} on:change={onPick} aria-label="English translation">
            {#each translations as t}
              <option value={t.id}>{t.name}</option>
            {/each}
          </select>
        </label>
      </div>
    {/if}
    {#if canCompare}
      <!-- Mode lives HERE, not in the picker: the dropdowns choose WHICH
           translation, this chooses single vs side-by-side comparison. -->
      <div class="settings-section">
        <div class="settings-section-label">Translations</div>
        <label class="settings-mode-row">
          <input
            type="radio"
            name="trans-mode"
            checked={trans !== 'compare'}
            on:change={() => setTrans(lastSingle)}
          />
          <span>Single translation</span>
        </label>
        <label class="settings-mode-row">
          <input
            type="radio"
            name="trans-mode"
            checked={trans === 'compare'}
            on:change={() => setTrans('compare')}
          />
          <span>Compare two translations</span>
        </label>
      </div>
    {/if}
    {#if canCompare && trans === 'compare'}
      <!-- Compare pair: which two translations sit side by side. -->
      <div class="settings-section">
        <div class="settings-section-label">Compare</div>
        <!-- svelte-ignore a11y-label-has-associated-control -->
        <label class="settings-compare-row">
          <span class="settings-compare-side">Left</span>
          <select class="settings-select" bind:value={compareLeft} on:change={pickCompareLeft} aria-label="Compare left translation">
            {#each translations as t}
              <option value={t.id} disabled={t.id === compareRight}>{t.name}</option>
            {/each}
          </select>
        </label>
        <!-- svelte-ignore a11y-label-has-associated-control -->
        <label class="settings-compare-row">
          <span class="settings-compare-side">Right</span>
          <select class="settings-select" bind:value={compareRight} on:change={pickCompareRight} aria-label="Compare right translation">
            {#each translations as t}
              <option value={t.id} disabled={t.id === compareLeft}>{t.name}</option>
            {/each}
          </select>
        </label>
      </div>
    {/if}

    <div class="settings-section settings-mobile-only">
      <div class="settings-section-label">Print</div>
      {@render printControl()}
    </div>

    <div class="settings-section">
      <div class="settings-section-label">Text size</div>
      <label class="settings-slider">
        <div class="settings-slider-row">
          <span class="settings-slider-name">Size</span>
          <span class="settings-slider-val">{Math.round(fsScale * 100)}%</span>
        </div>
        <input type="range" min="0.75" max="1.4" step="0.05" bind:value={fsScale} on:change={saveFs} aria-label="Text size" />
      </label>
    </div>

    <div class="settings-section">
      <div class="settings-section-label">Line spacing</div>
      <label class="settings-slider">
        <div class="settings-slider-row">
          <span class="settings-slider-name">Spacing</span>
          <span class="settings-slider-val">{Math.round(lhScale * 100)}%</span>
        </div>
        <input type="range" min="0.8" max="1.4" step="0.05" bind:value={lhScale} on:change={saveLh} aria-label="Line spacing" />
      </label>
    </div>

    <div class="settings-section">
      <div class="settings-section-label">Column width</div>
      <label class="settings-slider">
        <div class="settings-slider-row">
          <span class="settings-slider-name">Width</span>
          <span class="settings-slider-val">{Math.round(colScale * 100)}%</span>
        </div>
        <input type="range" min="0.75" max="1.3" step="0.05" bind:value={colScale} on:change={saveColw} aria-label="Column width" />
      </label>
    </div>

    {#if spkSlots.size > 1}
    <div class="settings-section">
      <div class="settings-section-label">Speakers</div>
      <label class="settings-check-row">
        <span class="settings-check-name">
          Color speaker names
          <span class="settings-check-hint">A distinct hue per speaker</span>
        </span>
        <span class="settings-pill">
          <input type="checkbox" bind:checked={spkColor} on:change={saveSpkColor} aria-label="Color speaker names by speaker" />
          <span class="settings-pill-track"></span>
          <span class="settings-pill-thumb"></span>
        </span>
      </label>
    </div>
    {/if}

    <div class="settings-section">
      <div class="settings-section-label">Copying</div>
      <label class="settings-check-row">
        <span class="settings-check-name">
          Append citation on copy
          <span class="settings-check-hint">Greek selections only</span>
        </span>
        <span class="settings-pill">
          <input type="checkbox" bind:checked={citeCopy} on:change={saveCiteCopy} aria-label="Append citation when copying text" />
          <span class="settings-pill-track"></span>
          <span class="settings-pill-thumb"></span>
        </span>
      </label>
    </div>

    <div class="settings-section">
      <button type="button" class="settings-reset" on:click={resetSettings}>Reset to defaults</button>
    </div>
  </div>
</aside>

{#if settingsOpen}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="settings-backdrop" on:click={closeSettings} transition:fade={{ duration: reduceMotion ? 0 : 180 }}></div>
{/if}

{#if popup}
  <WordPopup
    {work}
    token={popup.token}
    anchor={popup.anchor}
    asSheet={trans === 'compare'}
    onClose={closePopup}
  />
{/if}

<svelte:window on:pointerdown={onDocPointerDown} />

{#if footnote}
  <FootnotePopup
    {work}
    n={footnote.n}
    transId={footnote.transId}
    anchor={footnote.anchor}
    onClose={closeFootnote}
    onHoverIn={cancelFnClose}
    onHoverOut={scheduleFnClose}
  />
{/if}

{#if copyBtnPos}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <button
    class="copy-cite-btn"
    style="left:{copyBtnPos.x}px;top:{copyBtnPos.y}px"
    on:mousedown|preventDefault
    on:click={clickCopyBtn}
    aria-label="Copy with citation"
    title="Copy with citation"
  >
    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M4 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V2z"/>
      <path d="M0 4a2 2 0 0 1 2-2v10a2 2 0 0 0 2 2h8a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V4z"/>
    </svg>
    Copy
  </button>
{/if}
