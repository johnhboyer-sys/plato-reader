import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SpeakerPicker from '../components/SpeakerPicker.svelte';
import type { SpeakerRegistry } from '../lib/data';

// The registry the picker is built from, cut to what these tests touch and
// shaped exactly like the emitted one. Republic and Apology carry only `none`
// tokens — they are the narrated works. Lysis appears under `unknown` and under
// no name at all, which is the case a picker built on names alone gets wrong.
const registry: SpeakerRegistry = {
  works: 4,
  tokens: 1000,
  turns: 40,
  speakers: {
    // Deliberately NOT in token order in the source object, and Theaetetus has
    // more turns than Socrates while saying a third as much — so a list ordered
    // by turns would put the wrong voice first.
    Theaetetus: { tokens: 100, turns: 30, works: { Theaetetus: { tokens: 100, turns: 30 } } },
    Socrates: { tokens: 300, turns: 6, works: { Theaetetus: { tokens: 300, turns: 6 } } },
  },
  reserved: {
    none: {
      id: 0,
      tokens: 550,
      turns: 0,
      works: {
        Republic: { tokens: 400, turns: 0 },
        Apology: { tokens: 150, turns: 0 },
        Lysis: { tokens: 0, turns: 0 },
      },
    },
    unknown: {
      id: 1,
      tokens: 50,
      turns: 4,
      works: { Lysis: { tokens: 50, turns: 4 } },
    },
  },
};

function json(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response);
}

// data.ts caches the registry for the life of the module, so the fetch spy is
// only reached by the first test. Mock the module and hand back a fresh copy.
vi.mock('../lib/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/data')>();
  return {
    ...actual,
    fetchSpeakerRegistry: vi.fn(async () => JSON.parse(JSON.stringify(registry))),
  };
});

async function mount(props: Record<string, unknown> = {}) {
  const view = render(SpeakerPicker, { props });
  await screen.findByRole('checkbox', { name: /Socrates/ });
  return view;
}

describe('SpeakerPicker', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => json(registry));
  });
  afterEach(() => vi.restoreAllMocks());

  // Turns vary wildly in length — a narrator's single turn can outweigh
  // hundreds of one-word assents — so prominence has to mean tokens.
  it('orders speakers by how much they say, not how often', async () => {
    await mount();
    const names = screen.getAllByRole('checkbox')
      .map((box) => box.closest('label')?.textContent?.trim() ?? '')
      .filter((text) => /Socrates|Theaetetus/.test(text));
    expect(names[0]).toMatch(/Socrates/);
    expect(names[1]).toMatch(/Theaetetus/);
  });

  // The coverage gap is knowable from the registry alone, so there is no excuse
  // for waiting until a result set has quietly dropped a fifth of the corpus.
  it('names the works a speaker filter cannot reach, before any query runs', async () => {
    await mount();
    const coverage = await screen.findByText(/A speaker filter cannot reach/);
    expect(coverage.textContent).toContain('Apology');
    expect(coverage.textContent).toContain('Republic');
    // 550 of 1000 tokens sit in `none`, but only 400 + 150 belong to works with
    // no attribution at all — Lysis has real turns and must not be counted here.
    expect(coverage.textContent).not.toContain('Lysis');
    expect(coverage.textContent).toContain('550');
    expect(coverage.textContent).toContain('55%');
  });

  // A picker built on named speakers alone reports Lysis as narrated, because
  // every one of its speeches is unlabelled and lands in the reserved bucket
  // rather than under any name. Its 50 tokens must not join the skipped total.
  it('does not mistake an all-unnamed work for a narrated one', async () => {
    await mount();
    const coverage = await screen.findByText(/A speaker filter cannot reach/);
    expect(coverage.textContent).toMatch(/Apology[^.]*Republic|Republic[^.]*Apology/);
    expect(coverage.textContent).not.toContain('Lysis');
    // 400 + 150, not 550 + Lysis's 50.
    expect(coverage.textContent).toContain('550');
  });

  // Two different answers, and neither of them is "unknown".
  it('offers both reserved ids and keeps them distinct', async () => {
    await mount();
    const narration = screen.getByRole('checkbox', { name: /Narration, not a speech/ });
    const unnamed = screen.getByRole('checkbox', { name: /A speech the text leaves unnamed/ });
    expect(narration).not.toBe(unnamed);
    expect((narration as HTMLInputElement).value).toBe('(not in a speech)');
    expect((unnamed as HTMLInputElement).value).toBe('(unnamed speaker)');
    // Neither is described as "unknown" anywhere the reader can see it.
    const reserved = narration.closest('.speaker-reserved') as HTMLElement;
    expect(within(reserved).queryByText(/unknown/i)).toBeNull();
  });

  it('reports the reserved ids as filter members when ticked', async () => {
    await mount();
    const unnamed = screen.getByRole('checkbox', { name: /A speech the text leaves unnamed/ });
    await fireEvent.click(unnamed);
    expect(unnamed).toBeChecked();
    // The value bound into the filter is the constant search.ts names, not the
    // prose the reader sees.
    expect((unnamed as HTMLInputElement).value).toBe('(unnamed speaker)');
    expect(await screen.findByRole('button', { name: 'Clear speakers (1)' })).toBeInTheDocument();
  });

  // "Only these" and "everyone except these" are opposite questions, and the
  // difference has to be readable rather than inferred from a plus or a minus.
  it('offers include and exclude as plain alternatives', async () => {
    await mount();
    const only = screen.getByRole('radio', { name: 'Only these speakers' });
    const except = screen.getByRole('radio', { name: 'Everyone except these' });
    expect(only).toBeChecked();
    await fireEvent.click(except);
    expect(except).toBeChecked();
    expect(only).not.toBeChecked();
  });

  it('clears the selection with a button carrying the count', async () => {
    await mount();
    const socrates = screen.getByRole('checkbox', { name: /Socrates/ });
    const theaetetus = screen.getByRole('checkbox', { name: /Theaetetus/ });
    await fireEvent.click(socrates);
    await fireEvent.click(theaetetus);
    const clear = await screen.findByRole('button', { name: 'Clear speakers (2)' });
    await fireEvent.click(clear);
    expect(socrates).not.toBeChecked();
    expect(theaetetus).not.toBeChecked();
    expect(screen.queryByRole('button', { name: /Clear speakers/ })).toBeNull();
  });

  it('says why it is unusable rather than rendering a dead control', async () => {
    render(SpeakerPicker, {
      props: { disabled: true, disabledNote: 'The English list cannot be filtered by speaker.' },
    });
    expect(await screen.findByText(/The English list cannot be filtered by speaker/))
      .toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
