import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Reader from '../components/Reader.svelte';
import Search from '../components/Search.svelte';
import type { BookData } from '../lib/data';
import { getWork, type Work } from '../lib/works';

// These Reader tests need a real Work shape (translations, citation scheme)
// for the 'EN'/'Isa' fixture ids they render — a bekker-scheme work with a
// Rackham-style primary translation, and a busse-scheme work with lineless
// citations. Neither id is in the real registry (Plato-only now), so fixture
// metas stand in rather than depending on a real registry entry.
vi.mock('../lib/works', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/works')>();
  const fixtures: Record<string, Work> = {
    EN: {
      id: 'EN', title: 'Fixture Bekker Work', abbr: 'EN', author: 'Test',
      books: 1, bookLabels: ['1'],
      greekEdition: 'Test edition',
      greekSource: { short: 'Test', full: 'Test edition, full citation.' },
      translations: [{ id: 'rackham', name: 'Test Translator (Test, 1900)', short: 'Rackham', slot: 'english' }],
      blurb: 'Fixture work for Reader.svelte tests (bekker scheme, the default).',
    },
    Isa: {
      id: 'Isa', title: 'Fixture Busse Work', abbr: 'Isa', author: 'Test',
      books: 1, bookLabels: ['1'],
      greekEdition: 'Test edition',
      greekSource: { short: 'Test', full: 'Test edition, full citation.' },
      translations: [{ id: 'owen', name: 'Test Translator (Test, 1900)', short: 'Owen', slot: 'english', footnotes: true }],
      citation: { scheme: 'busse', hideLineNumbers: true },
      blurb: 'Fixture work for Reader.svelte tests (busse scheme, lineless).',
    },
  };
  return { ...actual, getWork: (id: string) => fixtures[id] ?? actual.getWork(id) };
});

const { fixtureBook } = vi.hoisted(() => ({
  fixtureBook: {
    book: 1,
    segments: [
      {
        id: 'seg1',
        column: '1094a',
        greek: [
          { n: 1, text: 'λόγος ἀρετή', tokens: [{ t: 'λόγος', o: 0, k: 'logos' }, { t: 'ἀρετή', o: 6, k: 'areth' }] },
        ],
        english: {
          text: 'Virtue (test) and κόσμος are discussed here.',
          notes: [],
          markers: [],
          bekker: [{ n: 1, offset: 0, real: true }],
        },
        chapterStarts: [{ chapter: '1', beforeLine: 1, wordIndex: 0, engOffset: 0, bekker: '1094a' }],
        third: [
          {
            chapter: '1',
            cont: false,
            text: 'Ostwald says virtue (test) beside κόσμος.',
            bekker: [{ n: 1, offset: 0, real: true }],
          },
        ],
      },
    ],
  } satisfies BookData,
}));

vi.mock('../lib/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/search')>();
  return {
    ...actual,
    search: vi.fn(async () => ({
      results: [
        {
          work: 'EN',
          meta: { id: 'seg1', book: 1, column: '1094a' },
          grkMatch: true,
          engMatch: true,
          grkPositions: [0],
        },
      ],
      failedWorks: [],
    })),
    searchCombo: vi.fn(async () => ({ results: [], failedWorks: [] })),
    searchPhraseVariants: vi.fn(),
    speakerRoster: vi.fn(async () => []),
  };
});

vi.mock('../lib/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/data')>();
  return {
    ...actual,
    fetchBook: vi.fn(async () => fixtureBook),
    fetchChapters: vi.fn(async () => ({
      '1': [{ chapter: '1', column: '1094a', line: '1', bekker: '1094a' }],
    })),
    fetchSections: vi.fn(async () => ({
      '1': [{ column: '1094a', page: 1094 }],
    })),
    fetchLemmaPickerShard: vi.fn(async () => ({
      yuxh: { n: 1026, c: [{ h: 'ψυχή', k: 'yuxh', s: 'psyche' }] },
      yuxros: { n: 41, c: [{ h: 'ψυχρός', k: 'yu_xro/s', s: 'psychros' }] },
    })),
    // The commoner word's gloss lands last, as a slower fetch would.
    fetchLemmaGlosses: vi.fn((slug: string) => new Promise<string[]>((resolve) =>
      setTimeout(() => resolve(slug === 'psyche' ? ['life', 'soul'] : ['cold']), slug === 'psyche' ? 30 : 5))),
  };
});

afterEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('Search.svelte', () => {
  // Smoke test: mounts, accepts Greek + English queries (including a
  // parenthesis metacharacter and a Unicode Greek term), and runs a search
  // without throwing. Asserting exact result-card markup would couple this to
  // the grouping internals; the value here is that mount + input + submit +
  // the (mocked) search call all wire together and nothing crashes.
  it('mounts and runs a search with metacharacter + Unicode input without throwing', async () => {
    const { search } = await import('../lib/search');
    render(Search);

    await fireEvent.input(screen.getByLabelText('Greek'), { target: { value: 'λόγ*' } });
    await fireEvent.input(screen.getByLabelText('English'), { target: { value: 'virtue (test) κόσμος' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    // The wired search path was invoked with the typed queries.
    expect(search).toHaveBeenCalled();
    // The form is still mounted (no crash / unhandled render error): the Greek
    // searchbox persists after the search runs.
    expect(screen.getByLabelText('Greek')).toBeInTheDocument();
  });
});

// The search features ported from aristotle-reader: the address bar, the
// works and translations rows, notices, stacked translations and the picker.
// Meno and Crito are real registry works carrying Lamb/Fowler and Jowett.
describe('Search.svelte: results', () => {
  const meta = { id: 'seg1', book: 1, column: '1094a' };

  it('counts every English word, shows hits by work, and says so in a live region', async () => {
    const { search } = await import('../lib/search');
    vi.mocked(search).mockResolvedValueOnce({
      results: [
        // One Greek word and two English ones: three hits.
        { work: 'Meno', meta, grkMatch: true, engMatch: true, grkPositions: [0], engHits: [{ translation: 'lamb', positions: [0, 1] }] },
        { work: 'Crito', meta, grkMatch: true, engMatch: false, grkPositions: [0, 1] },
      ],
      failedWorks: [],
    });
    render(Search);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');

    await fireEvent.input(screen.getByLabelText('Greek'), { target: { value: 'λόγος' } });
    await fireEvent.input(screen.getByLabelText('English'), { target: { value: 'virtue test' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    await vi.waitFor(() => expect(status).toHaveTextContent('5 instances'));
    // A plain item per work, its count beside it — not a chip with an "All".
    const works = screen.getByRole('group', { name: 'Show hits from one work' });
    expect(within(works).queryByRole('button', { name: 'All' })).toBeNull();
    const meno = within(works).getByRole('button', { name: /^Meno/ });
    expect(meno).toHaveClass('i');
    expect(meno.querySelector('small')).toHaveTextContent('3');
    expect(within(works).getByRole('button', { name: /^Crito/ })).toHaveTextContent('Crito2');

    await fireEvent.click(meno);
    await vi.waitFor(() => expect(status).toHaveTextContent('3 instances'));
    expect(meno).toHaveAttribute('aria-pressed', 'true');
    // Again lifts it.
    await fireEvent.click(meno);
    await vi.waitFor(() => expect(status).toHaveTextContent('5 instances'));
  });

  it('stacks the translations of one passage, each under its own label', async () => {
    const { search } = await import('../lib/search');
    vi.mocked(search).mockResolvedValueOnce({
      results: [{
        work: 'Meno', meta, grkMatch: false, engMatch: true, grkPositions: [],
        engHits: [{ translation: 'lamb', positions: [0] }],
      }],
      failedWorks: [],
    });
    const { container } = render(Search);
    await fireEvent.input(screen.getByLabelText('English'), { target: { value: 'virtue' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const stack = await vi.waitFor(() => {
      const el = container.querySelector('.sx-tr');
      if (!el) throw new Error('no stacked translations yet');
      return el;
    });
    const label = stack.querySelector('.lab')!;
    expect(label).toHaveTextContent('Lamb');
    // The label opens the reader in that translation, at the section.
    expect(label.getAttribute('href')).toContain('trans=lamb');
    expect(label.getAttribute('href')).toContain('loc=1094a');
    expect(stack.querySelector('mark')).toHaveTextContent('Virtue');
  });

  it('says what did not load as a warning row, with a way to try again', async () => {
    const { search } = await import('../lib/search');
    vi.mocked(search).mockResolvedValueOnce({
      results: [{ work: 'Meno', meta, grkMatch: true, engMatch: false, grkPositions: [0] }],
      failedWorks: ['Laws'],
      unsearchedTranslations: [{ work: 'Crito', translation: 'jowett' }],
    });
    const { container } = render(Search);
    await fireEvent.input(screen.getByLabelText('Greek'), { target: { value: 'λόγος' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await vi.waitFor(() => expect(container.querySelectorAll('.sx-note.warn')).toHaveLength(2));
    const [works, trans] = [...container.querySelectorAll('.sx-note.warn')];
    expect(works.querySelector('.k')).toHaveTextContent('Warning');
    expect(works).toHaveTextContent('Laws did not load');
    expect(trans).toHaveTextContent('Jowett (Crito)');
    await fireEvent.click(within(works as HTMLElement).getByRole('button', { name: 'Try again' }));
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(2));
  });
});

describe('Search.svelte: the lemma picker', () => {
  it('lists headword, gloss and count, and a pick runs a headword search', async () => {
    const { search } = await import('../lib/search');
    const { container } = render(Search);
    await fireEvent.click(screen.getByRole('button', { name: /Advanced search/ }));
    const panel = container.querySelector('details.lemma-panel') as HTMLDetailsElement;
    panel.open = true;
    await fireEvent.input(within(panel).getByLabelText('Find a dictionary word'), { target: { value: 'ψυχ' } });
    const list = await within(panel).findByRole('list', { name: /Dictionary words/ });
    const rows = within(list).getAllByRole('button');
    // Commonest first: ψυχή (1026) before ψυχρός (41).
    expect(rows[0].querySelector('.hw')).toHaveTextContent('ψυχή');
    expect(rows[0].querySelector('.ct')).toHaveTextContent('1,026');
    await vi.waitFor(() => expect(rows[0].querySelector('.gl')).toHaveTextContent('life; soul'));
    // Both glosses stay: one landing must not write back a map without the other.
    expect(rows[1].querySelector('.gl')).toHaveTextContent('cold');

    await fireEvent.click(rows[0]);
    // Picked: the list closes and the word reads as headword, gloss, count.
    const picked = container.querySelector('.lpsel')!;
    expect(picked.querySelector('.hw')).toHaveTextContent('ψυχή');
    expect(picked.querySelector('.ct')).toHaveTextContent('1,026');
    expect(within(panel).queryByRole('list')).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(vi.mocked(search).mock.calls[0].slice(0, 7)).toEqual(['yuxh', '', 'any', 'all', 'and', expect.any(Array), 'headword']);
    expect(window.location.search).toBe('?l=yuxh');

    // Change drops it.
    await fireEvent.click(within(picked as HTMLElement).getByRole('button', { name: /^Change/ }));
    expect(container.querySelector('.lpsel')).toBeNull();
  });
});

describe('Search.svelte in the address bar', () => {
  const at = (url: string) => window.history.replaceState(null, '', url);
  // Greek and English each have an "Any form" / "Only as I typed it" pair, so
  // a radio is named by its group as well.
  const checked = (name: string, group?: string) => (screen.getByLabelText(name,
    group ? { selector: `input[name="${group}"]` } : undefined) as HTMLInputElement).checked;

  it('restores every control from the URL and runs that search', async () => {
    const { search } = await import('../lib/search');
    at('/search?g=logos&gm=phrase&m=form&acc=1&e=virtue&em=any&op=or&w=Crito,Meno');
    render(Search);
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search).toHaveBeenCalledWith('logos', 'virtue', 'phrase', 'any', 'or', ['Crito', 'Meno'], 'form', true, undefined);
    expect(screen.getByLabelText('Greek')).toHaveValue('logos');
    expect(screen.getByLabelText('English')).toHaveValue('virtue');
    expect(checked('Only as I typed it', 'matchmode')).toBe(true);
    expect(checked('Any form of this word', 'engforms')).toBe(true);
    expect(checked('Either query')).toBe(true);
  });

  it('shows how a picked headword and an English query combine', async () => {
    const { search } = await import('../lib/search');
    at('/search?l=yuxh&e=soul&op=or');
    render(Search);
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(vi.mocked(search).mock.calls[0].slice(0, 5)).toEqual(['yuxh', 'soul', 'any', 'all', 'or']);
    // The headword is the Greek side of this search, so the Greek + English
    // choice it ran with must be on the page.
    expect(checked('Either query')).toBe(true);
  });

  it('runs the command palette hand-off with every default', async () => {
    const { search } = await import('../lib/search');
    at(`/search?g=${encodeURIComponent('λόγος')}`);
    render(Search);
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search).toHaveBeenCalledWith('λόγος', '', 'all', 'all', 'and', expect.any(Array), 'lemma', true, undefined);
  });

  it('restores a speaker filter and runs the search under it', async () => {
    const { search } = await import('../lib/search');
    at('/search?g=dikh&sp=only&sn=Socrates,Meno');
    render(Search);
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(vi.mocked(search).mock.calls[0][8]).toEqual({ mode: 'only', names: ['Socrates', 'Meno'] });
    expect(checked('Only these speakers')).toBe(true);
  });

  it('restores English "only as I typed it", and writes it as ef=0', async () => {
    const { search } = await import('../lib/search');
    at('/search?e=virtue&ef=0');
    render(Search);
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(vi.mocked(search).mock.calls[0][7]).toBe(false);
    expect(checked('Only as I typed it', 'engforms')).toBe(true);

    await fireEvent.click(screen.getByLabelText('Any form of this word', { selector: 'input[name="engforms"]' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(window.location.search).toBe('?e=virtue');
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    expect(vi.mocked(search).mock.calls[1][7]).toBe(true);

    at('/search?e=virtue&ef=0');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(3));
    expect(vi.mocked(search).mock.calls[2][7]).toBe(false);
  });

  it('pushes each search, and a repeat of it adds no entry', async () => {
    at('/search');
    const push = vi.spyOn(window.history, 'pushState');
    render(Search);
    await fireEvent.input(screen.getByLabelText('English'), { target: { value: 'practical wisdom' } });
    await fireEvent.click(screen.getByLabelText('Any word', { selector: 'input[name="engmode"]' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(window.location.search).toBe('?e=practical%20wisdom&em=any');
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled());
    await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(push).toHaveBeenCalledTimes(1);
    push.mockRestore();
  });

  it('replaces a ?q= arrival when the same search runs again, so Back leaves the page', async () => {
    const { search } = await import('../lib/search');
    at('/search?q=justice');
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');
    render(Search);
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(vi.mocked(search).mock.calls[0].slice(0, 2)).toEqual(['', 'justice']);
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled());
    await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(window.location.search).toBe('?e=justice');
    expect(push).not.toHaveBeenCalled();
    expect(replace).toHaveBeenCalled();
    push.mockRestore();
    replace.mockRestore();
  });

  it('follows the back button, and clears the page on a URL with no search', async () => {
    const { search } = await import('../lib/search');
    at('/search?g=logos');
    render(Search);
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));

    at('/search?e=soul&w=-Laws');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    expect(vi.mocked(search).mock.calls[1].slice(0, 2)).toEqual(['', 'soul']);
    expect(vi.mocked(search).mock.calls[1][5]).not.toContain('Laws');
    expect(screen.getByLabelText('Greek')).toHaveValue('');

    at('/search');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(screen.getByLabelText('English')).toHaveValue(''));
    expect(search).toHaveBeenCalledTimes(2);
  });

  it('restores a proximity search', async () => {
    const { searchCombo } = await import('../lib/search');
    at(`/search?c=l:logos&c=fa:${encodeURIComponent('ἀρετή')}&cu=turn&cx=0`);
    render(Search);
    await vi.waitFor(() => expect(searchCombo).toHaveBeenCalledTimes(1));
    expect(searchCombo).toHaveBeenCalledWith(
      [
        { kind: 'lemma', terms: ['logos'], relation: 'near' },
        { kind: 'form', terms: ['ἀρετή'], relation: 'after' },
      ],
      { window: 5, unit: 'turn', ordered: false, crossTurn: false, speaker: undefined },
      expect.any(Array),
    );
  });

  // A promise and the function that settles it, for holding one load open.
  function held<T>() {
    let settle!: (v: T) => void;
    const promise = new Promise<T>((r) => { settle = r; });
    return { promise, settle };
  }
  const workNames = () => [...document.querySelectorAll('.work-name')].map(n => n.textContent);

  it('drops widened results that arrive after the back button cleared the page', async () => {
    const { search, searchPhraseVariants } = await import('../lib/search');
    const variants = held<Awaited<ReturnType<typeof searchPhraseVariants>>>();
    vi.mocked(searchPhraseVariants).mockReturnValue(variants.promise);
    at(`/search?g=${encodeURIComponent('λόγος ἀρετή')}`);
    render(Search);
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    await fireEvent.click(await screen.findByRole('button', { name: 'Find this phrase in any inflection' }));

    at('/search');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(screen.getByLabelText('Greek')).toHaveValue(''));
    variants.settle({
      results: [{ work: 'Meno', meta: { id: 'seg1', book: 1, column: '1094a' }, grkMatch: true, engMatch: false, grkPositions: [0] }],
      readings: [['logos', 'areth']], productive: [['logos', 'areth']], cappedFrom: 0, failedWorks: [],
    } as Awaited<ReturnType<typeof searchPhraseVariants>>);
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText(/instances?/)).toBeNull();
    expect(screen.queryByText(/Showing every place/)).toBeNull();
  });

  it("drops an older search's page that finishes loading after a newer search", async () => {
    const { search } = await import('../lib/search');
    const { fetchBook } = await import('../lib/data');
    const hit = (work: string) => ({
      results: [{ work, meta: { id: 'seg1', book: 1, column: '1094a' }, grkMatch: true, engMatch: false, grkPositions: [0] }],
      failedWorks: [],
    });
    vi.mocked(search).mockResolvedValueOnce(hit('Meno')).mockResolvedValueOnce(hit('Crito'));
    const bookA = held<typeof fixtureBook>();
    vi.mocked(fetchBook).mockReturnValueOnce(bookA.promise);
    // Only history can start a search while one is loading: the button waits.
    at(`/search?g=${encodeURIComponent('λόγος')}`);
    render(Search);
    await vi.waitFor(() => expect(fetchBook).toHaveBeenCalledTimes(1));
    at(`/search?g=${encodeURIComponent('ἀρετή')}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(workNames()).toEqual([getWork('Crito')!.title]));

    bookA.settle(fixtureBook);
    await new Promise(r => setTimeout(r, 20));
    expect(workNames()).toEqual([getWork('Crito')!.title]);
  });

  it('frees the inflection lookup when a new search retires it', async () => {
    const { search, searchPhraseVariants } = await import('../lib/search');
    vi.mocked(searchPhraseVariants).mockReturnValue(new Promise(() => {}));
    at(`/search?g=${encodeURIComponent('λόγος ἀρετή')}`);
    render(Search);
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    await fireEvent.click(await screen.findByRole('button', { name: 'Find this phrase in any inflection' }));
    await screen.findByRole('button', { name: 'Looking…' });

    await fireEvent.input(screen.getByLabelText('Greek'), { target: { value: 'λόγος τέχνη' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: 'Find this phrase in any inflection' })).toBeEnabled();
  });

  it("keeps a retired inflection lookup's note off a newer search", async () => {
    const { search, searchPhraseVariants } = await import('../lib/search');
    const { fetchBook } = await import('../lib/data');
    vi.mocked(searchPhraseVariants).mockResolvedValue({
      results: [{ work: 'Meno', meta: { id: 'seg1', book: 1, column: '1094a' }, grkMatch: true, engMatch: false, grkPositions: [0] }],
      readings: [['logos', 'areth']], productive: [['logos', 'areth']], cappedFrom: 0, failedWorks: [],
    } as Awaited<ReturnType<typeof searchPhraseVariants>>);
    at(`/search?g=${encodeURIComponent('λόγος ἀρετή')}`);
    render(Search);
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    // The widened results' page is held open while a newer search runs.
    const bookV = held<typeof fixtureBook>();
    vi.mocked(fetchBook).mockReturnValueOnce(bookV.promise);
    await fireEvent.click(await screen.findByRole('button', { name: 'Find this phrase in any inflection' }));
    await vi.waitFor(() => expect(fetchBook).toHaveBeenCalledTimes(2));

    await fireEvent.input(screen.getByLabelText('Greek'), { target: { value: 'λόγος τέχνη' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    bookV.settle(fixtureBook);
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText(/Showing every place/)).toBeNull();
  });

  it('writes the translator filter with replaceState, and restores it', async () => {
    const { search } = await import('../lib/search');
    vi.mocked(search).mockResolvedValue({
      results: [{
        work: 'Meno', meta: { id: 'seg1', book: 1, column: '1094a' },
        grkMatch: false, engMatch: true, grkPositions: [],
        engHits: [{ translation: 'lamb', positions: [0] }, { translation: 'jowett', positions: [2] }],
      }],
      failedWorks: [],
    });
    at('/search?e=virtue');
    const push = vi.spyOn(window.history, 'pushState');
    const { unmount } = render(Search);
    const row = await screen.findByRole('group', { name: 'Show English hits from one translation' });
    await fireEvent.click(within(row).getByRole('button', { name: /^Jowett/ }));
    expect(window.location.search).toBe('?e=virtue&t=jowett');
    expect(push).not.toHaveBeenCalled();
    push.mockRestore();
    unmount();

    const second = render(Search);
    expect(await screen.findByRole('button', { name: /^Jowett/ })).toHaveAttribute('aria-pressed', 'true');

    // A translation this search did not find is dropped from the URL.
    second.unmount();
    at('/search?e=virtue&t=nobody');
    render(Search);
    await screen.findByRole('button', { name: /^Jowett/ });
    expect(window.location.search).toBe('?e=virtue');
  });

  it('writes the works filter with replaceState, and restores it', async () => {
    const { search } = await import('../lib/search');
    const meta = { id: 'seg1', book: 1, column: '1094a' };
    vi.mocked(search).mockResolvedValue({
      results: [
        { work: 'Meno', meta, grkMatch: true, engMatch: false, grkPositions: [0] },
        { work: 'Crito', meta, grkMatch: true, engMatch: false, grkPositions: [0, 1] },
      ],
      failedWorks: [],
    });
    const status = () => screen.getByRole('status');
    at('/search?g=logos');
    const push = vi.spyOn(window.history, 'pushState');
    const { unmount } = render(Search);
    const works = await screen.findByRole('group', { name: 'Show hits from one work' });
    await fireEvent.click(within(works).getByRole('button', { name: /^Crito/ }));
    expect(window.location.search).toBe('?g=logos&wf=Crito');
    expect(push).not.toHaveBeenCalled();
    await fireEvent.click(within(works).getByRole('button', { name: /^Crito/ }));
    expect(window.location.search).toBe('?g=logos');
    push.mockRestore();
    unmount();

    at('/search?g=logos&wf=Crito');
    const second = render(Search);
    const restored = await screen.findByRole('group', { name: 'Show hits from one work' });
    await vi.waitFor(() => expect(within(restored).getByRole('button', { name: /^Crito/ }))
      .toHaveAttribute('aria-pressed', 'true'));
    await vi.waitFor(() => expect(status()).toHaveTextContent('2 instances'));

    at('/search?g=logos');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await vi.waitFor(() => expect(status()).toHaveTextContent('3 instances'));

    // A work this search did not find is dropped from the URL.
    second.unmount();
    at('/search?g=logos&wf=Laws');
    render(Search);
    await screen.findByRole('group', { name: 'Show hits from one work' });
    await vi.waitFor(() => expect(window.location.search).toBe('?g=logos'));
  });
});

describe('Reader.svelte', () => {
  it('marks exactly the Greek tokens a search hit names (?hlt=)', async () => {
    // hlg alone would mark every word beginning λογ; hlt names token 1, ἀρετή.
    window.history.replaceState(null, '', '/EN/book/1?hlg=logos&hlt=1094a:1&loc=1094a:1');
    render(Reader, { props: { work: 'EN', bookNum: 1, bookData: fixtureBook } });
    expect(await screen.findByText('ἀρετή')).toHaveClass('hit');
    expect(screen.getByText('λόγος')).not.toHaveClass('hit');
  });

  it('marks English whole words by the search\'s rule, not every word a term begins', async () => {
    window.history.replaceState(null, '', '/EN/book/1?hle=virtue&hlf=any');
    const { container } = render(Reader, { props: { work: 'EN', bookNum: 1, bookData: fixtureBook } });
    await vi.waitFor(() => expect(container.querySelector('.english-col mark')).toHaveTextContent('Virtue'));
    expect(container.querySelectorAll('.english-col mark')).toHaveLength(1);
  });

  // Smoke test: mounts with fixture book data plus highlight URL params
  // (Greek wildcard + English phrase containing a metacharacter) and renders
  // the fixture prose without throwing in the highlight code paths.
  it('renders fixture book data with highlight params applied', async () => {
    window.history.replaceState(null, '', '/EN/book/1?hlg=λόγ*&hle=virtue%20(test)%20κόσμος&loc=1094a:1');

    render(Reader, { props: { work: 'EN', bookNum: 1, bookData: fixtureBook } });

    // Bekker column from the fixture renders.
    expect(await screen.findByText('1094a')).toBeInTheDocument();
    // Greek token from the fixture renders as a token span.
    expect(screen.getByText('λόγος')).toHaveClass('tok');
    // The English column renders the fixture prose (the highlight code path ran
    // over a phrase containing a parenthesis metacharacter without throwing).
    const main = screen.getByRole('main');
    expect(within(main).getAllByText(/virtue/i).length).toBeGreaterThan(0);
  });

  it('renders sidecar English paragraph markers as paragraph breaks', async () => {
    window.history.replaceState(null, '', '/EN/book/1?trans=rackham');
    const book: BookData = structuredClone(fixtureBook);
    book.segments[0].english = {
      text: 'First paragraph. Second paragraph.',
      notes: [],
      markers: [{ kind: 'paragraph', n: '', offset: 'First paragraph.'.length }],
      bekker: [{ n: 1, offset: 0, real: true }],
    };

    const { container } = render(Reader, { props: { work: 'EN', bookNum: 1, bookData: book } });

    expect(await screen.findByText('First paragraph.')).toBeInTheDocument();
    expect(container.querySelectorAll('.english-col .para-br')).toHaveLength(1);
    expect(screen.getByText(/Second paragraph/)).toBeInTheDocument();
  });

  it('keeps English prose without paragraph markers on the existing flat path', async () => {
    window.history.replaceState(null, '', '/EN/book/1?trans=rackham');
    const book: BookData = structuredClone(fixtureBook);
    book.segments[0].english = {
      text: 'First paragraph. Second paragraph.',
      notes: [],
      markers: [],
      bekker: [{ n: 1, offset: 0, real: true }],
    };

    const { container } = render(Reader, { props: { work: 'EN', bookNum: 1, bookData: book } });

    expect(await screen.findByText(/First paragraph\. Second paragraph\./)).toBeInTheDocument();
    expect(container.querySelectorAll('.english-col .para-br')).toHaveLength(0);
  });

  it('keeps existing sidenote and figure inline markers out of rendered prose', async () => {
    window.history.replaceState(null, '', '/Isa/book/1');
    const book: BookData = structuredClone(fixtureBook);
    book.segments[0].english = {
      text: 'Alpha [[s1]] beta [[fig2]] gamma.',
      notes: [],
      markers: [],
      bekker: [{ n: 1, offset: 0, real: true }],
    };

    const { container } = render(Reader, { props: { work: 'Isa', bookNum: 1, bookData: book } });

    expect(await screen.findByText(/Alpha/)).toBeInTheDocument();
    expect(container.textContent).toContain('Alpha beta gamma.');
    expect(container.textContent).not.toContain('[[s1]]');
    expect(container.textContent).not.toContain('[[fig2]]');
  });
});
