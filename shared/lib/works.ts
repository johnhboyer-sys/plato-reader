// The corpus registry — the single source of truth for which works the site
// carries. Adding a work is one entry here (plus its pipeline data under
// build/dist/<id>/). Everything else — routing, the home index, the reader's
// work switcher, unified search — is driven off this list.
//
// `id` is the URL slug AND the data directory name; it is a readable
// CamelCase slug matching the manifest filename (Euthyphro, Alcibiades1),
// established by the Euthyphro pilot rather than a Bekker-style abbreviation.
//
// `translations[].slot` says which emitted segment field the reader renders for
// that translation: 'english' is the primary parallel chunk, 'ross' a
// secondary chapter-anchored overlay, 'third' an optional third overlay, and
// 'overlay' any further overlay (4th onward) read from seg.overlays[id] — so a
// work can carry any number of translations. The picker lists them in
// registry order. Every Plato work in this rollout carries exactly one
// (primary/'english') translation; the slot machinery is inherited generic
// infrastructure, not Plato-specific.

export interface TranslationRef {
  id: string;
  name: string;     // full citation, for the picker + attribution
  short: string;    // chip label
  slot: 'english' | 'ross' | 'third' | 'overlay';
  // Carries inline `[^N]` footnote markers + a footnotes.json popup map.
  // Independent of slot — the reader renders the markers for whichever
  // translation sets this.
  footnotes?: boolean;
  // Copyright-encumbered translations carried only in the local/full build.
  // The public deploy sets PUBLIC_HIDE_PRIVATE=1 to drop them from the registry
  // (and is built from the work's -public manifest, so their text is absent too).
  private?: boolean;
}

// A gap in a work's book sequence worth annotating in the reader (e.g. the
// Aristotelian Eudemian Ethics' "common books", shared with the Nicomachean
// Ethics and not reprinted). No work in this rollout uses it — every Plato
// work here is bookless (books: 1) — but the field/type stay as generic
// multi-book infrastructure for the Republic/Laws/Letters follow-up.
export interface MissingBooks {
  after: number;      // render the note after this (contiguous) book index
  label: string;      // the missing books' labels, e.g. 'IV–VI'
  note: string;       // one line explaining the gap
  linkWork: string;   // id of the work that carries the text (e.g. 'EN')
  linkBook: number;   // book to jump to in that work
  linkLabel: string;  // link text, e.g. 'Nicomachean Ethics V–VII'
}

export interface Work {
  id: string;       // slug + data dir, e.g. 'Euthyphro'
  title: string;
  greekTitle?: string;  // polytonic Greek title, shown in the print masthead
  abbr: string;     // display abbreviation (may differ from id styling)
  author: string;
  books: number;
  bookLabels: string[];   // per-book display labels (Arabic for a bookless work)
  missingBooks?: MissingBooks;  // annotate a gap in the book sequence
  greekEdition: string;
  // The print edition the TLG text was digitised from, in two lengths: `short`
  // for the reader's bilingual strip, `full` for the Greek-only strip and the
  // Texts & Licences page (both driven off this one field so they can't drift).
  greekSource: { short: string; full: string };
  translations: TranslationRef[];
  // Which translation the reader shows by default (a translations[].id). When
  // omitted the reader falls back to the primary 'english'-slot translation.
  defaultTranslation?: string;
  blurb: string;    // one line for the home index
  // Most works are cited by Bekker (column:line). Plato is cited by Stephanus
  // page + section only — no user-facing line numbers at all (see
  // shared/lib/citation.ts). Default (omitted) = bekker.
  citation?: { scheme: 'bekker' | 'busse' | 'stephanus'; hideLineNumbers?: boolean };
  // Cross-links to closely related works, shown on the landing page. Each
  // `id` must be a built work.
  related?: { id: string; label: string }[];
  // Ancient commentaries/introductions hosted on the site that comment on THIS
  // work (ids of built works), surfaced in a "Commentary" section on the
  // landing page.
  commentaries?: string[];
  /** Authorship status. Absent ⇒ genuine. Drives the homepage/landing badge. */
  authenticity?: 'genuine' | 'dubious' | 'spurious';
  // Traditional stylometric/dramatic dating (early/middle/late Plato), shown
  // as a single hedged line on the work's landing page. Omitted for the
  // disputed corpus (works without a settled place in the traditional
  // chronology) and the Letters — see docs/registry-draft.md and John's call
  // 2026-07-11. Not shown anywhere on the home page.
  period?: 'early' | 'middle' | 'late';
}

export const AUTHENTICITY_LABEL: Record<'dubious' | 'spurious', string> = {
  dubious: 'Dubious',
  spurious: 'Spurious',
};

// Copyright-encumbered translations are carried ONLY when a build explicitly
// opts in via PUBLIC_SHOW_PRIVATE=1 — the `npm run dev` script sets it, so they
// show locally. Every production build (plain `npm run build` AND the public
// deploy, which forces it off) leaves it unset, so private entries — and their
// citations — are dropped from the bundle. This is fail-SAFE: a forgotten flag
// hides private content rather than leaking text we can't host. No work in
// this rollout carries a private translation yet, but `visibleTranslations`
// below still gates on this flag for when one does.
const SHOW_PRIVATE = import.meta.env.PUBLIC_SHOW_PRIVATE === '1';

// The site's house author. Works BY this author show a bare title everywhere a
// label is composed (work switcher, breadcrumbs); a work by anyone else (a
// future commentator/introduction, as aristotle-reader carries Porphyry) keeps
// the "(Author)" parenthetical. Single named constant so the default is never a
// scattered string comparison.
export const HOUSE_AUTHOR = 'Plato';

// Display order follows the Thrasyllan tetralogies (the traditional ancient
// arrangement of the Platonic corpus, TLG work order 001–036 = ceil(n/4)),
// per docs/registry-draft.md. The full 36-work Thrasyllan canon is carried:
// the P6b bookless rollout, the Republic/Laws/Letters multi-book follow-up,
// and the four works whose Perseus milestone gaps were patched
// (sources/perseus-eng/PATCHES.md). Phase-2 appendix (Definitions, Spuria)
// is not yet here — see docs/registry-draft.md.
export const WORKS: Work[] = [
  // ---- Tetralogy I ----
  {
    id: 'Euthyphro',
    title: 'Euthyphro',
    greekTitle: 'Εὐθύφρων',
    abbr: 'Euthphr.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 1 (OCT, 1900)',
    greekSource: {
      short: 'Burnet (OCT, 1900)',
      full: 'J. Burnet, ed. Platonis opera, vol. 1. Oxford: Clarendon Press, 1900 (repr. 1967).',
    },
    translations: [
      { id: 'fowler', name: 'H. N. Fowler (Loeb, 1914)', short: 'Fowler', slot: 'english' },
      // Turn-aligned public-domain second voice (align_turns.py); its text is
      // carried per-turn in turnFlow (FlowTurn.alt.jowett), not the segment
      // overlay slots — the 'overlay' slot here just marks it a non-primary
      // translation for the picker / compare gating.
      { id: 'jowett', name: 'Benjamin Jowett (3rd ed., 1892)', short: 'Jowett', slot: 'overlay' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    period: 'early',
    blurb: 'Socrates and Euthyphro on piety, outside the court of the archon basileus.',
  },
  {
    id: 'Apology',
    title: 'Apology',
    greekTitle: 'Ἀπολογία Σωκράτους',
    abbr: 'Ap.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 1 (OCT, 1900)',
    greekSource: {
      short: 'Burnet (OCT, 1900)',
      full: 'J. Burnet, ed. Platonis opera, vol. 1. Oxford: Clarendon Press, 1900 (repr. 1967).',
    },
    translations: [
      { id: 'fowler', name: 'H. N. Fowler (Loeb, 1914)', short: 'Fowler', slot: 'english' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    period: 'early',
    blurb: 'Socrates’ defense at his trial before the Athenian jury, on the charges of impiety and corrupting the youth.',
  },
  {
    id: 'Crito',
    title: 'Crito',
    greekTitle: 'Κρίτων',
    abbr: 'Cri.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 1 (OCT, 1900)',
    greekSource: {
      short: 'Burnet (OCT, 1900)',
      full: 'J. Burnet, ed. Platonis opera, vol. 1. Oxford: Clarendon Press, 1900 (repr. 1967).',
    },
    translations: [
      { id: 'fowler', name: 'H. N. Fowler (Loeb, 1914)', short: 'Fowler', slot: 'english' },
      { id: 'jowett', name: 'Benjamin Jowett (3rd ed., 1892)', short: 'Jowett', slot: 'overlay' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    period: 'early',
    blurb: 'Socrates, awaiting execution in prison, explains to Crito why he will not escape.',
  },
  {
    id: 'Phaedo',
    title: 'Phaedo',
    greekTitle: 'Φαίδων',
    abbr: 'Phd.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 1 (OCT, 1900)',
    greekSource: {
      short: 'Burnet (OCT, 1900)',
      full: 'J. Burnet, ed. Platonis opera, vol. 1. Oxford: Clarendon Press, 1900 (repr. 1967).',
    },
    translations: [
      { id: 'fowler', name: 'H. N. Fowler (Loeb, 1914)', short: 'Fowler', slot: 'english' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    period: 'middle',
    blurb: 'Socrates’ final conversation and death in prison, arguing for the immortality of the soul.',
  },
  // ---- Tetralogy II ----
  {
    id: 'Cratylus',
    title: 'Cratylus',
    greekTitle: 'Κρατύλος',
    abbr: 'Cra.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 1 (OCT, 1900)',
    greekSource: {
      short: 'Burnet (OCT, 1900)',
      full: 'J. Burnet, ed. Platonis opera, vol. 1. Oxford: Clarendon Press, 1900 (repr. 1967).',
    },
    translations: [
      { id: 'fowler', name: 'H. N. Fowler (Loeb, 1926)', short: 'Fowler', slot: 'english' },
      { id: 'jowett', name: 'Benjamin Jowett (3rd ed., 1892)', short: 'Jowett', slot: 'overlay' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    period: 'middle',
    blurb: 'Socrates, Hermogenes, and Cratylus debate whether names signify their objects by nature or by convention.',
  },
  {
    id: 'Theaetetus',
    title: 'Theaetetus',
    greekTitle: 'Θεαίτητος',
    abbr: 'Tht.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 1 (OCT, 1900)',
    greekSource: {
      short: 'Burnet (OCT, 1900)',
      full: 'J. Burnet, ed. Platonis opera, vol. 1. Oxford: Clarendon Press, 1900 (repr. 1967).',
    },
    translations: [
      { id: 'fowler', name: 'H. N. Fowler (Loeb, 1921)', short: 'Fowler', slot: 'english' },
      { id: 'jowett', name: 'Benjamin Jowett (3rd ed., 1892)', short: 'Jowett', slot: 'overlay' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    period: 'late',
    blurb: 'Socrates and Theaetetus examine and reject three definitions of knowledge.',
  },
  {
    id: 'Sophist',
    title: 'Sophist',
    greekTitle: 'Σοφιστής',
    abbr: 'Soph.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 1 (OCT, 1900)',
    greekSource: {
      short: 'Burnet (OCT, 1900)',
      full: 'J. Burnet, ed. Platonis opera, vol. 1. Oxford: Clarendon Press, 1900 (repr. 1967).',
    },
    translations: [
      { id: 'fowler', name: 'H. N. Fowler (Loeb, 1921)', short: 'Fowler', slot: 'english' },
      { id: 'jowett', name: 'Benjamin Jowett (3rd ed., 1892)', short: 'Jowett', slot: 'overlay' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    period: 'late',
    blurb: 'An Eleatic Stranger and Theaetetus pursue a definition of the sophist through the method of division, and confront the problem of not-being.',
  },
  {
    id: 'Statesman',
    title: 'Statesman',
    greekTitle: 'Πολιτικός',
    abbr: 'Plt.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 1 (OCT, 1900)',
    greekSource: {
      short: 'Burnet (OCT, 1900)',
      full: 'J. Burnet, ed. Platonis opera, vol. 1. Oxford: Clarendon Press, 1900 (repr. 1967).',
    },
    translations: [
      { id: 'fowler', name: 'H. N. Fowler (Loeb, 1925)', short: 'Fowler', slot: 'english' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    period: 'late',
    blurb: 'An Eleatic Stranger and the young Socrates seek a definition of the statesman and the nature of political rule.',
  },
  // ---- Tetralogy III ----
  {
    id: 'Symposium',
    title: 'Symposium',
    greekTitle: 'Συμπόσιον',
    abbr: 'Smp.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 2 (OCT, 1901)',
    greekSource: {
      short: 'Burnet (OCT, 1901)',
      full: 'J. Burnet, ed. Platonis opera, vol. 2. Oxford: Clarendon Press, 1901 (repr. 1967).',
    },
    translations: [
      { id: 'lamb', name: 'W. R. M. Lamb (Loeb, 1925)', short: 'Lamb', slot: 'english' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    period: 'middle',
    blurb: 'Speeches in praise of Love at Agathon’s victory banquet, crowned by Socrates’ report of Diotima’s teaching.',
  },
  {
    id: 'Parmenides',
    title: 'Parmenides',
    greekTitle: 'Παρμενίδης',
    abbr: 'Prm.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 2 (OCT, 1901)',
    greekSource: {
      short: 'Burnet (OCT, 1901)',
      full: 'J. Burnet, ed. Platonis opera, vol. 2. Oxford: Clarendon Press, 1901 (repr. 1967).',
    },
    translations: [
      { id: 'fowler', name: 'H. N. Fowler (Loeb, 1926)', short: 'Fowler', slot: 'english' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    period: 'late',
    blurb: 'The aged Parmenides examines the young Socrates’ theory of Forms and demonstrates the perplexities of the One.',
  },
  {
    id: 'Philebus',
    title: 'Philebus',
    greekTitle: 'Φίληβος',
    abbr: 'Phlb.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 2 (OCT, 1901)',
    greekSource: {
      short: 'Burnet (OCT, 1901)',
      full: 'J. Burnet, ed. Platonis opera, vol. 2. Oxford: Clarendon Press, 1901 (repr. 1967).',
    },
    translations: [
      { id: 'fowler', name: 'H. N. Fowler (Loeb, 1925)', short: 'Fowler', slot: 'english' },
      { id: 'jowett', name: 'Benjamin Jowett (3rd ed., 1892)', short: 'Jowett', slot: 'overlay' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    period: 'late',
    blurb: 'Socrates and Protarchus weigh the claims of pleasure and knowledge to be the good life.',
  },
  {
    id: 'Phaedrus',
    title: 'Phaedrus',
    greekTitle: 'Φαῖδρος',
    abbr: 'Phdr.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 2 (OCT, 1901)',
    greekSource: {
      short: 'Burnet (OCT, 1901)',
      full: 'J. Burnet, ed. Platonis opera, vol. 2. Oxford: Clarendon Press, 1901 (repr. 1967).',
    },
    translations: [
      { id: 'fowler', name: 'H. N. Fowler (Loeb, 1914)', short: 'Fowler', slot: 'english' },
      { id: 'jowett', name: 'Benjamin Jowett (3rd ed., 1892)', short: 'Jowett', slot: 'overlay' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    period: 'middle',
    blurb: 'Socrates and Phaedrus on erotic love, the soul, and the art of rhetoric.',
  },
  // ---- Tetralogy IV ----
  {
    id: 'Alcibiades1',
    title: 'Alcibiades I',
    greekTitle: 'Ἀλκιβιάδης αʹ',
    abbr: 'Alc. I',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 2 (OCT, 1901)',
    greekSource: {
      short: 'Burnet (OCT, 1901)',
      full: 'J. Burnet, ed. Platonis opera, vol. 2. Oxford: Clarendon Press, 1901 (repr. 1967).',
    },
    translations: [
      { id: 'lamb', name: 'W. R. M. Lamb (Loeb, 1927)', short: 'Lamb', slot: 'english' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    authenticity: 'dubious',
    blurb: 'Socrates urges the young Alcibiades toward self-knowledge as the basis of political ambition.',
  },
  {
    id: 'Alcibiades2',
    title: 'Alcibiades II',
    greekTitle: 'Ἀλκιβιάδης βʹ',
    abbr: 'Alc. II',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 2 (OCT, 1901)',
    greekSource: {
      short: 'Burnet (OCT, 1901)',
      full: 'J. Burnet, ed. Platonis opera, vol. 2. Oxford: Clarendon Press, 1901 (repr. 1967).',
    },
    translations: [
      { id: 'lamb', name: 'W. R. M. Lamb (Loeb, 1927)', short: 'Lamb', slot: 'english' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    authenticity: 'dubious',
    blurb: 'Socrates and Alcibiades on the dangers of praying for what one does not understand.',
  },
  {
    id: 'Hipparchus',
    title: 'Hipparchus',
    greekTitle: 'Ἵππαρχος',
    abbr: 'Hipparch.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 2 (OCT, 1901)',
    greekSource: {
      short: 'Burnet (OCT, 1901)',
      full: 'J. Burnet, ed. Platonis opera, vol. 2. Oxford: Clarendon Press, 1901 (repr. 1967).',
    },
    translations: [
      { id: 'lamb', name: 'W. R. M. Lamb (Loeb, 1927)', short: 'Lamb', slot: 'english' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    authenticity: 'dubious',
    blurb: 'Socrates and a companion inquire into the nature of love of gain, framed by an account of the tyrant Hipparchus.',
  },
  {
    id: 'Lovers',
    title: 'Lovers',
    greekTitle: 'Ἐρασταί',
    abbr: 'Amat.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 2 (OCT, 1901)',
    greekSource: {
      short: 'Burnet (OCT, 1901)',
      full: 'J. Burnet, ed. Platonis opera, vol. 2. Oxford: Clarendon Press, 1901 (repr. 1967).',
    },
    translations: [
      { id: 'lamb', name: 'W. R. M. Lamb (Loeb, 1927)', short: 'Lamb', slot: 'english' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    authenticity: 'dubious',
    blurb: 'Socrates contrasts philosophy with a rival, more superficial idea of intellectual culture.',
  },
  // ---- Tetralogy V ----
  {
    id: 'Theages',
    title: 'Theages',
    greekTitle: 'Θεάγης',
    abbr: 'Thg.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 3 (OCT, 1903)',
    greekSource: {
      short: 'Burnet (OCT, 1903)',
      full: 'J. Burnet, ed. Platonis opera, vol. 3. Oxford: Clarendon Press, 1903 (repr. 1968).',
    },
    translations: [
      { id: 'lamb', name: 'W. R. M. Lamb (Loeb, 1927)', short: 'Lamb', slot: 'english' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    authenticity: 'dubious',
    blurb: 'Socrates and Demodocus discuss whether wisdom can be taught, and the nature of Socrates’ daimonion.',
  },
  {
    id: 'Charmides',
    title: 'Charmides',
    greekTitle: 'Χαρμίδης',
    abbr: 'Chrm.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 3 (OCT, 1903)',
    greekSource: {
      short: 'Burnet (OCT, 1903)',
      full: 'J. Burnet, ed. Platonis opera, vol. 3. Oxford: Clarendon Press, 1903 (repr. 1968).',
    },
    translations: [
      { id: 'lamb', name: 'W. R. M. Lamb (Loeb, 1927)', short: 'Lamb', slot: 'english' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    period: 'early',
    blurb: 'Socrates and the young Charmides seek a definition of sōphrosynē, temperance or self-knowledge.',
  },
  {
    id: 'Laches',
    title: 'Laches',
    greekTitle: 'Λάχης',
    abbr: 'La.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 3 (OCT, 1903)',
    greekSource: {
      short: 'Burnet (OCT, 1903)',
      full: 'J. Burnet, ed. Platonis opera, vol. 3. Oxford: Clarendon Press, 1903 (repr. 1968).',
    },
    translations: [
      { id: 'lamb', name: 'W. R. M. Lamb (Loeb, 1924)', short: 'Lamb', slot: 'english' },
      { id: 'jowett', name: 'Benjamin Jowett (3rd ed., 1892)', short: 'Jowett', slot: 'overlay' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    period: 'early',
    blurb: 'Socrates, Laches, and Nicias examine the nature of courage.',
  },
  {
    id: 'Lysis',
    title: 'Lysis',
    greekTitle: 'Λύσις',
    abbr: 'Ly.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 3 (OCT, 1903)',
    greekSource: {
      short: 'Burnet (OCT, 1903)',
      full: 'J. Burnet, ed. Platonis opera, vol. 3. Oxford: Clarendon Press, 1903 (repr. 1968).',
    },
    translations: [
      { id: 'lamb', name: 'W. R. M. Lamb (Loeb, 1925)', short: 'Lamb', slot: 'english' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    period: 'early',
    blurb: 'Socrates and two boys, Lysis and Menexenus, inquire into the nature of friendship.',
  },
  // ---- Tetralogy VI ----
  {
    id: 'Euthydemus',
    title: 'Euthydemus',
    greekTitle: 'Εὐθύδημος',
    abbr: 'Euthd.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 3 (OCT, 1903)',
    greekSource: {
      short: 'Burnet (OCT, 1903)',
      full: 'J. Burnet, ed. Platonis opera, vol. 3. Oxford: Clarendon Press, 1903 (repr. 1968).',
    },
    translations: [
      { id: 'lamb', name: 'W. R. M. Lamb (Loeb, 1924)', short: 'Lamb', slot: 'english' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    period: 'early',
    blurb: 'Socrates confronts two sophist brothers and their eristic tricks, while defending the value of philosophy.',
  },
  {
    id: 'Protagoras',
    title: 'Protagoras',
    greekTitle: 'Πρωταγόρας',
    abbr: 'Prt.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 3 (OCT, 1903)',
    greekSource: {
      short: 'Burnet (OCT, 1903)',
      full: 'J. Burnet, ed. Platonis opera, vol. 3. Oxford: Clarendon Press, 1903 (repr. 1968).',
    },
    translations: [
      { id: 'lamb', name: 'W. R. M. Lamb (Loeb, 1924)', short: 'Lamb', slot: 'english' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    period: 'early',
    blurb: 'Socrates debates the great sophist on whether virtue can be taught and the unity of the virtues.',
  },
  {
    id: 'Gorgias',
    title: 'Gorgias',
    greekTitle: 'Γοργίας',
    abbr: 'Grg.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 3 (OCT, 1903)',
    greekSource: {
      short: 'Burnet (OCT, 1903)',
      full: 'J. Burnet, ed. Platonis opera, vol. 3. Oxford: Clarendon Press, 1903 (repr. 1968).',
    },
    translations: [
      { id: 'lamb', name: 'W. R. M. Lamb (Loeb, 1925)', short: 'Lamb', slot: 'english' },
      { id: 'jowett', name: 'Benjamin Jowett (3rd ed., 1892)', short: 'Jowett', slot: 'overlay' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    period: 'early',
    blurb: 'Socrates confronts Gorgias, Polus, and Callicles on rhetoric, justice, and the good life.',
  },
  {
    id: 'Meno',
    title: 'Meno',
    greekTitle: 'Μένων',
    abbr: 'Men.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 3 (OCT, 1903)',
    greekSource: {
      short: 'Burnet (OCT, 1903)',
      full: 'J. Burnet, ed. Platonis opera, vol. 3. Oxford: Clarendon Press, 1903 (repr. 1968).',
    },
    translations: [
      { id: 'lamb', name: 'W. R. M. Lamb (Loeb, 1924)', short: 'Lamb', slot: 'english' },
      { id: 'jowett', name: 'Benjamin Jowett (3rd ed., 1892)', short: 'Jowett', slot: 'overlay' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    period: 'middle',
    blurb: 'Socrates and Meno ask whether virtue can be taught, and Socrates elicits a geometrical proof from an untutored slave.',
  },
  // ---- Tetralogy VII ----
  {
    id: 'HippiasMajor',
    title: 'Hippias Major',
    greekTitle: 'Ἱππίας μείζων',
    abbr: 'Hp. Ma.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 3 (OCT, 1903)',
    greekSource: {
      short: 'Burnet (OCT, 1903)',
      full: 'J. Burnet, ed. Platonis opera, vol. 3. Oxford: Clarendon Press, 1903 (repr. 1968).',
    },
    translations: [
      { id: 'fowler', name: 'H. N. Fowler (Loeb, 1926)', short: 'Fowler', slot: 'english' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    authenticity: 'dubious',
    period: 'early',
    blurb: 'Socrates presses Hippias for a definition of the beautiful, demolishing one answer after another.',
  },
  {
    id: 'HippiasMinor',
    title: 'Hippias Minor',
    greekTitle: 'Ἱππίας ἐλάττων',
    abbr: 'Hp. Mi.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 3 (OCT, 1903)',
    greekSource: {
      short: 'Burnet (OCT, 1903)',
      full: 'J. Burnet, ed. Platonis opera, vol. 3. Oxford: Clarendon Press, 1903 (repr. 1968).',
    },
    translations: [
      { id: 'fowler', name: 'H. N. Fowler (Loeb, 1926)', short: 'Fowler', slot: 'english' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    period: 'early',
    blurb: 'Socrates and the sophist Hippias debate whether the deliberate wrongdoer is better than the involuntary one.',
  },
  {
    id: 'Ion',
    title: 'Ion',
    greekTitle: 'Ἴων',
    abbr: 'Ion',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 3 (OCT, 1903)',
    greekSource: {
      short: 'Burnet (OCT, 1903)',
      full: 'J. Burnet, ed. Platonis opera, vol. 3. Oxford: Clarendon Press, 1903 (repr. 1968).',
    },
    translations: [
      { id: 'lamb', name: 'W. R. M. Lamb (Loeb, 1925)', short: 'Lamb', slot: 'english' },
      { id: 'jowett', name: 'Benjamin Jowett (3rd ed., 1892)', short: 'Jowett', slot: 'overlay' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    period: 'early',
    blurb: 'Socrates questions the rhapsode Ion on whether his art rests on knowledge or divine inspiration.',
  },
  {
    id: 'Menexenus',
    title: 'Menexenus',
    greekTitle: 'Μενέξενος',
    abbr: 'Mx.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 3 (OCT, 1903)',
    greekSource: {
      short: 'Burnet (OCT, 1903)',
      full: 'J. Burnet, ed. Platonis opera, vol. 3. Oxford: Clarendon Press, 1903 (repr. 1968).',
    },
    translations: [
      { id: 'bury', name: 'R. G. Bury (Loeb, 1929)', short: 'Bury', slot: 'english' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    period: 'early',
    blurb: 'Socrates recites a funeral oration for the Athenian war dead, framed as a parody of civic rhetoric.',
  },
  // ---- Tetralogy VIII ----
  {
    id: 'Clitophon',
    title: 'Clitophon',
    greekTitle: 'Κλειτοφῶν',
    abbr: 'Clit.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 4 (OCT, 1902)',
    greekSource: {
      short: 'Burnet (OCT, 1902)',
      full: 'J. Burnet, ed. Platonis opera, vol. 4. Oxford: Clarendon Press, 1902 (repr. 1968).',
    },
    translations: [
      { id: 'bury', name: 'R. G. Bury (Loeb, 1929)', short: 'Bury', slot: 'english' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    authenticity: 'dubious',
    blurb: 'Clitophon reproaches Socrates for exhorting others to virtue without teaching what virtue is.',
  },
  {
    id: 'Republic',
    title: 'Republic',
    greekTitle: 'Πολιτεία',
    abbr: 'Rep.',
    author: 'Plato',
    books: 10,
    bookLabels: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'],
    greekEdition: 'Burnet, Platonis Opera vol. 4 (OCT, 1902)',
    greekSource: {
      short: 'Burnet (OCT, 1902)',
      full: 'J. Burnet, ed. Platonis opera, vol. 4. Oxford: Clarendon Press, 1902 (repr. 1968).',
    },
    // Shorey (Loeb, 1930/1935) — grey-area accepted on the Perseus/Tufts
    // public-hosting cover, per John's call 2026-07-11 (sources/INVENTORY.md).
    translations: [
      { id: 'shorey', name: 'Paul Shorey (Loeb, 1930–35)', short: 'Shorey', slot: 'english' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    period: 'middle',
    blurb: 'Socrates constructs the just city in speech to find justice in the soul — the central work of the corpus.',
  },
  {
    id: 'Timaeus',
    title: 'Timaeus',
    greekTitle: 'Τίμαιος',
    abbr: 'Ti.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 4 (OCT, 1902)',
    greekSource: {
      short: 'Burnet (OCT, 1902)',
      full: 'J. Burnet, ed. Platonis opera, vol. 4. Oxford: Clarendon Press, 1902 (repr. 1968).',
    },
    translations: [
      { id: 'bury', name: 'R. G. Bury (Loeb, 1929)', short: 'Bury', slot: 'english' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    period: 'late',
    blurb: 'Timaeus gives a cosmological account of the origin and structure of the universe.',
  },
  {
    id: 'Critias',
    title: 'Critias',
    greekTitle: 'Κριτίας',
    abbr: 'Criti.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 4 (OCT, 1902)',
    greekSource: {
      short: 'Burnet (OCT, 1902)',
      full: 'J. Burnet, ed. Platonis opera, vol. 4. Oxford: Clarendon Press, 1902 (repr. 1968).',
    },
    translations: [
      { id: 'bury', name: 'R. G. Bury (Loeb, 1929)', short: 'Bury', slot: 'english' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    period: 'late',
    blurb: 'Critias tells the unfinished story of ancient Athens and the island empire of Atlantis.',
  },
  // ---- Tetralogy IX ----
  {
    id: 'Minos',
    title: 'Minos',
    greekTitle: 'Μίνως',
    abbr: 'Min.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 5 (OCT, 1907)',
    greekSource: {
      short: 'Burnet (OCT, 1907)',
      full: 'J. Burnet, ed. Platonis opera, vol. 5. Oxford: Clarendon Press, 1907 (repr. 1967).',
    },
    translations: [
      { id: 'lamb', name: 'W. R. M. Lamb (Loeb, 1927)', short: 'Lamb', slot: 'english' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    authenticity: 'dubious',
    blurb: 'Socrates and a companion inquire into the nature of law and its relation to Minos, the lawgiver of Crete.',
  },
  {
    id: 'Laws',
    title: 'Laws',
    greekTitle: 'Νόμοι',
    abbr: 'Leg.',
    author: 'Plato',
    books: 12,
    bookLabels: ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'],
    greekEdition: 'Burnet, Platonis Opera vol. 5 (OCT, 1907)',
    greekSource: {
      short: 'Burnet (OCT, 1907)',
      full: 'J. Burnet, ed. Platonis opera, vol. 5. Oxford: Clarendon Press, 1907 (repr. 1967).',
    },
    translations: [
      { id: 'bury', name: 'R. G. Bury (Loeb, 1926)', short: 'Bury', slot: 'english' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    period: 'late',
    blurb: 'An Athenian stranger, Cleinias, and Megillus frame the laws of a new Cretan city — Plato’s longest and last work.',
  },
  {
    id: 'Epinomis',
    title: 'Epinomis',
    greekTitle: 'Ἐπινομίς',
    abbr: 'Epin.',
    author: 'Plato',
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 5 (OCT, 1907)',
    greekSource: {
      short: 'Burnet (OCT, 1907)',
      full: 'J. Burnet, ed. Platonis opera, vol. 5. Oxford: Clarendon Press, 1907 (repr. 1967).',
    },
    translations: [
      { id: 'lamb', name: 'W. R. M. Lamb (Loeb, 1927)', short: 'Lamb', slot: 'english' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    authenticity: 'dubious',
    blurb: 'A sequel to the Laws, on the study that makes a man wise, likely by a later hand.',
  },
  {
    id: 'Letters',
    title: 'Letters',
    greekTitle: 'Ἐπιστολαί',
    abbr: 'Ep.',
    author: 'Plato',
    // The 13 letters render as one continuous Stephanus-paginated work; the
    // 7 sections that straddle a letter boundary in the print tradition merge
    // cleanly this way (see manifests/Letters.yaml). Per-letter nav is later
    // polish.
    books: 1,
    bookLabels: ['1'],
    greekEdition: 'Burnet, Platonis Opera vol. 5 (OCT, 1907)',
    greekSource: {
      short: 'Burnet (OCT, 1907)',
      full: 'J. Burnet, ed. Platonis opera, vol. 5. Oxford: Clarendon Press, 1907 (repr. 1967).',
    },
    translations: [
      { id: 'bury', name: 'R. G. Bury (Loeb, 1929)', short: 'Bury', slot: 'english' },
    ],
    citation: { scheme: 'stephanus', hideLineNumbers: true },
    authenticity: 'dubious',
    blurb: 'Thirteen letters attributed to Plato; the Seventh, with its philosophical digression, is the most defended.',
  },
];

const BY_ID = new Map(WORKS.map((w) => [w.id, w]));

export function getWork(id: string): Work | undefined {
  return BY_ID.get(id);
}

export function bookLabel(work: Work, n: number): string {
  return work.bookLabels[n - 1] ?? String(n);
}

// A single-book work (every Plato work carried so far) is a single treatise
// with no book level, so it lives at /<work> with no /book/<n> subfolder, and
// the reader hides all book-level navigation.
export function isBookless(work: Work): boolean {
  return work.books === 1;
}

// The base-relative path to a work's READER (caller prepends BASE_URL). Every
// work — bookless or not — reads at /<work>/book/<n>; bookless works only ever
// have book 1. The bare /<work> slug is the work's landing page (workLanding).
// The single source of truth for reader URLs — used by the home index, work
// switcher, Bekker/Stephanus jump, search jumps, and cross-book outline links.
export function workPath(workId: string, book = 1): string {
  // Clamp to the work's real book range so a stale/overflow value (e.g. a
  // remembered book number for a work that is now bookless) can't 404.
  const w = BY_ID.get(workId);
  const max = w ? w.books : book;
  const b = Math.min(Math.max(1, book || 1), max);
  return `/${workId}/book/${b}`;
}

// The base-relative path to a work's LANDING page (caller prepends BASE_URL):
// the bare /<work> slug, an overview of the work that funnels into the reader.
export function workLanding(workId: string): string {
  return `/${workId}`;
}

// Translations visible in the current build. Private (copyright-encumbered)
// entries are already dropped from WORKS at compile time unless the build opted
// in (see SHOW_PRIVATE above); this filter is a runtime backstop.
// A non-Astro host (e.g. a future desktop app) can append runtime-registered
// translations — user imports, loaded from local files — via
// globalThis.__ARISTOTLE_EXTRA_TRANSLATIONS__ ({workId: TranslationRef[]});
// the site never sets it, so the static registry is unchanged there.
export function visibleTranslations(work: Work): TranslationRef[] {
  const extra = (globalThis as {
    __ARISTOTLE_EXTRA_TRANSLATIONS__?: Record<string, TranslationRef[]>;
  }).__ARISTOTLE_EXTRA_TRANSLATIONS__?.[work.id] ?? [];
  return work.translations.filter(t => !t.private || SHOW_PRIVATE).concat(extra);
}

// ---------------------------------------------------------------------------
// "In print" — copyright-encumbered modern translations and commentaries we
// can't host but want to point readers to, shown on each work's landing page.
// This is curated, additive metadata: a work with no entry simply omits the
// section. Each item is a citation plus an optional direct `url`; when `url` is
// absent the landing renders a Google Books search for the citation, so a link
// always resolves and we never fabricate a product page.
//
// Empty for this rollout — no modern Plato translations/commentaries have
// been curated yet (the Aristotle-specific catalogue this replaced is gone
// along with those works). Populate per-work as John curates them.

export interface FurtherReadingItem {
  // 'translation'/'commentary' = modern, copyright-protected works we can't host.
  // 'collection' = an in-print physical edition that CONTAINS the translation we
  // do host (e.g. a Loeb volume), for readers who want a paper copy of what
  // they're reading here.
  kind: 'translation' | 'commentary' | 'collection';
  cite: string;     // full citation, e.g. "Christopher Rowe (Penguin, 2005)"
  url?: string;     // optional direct purchase/publisher link; else Books search
}

// Citations may use <em>…</em> around the work's title (rendered as italics on
// the landing; stripped for the Google Books search link in inPrintHref).
const FURTHER_READING: Record<string, FurtherReadingItem[]> = {};

export function furtherReading(workId: string): FurtherReadingItem[] {
  return FURTHER_READING[workId] ?? [];
}

// A link that always resolves to where the cited edition can be found/bought.
// The cite may carry <em> title markup, so strip tags before building the query.
export function inPrintHref(item: FurtherReadingItem): string {
  const plain = item.cite.replace(/<[^>]+>/g, '');
  return item.url ?? `https://www.google.com/search?tbm=bks&q=${encodeURIComponent(plain)}`;
}

// ---------------------------------------------------------------------------
// "Resources" — external study aids relevant to a specific work, shown on the
// landing page. Curated, additive metadata like FURTHER_READING: a work with
// no entry simply omits the section. Empty for this rollout (the Aristotle
// logic-exercise catalogue this replaced doesn't apply to Plato).

export interface ResourceItem {
  label: string;         // resource name
  url: string;
  blurb: string;         // one line describing the resource
  authorName: string;
  authorUrl: string;
  exercises?: string;    // exercise set(s) within the resource keyed to this work
}

const RESOURCES: Record<string, ResourceItem[]> = {};

export function resourcesFor(workId: string): ResourceItem[] {
  return RESOURCES[workId] ?? [];
}

// ---------------------------------------------------------------------------
// Home-page taxonomy. The nine Thrasyllan tetralogies grouped the corpus by
// original publication set — accurate ancient history, but "too inside
// baseball" for a first-time reader (John's call 2026-07-11): nobody browsing
// for something to read thinks in tetralogies. SHELVES replaces that grouping
// with six thematic "reading paths" a newcomer would recognise (the trial and
// death of Socrates, the search for definitions, and so on). WITHIN each
// shelf, works stay in Thrasyllan (TLG-number) order — scholars will notice
// that continuity; nobody else has to. A `ShelfWork` is either an existing
// work (`id`, resolved against WORKS) or a not-yet-added work shown as a
// "coming soon" placeholder (`title` only) — unused so far; the works missing
// from this rollout are called out with a TODO comment instead (see WORKS
// above), since none of them are meant to display as a placeholder card yet.
// Every one of the 36 WORKS entries appears in exactly one shelf — verified in
// shared/__tests__/works.test.ts.

export interface ShelfWork {
  id?: string;      // an existing work (in WORKS) — clickable
  title?: string;   // a planned work — greyed-out placeholder
}

export interface Shelf {
  numeral: string;  // '1'–'6', a plain ordinal — the shelf TITLE is what should read prominently
  title: string;    // 'The Trial and Death of Socrates'
  works: ShelfWork[];
}

export const SHELVES: Shelf[] = [
  {
    numeral: '1',
    title: 'The Trial and Death of Socrates',
    works: [{ id: 'Euthyphro' }, { id: 'Apology' }, { id: 'Crito' }, { id: 'Phaedo' }],
  },
  {
    numeral: '2',
    title: 'Searching for Definitions',
    works: [
      { id: 'Charmides' }, { id: 'Laches' }, { id: 'Lysis' }, { id: 'Euthydemus' },
      { id: 'Meno' }, { id: 'HippiasMajor' }, { id: 'HippiasMinor' }, { id: 'Ion' },
    ],
  },
  {
    numeral: '3',
    title: 'Love, Rhetoric, and the Sophists',
    works: [
      { id: 'Cratylus' }, { id: 'Symposium' }, { id: 'Phaedrus' },
      { id: 'Protagoras' }, { id: 'Gorgias' }, { id: 'Menexenus' },
    ],
  },
  {
    numeral: '4',
    title: 'The Republic and Politics',
    works: [
      { id: 'Statesman' }, { id: 'Clitophon' }, { id: 'Republic' },
      { id: 'Critias' }, { id: 'Minos' }, { id: 'Laws' },
    ],
  },
  {
    numeral: '5',
    title: 'Knowledge and Being',
    works: [{ id: 'Theaetetus' }, { id: 'Sophist' }, { id: 'Parmenides' }, { id: 'Philebus' }, { id: 'Timaeus' }],
  },
  {
    numeral: '6',
    title: 'Letters and Disputed Works',
    works: [
      { id: 'Alcibiades1' }, { id: 'Alcibiades2' }, { id: 'Hipparchus' }, { id: 'Lovers' },
      { id: 'Theages' }, { id: 'Epinomis' }, { id: 'Letters' },
    ],
  },
];

// "Start here" — a curated front-table strip of six approachable works for
// newcomers, rendered as a featured band ABOVE the SHELVES on the home page
// (John's call 2026-07-11, Option 3). These six also keep their normal place
// in their thematic shelf below: this is an additive pointer, not a seventh
// division, so the "every work exactly once" invariant is checked against
// SHELVES only. Every id here must resolve to a real WORKS entry — verified
// in shared/__tests__/works.test.ts.
export const START_HERE: string[] = [
  'Apology', 'Republic', 'Symposium', 'Meno', 'Phaedo', 'Gorgias',
];

// A named group of works for the search "works to include" selector: one entry
// per home-page shelf, in home-page order, holding only the existing works
// (placeholders dropped).
export interface WorkGroup {
  ref: string;    // '1'–'6' (the shelf numeral)
  label: string;  // the shelf's title
  ids: string[];  // existing work ids in this group, in order
}

export const WORK_GROUPS: WorkGroup[] = (() => {
  const groups: WorkGroup[] = [];
  const ids = (ws: ShelfWork[]) => ws.filter(w => w.id && BY_ID.has(w.id)).map(w => w.id!);
  for (const shelf of SHELVES) {
    const g = ids(shelf.works);
    if (g.length) groups.push({ ref: shelf.numeral, label: shelf.title, ids: g });
  }
  return groups;
})();

// Cross-work ordering for search results, matching the home page's SHELVES
// flatten order (which differs from the raw WORKS/corpus order). Any real work
// not referenced by SHELVES is appended in WORKS order so every searchable
// work has a defined index.
export const WORK_ORDER: Map<string, number> = (() => {
  const order: string[] = [];
  for (const g of WORK_GROUPS) for (const id of g.ids) order.push(id);
  for (const w of WORKS) if (!order.includes(w.id)) order.push(w.id);
  return new Map(order.map((id, i) => [id, i]));
})();
