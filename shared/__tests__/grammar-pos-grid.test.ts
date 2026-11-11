// Part of speech in the combo's grammar grid (John, 2026-11-10, option A1):
// it replaces Morpheus's raw "Word class" row, offers readers' words for the
// abbreviated classes, and a link from before carrying the old row's
// `marker` tag loses it rather than filtering on a row nobody can see.
import { render, screen, within } from '@testing-library/svelte';
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

describe('the grammar grid', () => {
  it('offers Part of speech in place of Word class, in readers\' words', async () => {
    window.history.replaceState(null, '', URL_WITH_MARKER);
    const { container } = render(Search);
    await vi.waitFor(() => expect(container.querySelector('.combo-grammar-grid')).not.toBeNull());
    const grid = container.querySelector('.combo-grammar-grid') as HTMLElement;
    expect(within(grid).queryByText('Word class')).toBeNull();
    const pos = within(grid).getByLabelText('Part of speech') as HTMLSelectElement;
    const options = [...pos.options].map(o => [o.value, o.text]);
    expect(options).toEqual([
      ['', 'any'], ['noun', 'noun'], ['verb', 'verb'], ['adj', 'adjective'], ['article', 'article'],
      ['pronoun', 'pronoun'], ['adverb', 'adverb'], ['prep', 'preposition'], ['conj', 'conjunction'],
      ['particle', 'particle'], ['exclam', 'interjection'], ['numeral', 'numeral'], ['letter', 'letter'],
    ]);
  });

  it('drops an old link\'s word-class tag instead of filtering on it unseen', async () => {
    window.history.replaceState(null, '', URL_WITH_MARKER);
    render(Search);
    const { searchCombo } = await import('../lib/search');
    await vi.waitFor(() => expect(vi.mocked(searchCombo)).toHaveBeenCalled());
    const slots = vi.mocked(searchCombo).mock.calls[0][0];
    expect(slots.find(s => s.kind === 'grammatical')).toMatchObject({ query: { case: 'nom' } });
    expect(JSON.stringify(slots)).not.toContain('marker');
    expect(screen.queryByText('Word class')).toBeNull();
  });
});
