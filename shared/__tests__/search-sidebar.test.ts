// The results page's side column (John, 2026-11-09: "Controls + summary").
// The controls sit in one place, labelled "Refine results": a column beside
// the hits on a wide screen, a sheet opened by the Refine button on a narrow
// one. At its head, "This search" lists what narrows or changes the results,
// each with a button that undoes it. The controls themselves are tested where
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
  await screen.findByRole('group', { name: 'Hits per page' });
  await vi.waitFor(() => expect(page.container.querySelectorAll('.group-head, .cite').length).toBeGreaterThan(0));
  return page;
}
const status = () => screen.getByRole('status');
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const summary = () => screen.getByRole('group', { name: 'This search' });
const chosen = () => [...summary().querySelectorAll('li')].map(li => text(li.querySelector('span')));
const remove = (what: string) => within(summary()).getByRole('button', { name: `Remove ${what}` });
const pressed = (group: string) =>
  within(screen.getByRole('group', { name: group })).getAllByRole('button')
    .filter(b => b.getAttribute('aria-pressed') === 'true').map(text);
const G = `/search?g=${encodeURIComponent('εἰμί')}`;

describe('Search.svelte: the side column', () => {
  it('holds every control of the results in one landmark, "Refine results"', async () => {
    await open(`${G}&v=grammar`);
    await screen.findByRole('group', { name: 'Greek forms found' });
    await screen.findByRole('group', { name: 'Narrow by grammar' });
    const side = screen.getByRole('complementary', { name: 'Refine results' });
    for (const name of ['Show hits from one work', 'Greek forms found', 'Group the hits', 'Sort', 'Context', 'Hits per page', 'Narrow by grammar']) {
      expect(within(side).getByRole('group', { name })).toBeInTheDocument();
    }
    expect(within(side).getByRole('button', { name: 'Export results as CSV' })).toBeInTheDocument();
    // The hits are not in it.
    expect(side.querySelector('.group-head')).toBeNull();
  });

  it('shows the count once, and the status region still announces it', async () => {
    await open(G);
    await vi.waitFor(() => expect(status()).toHaveTextContent('6 instances'));
    const shown = screen.getAllByText('6 instances').filter(el => el.getAttribute('role') !== 'status');
    expect(shown).toHaveLength(1);
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });
});

describe('Search.svelte: "This search"', () => {
  it('lists nothing for a plain search', async () => {
    await open(G);
    expect(chosen()).toEqual([]);
    expect(within(summary()).queryByRole('button')).toBeNull();
  });

  it('lists exactly what narrows or changes the results, in the order of the controls', async () => {
    await open(`${G}&e=one&t=lamb&wf=Meno&xf=tais&gf=case.gen&v=form&so=form&ctx=1&ps=20&sp=only&sn=Meno`, BILINGUAL);
    await vi.waitFor(() => expect(chosen()).toEqual([
      'Meno', 'Lamb', '1 form set aside', 'Case gen', 'Meno only', 'By form', 'Sorted by form', '1 line', '20 a page',
    ]));
    for (const what of chosen()) expect(remove(what)).toHaveTextContent('×');
    expect(within(summary()).getByRole('button', { name: 'Clear all' })).toBeInTheDocument();
  });

  it('names the other choices as their controls do', async () => {
    await open(`${G}&wf=Meno&ps=c&ctx=s&sp=except&sn=Meno,Socrates`);
    await vi.waitFor(() => expect(chosen()).toEqual(['Meno', 'Anyone but Meno and Socrates', 'Whole section', 'Citations only']));
  });

  it('offers no "Clear all" for one thing', async () => {
    await open(`${G}&wf=Meno`);
    expect(chosen()).toEqual(['Meno']);
    expect(within(summary()).queryByRole('button', { name: 'Clear all' })).toBeNull();
  });

  // Each removal: the hits, the address and the control all go back, and
  // nothing is searched again.
  const cases: { what: string; url: string; results?: SearchResult[]; before: string; after: string; param: string; control: () => void }[] = [
    {
      what: 'Meno', url: `${G}&wf=Meno`, before: '4 instances', after: '6 instances', param: 'wf=',
      control: () => expect(pressed('Show hits from one work')).toEqual([]),
    },
    {
      what: 'Lamb', url: `${G}&e=one&t=lamb`, results: BILINGUAL, before: '4 instances', after: '9 instances', param: 't=',
      control: () => expect(pressed('Show English hits from one translation')).toEqual([]),
    },
    {
      what: '1 form set aside', url: `${G}&xf=ths`, before: '4 instances', after: '6 instances', param: 'xf=',
      control: () => {
        const boxes = within(screen.getByRole('group', { name: 'Greek forms found' })).getAllByRole('checkbox') as HTMLInputElement[];
        expect(boxes.map(b => b.checked)).toEqual([true, true, true]);
      },
    },
    {
      what: 'Case gen', url: `${G}&v=grammar&gf=case.gen`, before: '2 instances', after: '6 instances', param: 'gf=',
      control: () => {
        expect((within(screen.getByRole('group', { name: 'Narrow by grammar' })).getByRole('checkbox', { name: 'Case gen' }) as HTMLInputElement).checked).toBe(false);
        // The view, also chosen, stays.
        expect(pressed('Group the hits')).toEqual(['Grammar']);
      },
    },
    {
      what: 'By form', url: `${G}&v=form`, before: '6 instances', after: '6 instances', param: 'v=',
      control: () => expect(pressed('Group the hits')).toEqual(['By Stephanus page']),
    },
    {
      what: 'Sorted by form', url: `${G}&so=form`, before: '6 instances', after: '6 instances', param: 'so=',
      control: () => expect(pressed('Sort')).toEqual(['Stephanus order']),
    },
    {
      what: '1 line', url: `${G}&ctx=1`, before: '6 instances', after: '6 instances', param: 'ctx=',
      control: () => expect(pressed('Context')).toEqual(['3 lines']),
    },
    {
      what: '20 a page', url: `${G}&ps=20`, before: '6 instances', after: '6 instances', param: 'ps=',
      control: () => expect(pressed('Hits per page')).toEqual(['40']),
    },
    {
      what: 'Citations only', url: `${G}&ps=c`, before: '6 instances', after: '6 instances', param: 'ps=',
      control: () => expect(pressed('Hits per page')).toEqual(['40']),
    },
  ];
  for (const c of cases) {
    it(`undoes "${c.what}" alone, without a new search`, async () => {
      const { search } = await import('../lib/search');
      await open(c.url, c.results);
      await vi.waitFor(() => expect(status()).toHaveTextContent(c.before));
      expect(window.location.search).toContain(c.param);
      const others = chosen().filter(w => w !== c.what);
      await fireEvent.click(remove(c.what));
      await vi.waitFor(() => expect(status()).toHaveTextContent(c.after));
      expect(window.location.search).not.toContain(c.param);
      expect(chosen()).toEqual(others);
      c.control();
      expect(search).toHaveBeenCalledTimes(1);
    });
  }

  it('runs the search once more without the speaker filter, and keeps the rest', async () => {
    const { search } = await import('../lib/search');
    await open(`${G}&wf=Meno&sp=only&sn=Meno`);
    await vi.waitFor(() => expect(chosen()).toEqual(['Meno', 'Meno only']));
    expect(vi.mocked(search).mock.calls[0][8]).toEqual({ mode: 'only', names: ['Meno'] });
    await answer();
    await fireEvent.click(remove('Meno only'));
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    expect(vi.mocked(search).mock.calls[1][8]).toBeUndefined();
    await vi.waitFor(() => expect(chosen()).toEqual(['Meno']));
    await vi.waitFor(() => expect(status()).toHaveTextContent('4 instances'));
    expect(window.location.search).not.toContain('sp=');
    expect(window.location.search).toContain('wf=Meno');
    expect(screen.getByRole('button', { name: /^Spoken by anyone/ })).toBeInTheDocument();
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('runs the search as it was submitted, not as the box now reads', async () => {
    const { search } = await import('../lib/search');
    await open(`${G}&sp=only&sn=Meno`);
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

  it('clears everything at once, without a new search', async () => {
    const { search } = await import('../lib/search');
    await open(`${G}&wf=Meno&xf=tais&v=grammar&gf=case.gen&so=form&ctx=1&ps=20`);
    await vi.waitFor(() => expect(status()).toHaveTextContent('1 instance'));
    await fireEvent.click(within(summary()).getByRole('button', { name: 'Clear all' }));
    await vi.waitFor(() => expect(status()).toHaveTextContent('6 instances'));
    expect(chosen()).toEqual([]);
    expect(window.location.search).toBe(`?g=${encodeURIComponent('εἰμί')}`);
    expect(pressed('Group the hits')).toEqual(['By Stephanus page']);
    expect(pressed('Hits per page')).toEqual(['40']);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('clears everything with one new search when the speaker filter is among them', async () => {
    const { search } = await import('../lib/search');
    await open(`${G}&wf=Meno&v=form&sp=only&sn=Meno`);
    await vi.waitFor(() => expect(chosen()).toEqual(['Meno', 'Meno only', 'By form']));
    await answer();
    await fireEvent.click(within(summary()).getByRole('button', { name: 'Clear all' }));
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(status()).toHaveTextContent('6 instances'));
    expect(chosen()).toEqual([]);
    expect(vi.mocked(search).mock.calls[1][8]).toBeUndefined();
    expect(window.location.search).toBe(`?g=${encodeURIComponent('εἰμί')}`);
    expect(search).toHaveBeenCalledTimes(2);
  });
});

describe('Search.svelte: the Refine sheet', () => {
  const refine = () => screen.getByRole('button', { name: /^Refine/ });

  it('says how many things are chosen', async () => {
    await open(`${G}&wf=Meno&v=form`);
    expect(text(refine())).toBe('Refine · 2');
  });

  it('opens as a modal dialog with focus inside, and Escape shuts it and hands focus back', async () => {
    await open(G);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(refine()).toHaveAttribute('aria-expanded', 'false');
    await fireEvent.click(refine());
    const sheet = await screen.findByRole('dialog', { name: 'Refine results' });
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(refine()).toHaveAttribute('aria-expanded', 'true');
    await vi.waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));
    expect(within(sheet).getByRole('group', { name: 'Group the hits' })).toBeInTheDocument();
    await fireEvent.keyDown(document.activeElement ?? sheet, { key: 'Escape' });
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(refine());
    // Shut, the controls are the side column again.
    expect(screen.getByRole('complementary', { name: 'Refine results' })).toBeInTheDocument();
  });

  it('shuts on Close and on the backdrop', async () => {
    const { container } = await open(G);
    await fireEvent.click(refine());
    const sheet = await screen.findByRole('dialog', { name: 'Refine results' });
    await fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(refine());
    await fireEvent.click(refine());
    await screen.findByRole('dialog', { name: 'Refine results' });
    await fireEvent.click(container.querySelector('.sx-scrim')!);
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(refine());
  });

  it('stays open while a control in it is changed, and the change applies at once', async () => {
    const { search } = await import('../lib/search');
    await open(G);
    await fireEvent.click(refine());
    const sheet = await screen.findByRole('dialog', { name: 'Refine results' });
    await fireEvent.click(within(within(sheet).getByRole('group', { name: 'Group the hits' })).getByRole('button', { name: 'By form' }));
    await vi.waitFor(() => expect(pressed('Group the hits')).toEqual(['By form']));
    expect(screen.getByRole('dialog', { name: 'Refine results' })).toBeInTheDocument();
    expect(window.location.search).toContain('v=form');
    expect(search).toHaveBeenCalledTimes(1);
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

  it('is sticky on a wide screen, with its own scroll', () => {
    const side = rules(block(style, /@media \(min-width: 1100px\)/)).find(r => r.sel.split(',').map(s => s.trim()).includes('.sx-side'));
    expect(side?.body).toMatch(/position:\s*sticky/);
    expect(side?.body).toMatch(/overflow-y:\s*auto/);
    expect(side?.body).toMatch(/max-height:\s*calc\(100vh/);
  });

  it('does not print', () => {
    const CSS = readFileSync(resolve(here, '../styles/global.css'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    const hidden = rules(block(CSS, /@media print/))
      .filter(r => /display:\s*none/.test(r.body)).flatMap(r => r.sel.split(',').map(s => s.trim()));
    for (const sel of ['.search-page .sx-panel', '.search-page .sx-refine', '.search-page .sx-scrim']) expect(hidden).toContain(sel);
  });
});

describe('Search.svelte: the Refine sheet and the page behind it', () => {
  const refine = () => screen.getByRole('button', { name: /^Refine/ });

  it('holds the page still while it is open', async () => {
    await open(G);
    await fireEvent.click(refine());
    await screen.findByRole('dialog', { name: 'Refine results' });
    expect(document.documentElement.style.overflow).toBe('hidden');
    await fireEvent.keyDown(window, { key: 'Escape' });
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('is shut when the results it refined are gone, and stays shut for the next search', async () => {
    const { search } = await import('../lib/search');
    const { container } = await open(G);
    await fireEvent.click(refine());
    await screen.findByRole('dialog', { name: 'Refine results' });
    // Back, to no search at all.
    window.history.pushState(null, '', '/search');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(container.querySelector('li.instance')).toBeNull());
    await vi.waitFor(() => expect(document.documentElement.style.overflow).toBe(''));
    vi.mocked(search).mockResolvedValueOnce({ results: RESULTS, failedWorks: [] });
    await fireEvent.input(screen.getByLabelText('Greek'), { target: { value: 'εἰμί' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await vi.waitFor(() => expect(status()).toHaveTextContent('6 instances'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Search.svelte: removing the speaker from widened results', () => {
  it('widens again without the speaker, and does not fall back to the search before the widening', async () => {
    const { search, searchPhraseVariants } = await import('../lib/search');
    const speaker = { mode: 'only' as const, names: ['Meno'] };
    await open(`/search?g=${encodeURIComponent('τῆς ἐστι')}&sp=only&sn=Meno`);
    await vi.waitFor(() => expect(chosen()).toEqual(['Meno only']));
    const widened = { results: RESULTS.slice(0, 1), failedWorks: [], readings: [['x']], productive: [['x']] };
    vi.mocked(searchPhraseVariants).mockResolvedValueOnce(widened as never);
    await fireEvent.click(screen.getByRole('button', { name: 'Find this phrase in any inflection' }));
    await vi.waitFor(() => expect(searchPhraseVariants).toHaveBeenCalledTimes(1));
    expect(vi.mocked(searchPhraseVariants).mock.calls[0][2]).toEqual(speaker);
    await vi.waitFor(() => expect(status()).toHaveTextContent('3 instances'));
    // The same widening, for everyone.
    vi.mocked(searchPhraseVariants).mockResolvedValueOnce({ ...widened, results: RESULTS } as never);
    await fireEvent.click(remove('Meno only'));
    await vi.waitFor(() => expect(searchPhraseVariants).toHaveBeenCalledTimes(2));
    expect(vi.mocked(searchPhraseVariants).mock.calls[1][2]).toBeUndefined();
    await vi.waitFor(() => expect(status()).toHaveTextContent('6 instances'));
    expect(search).toHaveBeenCalledTimes(1);
    expect(chosen()).toEqual([]);
    expect(window.location.search).not.toContain('sp=');
  });
});

describe('Search.svelte: the sidebar and widened results', () => {
  const PHRASE = `/search?g=${encodeURIComponent('τῆς ἐστι')}`;
  const widened = { results: RESULTS, failedWorks: [], readings: [['x']], productive: [['x']] };
  const widen = async () => {
    await fireEvent.click(screen.getByRole('button', { name: 'Find this phrase in any inflection' }));
  };

  it('lets the page go when the request behind an open sheet fails', async () => {
    const { searchPhraseVariants } = await import('../lib/search');
    await open(PHRASE);
    await fireEvent.click(screen.getByRole('button', { name: /^Refine/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Refine results' });
    expect(document.documentElement.style.overflow).toBe('hidden');
    vi.mocked(searchPhraseVariants).mockRejectedValueOnce(new Error('the index did not load'));
    await fireEvent.click(within(sheet).getByRole('button', { name: 'Find this phrase in any inflection' }));
    // The error takes the results, and the sheet with them, off the page.
    await screen.findByText('the index did not load');
    await vi.waitFor(() => expect(document.documentElement.style.overflow).toBe(''));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the reader\'s other filters when only the speaker is removed', async () => {
    const { searchPhraseVariants } = await import('../lib/search');
    await open(`${PHRASE}&sp=only&sn=Meno`);
    vi.mocked(searchPhraseVariants).mockResolvedValueOnce(widened as never);
    await widen();
    await vi.waitFor(() => expect(searchPhraseVariants).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(status()).toHaveTextContent('6 instances'));
    // Narrowed to the Meno, in the widened results.
    await fireEvent.click(within(screen.getByRole('group', { name: 'Show hits from one work' })).getByRole('button', { name: /^Meno/ }));
    await vi.waitFor(() => expect(status()).toHaveTextContent('4 instances'));
    expect(chosen()).toEqual(['Meno', 'Meno only']);
    vi.mocked(searchPhraseVariants).mockResolvedValueOnce(widened as never);
    await fireEvent.click(remove('Meno only'));
    await vi.waitFor(() => expect(searchPhraseVariants).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(chosen()).toEqual(['Meno']));
    expect(status()).toHaveTextContent('4 instances');
    expect(window.location.search).toContain('wf=Meno');
    expect(window.location.search).not.toContain('sp=');
  });

  it('does not show the widened hits unnarrowed while their readings load', async () => {
    const { searchPhraseVariants, greekHitGrammar } = await import('../lib/search');
    await open(`${PHRASE}&sp=only&sn=Meno`);
    vi.mocked(searchPhraseVariants).mockResolvedValueOnce(widened as never);
    await widen();
    await vi.waitFor(() => expect(status()).toHaveTextContent('6 instances'));
    // Narrowed to the dative, in the grammar view.
    vi.mocked(greekHitGrammar).mockReset().mockResolvedValueOnce(GRAMMAR);
    await fireEvent.click(within(screen.getByRole('group', { name: 'Group the hits' })).getByRole('button', { name: 'Grammar' }));
    await fireEvent.click(await screen.findByRole('checkbox', { name: 'Case dat' }));
    await vi.waitFor(() => expect(status()).toHaveTextContent('3 instances'));
    // The speaker goes; the re-widened hits' readings are slow to come.
    let readingsIn!: (g: HitGrammar) => void;
    vi.mocked(greekHitGrammar).mockReturnValueOnce(new Promise(resolve => { readingsIn = resolve; }));
    vi.mocked(searchPhraseVariants).mockResolvedValueOnce(widened as never);
    await fireEvent.click(remove('Meno only'));
    await vi.waitFor(() => expect(greekHitGrammar).toHaveBeenCalledTimes(2));
    await new Promise(r => setTimeout(r, 30));
    expect(status()).not.toHaveTextContent('6 instances');
    readingsIn(GRAMMAR);
    await vi.waitFor(() => expect(chosen()).toEqual(['Case dat', 'By grammar']));
    expect(status()).toHaveTextContent('3 instances');
  });

  it('does not put the filters it was keeping on a search made since', async () => {
    const { searchPhraseVariants } = await import('../lib/search');
    await open(`${PHRASE}&sp=only&sn=Meno`);
    vi.mocked(searchPhraseVariants).mockResolvedValueOnce(widened as never);
    await widen();
    await vi.waitFor(() => expect(status()).toHaveTextContent('6 instances'));
    await fireEvent.click(within(screen.getByRole('group', { name: 'Show hits from one work' })).getByRole('button', { name: /^Meno/ }));
    await vi.waitFor(() => expect(chosen()).toEqual(['Meno', 'Meno only']));
    // The speaker is removed, and its re-widening is slow.
    let oldIn!: (outcome: unknown) => void;
    vi.mocked(searchPhraseVariants).mockReturnValueOnce(new Promise(resolve => { oldIn = resolve; }) as never);
    await fireEvent.click(remove('Meno only'));
    await vi.waitFor(() => expect(searchPhraseVariants).toHaveBeenCalledTimes(2));
    // Meanwhile the reader searches again and widens that.
    await answer();
    await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await vi.waitFor(() => expect(status()).toHaveTextContent('6 instances'));
    vi.mocked(searchPhraseVariants).mockResolvedValueOnce(widened as never);
    await widen();
    await vi.waitFor(() => expect(searchPhraseVariants).toHaveBeenCalledTimes(3));
    await vi.waitFor(() => expect(status()).toHaveTextContent('6 instances'));
    oldIn(widened);
    await new Promise(r => setTimeout(r, 30));
    expect(chosen()).toEqual([]);
    expect(window.location.search).not.toContain('wf=');
  });

  it('"Clear all" leaves none of the old filters in the address bar', async () => {
    const { searchPhraseVariants } = await import('../lib/search');
    await open(`${PHRASE}&sp=only&sn=Meno&wf=Meno&v=form`);
    vi.mocked(searchPhraseVariants).mockResolvedValueOnce(widened as never);
    await widen();
    await vi.waitFor(() => expect(searchPhraseVariants).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(chosen()).toEqual(['Meno only', 'By form']));
    vi.mocked(searchPhraseVariants).mockResolvedValueOnce(widened as never);
    await fireEvent.click(within(summary()).getByRole('button', { name: 'Clear all' }));
    await vi.waitFor(() => expect(searchPhraseVariants).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(chosen()).toEqual([]));
    expect(window.location.search).toBe(`?g=${encodeURIComponent('τῆς ἐστι')}`);
  });
});
