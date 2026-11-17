// The results page's side column (John, 2026-11-09: "Controls + summary").
// The controls sit in one place, labelled "Refine results": a column beside
// the hits on a wide screen, a sheet opened by the filter icon on a narrow
// one. "This search" lists what narrows or changes the results, each with a
// button that undoes it: since S4b (round 34) only at the head of the sheet's
// menu, as the rail has no summary. The controls themselves are tested where
// they were before (result-views-search, form-panel-search, ...); this file
// tests the column, the summary and the sheet.
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Search from '../components/Search.svelte';
import type { BookData, GreekLine } from '../lib/data';
import type { HitForms, HitGrammar, Reading, SearchResult } from '../lib/search';

const { book } = vi.hoisted(() => {
  const line = (n: number, text: string): GreekLine => ({
    n, text, tokens: text.split(' ').map((t, i) => ({ t, o: i * 2, k: t })),
  });
  const book = (n: number): BookData => ({
    book: n,
    segments: [
      { id: `${n}:70a`, column: '70a', greek: [line(1, 'ἐστί τῆς λόγος ἐστι')], english: { text: 'One two three four', notes: [], markers: [] } },
      { id: `${n}:70b`, column: '70b', greek: [line(1, 'καί ταῖς')], english: { text: 'five six', notes: [], markers: [] } },
    ],
  });
  return { book };
});

vi.mock('../lib/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/search')>();
  return {
    ...actual,
    search: vi.fn(async () => ({ results: [], failedWorks: [] })),
    greekHitForms: vi.fn(async () => ({ byResult: new Map(), headwords: new Map(), failedWorks: [] })),
    greekHitGrammar: vi.fn(async () => ({ byResult: new Map(), failedWorks: [] })),
    searchCombo: vi.fn(async () => ({ results: [], failedWorks: [] })),
    searchPhraseVariants: vi.fn(),
    speakerRoster: vi.fn(async () => []),
  };
});
vi.mock('../lib/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/data')>();
  const sections = [{ column: '70a', page: 70 }, { column: '70b', page: 70 }];
  return {
    ...actual,
    fetchBook: vi.fn(async (_work: string, n: number) => book(n)),
    fetchSections: vi.fn(async () => ({ '1': sections, '2': sections })),
  };
});

afterEach(async () => {
  const { greekHitGrammar } = await import('../lib/search');
  vi.mocked(greekHitGrammar).mockReset();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

const at = (work: string, column: string, grkPositions: number[]): SearchResult => ({
  work, meta: { id: `1:${column}`, book: 1, column }, grkMatch: true, engMatch: false, grkPositions,
});
const PRES_IND: Reading = { tense: ['pres'], mood: ['ind'], voice: ['act'], person: ['3rd'], number: ['sg'] };
const GEN_SG_FEM: Reading = { case: ['gen'], number: ['sg'], gender: ['fem'] };
const DAT_SG_FEM: Reading = { case: ['dat'], number: ['sg'], gender: ['fem'] };
const DAT_PL_FEM: Reading = { case: ['dat'], number: ['pl'], gender: ['fem'] };

// Meno 70a: ἐστί τῆς ἐστι; 70b: ταῖς. Crito 70a: ἐστί τῆς. Six hits, two of
// them genitive.
const RESULTS = [at('Meno', '70a', [0, 1, 3]), at('Meno', '70b', [1]), at('Crito', '70a', [0, 1])];
// The same, with English: Meno 70a in Lamb, 70b in Jowett, Crito 70a in
// Fowler. Nine hits; held to Lamb, only Meno 70a is left, four.
const BILINGUAL: SearchResult[] = [
  { ...at('Meno', '70a', [0, 1, 3]), engMatch: true, engHits: [{ translation: 'lamb', positions: [0] }] },
  { ...at('Meno', '70b', [1]), engMatch: true, engHits: [{ translation: 'jowett', positions: [0] }] },
  { ...at('Crito', '70a', [0, 1]), engMatch: true, engHits: [{ translation: 'fowler', positions: [0] }] },
];
const FORMS: HitForms = {
  byResult: new Map([['Meno:1:70a', ['esti', 'ths', 'esti']], ['Meno:1:70b', ['tais']], ['Crito:1:70a', ['esti', 'ths']]]),
  headwords: new Map(), failedWorks: [],
};
const GRAMMAR: HitGrammar = {
  byResult: new Map([
    ['Meno:1:70a', [[PRES_IND], [GEN_SG_FEM, DAT_SG_FEM], [PRES_IND]]],
    ['Meno:1:70b', [[DAT_PL_FEM]]],
    ['Crito:1:70a', [[PRES_IND], [GEN_SG_FEM, DAT_SG_FEM]]],
  ]),
  failedWorks: [],
};

async function answer(results: SearchResult[] = RESULTS) {
  const { search, greekHitForms, greekHitGrammar } = await import('../lib/search');
  vi.mocked(search).mockResolvedValueOnce({ results, failedWorks: [] });
  vi.mocked(greekHitForms).mockResolvedValueOnce(FORMS);
  vi.mocked(greekHitGrammar).mockResolvedValueOnce(GRAMMAR);
}
async function open(url: string, results: SearchResult[] = RESULTS) {
  await answer(results);
  window.history.replaceState(null, '', url);
  const page = render(Search);
  // Settled once the results' controls and the first page's hits are drawn.
  await screen.findByRole('group', { name: 'Per page' });
  await vi.waitFor(() => expect(page.container.querySelectorAll('.group-head').length).toBeGreaterThan(0));
  return page;
}
const status = () => screen.getByRole('status');
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const summary = () => screen.getByRole('group', { name: 'This search' });
const chosen = () => [...(screen.queryByRole('group', { name: 'This search' })?.querySelectorAll('li') ?? [])].map(li => text(li.querySelector('span')));
const remove = (what: string) => within(summary()).getByRole('button', { name: `Remove ${what}` });
// The summary is the Filter sheet's: open it, and shut it to read the rail.
async function openSheet() {
  if (screen.queryByRole('dialog', { name: 'Filter' })) return;
  await fireEvent.click(screen.getByRole('button', { name: /^Filter/ }));
  await screen.findByRole('dialog', { name: 'Filter' });
}
// A new search shuts the sheet; read the summary with the sheet open again.
async function sheetChosen() {
  await openSheet();
  return chosen();
}
async function shutSheet() {
  await fireEvent.click(within(screen.getByRole('dialog', { name: 'Filter' })).getByRole('button', { name: 'Close' }));
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}
// What a control has chosen: its pressed buttons, or, in a display menu, its
// checked radio by its label.
const pressed = (group: string) =>
  [...screen.getByRole('group', { name: group }).querySelectorAll('button[aria-pressed="true"], input[type="radio"]:checked')]
    .map(el => text(el.closest('label') ?? el));
const G = `/search?g=${encodeURIComponent('εἰμί')}`;
// A dictionary-word search: the one Group by grammar is offered for (John,
// 13 Nov), and so the one whose grammar facets show unasked.
const L = '/search?l=eimi';

describe('Search.svelte: the side column', () => {
  // The display settings are not in it: they are the menus over the hits
  // (set B, John 2026-11-10; search-display-bar.test.ts).
  it('holds every filter of the results in one landmark, "Refine results"', async () => {
    const { container } = await open(`${L}&v=grammar`);
    await screen.findByRole('group', { name: 'Greek forms found' });
    await screen.findByRole('group', { name: 'Narrow by grammar' });
    const side = screen.getByRole('complementary', { name: 'Refine results' });
    for (const name of ['Show hits from one work', 'Greek forms found', 'Narrow by grammar']) {
      expect(within(side).getByRole('group', { name })).toBeInTheDocument();
    }
    for (const name of ['Group by', 'Sort', 'Context', 'Per page']) {
      expect(within(side).queryByRole('group', { name })).toBeNull();
    }
    // Export is under the count, at the rail's head (r34-02), not among the filters.
    expect(within(side).queryByRole('button', { name: 'Export results as CSV' })).toBeNull();
    expect(container.querySelector('.sx-head')!.contains(screen.getByRole('button', { name: 'Export results as CSV' }))).toBe(true);
    // The hits are not in it.
    expect(side.querySelector('.group-head')).toBeNull();
  });

  it('shows the count once, and the status region still announces it', async () => {
    const { container } = await open(G);
    await vi.waitFor(() => expect(status()).toHaveTextContent('6 hits'));
    // The number and its word are spans of one line (r34-02: the number large).
    const shown = container.querySelectorAll('.result-count');
    expect(shown).toHaveLength(1);
    // The bar counts sections, then Greek hits (John, 15-16 Nov); the " · " between is drawn by CSS.
    expect(text(shown[0])).toBe('2 sections6 hits');
    expect(text(shown[0].querySelector('.rc-n'))).toBe('2');
    expect(text(shown[0].querySelector('.rc-w'))).toBe('sections');
    expect(text(shown[0].querySelector('.rc-hits'))).toBe('6 hits');
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('says "of N · restore all forms" under the count while forms are set aside, and restores them', async () => {
    const { search } = await import('../lib/search');
    // "of N" counts sections (John, 15-16 Nov), so the forms set aside must take
    // a section with them: Crito holds only esti and ths, Meno keeps tais.
    const { container } = await open(`${G}&xf=esti,ths`);
    await vi.waitFor(() => expect(status()).toHaveTextContent('1 section · 1 hit'));
    const of = container.querySelector('.sx-head .sx-of')!;
    expect(text(of)).toBe('of 2 · restore all forms');
    await fireEvent.click(within(of as HTMLElement).getByRole('button', { name: 'restore all forms' }));
    await vi.waitFor(() => expect(status()).toHaveTextContent('2 sections · 6 hits'));
    expect(window.location.search).not.toContain('xf=');
    expect(container.querySelector('.sx-of')).toBeNull();
    expect(search).toHaveBeenCalledTimes(1);
  });

  // One list where English was searched (John, 16 Nov): each work, and under
  // it each translation with hits there; no separate Translations list.
  it('lists every translation with hits under its work, in one box', async () => {
    await open(`${G}&e=one&op=or`, BILINGUAL);
    const list = screen.getByRole('group', { name: 'Show hits from one work or one translation' });
    expect(screen.queryByRole('group', { name: 'Show English hits from one translation' })).toBeNull();
    const box = list.querySelector(':scope > .sx-list')!;
    expect([...box.querySelectorAll('button.i')].map(b => `${b.classList.contains('sub') ? '  ' : ''}${text(b)}`))
      .toEqual(['Crito1 sect.', '  Fowler1', 'Meno1 sect.', '  Jowett1', '  Lamb1']);
    await fireEvent.click(within(list).getByRole('button', { name: /^Lamb/ }));
    await vi.waitFor(() => expect(window.location.search).toContain('t=lamb'));
    expect(window.location.search).toContain('wf=Meno');
    expect(within(list).getByRole('button', { pressed: true }).querySelector('.i-x')).toHaveTextContent('×');
  });
});

describe('Search.svelte: "This search"', () => {
  it('is not in the rail, and is not on the sheet for a plain search', async () => {
    await open(G);
    expect(screen.queryByRole('group', { name: 'This search' })).toBeNull();
    await openSheet();
    expect(screen.queryByRole('group', { name: 'This search' })).toBeNull();
  });

  // Ruling (finding 2 of Codex's review R7): the list is the filters, as the
  // Filter badge counts them; display settings are View's.
  it('lists exactly what narrows the results, in the order of the controls', async () => {
    await open(`${G}&e=one&t=lamb&wf=Meno&xf=tais&gf=case.gen&v=form&so=form&ctx=1&ps=20&sp=only&sn=Meno`, BILINGUAL);
    await vi.waitFor(() => expect(status()).toHaveTextContent(/\d+ hits?/));
    // Round 34: the rail undoes each where it is set, with no summary.
    expect(screen.queryByRole('group', { name: 'This search' })).toBeNull();
    await openSheet();
    await vi.waitFor(() => expect(chosen()).toEqual([
      'Meno', 'Lamb', '1 form set aside', 'Case gen', 'Meno only',
    ]));
    for (const what of chosen()) expect(remove(what)).toHaveTextContent('×');
    expect(within(summary()).getByRole('button', { name: 'Clear all' })).toBeInTheDocument();
  });

  it('names the other choices as their controls do', async () => {
    await open(`${G}&wf=Meno&ps=c&ctx=s&sp=except&sn=Meno,Socrates`);
    await openSheet();
    // The display settings (Whole section, the 100 page) are View's, not listed.
    await vi.waitFor(() => expect(chosen()).toEqual(['Meno', 'Anyone but Meno and Socrates']));
  });

  it('offers no "Clear all" for one thing', async () => {
    await open(`${G}&wf=Meno`);
    await openSheet();
    expect(chosen()).toEqual(['Meno']);
    expect(within(summary()).queryByRole('button', { name: 'Clear all' })).toBeNull();
  });

  // Each removal: the hits, the address and the control all go back, and
  // nothing is searched again.
  const cases: { what: string; url: string; results?: SearchResult[]; before: string; after: string; param: string; control: () => void }[] = [
    {
      what: 'Meno', url: `${G}&wf=Meno`, before: '4 hits', after: '6 hits', param: 'wf=',
      control: () => expect(pressed('Show hits from one work')).toEqual([]),
    },
    {
      what: 'Lamb', url: `${G}&e=one&t=lamb`, results: BILINGUAL, before: '4 hits', after: '6 hits', param: 't=',
      control: () => expect(pressed('Show hits from one work or one translation')).toEqual([]),
    },
    {
      what: '1 form set aside', url: `${G}&xf=ths`, before: '4 hits', after: '6 hits', param: 'xf=',
      control: () => {
        const boxes = within(screen.getByRole('group', { name: 'Greek forms found' })).getAllByRole('checkbox') as HTMLInputElement[];
        expect(boxes.map(b => b.checked)).toEqual([true, true, true]);
      },
    },
    {
      what: 'Case gen', url: `${L}&v=grammar&gf=case.gen`, before: '2 hits', after: '6 hits', param: 'gf=',
      control: () => {
        expect((within(screen.getByRole('group', { name: 'Narrow by grammar' })).getByRole('checkbox', { name: 'Case gen' }) as HTMLInputElement).checked).toBe(false);
        // The view, also chosen, stays.
        expect(pressed('Group by')).toEqual(['By grammar']);
      },
    },
  ];
  for (const c of cases) {
    it(`undoes "${c.what}" alone, without a new search`, async () => {
      const { search } = await import('../lib/search');
      await open(c.url, c.results);
      await vi.waitFor(() => expect(status()).toHaveTextContent(new RegExp(c.before.replace('instances', '(?:instances|hits)'))));
      expect(window.location.search).toContain(c.param);
      await openSheet();
      const others = chosen().filter(w => w !== c.what);
      await fireEvent.click(remove(c.what));
      await vi.waitFor(() => expect(status()).toHaveTextContent(new RegExp(c.after.replace('instances', '(?:instances|hits)'))));
      expect(window.location.search).not.toContain(c.param);
      expect(chosen()).toEqual(others);
      // The control, in the rail again once the sheet is shut.
      await shutSheet();
      c.control();
      expect(search).toHaveBeenCalledTimes(1);
    });
  }

  it('runs the search once more without the speaker filter, and keeps the rest', async () => {
    const { search } = await import('../lib/search');
    await open(`${G}&wf=Meno&sp=only&sn=Meno`);
    await openSheet();
    await vi.waitFor(() => expect(chosen()).toEqual(['Meno', 'Meno only']));
    expect(vi.mocked(search).mock.calls[0][8]).toEqual({ mode: 'only', names: ['Meno'] });
    await answer();
    await fireEvent.click(remove('Meno only'));
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    expect(vi.mocked(search).mock.calls[1][8]).toBeUndefined();
    await vi.waitFor(async () => expect(await sheetChosen()).toEqual(['Meno']));
    await vi.waitFor(() => expect(status()).toHaveTextContent('4 hits'));
    expect(window.location.search).not.toContain('sp=');
    expect(window.location.search).toContain('wf=Meno');
    // The Spoken-by panel, opened by the address, is back to Anyone.
    expect(within(screen.getByRole('group', { name: 'Spoken by' })).getByRole('radio', { name: 'Anyone' })).toBeChecked();
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('runs the search as it was submitted, not as the box now reads', async () => {
    const { search } = await import('../lib/search');
    await open(`${G}&sp=only&sn=Meno`);
    await openSheet();
    await vi.waitFor(() => expect(chosen()).toEqual(['Meno only']));
    // The reader has typed a new word and not searched for it.
    await fireEvent.input(screen.getByLabelText('Greek'), { target: { value: 'λόγος' } });
    await answer();
    await fireEvent.click(remove('Meno only'));
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    expect(vi.mocked(search).mock.calls[1][0]).toBe('εἰμί');
    expect(vi.mocked(search).mock.calls[1][8]).toBeUndefined();
    expect(screen.getByLabelText('Greek')).toHaveValue('εἰμί');
  });

  it('clears every filter at once, without a new search, and leaves the display as it is', async () => {
    const { search } = await import('../lib/search');
    await open(`${L}&wf=Meno&xf=tais&v=grammar&gf=case.gen&so=form&ctx=1&ps=20`);
    await vi.waitFor(() => expect(status()).toHaveTextContent('1 hit'));
    await openSheet();
    await fireEvent.click(within(summary()).getByRole('button', { name: 'Clear all' }));
    await vi.waitFor(() => expect(status()).toHaveTextContent('6 hits'));
    expect(chosen()).toEqual([]);
    expect(window.location.search).not.toMatch(/[?&](wf|xf|gf)=/);
    expect(window.location.search).toMatch(/[?&]v=grammar(&|$)/);
    expect(window.location.search).toMatch(/[?&]so=form(&|$)/);
    expect(window.location.search).toMatch(/[?&]ctx=1(&|$)/);
    expect(window.location.search).toMatch(/[?&]ps=20(&|$)/);
    expect(pressed('Group by')).toEqual(['By grammar']);
    expect(pressed('Per page')).toEqual(['20']);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('clears everything with one new search when the speaker filter is among them', async () => {
    const { search } = await import('../lib/search');
    await open(`${G}&wf=Meno&v=form&sp=only&sn=Meno`);
    await openSheet();
    await vi.waitFor(() => expect(chosen()).toEqual(['Meno', 'Meno only']));
    await answer();
    await fireEvent.click(within(summary()).getByRole('button', { name: 'Clear all' }));
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(status()).toHaveTextContent('6 hits'));
    expect(await sheetChosen()).toEqual([]);
    expect(vi.mocked(search).mock.calls[1][8]).toBeUndefined();
    // View's setting stays in the address; the filters and the speaker go.
    expect(window.location.search).toBe(`?g=${encodeURIComponent('εἰμί')}&v=form`);
    expect(search).toHaveBeenCalledTimes(2);
  });
});

// Below 961px the column is a sheet, opened by Filter on the count row (P4,
// John 2026-11-10; S5b, p03): a menu of the filters with "This search" at its
// head, each filter on a full screen of its own. View opens a second sheet
// of the display settings (p04).
describe('Search.svelte: the Filter sheet', () => {
  const filter = () => screen.getByRole('button', { name: /^Filter/ });
  const viewBtn = () => screen.getByRole('button', { name: /^View/ });

  // S5b (§5.7): Filter counts what narrows the hits; how they are shown is
  // View's, marked by a red dot and named in its label.
  it('says how many filters are chosen, on a badge and in its name; View marks a changed display', async () => {
    await open(`${G}&wf=Meno&v=form`);
    expect(filter()).toHaveAccessibleName('Filter, 1 chosen');
    expect(text(filter().querySelector('.sx-badge'))).toBe('1');
    expect(viewBtn()).toHaveAccessibleName('View, grouped by form');
    expect(viewBtn().querySelector('.sx-dot')).not.toBeNull();
  });

  // Finding 2 of Codex's review R7: the badge counts what "This search"
  // lists, and Clear all clears those and nothing of View's.
  it('counts on its badge exactly what "This search" lists, and Clear all leaves the view', async () => {
    await open(`${G}&wf=Meno&v=form&xf=tais`);
    expect(filter()).toHaveAccessibleName('Filter, 2 chosen');
    expect(text(filter().querySelector('.sx-badge'))).toBe('2');
    await fireEvent.click(filter());
    const sum = await screen.findByRole('group', { name: 'This search' });
    const listed = [...sum.querySelectorAll('li > span')].map(text);
    expect(listed).toEqual(['Meno', '1 form set aside']);
    await fireEvent.click(within(sum).getByRole('button', { name: 'Clear all' }));
    await vi.waitFor(() => expect(window.location.search).not.toContain('wf='));
    expect(window.location.search).toMatch(/[?&]v=form(&|$)/);
    expect(filter()).toHaveAccessibleName('Filter');
    expect(viewBtn()).toHaveAccessibleName('View, grouped by form');
  });

  it('with one filter and a changed view: badge 1, one line, the view kept', async () => {
    await open(`${G}&wf=Meno&v=form`);
    expect(text(filter().querySelector('.sx-badge'))).toBe('1');
    await fireEvent.click(filter());
    const sum = await screen.findByRole('group', { name: 'This search' });
    expect([...sum.querySelectorAll('li > span')].map(text)).toEqual(['Meno']);
    await fireEvent.click(within(sum).getByRole('button', { name: 'Remove Meno' }));
    await vi.waitFor(() => expect(window.location.search).not.toContain('wf='));
    expect(window.location.search).toMatch(/[?&]v=form(&|$)/);
  });

  it('has no badge and no dot when nothing is chosen, and each icon carries its label', async () => {
    await open(G);
    expect(filter()).toHaveAccessibleName('Filter');
    expect(filter().querySelector('.sx-badge')).toBeNull();
    expect(viewBtn()).toHaveAccessibleName('View');
    expect(viewBtn().querySelector('.sx-dot')).toBeNull();
    expect(text(filter())).toBe('Filter');
    expect(text(viewBtn())).toBe('View');
  });

  it('opens as a modal dialog with focus inside, and Escape shuts it and hands focus back', async () => {
    await open(G);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(filter()).toHaveAttribute('aria-expanded', 'false');
    await fireEvent.click(filter());
    const sheet = await screen.findByRole('dialog', { name: 'Filter' });
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(filter()).toHaveAttribute('aria-expanded', 'true');
    await vi.waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
    await fireEvent.keyDown(document.activeElement ?? sheet, { key: 'Escape' });
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(filter());
    // Shut, the controls are the side column again.
    expect(screen.getByRole('complementary', { name: 'Refine results' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Show hits from one work' })).toBeInTheDocument();
  });

  it('shuts on Close and on the backdrop', async () => {
    const { container } = await open(G);
    await fireEvent.click(filter());
    const sheet = await screen.findByRole('dialog', { name: 'Filter' });
    await fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(filter());
    await fireEvent.click(filter());
    await screen.findByRole('dialog', { name: 'Filter' });
    await fireEvent.click(container.querySelector('.sx-scrim')!);
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(filter());
  });

  // John, 15-16 Nov: the foot counts sections; the bar adds the Greek hits.
  it('uses sections in the Filter foot for Both, with hits named in the results bar', async () => {
    await open(`${G}&e=one`, BILINGUAL);
    await fireEvent.click(filter());
    const sheet = await screen.findByRole('dialog', { name: 'Filter' });
    expect(within(sheet).getByRole('button', { name: 'Show 2 sections' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Show 6 hits' })).toBeNull();
    expect(status()).toHaveTextContent('2 sections · 6 hits');
  });

  it('lists the filters as a menu, each with what is set, and no filter itself', async () => {
    await open(`${L}&v=grammar`);
    await fireEvent.click(filter());
    const sheet = await screen.findByRole('dialog', { name: 'Filter' });
    const rows = within(sheet).getAllByRole('button', { name: /›$/ }).map(text);
    expect(rows).toEqual(['Works All 2 ›', 'Forms All 3 ›', 'Grammar Any ›']);
    for (const name of ['Show hits from one work', 'Greek forms found', 'Narrow by grammar']) {
      expect(within(sheet).queryByRole('group', { name })).toBeNull();
    }
    // The foot counts sections (John, 15-16 Nov): Meno's book and Crito's.
    expect(within(sheet).getByRole('button', { name: 'Show 2 sections' })).toBeInTheDocument();
  });

  it('puts "This search" at the head of the menu when something is chosen, and only then', async () => {
    await open(`${G}&wf=Meno`);
    await fireEvent.click(filter());
    let sheet = await screen.findByRole('dialog', { name: 'Filter' });
    const sum = within(sheet).getByRole('group', { name: 'This search' });
    expect(sheet.querySelector('.sx-menu')!.compareDocumentPosition(sum) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(chosen()).toEqual(['Meno']);
    expect(text(within(sheet).getByRole('button', { name: /^Works/ }))).toBe('Works Meno ›');
    await fireEvent.click(remove('Meno'));
    await vi.waitFor(() => expect(status()).toHaveTextContent('6 hits'));
    sheet = screen.getByRole('dialog', { name: 'Filter' });
    expect(within(sheet).queryByRole('group', { name: 'This search' })).toBeNull();
  });

  it('opens a filter on a screen of its own, and Back returns to the menu', async () => {
    const { search } = await import('../lib/search');
    await open(G);
    await fireEvent.click(filter());
    let sheet = await screen.findByRole('dialog', { name: 'Filter' });
    await fireEvent.click(within(sheet).getByRole('button', { name: /^Works/ }));
    sheet = await screen.findByRole('dialog', { name: 'Works' });
    await vi.waitFor(() => expect(document.activeElement).toBe(within(sheet).getByRole('button', { name: '‹ Filter' })));
    expect(within(sheet).queryByRole('button', { name: /^Forms/ })).toBeNull();
    // A choice applies at once, and the screen stays.
    await fireEvent.click(within(within(sheet).getByRole('group', { name: 'Show hits from one work' })).getByRole('button', { name: /^Meno/ }));
    await vi.waitFor(() => expect(status()).toHaveTextContent('4 hits'));
    expect(screen.getByRole('dialog', { name: 'Works' })).toBeInTheDocument();
    expect(window.location.search).toContain('wf=Meno');
    expect(search).toHaveBeenCalledTimes(1);
    await fireEvent.click(within(sheet).getByRole('button', { name: '‹ Filter' }));
    sheet = await screen.findByRole('dialog', { name: 'Filter' });
    await vi.waitFor(() => expect(document.activeElement).toBe(within(sheet).getByRole('button', { name: /^Works/ })));
    expect(text(document.activeElement)).toBe('Works Meno ›');
  });

  // S5b (q08): the foot's button applies the ticks and shows the hits they
  // leave, counted before it is pressed.
  it('keeps Deselect all and "Show N sections" at the foot of the forms screen', async () => {
    await open(G);
    await fireEvent.click(filter());
    await fireEvent.click(within(await screen.findByRole('dialog', { name: 'Filter' })).getByRole('button', { name: /^Forms/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Forms' });
    const foot = sheet.querySelector('.sx-foot')!;
    expect(foot).toHaveClass('sheet-foot');
    expect([...foot.querySelectorAll('button')].map(text)).toEqual(['Deselect all', 'Show 2 sections']);
    expect(within(sheet).getAllByRole('checkbox')).toHaveLength(3);
  });

  // S5b (q08): what the ticks would leave, counted on the button; pressed,
  // they are applied and the hits shown.
  it('counts the hits the ticks leave on its button, and applies them as it shuts', async () => {
    await open(G);
    await fireEvent.click(filter());
    await fireEvent.click(within(await screen.findByRole('dialog', { name: 'Filter' })).getByRole('button', { name: /^Forms/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Forms' });
    const boxes = within(sheet).getAllByRole('checkbox');
    await fireEvent.click(boxes.find(b => /ται/.test(b.closest('label')!.textContent!))!);
    const show = within(sheet).getByRole('button', { name: /^Show \d+ sections?$/ });
    // The button counts sections (John, 15-16 Nov): ταῖς is Meno's, whose other
    // hits stay in the same section, so nothing leaves yet.
    expect(text(show)).toBe('Show 2 sections');
    // Tick ταῖς again and set aside the others: Crito holds only ἐστί and τῆς, so
    // its section goes, and Meno's stays on ταῖς.
    await fireEvent.click(boxes.find(b => /ται/.test(b.closest('label')!.textContent!))!);
    for (const b of boxes.filter(b => !/ται/.test(b.closest('label')!.textContent!))) await fireEvent.click(b);
    expect(text(show)).toBe('Show 1 section');
    expect(status()).toHaveTextContent('2 sections · 6 hits');
    await fireEvent.click(show);
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await vi.waitFor(() => expect(status()).toHaveTextContent('1 section · 1 hit'));
    expect(window.location.search).toContain('xf=');
    expect(document.activeElement).toBe(filter());
  });

  // S5b (q07): one work of many, or all, a ring each.
  it('offers All works first on the works screen, and it lifts a chosen work', async () => {
    await open(`${G}&wf=Meno`);
    await fireEvent.click(filter());
    await fireEvent.click(within(await screen.findByRole('dialog', { name: 'Filter' })).getByRole('button', { name: /^Works/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Works' });
    const rows = within(within(sheet).getByRole('group', { name: 'Show hits from one work' })).getAllByRole('button');
    expect(text(rows[0])).toBe('All works');
    expect(rows[0]).toHaveAttribute('aria-pressed', 'false');
    expect(rows.filter(r => r.getAttribute('aria-pressed') === 'true').map(r => text(r.querySelector('.i-t')))).toEqual(['Meno']);
    await fireEvent.click(rows[0]);
    await vi.waitFor(() => expect(status()).toHaveTextContent('6 hits'));
    expect(window.location.search).not.toContain('wf=');
    expect(within(sheet).getByRole('button', { name: 'All works' })).toHaveAttribute('aria-pressed', 'true');
    // Pressed again, All works changes nothing.
    await fireEvent.click(within(sheet).getByRole('button', { name: 'All works' }));
    expect(window.location.search).not.toContain('wf=');
  });

  it('clears the grammar from its screen', async () => {
    await open(`${L}&v=grammar`);
    await fireEvent.click(filter());
    await fireEvent.click(within(await screen.findByRole('dialog', { name: 'Filter' })).getByRole('button', { name: /^Grammar/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Grammar' });
    const clear = within(sheet).getByRole('button', { name: 'Clear' });
    expect(clear).toBeDisabled();
    await fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Case gen' }));
    await vi.waitFor(() => expect(status()).toHaveTextContent('2 hits'));
    expect(clear).not.toBeDisabled();
    await fireEvent.click(clear);
    await vi.waitFor(() => expect(status()).toHaveTextContent('6 hits'));
    expect(window.location.search).not.toContain('gf=');
  });

  it('shuts from "Show N sections" and hands focus back', async () => {
    await open(G);
    await fireEvent.click(filter());
    const sheet = await screen.findByRole('dialog', { name: 'Filter' });
    await fireEvent.click(within(sheet).getByRole('button', { name: 'Show 2 sections' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(filter());
  });
});

// S5b (p04): the View sheet, as §5.7 draws it.
describe('Search.svelte: the View sheet', () => {
  const sortBtn = () => screen.getByRole('button', { name: /^View/ });

  it('holds Group by, Sort, Context and Per page, no glosses, then Export and Done', async () => {
    await open(G);
    await fireEvent.click(sortBtn());
    const sheet = await screen.findByRole('dialog', { name: 'View' });
    expect(text(sheet.querySelector('.sx-sheet-t'))).toBe('View');
    const legends = [...sheet.querySelectorAll('fieldset legend')].map(text);
    expect(legends).toEqual(['Group by', 'Sort', 'Context', 'Per page']);
    for (const fs of sheet.querySelectorAll('fieldset')) {
      for (const r of fs.querySelectorAll('input[type="radio"]')) expect(r.closest('label')).toHaveClass('ck');
    }
    // One word as spelled: By grammar is a dictionary word's (John, 13 Nov).
    expect([...sheet.querySelectorAll('fieldset')].map(fs => [...fs.querySelectorAll('label')].map(text))).toEqual([
      ['By work', 'By form'],
      ['Stephanus order', 'Works A–Z', 'Forms A–Z', 'Commonest form'],
      ['1 line', '3 lines', 'Whole section'],
      ['20', '40', '100'],
    ]);
    const on = [...sheet.querySelectorAll<HTMLInputElement>('input:checked')].map(i => text(i.closest('label')));
    expect(on).toEqual(['By work', 'Stephanus order', '3 lines', '40']);
    expect(sheet.querySelector('.opt-gloss')).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Export results as CSV' })).toBeInTheDocument();
    expect(sheet.querySelector('.sheet-foot .sheet-done')).toHaveTextContent('Done');
    expect(within(sheet).queryByRole('group', { name: 'Show hits from one work' })).toBeNull();
  });

  it('shuts on Done, focus back on View', async () => {
    await open(G);
    await fireEvent.click(sortBtn());
    const sheet = await screen.findByRole('dialog', { name: 'View' });
    await fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(sortBtn());
  });

  it('applies a choice at once, stays open, and hands focus back when shut', async () => {
    const { search } = await import('../lib/search');
    await open(G);
    await fireEvent.click(sortBtn());
    const sheet = await screen.findByRole('dialog', { name: 'View' });
    await fireEvent.click(within(sheet).getByRole('radio', { name: 'By form' }));
    await vi.waitFor(() => expect(window.location.search).toContain('v=form'));
    expect(screen.getByRole('dialog', { name: 'View' })).toBeInTheDocument();
    expect(search).toHaveBeenCalledTimes(1);
    await fireEvent.keyDown(document.activeElement ?? sheet, { key: 'Escape' });
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(sortBtn());
  });

  // S5b: Done is the last stop now and Close the first, so the wrap runs
  // between them; no radio group sits at either end of the sheet any more.
  it('keeps Tab inside: Done to Close, and back', async () => {
    await open(G);
    await fireEvent.click(sortBtn());
    const sheet = await screen.findByRole('dialog', { name: 'View' });
    const done = within(sheet).getByRole('button', { name: 'Done' });
    done.focus();
    await fireEvent.keyDown(done, { key: 'Tab' });
    expect(document.activeElement).toBe(within(sheet).getByRole('radio', { name: 'By work' }));
    await fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(done);
  });

  it('hands focus to the menus over the hits when the window widens past the sheet', async () => {
    const wide: ((e: { matches: boolean }) => void)[] = [];
    const spy = vi.spyOn(window, 'matchMedia').mockImplementation((media: string) => ({
      matches: false, media, onchange: null, addListener() {}, removeListener() {}, dispatchEvent: () => false,
      addEventListener: (_: string, f: (e: { matches: boolean }) => void) => { wide.push(f); },
      removeEventListener() {},
    }) as unknown as MediaQueryList);
    try {
      const { container } = await open(G);
      await fireEvent.click(sortBtn());
      const sheet = await screen.findByRole('dialog', { name: 'View' });
      within(sheet).getByRole('radio', { name: 'By form' }).focus();
      for (const f of wide) f({ matches: true });
      await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await vi.waitFor(() => expect(document.activeElement).toBe(container.querySelector('.sx-display summary')));
    } finally {
      spy.mockRestore();
    }
  });

  it('offers every menu on the 100 page', async () => {
    await open(`${G}&ps=100`);
    await fireEvent.click(sortBtn());
    const sheet = await screen.findByRole('dialog', { name: 'View' });
    expect([...sheet.querySelectorAll('fieldset legend')].map(text)).toEqual(['Group by', 'Sort', 'Context', 'Per page']);
  });
});

// The test environment lays nothing out, so these read the rules.
describe('the side column\'s rules', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const SEARCH = readFileSync(resolve(here, '../components/Search.svelte'), 'utf-8');
  const style = SEARCH.slice(SEARCH.lastIndexOf('<style')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
  // The body of the first @media block whose query matches.
  function block(css: string, query: RegExp): string {
    const m = query.exec(css);
    if (!m) throw new Error(`no ${query}`);
    let depth = 0;
    for (let i = css.indexOf('{', m.index); i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) return css.slice(css.indexOf('{', m.index) + 1, i);
    }
    throw new Error('unclosed block');
  }
  const rules = (css: string) => [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }));

  // Since S4b the rail's rules are in b-search.css. The rail scrolls with the
  // page, as round 34 draws it, and runs the results' height; the word card
  // in it is what stays in view, with its own scroll.
  it('holds the word card in view on a desktop, with its own scroll', () => {
    const B = readFileSync(resolve(here, '../styles/b-search.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    const desk = [...B.matchAll(/@media \(min-width: 961px\) \{/g)].map(m => block(B.slice(m.index), /@media/)).join(' ');
    const card = rules(desk).find(r => r.sel === '.search-page .word-rail');
    expect(card?.body).toMatch(/position:\s*sticky/);
    expect(card?.body).toMatch(/overflow-y:\s*auto/);
    expect(card?.body).toMatch(/max-height:\s*calc\(100vh/);
    const side = rules(desk).find(r => r.sel === '.search-page .sx-side');
    expect(side?.body).not.toMatch(/position:\s*sticky|align-self|max-height/);
    expect(rules(desk).find(r => r.sel === '.search-page .sx-layout')?.body).not.toMatch(/align-items/);
    expect(style).not.toMatch(/\.sx-side/);
  });

  it('does not print', () => {
    const CSS = readFileSync(resolve(here, '../styles/global.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    const hidden = rules(block(CSS, /@media print/))
      .filter(r => /display:\s*none/.test(r.body)).flatMap(r => r.sel.split(',').map(s => s.trim()));
    for (const sel of ['.search-page .sx-panel', '.search-page .sx-icon', '.search-page .sx-scrim']) expect(hidden).toContain(sel);
  });
});

describe('Search.svelte: the Filter sheet and the page behind it', () => {
  const refine = () => screen.getByRole('button', { name: /^Filter/ });

  it('holds the page still while it is open', async () => {
    await open(G);
    await fireEvent.click(refine());
    await screen.findByRole('dialog', { name: 'Filter' });
    expect(document.documentElement.style.overflow).toBe('hidden');
    await fireEvent.keyDown(window, { key: 'Escape' });
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('is shut when the results it refined are gone, and stays shut for the next search', async () => {
    const { search } = await import('../lib/search');
    const { container } = await open(G);
    await fireEvent.click(refine());
    await screen.findByRole('dialog', { name: 'Filter' });
    // Back, to no search at all.
    window.history.pushState(null, '', '/search');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(container.querySelector('li.instance')).toBeNull());
    await vi.waitFor(() => expect(document.documentElement.style.overflow).toBe(''));
    vi.mocked(search).mockResolvedValueOnce({ results: RESULTS, failedWorks: [] });
    await fireEvent.input(screen.getByLabelText('Greek'), { target: { value: 'εἰμί' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await vi.waitFor(() => expect(status()).toHaveTextContent('6 hits'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Search.svelte: removing the speaker from widened results', () => {
  it('widens again without the speaker, and does not fall back to the search before the widening', async () => {
    const { search, searchPhraseVariants } = await import('../lib/search');
    const speaker = { mode: 'only' as const, names: ['Meno'] };
    await open(`/search?g=${encodeURIComponent('τῆς ἐστι')}&gm=phrase&sp=only&sn=Meno`);
    const widened = { results: RESULTS.slice(0, 1), failedWorks: [], readings: [['x']], productive: [['x']] };
    vi.mocked(searchPhraseVariants).mockResolvedValueOnce(widened as never);
    await fireEvent.click(screen.getByRole('button', { name: 'Find this phrase in any inflection' }));
    await vi.waitFor(() => expect(searchPhraseVariants).toHaveBeenCalledTimes(1));
    expect(vi.mocked(searchPhraseVariants).mock.calls[0][2]).toEqual(speaker);
    await vi.waitFor(() => expect(status()).toHaveTextContent('3 hits'));
    await vi.waitFor(async () => expect(await sheetChosen()).toEqual(['Meno only']));
    // The same widening, for everyone.
    vi.mocked(searchPhraseVariants).mockResolvedValueOnce({ ...widened, results: RESULTS } as never);
    await fireEvent.click(remove('Meno only'));
    await vi.waitFor(() => expect(searchPhraseVariants).toHaveBeenCalledTimes(2));
    expect(vi.mocked(searchPhraseVariants).mock.calls[1][2]).toBeUndefined();
    await vi.waitFor(() => expect(status()).toHaveTextContent('6 hits'));
    expect(search).toHaveBeenCalledTimes(1);
    expect(await sheetChosen()).toEqual([]);
    expect(window.location.search).not.toContain('sp=');
  });
});

describe('Search.svelte: the sidebar and widened results', () => {
  const PHRASE = `/search?g=${encodeURIComponent('τῆς ἐστι')}&gm=phrase`;
  const widened = { results: RESULTS, failedWorks: [], readings: [['x']], productive: [['x']] };
  const widen = async () => {
    await fireEvent.click(screen.getByRole('button', { name: 'Find this phrase in any inflection' }));
  };

  it('lets the page go when the request behind an open sheet fails', async () => {
    const { searchPhraseVariants } = await import('../lib/search');
    await open(PHRASE);
    await fireEvent.click(screen.getByRole('button', { name: /^Filter/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Filter' });
    expect(document.documentElement.style.overflow).toBe('hidden');
    vi.mocked(searchPhraseVariants).mockRejectedValueOnce(new Error('the index did not load'));
    await fireEvent.click(within(sheet).getByRole('button', { name: 'Find this phrase in any inflection' }));
    // The error takes the results, and the sheet with them, off the page.
    await screen.findByText('the index did not load');
    await vi.waitFor(() => expect(document.documentElement.style.overflow).toBe(''));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('goes back to the menu, focus with it, when the screen open loses its filter', async () => {
    const { searchPhraseVariants } = await import('../lib/search');
    await open(PHRASE);
    await fireEvent.click(screen.getByRole('button', { name: /^Filter/ }));
    let sheet = await screen.findByRole('dialog', { name: 'Filter' });
    let done!: (v: unknown) => void;
    vi.mocked(searchPhraseVariants).mockReturnValueOnce(new Promise(r => { done = r; }) as never);
    await fireEvent.click(within(sheet).getByRole('button', { name: 'Find this phrase in any inflection' }));
    await fireEvent.click(within(sheet).getByRole('button', { name: /^Forms/ }));
    sheet = await screen.findByRole('dialog', { name: 'Forms' });
    await vi.waitFor(() => expect(document.activeElement).toBe(within(sheet).getByRole('button', { name: '‹ Filter' })));
    // Widened results have no form list: the Forms screen has nothing to show.
    done(widened);
    sheet = await screen.findByRole('dialog', { name: 'Filter' });
    await vi.waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
  });

  // "This search" lists filters only (finding 2 of Codex's review R7): the
  // widening drops the old ones but the speaker, which is part of the search
  // (Plato), and View's settings stay in the address.
  it('widened, lists none of the old filters but the speaker, and keeps View\'s settings', async () => {
    const { searchPhraseVariants } = await import('../lib/search');
    await open(`${PHRASE}&sp=only&sn=Meno&wf=Meno&v=form&ctx=1`);
    vi.mocked(searchPhraseVariants).mockResolvedValueOnce(widened as never);
    await widen();
    await vi.waitFor(() => expect(searchPhraseVariants).toHaveBeenCalledTimes(1));
    await vi.waitFor(async () => expect(await sheetChosen()).toEqual(['Meno only']));
    const q = new URLSearchParams(window.location.search);
    expect([q.get('v'), q.get('ctx'), q.get('sp')]).toEqual(['form', '1', 'only']);
  });

  it('keeps the reader\'s other filters when only the speaker is removed', async () => {
    const { searchPhraseVariants } = await import('../lib/search');
    await open(`${PHRASE}&sp=only&sn=Meno`);
    vi.mocked(searchPhraseVariants).mockResolvedValueOnce(widened as never);
    await widen();
    await vi.waitFor(() => expect(searchPhraseVariants).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(status()).toHaveTextContent('6 hits'));
    // Narrowed to Meno, in the widened results.
    await fireEvent.click(within(screen.getByRole('group', { name: 'Show hits from one work' })).getByRole('button', { name: /^Meno/ }));
    await vi.waitFor(() => expect(status()).toHaveTextContent('4 hits'));
    await vi.waitFor(async () => expect(await sheetChosen()).toEqual(['Meno', 'Meno only']));
    vi.mocked(searchPhraseVariants).mockResolvedValueOnce(widened as never);
    await fireEvent.click(remove('Meno only'));
    await vi.waitFor(() => expect(searchPhraseVariants).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => expect(await sheetChosen()).toEqual(['Meno']));
    expect(status()).toHaveTextContent('4 hits');
    expect(window.location.search).toContain('wf=Meno');
    expect(window.location.search).not.toContain('sp=');
  });

  it('does not put the filters it was keeping on a search made since', async () => {
    const { searchPhraseVariants } = await import('../lib/search');
    await open(`${PHRASE}&sp=only&sn=Meno`);
    vi.mocked(searchPhraseVariants).mockResolvedValueOnce(widened as never);
    await widen();
    await vi.waitFor(() => expect(status()).toHaveTextContent('6 hits'));
    await fireEvent.click(within(screen.getByRole('group', { name: 'Show hits from one work' })).getByRole('button', { name: /^Meno/ }));
    await vi.waitFor(async () => expect(await sheetChosen()).toEqual(['Meno', 'Meno only']));
    // The speaker is removed, and its re-widening is slow.
    let oldIn!: (outcome: unknown) => void;
    vi.mocked(searchPhraseVariants).mockReturnValueOnce(new Promise(resolve => { oldIn = resolve; }) as never);
    await fireEvent.click(remove('Meno only'));
    await vi.waitFor(() => expect(searchPhraseVariants).toHaveBeenCalledTimes(2));
    // Meanwhile the reader searches again and widens that.
    await answer();
    await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await vi.waitFor(() => expect(status()).toHaveTextContent('6 hits'));
    vi.mocked(searchPhraseVariants).mockResolvedValueOnce(widened as never);
    await widen();
    await vi.waitFor(() => expect(searchPhraseVariants).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(status()).toHaveTextContent('6 hits'));
    oldIn(widened);
    await new Promise(r => setTimeout(r, 30));
    expect(await sheetChosen()).toEqual([]);
    expect(window.location.search).not.toContain('wf=');
  });

  it('"Clear all" leaves none of the old filters in the address bar', async () => {
    const { searchPhraseVariants } = await import('../lib/search');
    await open(`${PHRASE}&sp=only&sn=Meno&v=form`);
    vi.mocked(searchPhraseVariants).mockResolvedValueOnce(widened as never);
    await widen();
    await vi.waitFor(() => expect(searchPhraseVariants).toHaveBeenCalledTimes(1));
    // The widening leaves the speaker; the reader narrows to one work again.
    await fireEvent.click(within(screen.getByRole('group', { name: 'Show hits from one work' })).getByRole('button', { name: /^Meno/ }));
    await vi.waitFor(async () => expect(await sheetChosen()).toEqual(['Meno', 'Meno only']));
    vi.mocked(searchPhraseVariants).mockResolvedValueOnce(widened as never);
    await fireEvent.click(within(summary()).getByRole('button', { name: 'Clear all' }));
    await vi.waitFor(() => expect(searchPhraseVariants).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () => expect(await sheetChosen()).toEqual([]));
    // View's setting stays; the filters and the speaker are gone.
    expect(window.location.search).toBe(`?g=${encodeURIComponent('τῆς ἐστι')}&gm=phrase&v=form`);
  });
});

describe('Search.svelte: removing the limit to one speech', () => {
  const CX = '/search?c=f:logos&c=f:logos&cx=0';
  async function oneSpeech(extra = '') {
    const { searchCombo, greekHitForms } = await import('../lib/search');
    vi.mocked(greekHitForms).mockResolvedValue(FORMS);
    vi.mocked(searchCombo).mockResolvedValue({ results: BILINGUAL, failedWorks: [] });
    window.history.replaceState(null, '', CX + extra);
    const page = render(Search);
    // "Within one speech" is undone from the sheet's summary (S4b).
    await vi.waitFor(async () => {
      await openSheet();
      expect(screen.getByRole('button', { name: 'Remove Within one speech' })).toBeInTheDocument();
    });
    await vi.waitFor(() => expect(page.container.querySelector('li.instance')).not.toBeNull());
    return page;
  }
  it('Clear all lifts the speech limit and the speaker filter together (Codex review)', async () => {
    await oneSpeech('&sp=only&sn=Meno');
    await vi.waitFor(async () => expect(await sheetChosen()).toEqual(expect.arrayContaining(['Within one speech', 'Meno only'])));
    await fireEvent.click(within(summary()).getByRole('button', { name: 'Clear all' }));
    await vi.waitFor(() => {
      const q = new URLSearchParams(location.search);
      expect(q.get('cx')).toBeNull();
      expect(q.get('sp')).toBeNull();
      expect(q.get('sn')).toBeNull();
    });
    await vi.waitFor(async () => expect(await sheetChosen()).toEqual([]));
  });
  it('keeps work, translation and display filters', async () => {
    await oneSpeech('&e=one&wf=Meno&t=lamb&ctx=1&ps=100');
    await fireEvent.click(remove('Within one speech'));
    await vi.waitFor(async () => expect(await sheetChosen()).toEqual(['Meno', 'Lamb']));
    await vi.waitFor(() => expect(new URLSearchParams(location.search).get('t')).toBe('lamb'));
    expect(new URLSearchParams(location.search).get('wf')).toBe('Meno');
    expect(new URLSearchParams(location.search).get('ctx')).toBe('1');
    expect(new URLSearchParams(location.search).get('ps')).toBe('100');
  });
  it('runs the submitted slots after an input edit', async () => {
    await oneSpeech();
    const { searchCombo } = await import('../lib/search');
    const before = structuredClone(vi.mocked(searchCombo).mock.calls[0]);
    await fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    await fireEvent.change(screen.getByRole('combobox', { name: 'Relation of term 2' }), { target: { value: 'before' } });
    await fireEvent.click(remove('Within one speech'));
    await vi.waitFor(() => expect(searchCombo).toHaveBeenCalledTimes(2));
    expect(vi.mocked(searchCombo).mock.calls[1][0]).toEqual(before[0]);
    expect(location.search).not.toContain('never');
  });
  it('does not show a chip for an unsubmitted checkbox edit', async () => {
    await oneSpeech();
    await fireEvent.click(remove('Within one speech'));
    await vi.waitFor(async () => expect(await sheetChosen()).toEqual([]));
    // The editor is shut on a proximity search from the address (S3).
    await fireEvent.click(screen.getByRole('button', {name:'Change'}));
    await fireEvent.click(screen.getByRole('switch', {name:'Keep hits that cross from one speaker to the next'}));
    expect(await sheetChosen()).toEqual([]);
  });
  it('clear all resets the speech switch and address', async () => {
    await oneSpeech('&wf=Meno&ctx=1');
    await fireEvent.click(within(summary()).getByRole('button',{name:'Clear all'}));
    await vi.waitFor(async () => expect(await sheetChosen()).toEqual([]));
    await fireEvent.click(screen.getByRole('button', {name:'Change'}));
    expect(screen.getByRole('switch',{name:'Keep hits that cross from one speaker to the next'})).toHaveAttribute('aria-checked', 'true');
    expect(location.search).not.toContain('cx='); expect(location.search).not.toContain('wf=');
  });
  it('keeps forms set aside', async () => {
    await oneSpeech('&g=logos&xf=esti');
    await fireEvent.click(remove('Within one speech'));
    await vi.waitFor(() => expect(location.search).toContain('xf=esti'));
  });
  it('keeps facets while their readings load', async () => {
    const { greekHitGrammar } = await import('../lib/search');
    vi.mocked(greekHitGrammar).mockResolvedValue(GRAMMAR);
    await oneSpeech('&gf=case.gen');
    await fireEvent.click(remove('Within one speech'));
    await vi.waitFor(() => expect(location.search).toContain('gf=case.gen'));
    await vi.waitFor(async () => expect(await sheetChosen()).toContain('Case gen'));
  });
  it('does not apply kept filters to a newer search', async () => {
    await oneSpeech('&wf=Meno');
    const { searchCombo } = await import('../lib/search');
    let done!: (v: any) => void;
    vi.mocked(searchCombo).mockReturnValueOnce(new Promise(resolve => {done=resolve;}));
    await fireEvent.click(remove('Within one speech'));
    await vi.waitFor(() => expect(searchCombo).toHaveBeenCalledTimes(2));
    // A newer search while that one runs. Proximity holds the Greek box (it
    // shows the terms, read-only), so the search goes through the form.
    await fireEvent.submit(document.querySelector('form.search-form')!);
    await vi.waitFor(() => expect(searchCombo).toHaveBeenCalledTimes(3));
    await vi.waitFor(async () => expect(await sheetChosen()).toEqual([]));
    done({results:BILINGUAL,failedWorks:[]});
    await new Promise(resolve => setTimeout(resolve,30));
    expect(await sheetChosen()).toEqual([]); expect(location.search).not.toContain('wf=');
  });
});
