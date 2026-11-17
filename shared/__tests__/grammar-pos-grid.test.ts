// Part of speech in the combo's grammar grid (John, 2026-11-10, option A1):
// it replaces Morpheus's raw "Word class" row, offers readers' words for the
// abbreviated classes, and a link from before carrying the old row's
// `marker` tag loses it rather than filtering on a row nobody can see.
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Search from '../components/Search.svelte';

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

afterEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

const URL_WITH_MARKER = `/search?c=${encodeURIComponent('f:alpha')}&c=${encodeURIComponent('g:marker.adverb,case.nom')}`;

// The editor opens from Proximity, and a term's grid from its Change link.
async function openGrid(container: HTMLElement) {
  await fireEvent.click(await screen.findByRole('button', { name: /^Proximity/ }));
  const change = await vi.waitFor(() => {
    const b = container.querySelector<HTMLElement>('.prox-gx');
    expect(b).not.toBeNull();
    return b!;
  });
  await fireEvent.click(change);
  return container.querySelector('.combo-grammar-grid') as HTMLElement;
}

describe('the grammar grid', () => {
  it('offers Part of speech beside Case, in readers\' words, and the other classes as the word class', async () => {
    window.history.replaceState(null, '', URL_WITH_MARKER);
    const { container } = render(Search);
    const grid = await openGrid(container);
    // Part of speech picks among the declined classes; the others (which take
    // no case or tense) are chosen as the word class.
    const pos = within(grid).getByLabelText('Part of speech for term 2') as HTMLSelectElement;
    expect([...pos.options].map(o => [o.value, o.text])).toEqual([
      ['', 'any'], ['noun', 'noun'], ['adj', 'adjective'], ['article', 'article'], ['pronoun', 'pronoun'],
    ]);
    const cls = within(grid).getByLabelText('Word class for term 2') as HTMLSelectElement;
    expect([...cls.options].map(o => [o.value, o.text])).toEqual([
      ['declined word', 'declined word'], ['verb', 'verb'], ['adverb', 'adverb'], ['prep', 'preposition'],
      ['conj', 'conjunction'], ['particle', 'particle'], ['exclam', 'interjection'], ['numeral', 'numeral'], ['letter', 'letter'],
    ]);
  });

  it('a class that takes no case is the word class, and its grid has no Case row', async () => {
    window.history.replaceState(null, '', `/search?c=${encodeURIComponent('f:alpha')}&c=${encodeURIComponent('g:pos.adverb')}`);
    const { container } = render(Search);
    const grid = await openGrid(container);
    expect((within(grid).getByLabelText('Word class for term 2') as HTMLSelectElement).value).toBe('adverb');
    expect(within(grid).queryByLabelText('Case for term 2')).toBeNull();
  });

  it('drops an old link\'s word-class tag instead of filtering on it unseen', async () => {
    window.history.replaceState(null, '', URL_WITH_MARKER);
    render(Search);
    const { searchCombo } = await import('../lib/search');
    await vi.waitFor(() => expect(vi.mocked(searchCombo)).toHaveBeenCalled());
    const slots = vi.mocked(searchCombo).mock.calls[0][0];
    expect(slots.find(s => s.kind === 'grammatical')).toMatchObject({ query: { case: 'nom' } });
    expect(JSON.stringify(slots)).not.toContain('marker');
  });
});
