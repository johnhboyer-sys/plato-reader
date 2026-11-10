// Reading the results (PR 3), as the page draws them: a Greek word opens its
// card, the Context, Sort and Page-size controls, a proximity hit's span, and
// printing. The pure parts are tested in reading-results.test.ts.
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Search from '../components/Search.svelte';
import type { BookData, FlowTurn, GreekLine, Segment } from '../lib/data';
import type { SearchResult } from '../lib/search';
import { getWork } from '../lib/works';

// The book of paired-hit.test.ts (Meno 70a–c, five turns, Lamb and a
// turn-aligned Jowett), and after it plain sections 71a … 99a, one to a
// Stephanus page, for paging; 99a is long, for the context windows: 31 Greek
// words κ0 … κ30, and 61 English words of five letters, "virtu" the 31st.
// Every work and book reads the same.
//   T0  70a line 1          Lamb "One two three."        Jowett "Uno dos."
//   T1  70a line 2 → 70b η  Lamb "Four five | six seven eight"   Jowett "Cuatro cinco | seis"
//   T2  70b θ → 70c λ       two stacked speeches: "Nine ten." "Eleven | twelve thirteen"
//   T3  no Greek            "Residual words here"
//   T4  70c μ               "Last."
const { fixture, COLUMNS } = vi.hoisted(() => {
  const line = (n: number, text: string): GreekLine => ({
    n, text, tokens: text.split(' ').map((t, i) => ({ t, o: i * 2, k: `${t}-key` })),
  });
  const seg = (column: string, english: string, ...greek: GreekLine[]): Segment => ({
    id: `1:${column}`, column, greek, english: { text: english, notes: [], markers: [] },
  });
  const turn = (t: Partial<FlowTurn>): FlowTurn => ({ s: null, d: null, g: null, e: null, p: false, ...t });
  const extra = Array.from({ length: 28 }, (_, i) => `${71 + i}a`);
  const LONG_GREEK = Array.from({ length: 31 }, (_, i) => `κ${i}`).join(' ');
  const word = (i: number) => `w${String.fromCharCode(97 + Math.floor(i / 26), 97 + (i % 26))}xx`;
  const LONG_ENGLISH = Array.from({ length: 61 }, (_, i) => (i === 30 ? 'virtu' : word(i))).join(' ');
  const fixture: BookData = {
    book: 1,
    segments: [
      seg('70a', 'One two three. Four five', line(1, 'α β γ'), line(2, 'δ ε')),
      seg('70b', 'six seven eight Nine ten. Eleven', line(1, 'ζ η θ'), line(2, 'ι κ')),
      seg('70c', 'twelve thirteen Residual words here Last.', line(1, 'λ μ')),
      ...extra.map(c => seg(c, 'Plain words', line(1, 'ο π ρ'))),
      seg('99a', LONG_ENGLISH, line(1, LONG_GREEK)),
    ],
    turnFlow: {
      leadE: null,
      turns: [
        turn({ s: 'Meno', g: { c: '70a', n: 1, o: 0 }, e: 'One two three.', es: [{ o: 0, c: '70a' }], p: true,
          alt: { jowett: { e: 'Uno dos.' } } }),
        turn({ s: 'Socrates', g: { c: '70a', n: 2, o: 0 }, e: 'Four five six seven eight', es: [{ o: 10, c: '70b' }], p: true,
          alt: { jowett: { e: 'Cuatro cinco seis', es: [{ o: 13, c: '70b' }] } } }),
        turn({ g: { c: '70b', n: 1, o: 4 }, e: '', sub: [
          { s: 'Socrates', d: 'Soc.', e: 'Nine ten.' },
          { s: 'Meno', d: 'Men.', e: 'Eleven twelve thirteen', es: [{ o: 7, c: '70c' }] },
        ] }),
        turn({ s: 'Meno', e: 'Residual words here' }),
        turn({ s: 'Socrates', g: { c: '70c', n: 1, o: 2 }, e: 'Last.', p: true }),
        ...extra.map(c => turn({ s: 'Socrates', g: { c, n: 1, o: 0 }, e: 'Plain words', p: true })),
        turn({ s: 'Socrates', g: { c: '99a', n: 1, o: 0 }, e: LONG_ENGLISH, p: true }),
      ],
    },
  };
  return { fixture, COLUMNS: ['70a', '70b', '70c', ...extra, '99a'] };
});

vi.mock('../components/WordPopup.svelte', async () => ({ default: (await import('./stubs/WordPopupStub.svelte')).default }));
vi.mock('../lib/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/search')>();
  return {
    ...actual,
    search: vi.fn(async () => ({ results: [], failedWorks: [] })),
    searchCombo: vi.fn(async () => ({ results: [], failedWorks: [] })),
    greekHitForms: vi.fn(async () => ({ byResult: new Map(), headwords: new Map(), failedWorks: [] })),
    greekHitGrammar: vi.fn(async () => ({ byResult: new Map(), failedWorks: [] })),
    searchPhraseVariants: vi.fn(),
    speakerRoster: vi.fn(async () => []),
  };
});
vi.mock('../lib/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/data')>();
  const sections = COLUMNS.map(column => ({ column, page: parseInt(column, 10) }));
  return {
    ...actual,
    fetchBook: vi.fn(async () => fixture),
    fetchSections: vi.fn(async () => ({ '1': sections, '2': sections })),
  };
});

afterEach(async () => {
  const { greekHitGrammar } = await import('../lib/search');
  vi.mocked(greekHitGrammar).mockReset();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

const at = (column: string, r: Partial<SearchResult>, work = 'Meno'): SearchResult => ({
  work, meta: { id: `1:${column}`, book: 1, column },
  grkMatch: false, engMatch: false, grkPositions: [], ...r,
});
const grk = (column: string, grkPositions: number[], work = 'Meno', more: Partial<SearchResult> = {}) =>
  at(column, { grkMatch: true, grkPositions, ...more }, work);
const text = (el: Element | null | undefined) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const marks = (el: Element) => [...el.querySelectorAll('mark')].map(m => m.textContent);
const status = () => screen.getByRole('status');

async function expandAll(c: HTMLElement) {
  for (const h of c.querySelectorAll('button.group-head[aria-expanded="false"]')) await fireEvent.click(h);
  await tick();
}
// Runs the search in `url` over `results`. Settled once the status line holds
// the count and the first page's groups are drawn; every group is opened.
async function open(url: string, results: SearchResult[], total: number, { combo = false } = {}) {
  const { search, searchCombo } = await import('../lib/search');
  vi.mocked(combo ? searchCombo : search).mockResolvedValueOnce({ results, failedWorks: [] });
  window.history.replaceState(null, '', url);
  const page = render(Search);
  await vi.waitFor(() => expect(status()).toHaveTextContent(`${total} instance`));
  await vi.waitFor(() => expect(page.container.querySelector('.chapter-group')).not.toBeNull());
  await expandAll(page.container);
  return page;
}
const items = (c: HTMLElement) => [...c.querySelectorAll('li.instance')];
const G = (q: string) => `/search?g=${encodeURIComponent(q)}`;

describe('Search.svelte: a Greek word opens its card', () => {
  it('opens the card for the word clicked, marked or not, and closes it', async () => {
    const { container } = await open(G('δ'), [grk('70a', [3])], 1);
    const [li] = items(container);
    expect(marks(li)).toEqual(['δ']);
    expect(container.querySelector('.word-sidebar')).toBeNull();
    // The marked word is a word button too.
    const hit = li.querySelector('mark')!.closest('button.gw')!;
    expect(hit).not.toBeNull();
    await fireEvent.click(hit);
    const card = await vi.waitFor(() => container.ownerDocument.querySelector('.word-sidebar')!);
    expect(card).toHaveAttribute('data-work', 'Meno');
    expect(JSON.parse(card.getAttribute('data-token')!)).toEqual(fixture.segments[0].greek[1].tokens[0]);
    // Another word in the same hit: the card is now that word's.
    const other = [...li.querySelectorAll('button.gw')].find(b => text(b) === 'β')!;
    await fireEvent.click(other);
    await vi.waitFor(() => expect(JSON.parse(container.ownerDocument.querySelector('.word-sidebar')!.getAttribute('data-token')!))
      .toEqual(fixture.segments[0].greek[0].tokens[1]));
    await fireEvent.click(within(container.ownerDocument.querySelector('.word-sidebar') as HTMLElement).getByRole('button', { name: 'Close' }));
    await vi.waitFor(() => expect(container.ownerDocument.querySelector('.word-sidebar')).toBeNull());
  });

  it('opens it from the Greek printed under an English hit', async () => {
    // "seven" is Socrates' turn in 70b, whose Greek there is ζ η.
    const { container } = await open('/search?e=seven', [at('70b', { engMatch: true, engHits: [{ translation: 'lamb', positions: [1] }] })], 1);
    const pair = items(container)[0].querySelector('.inst-pair.greek')!;
    expect(text(pair)).toBe('ζ η');
    const words = [...pair.querySelectorAll('button.gw')];
    expect(words.map(text)).toEqual(['ζ', 'η']);
    await fireEvent.click(words[1]);
    const card = await vi.waitFor(() => container.ownerDocument.querySelector('.word-sidebar')!);
    expect(JSON.parse(card.getAttribute('data-token')!)).toEqual(fixture.segments[1].greek[0].tokens[1]);
  });
});

// The words a passage prints, its marks and cut marks left out.
const wordsIn = (el: Element | null) => text(el).replace(/…/g, '').trim().split(/\s+/);
const control = (name: string) => screen.getByRole('group', { name });
const press = (group: string, name: string) => fireEvent.click(within(control(group)).getByRole('button', { name }));

describe('Search.svelte: context', () => {
  it('offers 1 line, 3 lines and the whole section, 3 lines in force', async () => {
    const { search } = await import('../lib/search');
    await open(G('κ15'), [grk('99a', [15])], 1);
    const row = control('Context');
    expect(within(row).getAllByRole('button').map(b => [text(b), b.getAttribute('aria-pressed')])).toEqual([
      ['1 line', 'false'], ['3 lines', 'true'], ['Whole section', 'false'],
    ]);
    for (const b of within(row).getAllByRole('button')) expect(b.className).toContain('i');
    await press('Context', '1 line');
    await vi.waitFor(() => expect(within(row).getByRole('button', { name: '1 line' })).toHaveAttribute('aria-pressed', 'true'));
    expect(window.location.search).toContain('ctx=1');
    await press('Context', '3 lines');
    await vi.waitFor(() => expect(window.location.search).not.toContain('ctx='));
    // A setting of the results: nothing is searched again.
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('Greek: 12 words either side under 3 lines, 4 under 1 line, the whole section under the third', async () => {
    const { container } = await open(G('κ15'), [grk('99a', [15])], 1);
    const greek = () => items(container)[0].querySelector('.inst-snippet.greek');
    expect(wordsIn(greek())).toEqual(Array.from({ length: 25 }, (_, i) => `κ${i + 3}`));
    expect(text(greek()).startsWith('… κ3')).toBe(true);
    expect(text(greek()).endsWith('κ27 …')).toBe(true);
    await press('Context', '1 line');
    await vi.waitFor(() => expect(wordsIn(greek())).toEqual(Array.from({ length: 9 }, (_, i) => `κ${i + 11}`)));
    await press('Context', 'Whole section');
    await vi.waitFor(() => expect(wordsIn(greek())).toHaveLength(31));
    expect(text(greek())).not.toContain('…');
    expect(marks(items(container)[0])).toEqual(['κ15']);
  });

  it('English: 140 characters either side under 3 lines, 50 under 1 line', async () => {
    const hit = at('99a', { engMatch: true, engHits: [{ translation: 'lamb', positions: [30] }] });
    const { container } = await open('/search?e=virtu', [hit], 1);
    const passage = () => items(container)[0].querySelector('.sx-tr .inst-snippet');
    expect(wordsIn(passage())).toHaveLength(46);
    await press('Context', '1 line');
    await vi.waitFor(() => expect(wordsIn(passage())).toHaveLength(16));
    expect(marks(items(container)[0].querySelector('.sx-tr')!)).toEqual(['virtu']);
  });

  it('whole section: one instance per section, both sides whole, every hit marked, the counts unchanged', async () => {
    const { container } = await open(G('α'), [grk('70a', [0, 3]), grk('70b', [1])], 3);
    expect(items(container)).toHaveLength(3);
    const counts = () => [...container.querySelectorAll('.group-count')].map(text);
    expect(counts()).toEqual(['3 instances']);
    await press('Context', 'Whole section');
    await vi.waitFor(async () => {
      await expandAll(container);
      expect(items(container)).toHaveLength(2);
    });
    expect(status()).toHaveTextContent('3 instances');
    expect(counts()).toEqual(['3 instances']);
    expect(window.location.search).toContain('ctx=s');
    const [a, b] = items(container);
    expect(text(a.querySelector('.inst-ref'))).toBe('70a');
    expect(text(a.querySelector('.inst-snippet.greek'))).toBe('α β γ δ ε');
    expect(marks(a)).toEqual(['α', 'δ']);
    // The citation names every Greek hit of the section.
    expect(a.querySelector('.inst-ref')!.getAttribute('href')).toContain('hlt=70a:0,3');
    // A Greek search: the section's English, unmarked, in the reference translation.
    expect(text(a.querySelector('.inst-pair'))).toBe('Lamb One two three. Four five');
    expect(a.querySelector('.inst-pair mark')).toBeNull();
    expect(text(b.querySelector('.inst-snippet.greek'))).toBe('ζ η θ ι κ');
    expect(marks(b)).toEqual(['η']);
    expect(text(b.querySelector('.inst-pair'))).toBe('Lamb six seven eight Nine ten. Eleven');
    // No "more" on a whole section.
    expect(container.querySelector('.inst-more')).toBeNull();
  });

  it("whole section: a translation's row is the section its words fall in", async () => {
    // α and Lamb's "Four" in 70a; Jowett's "seis", filed under 70a with its
    // turn, falls in 70b.
    const hit = at('70a', {
      grkMatch: true, engMatch: true, grkPositions: [0],
      engHits: [{ translation: 'lamb', positions: [3] }, { translation: 'jowett', positions: [4] }],
    });
    const url = `${G('α')}&e=four+seis&em=any&ctx=s`;
    const { container } = await open(url, [hit], 3);
    const [a, b] = items(container);
    expect(items(container)).toHaveLength(2);
    expect(marks(a)).toEqual(['α', 'Four']);
    expect([...a.querySelectorAll('.sx-tr > div')].map(text)).toEqual(['Lamb One two three. Four five']);
    expect(text(b.querySelector('.inst-ref'))).toBe('70b');
    expect(text(b.querySelector('.inst-snippet.greek'))).toBe('ζ η θ ι κ');
    expect([...b.querySelectorAll('.sx-tr > div')].map(text)).toEqual(['Jowett seis']);
    expect(marks(b)).toEqual(['seis']);
    expect(status()).toHaveTextContent('3 instances');
    expect([...container.querySelectorAll('.group-count')].map(text)).toEqual(['3 instances']);
  });

  it('more: opens one hit to its whole section on both sides, marks kept; less puts it back', async () => {
    const { container } = await open(G('α'), [grk('70a', [0, 3])], 2);
    const [a, b] = items(container);
    const before = [a.innerHTML, b.innerHTML];
    const more = a.querySelector('button.inst-more')!;
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(text(more)).toBe('more');
    await fireEvent.click(more);
    await vi.waitFor(() => expect(more).toHaveAttribute('aria-expanded', 'true'));
    expect(text(more)).toBe('less');
    expect(text(a.querySelector('.inst-snippet.greek'))).toBe('α β γ δ ε');
    expect(marks(a)).toEqual(['α', 'δ']);
    expect(text(a.querySelector('.inst-pair'))).toBe('Lamb One two three. Four five');
    expect(b.innerHTML).toBe(before[1]);
    expect(window.location.search).not.toContain('ctx');
    await fireEvent.click(more);
    await vi.waitFor(() => expect(text(more)).toBe('more'));
    expect(a.innerHTML).toBe(before[0]);
  });

  it('keeps the speaker filter: who speaks, and the counts', async () => {
    const results = [grk('70a', [0, 3], 'Meno', { speakers: ['Meno', 'Socrates'] })];
    const { container } = await open(`${G('α')}&sp=only&sn=Meno,Socrates&ctx=s`, results, 2);
    expect(items(container)).toHaveLength(1);
    expect(text(items(container)[0].querySelector('.inst-speaker'))).toBe('Meno · Socrates');
    expect(status()).toHaveTextContent('2 instances');
  });
});
