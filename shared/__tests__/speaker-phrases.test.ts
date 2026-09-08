import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Phrases from '../components/Phrases.svelte';
import type { NgramRow, SpeakerRegistry } from '../lib/data';

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

const shards: Record<string, Record<string, NgramRow>> = {
  'lemma/p': { 'panu men oun': [3, 5, 100.0, 2] },
};

// One phrase, five occurrences: three in an attributed work and two in the
// narrated one. Under a speaker filter the attributed work keeps two of its
// three, and the narrated work can answer nothing at all — a different fact
// from "none of them is Socrates".
const occurrences = {
  'panu men oun': { Theaetetus: [10, 10, 10], Republic: [100, 50] },
};

const { shardCalls, filterCalls } = vi.hoisted(() => ({
  shardCalls: [] as string[],
  filterCalls: [] as string[],
}));

vi.mock('../lib/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/data')>();
  return {
    ...actual,
    fetchSpeakerRegistry: vi.fn(async () => JSON.parse(JSON.stringify(registry))),
    fetchNgramShard: vi.fn(async (stream: string, letter: string) => {
      shardCalls.push(`${stream}/${letter}`);
      return shards[`${stream}/${letter}`] ?? {};
    }),
    fetchNgramOccurrences: vi.fn(async () => occurrences),
  };
});

vi.mock('../lib/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/search')>();
  return {
    ...actual,
    speakerFilterOccurrences: vi.fn(async (work: string, globals: number[]) => {
      filterCalls.push(work);
      if (work === 'Republic') return { offsets: [], speakers: [], attributable: false };
      return {
        offsets: globals.slice(0, 2),
        speakers: [
          { label: 'Socrates', settled: true },
          { label: 'Theodorus', settled: false },
        ],
        attributable: true,
      };
    }),
  };
});

function json(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response);
}

const offsets = {
  token_count: 1000,
  seg_base_offset: [0],
  segments: [{ book: 1, column: '166a', line_runs: [[1, 1000]] }],
  book_bounds: [{ book: 1, start: 0 }],
  turn_bounds: [],
};

const flat = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

// Type the phrase in dictionary-form mode, tick Socrates, open the row.
async function openRowAsSocrates({ pickSpeaker = true } = {}) {
  render(Phrases);
  await fireEvent.click(screen.getByRole('radio', { name: 'Word in any of its forms' }));
  if (pickSpeaker) {
    await fireEvent.click(await screen.findByRole('checkbox', { name: /Socrates/ }));
  }
  await fireEvent.input(screen.getByRole('searchbox'), { target: { value: 'panu men oun' } });
  await vi.waitFor(() => expect(shardCalls.length).toBeGreaterThan(0));
  const row = await screen.findByText('πανυ μεν ουν', { selector: '.phrase-greek' });
  await fireEvent.click(row);
}

describe('Phrases.svelte: the speaker filter', () => {
  beforeEach(() => {
    shardCalls.length = 0;
    filterCalls.length = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const path = String(url);
      if (path.endsWith('offsets.json')) return json(offsets);
      if (/lemma-map\//.test(path)) return json({});
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('leaves the occurrences alone when no speaker is chosen', async () => {
    await openRowAsSocrates({ pickSpeaker: false });
    // All five occurrences, both works, and the speaker column never touched.
    const links = await screen.findAllByRole('link', { name: '166a' });
    expect(links).toHaveLength(5);
    expect(filterCalls).toHaveLength(0);
    expect(document.querySelector('.cite-speaker')).toBeNull();
  });

  it('narrows a phrase’s occurrences to the chosen mouth and names the speaker', async () => {
    await openRowAsSocrates();
    await vi.waitFor(() => expect(filterCalls).toContain('Theaetetus'));
    // Three occurrences in the work, two of them in the mouth asked for.
    const heading = await vi.waitFor(() => {
      const h = screen.getByText('Theaetetus', { selector: '.work-heading h3' });
      return h.parentElement!;
    });
    expect(flat(heading)).toContain('2 of 3');
    expect(await screen.findByText('Socrates', { selector: '.cite-speaker' })).toBeInTheDocument();
  });

  // An unsettled attribution is marked rather than asserted, the same way the
  // search page marks one.
  it('marks an occurrence whose attribution is not settled', async () => {
    await openRowAsSocrates();
    const marks = await screen.findAllByText(/Theodorus/, { selector: '.cite-speaker' });
    expect(marks[0].className).toContain('unsettled');
    expect(await screen.findByText(/located only to the line/)).toBeInTheDocument();
  });

  // Not "no matches": the Republic cannot answer a speaker question at all, and
  // a silent zero would read as "nobody says it here".
  it('says a narrated work cannot answer rather than showing it empty', async () => {
    await openRowAsSocrates();
    const note = await screen.findByText(/carries no speaker attribution/);
    expect(flat(note)).toContain('Republic');
    expect(flat(note)).toContain('2 occurrences here');
  });

  // Ticking a speaker must not appear to prune the list of phrases, because it
  // does not — and a reader who sees the rows unchanged is owed the reason.
  it('says plainly that it narrows occurrences, not the list of phrases', async () => {
    render(Phrases);
    const scope = await screen.findByText(/narrows/, { selector: '.speaker-scope' });
    expect(flat(scope)).toContain('not which phrases are listed');
  });

  // Attribution is per Greek token; an English char offset has none.
  it('refuses the filter on the English stream and says why', async () => {
    render(Phrases);
    await fireEvent.click(screen.getByRole('radio', { name: 'English translation' }));
    expect(await screen.findByText(/The English list cannot be filtered by speaker/))
      .toBeInTheDocument();
  });
});
