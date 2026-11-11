// Grammar alone (ruling 3, John, 2026-11-10; option C2). A lone grammar term
// runs once fewer than all works or a speaker narrows it. Unnarrowed, Search
// stays enabled and pressing it shows three narrowing controls where the
// results go, with no sentence of explanation.
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

const AOR_PASS_PART = `c=${encodeURIComponent('g:tense.aor,mood.part,voice.pass')}`;
const prompt = () => screen.queryByRole('group', { name: 'Narrow the search' });

describe('a lone grammar term', () => {
  it('with nothing narrowing it, shows the three controls and does not search', async () => {
    window.history.replaceState(null, '', `/search?${AOR_PASS_PART}`);
    render(Search);
    await vi.waitFor(() => expect(prompt()).not.toBeNull());
    expect(within(prompt()!).getAllByRole('button').map(b => b.textContent))
      .toEqual(['Choose works', 'Choose speakers', 'Add a word near or not near']);
    // No sentence of explanation: the buttons' own words and nothing else.
    expect(prompt()!.textContent!.replace(/\s+/g, ' ').trim()).toBe('Choose works Choose speakers Add a word near or not near');
    const { searchCombo } = await import('../lib/search');
    expect(searchCombo).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Search' })).not.toBeDisabled();
  });

  it('opens the works chooser from Choose works, and the speaker panel from Choose speakers', async () => {
    window.history.replaceState(null, '', `/search?${AOR_PASS_PART}`);
    const { container } = render(Search);
    await vi.waitFor(() => expect(prompt()).not.toBeNull());
    await fireEvent.click(within(prompt()!).getByRole('button', { name: 'Choose works' }));
    await vi.waitFor(() => expect((container.querySelector('#works-panel') as HTMLElement).hidden).toBe(false));
    // The focus lands on the first work, not on "Select all" or "Clear".
    await vi.waitFor(() => expect(document.activeElement?.closest('#works-panel')).not.toBeNull());
    expect(document.activeElement?.classList.contains('work-chip')).toBe(true);
    await fireEvent.click(within(prompt()!).getByRole('button', { name: 'Choose speakers' }));
    await vi.waitFor(() => expect((container.querySelector('#speaker-panel') as HTMLElement).hidden).toBe(false));
    expect((container.querySelector('#works-panel') as HTMLElement).hidden).toBe(true);
  });

  it('puts the focus in a free word term from Add a word near or not near', async () => {
    window.history.replaceState(null, '', `/search?${AOR_PASS_PART}`);
    render(Search);
    await vi.waitFor(() => expect(prompt()).not.toBeNull());
    await fireEvent.click(within(prompt()!).getByRole('button', { name: 'Add a word near or not near' }));
    await vi.waitFor(() => expect(document.activeElement?.closest('.combo-slot')).not.toBeNull());
    expect(document.activeElement?.closest('.combo-slot')?.querySelector('.combo-grammar-grid')).toBeNull();
  });

  it('runs over fewer than all works, as one grammar slot', async () => {
    window.history.replaceState(null, '', `/search?w=Phaedo&${AOR_PASS_PART}`);
    render(Search);
    const { searchCombo } = await import('../lib/search');
    await vi.waitFor(() => expect(searchCombo).toHaveBeenCalled());
    const [slots, , works] = vi.mocked(searchCombo).mock.calls[0];
    expect(slots).toEqual([{ kind: 'grammatical', query: { tense: 'aor', mood: 'part', voice: 'pass' }, relation: 'near' }]);
    expect(works).toEqual(['Phaedo']);
    expect(prompt()).toBeNull();
  });
});
