import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import CompareWorks from '../components/CompareWorks.svelte';

// Real rows from build/dist/ngrams/form/occ, trimmed to four phrases, each to
// its first occurrence per work. ἀληθέστατα ἔφη stands at Phaedo 74c and
// Republic 336a; κατὰ τὸ δυνατὸν καὶ ἐν at Phaedo 67c and Republic 619a; τίνα
// τρόπον at Phaedo 73c and Republic 327a; ὡς ἔπος εἰπεῖν is kept in the
// Republic only.
const occ: Record<string, Record<string, Record<string, number[]>>> = {
  'form/a-2': { 'alhqestata efh': { Phaedo: [6238], Republic: [3047] } },
  'form/k-5': { 'kata to dunaton kai en': { Phaedo: [3616], Republic: [87474] } },
  'form/t-2': { 'tina tropon': { Phaedo: [5831], Republic: [18], Laws: [5] } },
  'form/w-3': { 'ws epos eipein': { Republic: [100], Laws: [7] } },
};

vi.mock('../lib/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/data')>();
  return {
    ...actual,
    fetchNgramOccurrences: vi.fn(async (stream: string, letter: string, n: number) => occ[`${stream}/${letter}-${n}`] ?? {}),
  };
});

// Each work's offsets cut to the sections those offsets fall in.
const offsets: Record<string, unknown> = {
  Phaedo: {
    token_count: 22356, seg_base_offset: [0, 3553, 5796, 6179],
    segments: [{ book: 1, column: '57a' }, { book: 1, column: '67c' }, { book: 1, column: '73c' }, { book: 1, column: '74c' }],
    book_bounds: [{ book: 1, start: 0 }], turn_bounds: [],
  },
  Republic: {
    token_count: 88260, seg_base_offset: [0, 3002, 87414],
    segments: [{ book: 1, column: '327a' }, { book: 1, column: '336a' }, { book: 10, column: '619a' }],
    book_bounds: [{ book: 1, start: 0 }], turn_bounds: [],
  },
};

vi.mock('../lib/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/search')>();
  return { ...actual, loadOffsets: vi.fn(async (work: string) => offsets[work]) };
});

describe('Compare works', () => {
  it('lists the phrases Phaedo and Republic share, with both works\' citations', async () => {
    const { container } = render(CompareWorks, { props: { occFiles: { form: ['a-2', 'k-5', 't-2', 'w-3'] } } });
    const [first, second] = screen.getAllByRole('combobox').slice(0, 2);
    await fireEvent.change(first, { target: { value: 'Phaedo' } });
    await fireEvent.change(second, { target: { value: 'Republic' } });
    // Only ἀληθέστατα ἔφη has two words that are not grammatical words: the
    // others are hidden by default, and shown on request.
    expect(await screen.findByText('1 shared phrase')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Hide phrases of common words only' }));
    expect(await screen.findByText('3 shared phrases')).toBeInTheDocument();
    // By frequency, then alphabetically: all three stand once in each work.
    const rows = [...container.querySelectorAll('tbody tr')].map((tr) => ({
      phrase: tr.querySelector('th')!.textContent,
      phaedo: [...tr.querySelectorAll('td[data-work="Phaedo"] a')].map((a) => a.textContent),
      republic: [...tr.querySelectorAll('td[data-work="Republic"] a')].map((a) => a.getAttribute('href')),
    }));
    expect(rows).toEqual([
      { phrase: 'αληθεστατα εφη', phaedo: ['74c'], republic: ['/Republic/book/1?loc=336a'] },
      { phrase: 'κατα το δυνατον και εν', phaedo: ['67c'], republic: ['/Republic/book/10?loc=619a'] },
      { phrase: 'τινα τροπον', phaedo: ['73c'], republic: ['/Republic/book/1?loc=327a'] },
    ]);
    expect(screen.queryByText('ως επος ειπειν')).toBeNull();
  });
});
