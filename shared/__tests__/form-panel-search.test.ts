// The form panel on the results page: the Greek forms a result is made of,
// each with its count and a tick box. Unticking and applying drops those hits
// and every count with them, without searching again. The counting and the
// form lookup are tested in form-panel.test.ts.
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Search from '../components/Search.svelte';
import type { BookData, GreekLine } from '../lib/data';
import type { HitForms, SearchResult } from '../lib/search';

const { fixture } = vi.hoisted(() => {
  const line = (n: number, text: string): GreekLine => ({
    n, text, tokens: text.split(' ').map((t, i) => ({ t, o: i * 2, k: t })),
  });
  const fixture: BookData = {
    book: 1,
    segments: [
      { id: '1:70a', column: '70a', greek: [line(1, 'α β γ δ')], english: { text: 'One two three four', notes: [], markers: [] } },
      { id: '1:70b', column: '70b', greek: [line(1, 'ε ζ')], english: { text: 'five six', notes: [], markers: [] } },
    ],
  };
  return { fixture };
});

vi.mock('../lib/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/search')>();
  return {
    ...actual,
    search: vi.fn(async () => ({ results: [], failedWorks: [] })),
    greekHitForms: vi.fn(async () => ({ byResult: new Map(), headwords: new Map() })),
    searchCombo: vi.fn(async () => ({ results: [], failedWorks: [] })),
    searchPhraseVariants: vi.fn(),
    speakerRoster: vi.fn(async () => []),
  };
});
vi.mock('../lib/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/data')>();
  return {
    ...actual,
    fetchBook: vi.fn(async () => fixture),
    fetchSections: vi.fn(async () => ({ '1': [{ column: '70a', page: 70 }, { column: '70b', page: 70 }] })),
  };
});

afterEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

const at = (work: string, column: string, grkPositions: number[]): SearchResult => ({
  work, meta: { id: `1:${column}`, book: 1, column }, grkMatch: true, engMatch: false, grkPositions,
});
// Meno 70a: ἐστι, ἦν, ἐστι; 70b: εἶναι. Crito 70a: ἐστι. Five hits.
const RESULTS = [at('Meno', '70a', [0, 1, 3]), at('Meno', '70b', [1]), at('Crito', '70a', [0])];
const FORMS: HitForms = {
  byResult: new Map([['Meno:1:70a', ['esti', 'hn', 'esti']], ['Meno:1:70b', ['einai']], ['Crito:1:70a', ['esti']]]),
  headwords: new Map(),
};

async function open(url: string, forms: HitForms = FORMS, results: SearchResult[] = RESULTS) {
  const { search, greekHitForms } = await import('../lib/search');
  vi.mocked(search).mockResolvedValueOnce({ results, failedWorks: [] });
  vi.mocked(greekHitForms).mockResolvedValueOnce(forms);
  window.history.replaceState(null, '', url);
  const page = render(Search);
  // The panel is drawn once the forms are in, after the results.
  const panel = await screen.findByRole('group', { name: 'Greek forms found' });
  return { ...page, panel };
}
const status = () => screen.getByRole('status');
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
// Each form as "εστι 3 ✓": its Greek, its count, whether it is ticked.
const rows = (panel: HTMLElement) => [...panel.querySelectorAll('label')].map(label =>
  `${text(label)}${(label.querySelector('input') as HTMLInputElement).checked ? ' ✓' : ''}`);
const box = (panel: HTMLElement, form: string) => within(panel).getByRole('checkbox', { name: new RegExp(`^${form}`) });
const G = `/search?g=${encodeURIComponent('εἰμί')}`;

describe('Search.svelte: the form panel', () => {
  it('lists every form found with its count, commonest first, all ticked', async () => {
    const { panel } = await open(G);
    await vi.waitFor(() => expect(status()).toHaveTextContent('5 instances'));
    expect(rows(panel)).toEqual(['εστι 3 ✓', 'ειναι 1 ✓', 'ην 1 ✓']);
    const { greekHitForms } = await import('../lib/search');
    expect(greekHitForms).toHaveBeenCalledWith(RESULTS, 'εἰμί', 'lemma');
  });

  it('drops an unticked form from the hits and every count, once applied, without a new search', async () => {
    const { search } = await import('../lib/search');
    const { panel } = await open(G);
    await vi.waitFor(() => expect(status()).toHaveTextContent('5 instances'));
    await fireEvent.click(box(panel, 'εστι'));
    // Nothing moves until Apply.
    expect(status()).toHaveTextContent('5 instances');
    await fireEvent.click(within(panel).getByRole('button', { name: 'Apply' }));
    await vi.waitFor(() => expect(status()).toHaveTextContent('2 instances'));
    // Crito had only ἐστι, so with one work left there is no Works row.
    expect(screen.queryByRole('group', { name: 'Show hits from one work' })).toBeNull();
    // The form set aside is still listed, with its count, to tick again.
    expect(rows(panel)).toEqual(['εστι 3', 'ειναι 1 ✓', 'ην 1 ✓']);
    expect(window.location.search).toContain('xf=esti');
    expect(search).toHaveBeenCalledTimes(1);

    await fireEvent.click(box(panel, 'εστι'));
    await fireEvent.click(within(panel).getByRole('button', { name: 'Apply' }));
    await vi.waitFor(() => expect(status()).toHaveTextContent('5 instances'));
    expect(window.location.search).not.toContain('xf=');
  });

  it('unticks every form at once, and will not apply none', async () => {
    const { panel } = await open(G);
    const apply = within(panel).getByRole('button', { name: 'Apply' });
    // Nothing to apply until a box changes.
    expect(apply).toBeDisabled();
    await fireEvent.click(within(panel).getByRole('button', { name: 'Deselect all' }));
    expect(rows(panel)).toEqual(['εστι 3', 'ειναι 1', 'ην 1']);
    expect(apply).toBeDisabled();
    await fireEvent.click(box(panel, 'ην'));
    expect(apply).toBeEnabled();
    await fireEvent.click(apply);
    await vi.waitFor(() => expect(status()).toHaveTextContent('1 instance'));
    expect(window.location.search).toContain('xf=esti,einai');
  });

  it('reads the forms set aside from the address bar', async () => {
    const { panel } = await open(`${G}&xf=esti,einai`);
    await vi.waitFor(() => expect(status()).toHaveTextContent('1 instance'));
    expect(rows(panel)).toEqual(['εστι 3', 'ειναι 1', 'ην 1 ✓']);
  });

  it('counts within the work the hits are narrowed to', async () => {
    const { panel } = await open(`${G}&wf=Meno`);
    await vi.waitFor(() => expect(status()).toHaveTextContent('4 instances'));
    expect(rows(panel)).toEqual(['εστι 2 ✓', 'ειναι 1 ✓', 'ην 1 ✓']);
  });

  it('groups the forms under each headword a typed form belongs to', async () => {
    const forms: HitForms = {
      byResult: FORMS.byResult,
      headwords: new Map([['esti', ['eimi']], ['einai', ['eimi']], ['hn', ['eimi', 'os']]]),
    };
    const { panel } = await open(`/search?g=${encodeURIComponent('ἦν')}`, forms);
    const groups = [...panel.querySelectorAll('.fx-group')].map(g =>
      `${text(g.querySelector('.fx-head'))}: ${[...g.querySelectorAll('label')].map(text).join(', ')}`);
    expect(groups).toEqual(['ειμι: εστι 3, ειναι 1, ην 1', 'ος: ην 1']);
    // One form, one tick: ἦν under either headword is the same box.
    await fireEvent.click(within(panel).getAllByRole('checkbox', { name: /^ην/ })[1]);
    expect(within(panel).getAllByRole('checkbox', { name: /^ην/ }).map(b => (b as HTMLInputElement).checked)).toEqual([false, false]);
  });

  it('counts the hits a speaker filter left', async () => {
    const { search } = await import('../lib/search');
    // What the engine returns under the filter: Socrates' two hits.
    const spoken = [{ ...at('Meno', '70a', [0, 1]), speakers: ['Socrates', 'Socrates'] }];
    const forms: HitForms = { byResult: new Map([['Meno:1:70a', ['esti', 'hn']]]), headwords: new Map() };
    const { panel } = await open(`${G}&sp=only&sn=Socrates`, forms, spoken);
    await vi.waitFor(() => expect(status()).toHaveTextContent('2 instances'));
    expect(vi.mocked(search).mock.calls[0][8]).toEqual({ mode: 'only', names: ['Socrates'] });
    expect(rows(panel)).toEqual(['εστι 1 ✓', 'ην 1 ✓']);
  });

  it('is not drawn for a result of one form', async () => {
    const { search, greekHitForms } = await import('../lib/search');
    vi.mocked(search).mockResolvedValueOnce({ results: [at('Meno', '70b', [1])], failedWorks: [] });
    vi.mocked(greekHitForms).mockResolvedValueOnce({ byResult: new Map([['Meno:1:70b', ['einai']]]), headwords: new Map() });
    window.history.replaceState(null, '', G);
    render(Search);
    await vi.waitFor(() => expect(status()).toHaveTextContent('1 instance'));
    await vi.waitFor(() => expect(greekHitForms).toHaveBeenCalled());
    await new Promise(r => setTimeout(r, 30));
    expect(screen.queryByRole('group', { name: 'Greek forms found' })).toBeNull();
  });
});
