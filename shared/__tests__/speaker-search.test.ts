import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Search from '../components/Search.svelte';
import type { SpeakerRegistry } from '../lib/data';

// Two works: one attributed, one narrated. The narrated one is the Republic,
// because that is the case that matters — the dialogue people most want to ask
// a speaker question of is the one a speaker filter cannot reach.
const registry: SpeakerRegistry = {
  works: 2,
  tokens: 1000,
  turns: 10,
  speakers: {
    Socrates: { tokens: 300, turns: 6, works: { Theaetetus: { tokens: 300, turns: 6 } } },
  },
  reserved: {
    none: { id: 0, tokens: 700, turns: 0, works: { Republic: { tokens: 700, turns: 0 } } },
    unknown: { id: 1, tokens: 0, turns: 0, works: {} },
  },
};

const fixtureBook = {
  book: 1,
  segments: [
    {
      id: 'seg1',
      column: '166a',
      greek: [
        {
          n: 1,
          text: 'ἀρετή λόγος',
          tokens: [{ t: 'ἀρετή', o: 0, k: 'areth' }, { t: 'λόγος', o: 6, k: 'logos' }],
        },
      ],
      english: { text: 'Virtue and reason.', notes: [], markers: [], bekker: [{ n: 1, offset: 0, real: true }] },
      chapterStarts: [],
      third: [],
    },
  ],
};

// The outcome the committed library returns: two hits in one segment, the
// second of them inside a line-snapped turn window, and the Republic skipped
// for carrying no attribution at all.
const { searchSpeaker } = vi.hoisted(() => ({
  searchSpeaker: vi.fn(async () => ({
    results: [
      {
        work: 'Theaetetus',
        meta: {
          id: 'seg1', book: 1, column: '166a',
          greek_head: 'ἀρετή', greek_tokens: 'areth', english_head: 'Virtue and reason.',
        },
        grkMatch: true,
        engMatch: false,
        grkPositions: [0, 1],
        engPositions: [],
        speakers: [
          { label: 'Socrates', settled: true },
          { label: 'Theodorus', settled: false },
        ],
      },
    ],
    failedWorks: [],
    coverage: {
      searched: ['Theaetetus'],
      skipped: ['Republic'],
      tokensSearched: 300,
      tokensSkipped: 700,
    },
  })),
}));

vi.mock('../lib/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/search')>();
  // `search` is mocked too, so "the speaker branch ran instead of the plain
  // one" is an assertion rather than an assumption.
  return { ...actual, searchSpeaker, search: vi.fn(async () => []) };
});

vi.mock('../lib/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/data')>();
  return {
    ...actual,
    fetchSpeakerRegistry: vi.fn(async () => JSON.parse(JSON.stringify(registry))),
    fetchBook: vi.fn(async () => fixtureBook),
    fetchSections: vi.fn(async () => ({
      '1': [{ column: '166a', page: 166, letter: 'a', id: '166a' }],
    })),
    fetchChapters: vi.fn(async () => ({})),
  };
});

// Open the advanced tools, tick Socrates, type a Greek word, search.
async function searchAsSocrates() {
  render(Search);
  await fireEvent.click(screen.getByRole('button', { name: /Advanced search/ }));
  await fireEvent.click(screen.getByText('In whose mouth'));
  const socrates = await screen.findByRole('checkbox', { name: /Socrates/ });
  await fireEvent.click(socrates);
  await fireEvent.input(screen.getByLabelText('Greek'), { target: { value: 'areth' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await vi.waitFor(() => expect(searchSpeaker).toHaveBeenCalled());
}

// Result groups holding more than one hit start collapsed, so the per-hit
// markers are behind their group head.
async function openFirstGroup() {
  const head = await screen.findByRole('button', { name: /instances/ });
  await fireEvent.click(head);
}

// The markup wraps, so compare on collapsed whitespace rather than on the
// accidents of where the template broke its lines.
const flat = (el: HTMLElement | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('Search.svelte: the speaker filter', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });
  afterEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('routes a filtered query through searchSpeaker, not the plain search', async () => {
    const { search } = await import('../lib/search');
    await searchAsSocrates();
    expect(searchSpeaker).toHaveBeenCalledWith('areth', 'all', expect.any(Array), { include: ['Socrates'] }, 'lemma');
    expect(search).not.toHaveBeenCalled();
  });

  it('flips to an exclude filter without changing the ticked speakers', async () => {
    render(Search);
    await fireEvent.click(screen.getByRole('button', { name: /Advanced search/ }));
    await fireEvent.click(screen.getByText('In whose mouth'));
    await fireEvent.click(await screen.findByRole('checkbox', { name: /Socrates/ }));
    await fireEvent.click(screen.getByRole('radio', { name: 'Everyone except these' }));
    await fireEvent.input(screen.getByLabelText('Greek'), { target: { value: 'areth' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await vi.waitFor(() => expect(searchSpeaker).toHaveBeenCalled());
    expect(searchSpeaker).toHaveBeenCalledWith('areth', 'all', expect.any(Array), { exclude: ['Socrates'] }, 'lemma');
  });

  // The whole point. A result set that silently omits the Republic is a lie by
  // omission, so the omission has to be on the page, in the open, beside the
  // count it changes — not in a tooltip or behind a disclosure triangle.
  it('names the skipped works beside the results', async () => {
    await searchAsSocrates();
    const coverage = await screen.findByRole('status');
    expect(flat(coverage)).toContain('Left out: Republic');
    expect(flat(coverage)).toContain('700');
    expect(flat(coverage)).toContain('Searched 1 of 2 works');
    // Visible text, not a title attribute or a collapsed <details>.
    expect(coverage.closest('details')).toBeNull();
  });

  it('says nothing was skipped when nothing was', async () => {
    searchSpeaker.mockResolvedValueOnce({
      results: [],
      failedWorks: [],
      coverage: { searched: ['Theaetetus'], skipped: [], tokensSearched: 300, tokensSkipped: 0 },
    } as unknown as Awaited<ReturnType<typeof searchSpeaker>>);
    await searchAsSocrates();
    const coverage = await screen.findByRole('status');
    expect(flat(coverage)).toContain('none skipped');
    expect(flat(coverage)).not.toContain('Left out');
  });

  // Attribution inside a line-snapped turn window may belong to the speaker
  // before, so it is marked rather than asserted — the same convention the
  // grammatical one-of-N marker uses.
  it('marks a hit whose attribution is not settled, and leaves a settled one plain', async () => {
    await searchAsSocrates();
    await openFirstGroup();
    const chips = await screen.findAllByText(/Socrates|Theodorus/, { selector: '.inst-speaker' });
    const settled = chips.find((c) => flat(c) === 'Socrates')!;
    const unsettled = chips.find((c) => flat(c).startsWith('Theodorus'))!;
    expect(settled.className).not.toContain('unsettled');
    expect(flat(unsettled)).toBe('Theodorus · attribution not settled');
    expect(unsettled.className).toContain('unsettled');
  });

  // Greek only: the column carries one id per Greek token and an English char
  // offset has no exact attribution, so the box is disabled rather than ignored.
  it('disables the English box while a speaker is chosen', async () => {
    render(Search);
    await fireEvent.click(screen.getByRole('button', { name: /Advanced search/ }));
    await fireEvent.click(screen.getByText('In whose mouth'));
    expect(screen.getByLabelText('English')).not.toBeDisabled();
    await fireEvent.click(await screen.findByRole('checkbox', { name: /Socrates/ }));
    await vi.waitFor(() => expect(screen.getByLabelText('English')).toBeDisabled());
  });
});
