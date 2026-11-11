import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CompareWorks from '../components/CompareWorks.svelte';

// Real rows from build/dist/ngrams/form/occ, trimmed to four phrases, each to
// its first occurrence per work. ἀληθέστατα ἔφη stands at Phaedo 74c and
// Republic 336a; κατὰ τὸ δυνατὸν καὶ ἐν at Phaedo 67c and Republic 619a; τίνα
// τρόπον at Phaedo 73c and Republic 327a; ὡς ἔπος εἰπεῖν is kept in the
// Republic only. καὶ γάρ (Phaedo 57a, Republic 327a by these cut offsets) is
// grammatical words only. The rest of the k-2 and t-2 rows are the review's
// phrases, each a grammatical word beside a content word or a word a content
// word also spells: τὸ ἕν, τὸν Δία, τὰ ἄλλα, πάνυ γε; and μὲν οὖν.
let reviewRows = false;
const occ: Record<string, Record<string, Record<string, number[]>>> = {
  'form/a-2': { 'alhqestata efh': { Phaedo: [6238], Republic: [3047] } },
  'form/k-2': { 'kai gar': { Phaedo: [41], Republic: [1971] } },
  'form/k-5': { 'kata to dunaton kai en': { Phaedo: [3616], Republic: [87474] } },
  'form/t-2': { 'tina tropon': { Phaedo: [5831], Republic: [18], Laws: [5] } },
  'form/t-2+': {
    'to en': { Phaedo: [14499], Republic: [17745] },
    'ton dia': { Phaedo: [1000], Republic: [548] },
    'ta alla': { Phaedo: [19150], Republic: [22829] },
  },
  'form/p-2': { 'panu ge': { Phaedo: [2381], Republic: [1517] } },
  'form/m-2': { 'men oun': { Phaedo: [1445], Republic: [26] } },
  'form/w-3': { 'ws epos eipein': { Republic: [100], Laws: [7] } },
};

vi.mock('../lib/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/data')>();
  return {
    ...actual,
    fetchNgramOccurrences: vi.fn(async (stream: string, letter: string, n: number) => {
      const stem = `${stream}/${letter}-${n}`;
      return { ...occ[stem], ...(reviewRows ? occ[`${stem}+`] : {}) };
    }),
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

// Real lemma-map entries (build/dist/lemma-map) for every word above.
const lemmaMap: Record<string, Record<string, string[]>> = {
  a: { alhqestata: ['alhqhs'], alla: ['alla', 'allos'] },
  d: { dunaton: ['dunatos'], dia: ['dia', 'dih', 'dios', 'zeus'] },
  e: { efh: ['fhmi'], en: ['eimi', 'eis', 'en', 'ihmi'] },
  g: { gar: ['gar'], ge: ['ge'] },
  k: { kai: ['kai'], kata: ['eita', 'kata'] },
  m: { men: ['men'] },
  o: { oun: ['oun'] },
  p: { panu: ['panu'] },
  t: { to: ['o'], ton: ['o'], ta: ['o', 'tis'], tina: ['tis'], tropon: ['tropos'] },
};

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation((url) => {
    const map = String(url).match(/lemma-map\/([a-z_])\.json$/);
    if (map) return Promise.resolve({ ok: true, json: async () => lemmaMap[map[1]] ?? {} } as Response);
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
  });
});
afterEach(() => vi.restoreAllMocks());

describe('Compare works', () => {
  it('lists the phrases Phaedo and Republic share, with both works\' citations', async () => {
    const { container } = render(CompareWorks, { props: { occFiles: { form: ['a-2', 'k-2', 'k-5', 't-2', 'w-3'] } } });
    const [first, second] = screen.getAllByRole('combobox').slice(0, 2);
    await fireEvent.change(first, { target: { value: 'Phaedo' } });
    await fireEvent.change(second, { target: { value: 'Republic' } });
    // Only καὶ γάρ is grammatical words alone: hidden by default, and shown
    // on request.
    expect(await screen.findByText('3 shared phrases')).toBeInTheDocument();
    expect(screen.queryByText('και γαρ')).toBeNull();
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Hide phrases of common words only' }));
    expect(await screen.findByText('4 shared phrases')).toBeInTheDocument();
    // By frequency, then alphabetically: all four stand once in each work.
    const rows = [...container.querySelectorAll('tbody tr')].map((tr) => ({
      phrase: tr.querySelector('th')!.textContent,
      phaedo: [...tr.querySelectorAll('td[data-work="Phaedo"] a')].map((a) => a.textContent),
      republic: [...tr.querySelectorAll('td[data-work="Republic"] a')].map((a) => a.getAttribute('href')),
    }));
    expect(rows).toEqual([
      { phrase: 'αληθεστατα εφη', phaedo: ['74c'], republic: ['/Republic/book/1?loc=336a'] },
      { phrase: 'και γαρ', phaedo: ['57a'], republic: ['/Republic/book/1?loc=327a'] },
      { phrase: 'κατα το δυνατον και εν', phaedo: ['67c'], republic: ['/Republic/book/10?loc=619a'] },
      { phrase: 'τινα τροπον', phaedo: ['73c'], republic: ['/Republic/book/1?loc=327a'] },
    ]);
    expect(screen.queryByText('ως επος ειπειν')).toBeNull();
  });

  it('keeps τὸ ἕν, τὸν Δία, τὰ ἄλλα and πάνυ γε, and hides καὶ γάρ and μὲν οὖν', async () => {
    reviewRows = true;
    render(CompareWorks, { props: { occFiles: { form: ['k-2', 'm-2', 'p-2', 't-2'] } } });
    const [first, second] = screen.getAllByRole('combobox').slice(0, 2);
    await fireEvent.change(first, { target: { value: 'Phaedo' } });
    await fireEvent.change(second, { target: { value: 'Republic' } });
    expect(await screen.findByText('5 shared phrases')).toBeInTheDocument();
    for (const p of ['το εν', 'τον δια', 'τα αλλα', 'πανυ γε', 'τινα τροπον']) expect(screen.getByText(p)).toBeInTheDocument();
    for (const p of ['και γαρ', 'μεν ουν']) expect(screen.queryByText(p)).toBeNull();
    reviewRows = false;
  });
});
