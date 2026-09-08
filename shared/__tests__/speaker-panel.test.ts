import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Search from '../components/Search.svelte';
import { WORKS } from '../lib/works';

// The roster the panel shows is read from each selected work's offsets.json.
// Two fixture casts: every work gets Socrates, and one adds Glaucon, so the
// aggregated list has to sum turns across works and sort by them.
const socrates = { book: 1, speaker: 'Socrates', start: 0, accuracy: 'exact' };
const glaucon = { book: 1, speaker: 'Glaucon', start: 5, accuracy: 'exact' };
const offsetsFor = (work: string) => ({
  token_count: 10,
  seg_base_offset: [0],
  segments: [{ book: 1, column: '1a', line_runs: [[1, 10]] }],
  book_bounds: [{ book: 1, start: 0 }],
  // The Republic is narrated in the real corpus: no labels, no cast.
  turn_bounds: work === 'Republic' ? [] : work === 'Gorgias' ? [socrates, glaucon, { ...socrates, start: 8 }] : [socrates],
});

function json(data: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(data) } as Response);
}

describe('Search.svelte — Spoken by', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
      const path = String(url);
      const work = path.split('/data/')[1]?.split('/')[0] ?? '';
      if (path.endsWith('/offsets.json')) return json(offsetsFor(work));
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('fetches nothing until a mode is chosen, then lists the cast most-spoken first', async () => {
    render(Search);
    await fireEvent.click(screen.getByRole('button', { name: /Spoken by/ }));
    expect(screen.getByRole('radio', { name: 'Anyone' })).toBeChecked();
    const calls = () => (fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => String(c[0]));
    expect(calls().some((u) => u.endsWith('/offsets.json'))).toBe(false);

    await fireEvent.click(screen.getByRole('radio', { name: 'Only these speakers' }));
    // One offsets fetch per registered work, and no other file.
    const socratesChip = await screen.findByRole('button', { name: /^Socrates/ });
    expect(calls().filter((u) => u.endsWith('/offsets.json'))).toHaveLength(WORKS.length);
    expect(calls().every((u) => u.endsWith('/offsets.json'))).toBe(true);

    // Socrates speaks in every labelled work (twice in Gorgias); Glaucon once.
    // The reported dialogues (works.ts `narrator`) contribute no chips: their
    // labels are the frame, and the filter leaves them out.
    const reported = WORKS.filter((w) => w.narrator);
    const chips = screen.getAllByRole('button', { pressed: false }).filter((b) =>
      /^(Socrates|Glaucon)/.test(b.textContent ?? ''));
    expect(chips.map((b) => b.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      `Socrates ${WORKS.length - reported.length}`,
      'Glaucon 1',
    ]);
    expect(socratesChip).toHaveAttribute('aria-pressed', 'false');

    // The narrated work is named as left out, and the reported ones apart from it.
    expect(screen.getByText(/Republic is narrated without speaker labels/)).toBeInTheDocument();
    expect(screen.getByText(/Phaedo \(Phaedo\), Symposium \(Apollodorus\).*reported by a narrator/)).toBeInTheDocument();
  });

  it('ticking a name arms the filter and the summary says so', async () => {
    render(Search);
    await fireEvent.click(screen.getByRole('button', { name: /Spoken by/ }));
    await fireEvent.click(screen.getByRole('radio', { name: 'Anyone but these' }));
    const glaucon = await screen.findByRole('button', { name: /^Glaucon/ });
    await fireEvent.click(glaucon);
    expect(glaucon).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Spoken by/ })).toHaveTextContent('Anyone but Glaucon');
    await fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(glaucon).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Spoken by/ })).toHaveTextContent('pick a speaker');
  });
});
