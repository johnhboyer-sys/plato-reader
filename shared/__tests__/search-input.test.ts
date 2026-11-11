// PR 6, Input: dictionary-word suggestions under the Greek box, the
// on-screen Greek keyboard, and the "Case exact" filter.
import axe from 'axe-core';
import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Search from '../components/Search.svelte';
import type { BookData } from '../lib/data';

const { fixtureBook } = vi.hoisted(() => ({
  fixtureBook: {
    book: 1,
    segments: [
      {
        id: 'seg1',
        column: '70a',
        greek: [
          { n: 1, text: 'Σωκράτης σωκράτης', tokens: [{ t: 'Σωκράτης', o: 0, k: 'swkraths' }, { t: 'σωκράτης', o: 9, k: 'swkraths' }] },
        ],
        english: { text: 'Socrates.', notes: [], markers: [], bekker: [{ n: 1, offset: 0, real: true }] },
        chapterStarts: [],
      },
    ],
  } satisfies BookData,
}));

vi.mock('../lib/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/search')>();
  return {
    ...actual,
    search: vi.fn(async () => ({
      results: [{ work: 'Meno', meta: { id: 'seg1', book: 1, column: '70a' }, grkMatch: true, engMatch: false, grkPositions: [0, 1] }],
      failedWorks: [],
    })),
    searchCombo: vi.fn(async () => ({ results: [], failedWorks: [] })),
    searchPhraseVariants: vi.fn(),
    speakerRoster: vi.fn(async () => []),
  };
});

// Keys under l: λόγος is the commonest, then λογόω, λογισμός; λαμβάνω does
// not start with "log". Keys under y for ψυχή.
const SHARDS: Record<string, Record<string, { n: number; c: { h: string; k: string; s?: string }[] }>> = {
  l: {
    logismos: { n: 74, c: [{ h: 'λογισμός', k: 'logismo/s', s: 'logismos' }] },
    logos: { n: 2483, c: [{ h: 'λόγος', k: 'lo/gos', s: 'logos' }] },
    logow: { n: 516, c: [{ h: 'λογόω', k: 'logo/w', s: 'logoo' }] },
    lambanw: { n: 3000, c: [{ h: 'λαμβάνω', k: 'lamba/nw', s: 'lambano' }] },
  },
  y: { yuxh: { n: 1026, c: [{ h: 'ψυχή', k: 'yuxh/', s: 'psyche' }] } },
};
vi.mock('../lib/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/data')>();
  return {
    ...actual,
    fetchBook: vi.fn(async () => fixtureBook),
    fetchSections: vi.fn(async () => ({ '1': [{ column: '70a', page: 70 }] })),
    fetchLemmaPickerShard: vi.fn(async (letter: string) => SHARDS[letter] ?? {}),
    fetchLemmaGlosses: vi.fn(async (slug: string) => (slug === 'logos' ? ['word', 'speech'] : [])),
  };
});

// Anything not mocked above is not found, rather than asked of the network.
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({ ok: false, status: 404, json: async () => ({}) }) as Response);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

const greekBox = () => document.querySelector('#grk-input') as HTMLInputElement;
async function type(value: string, caret = value.length) {
  const el = greekBox();
  el.focus();
  el.value = value;
  el.setSelectionRange(caret, caret);
  await fireEvent.input(el);
}
const list = () => screen.findByRole('listbox', { name: 'Dictionary words' });
const heads = (lb: HTMLElement) => within(lb).getAllByRole('option').map((o) => o.querySelector('.hw')?.textContent);
const key = (k: string) => fireEvent.keyDown(greekBox(), { key: k });

describe('Search: dictionary words under the Greek box', () => {
  it('lists headword, count and gloss as you type, commonest first', async () => {
    render(Search);
    await type('log');
    const lb = await list();
    expect(heads(lb)).toEqual(['λόγος', 'λογόω', 'λογισμός']);
    const first = within(lb).getAllByRole('option')[0];
    expect(first.querySelector('.ct')).toHaveTextContent('2,483');
    await vi.waitFor(() => expect(first.querySelector('.gl')).toHaveTextContent('word; speech'));
    expect(greekBox()).toHaveAttribute('role', 'combobox');
    expect(greekBox()).toHaveAttribute('aria-expanded', 'true');
    expect(greekBox()).toHaveAttribute('aria-controls', lb.id);
  });

  it('walks the list with Up and Down, and Esc shuts it leaving the text', async () => {
    render(Search);
    await type('log');
    const lb = await list();
    const opts = within(lb).getAllByRole('option');
    await key('ArrowDown');
    expect(greekBox()).toHaveAttribute('aria-activedescendant', opts[0].id);
    expect(opts[0]).toHaveAttribute('aria-selected', 'true');
    await key('ArrowDown');
    expect(greekBox()).toHaveAttribute('aria-activedescendant', opts[1].id);
    await key('ArrowUp');
    expect(greekBox()).toHaveAttribute('aria-activedescendant', opts[0].id);
    await key('ArrowUp');
    expect(greekBox()).toHaveAttribute('aria-activedescendant', opts[2].id);
    await key('Escape');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(greekBox()).toHaveAttribute('aria-expanded', 'false');
    expect(greekBox().value).toBe('log');
  });

  it('Enter on a highlighted word sets the single-lemma search and runs it', async () => {
    const { search } = await import('../lib/search');
    const { container } = render(Search);
    await type('log');
    await list();
    await key('ArrowDown');
    await key('Enter');
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(vi.mocked(search).mock.calls[0].slice(0, 7)).toEqual(['logos', '', 'any', 'all', 'and', expect.any(Array), 'headword']);
    expect(window.location.search).toBe('?l=logos');
    // As a pick in the Single-lemma panel: the picked row shows the word.
    expect(container.querySelector('.lemma-panel .lpsel .hw')).toHaveTextContent('λόγος');
    expect(greekBox().value).toBe('');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('a click picks too', async () => {
    const { search } = await import('../lib/search');
    render(Search);
    await type('log');
    const lb = await list();
    await fireEvent.click(within(lb).getAllByRole('option')[1]);
    await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(vi.mocked(search).mock.calls[0][0]).toBe('logow');
    expect(window.location.search).toBe('?l=logow');
  });

  it('Enter with nothing highlighted searches what was typed', async () => {
    const { search } = await import('../lib/search');
    render(Search);
    await type('log');
    await list();
    await key('Enter');
    await vi.waitFor(() => expect(search).toHaveBeenCalled());
    expect(vi.mocked(search).mock.calls[0].slice(0, 1)).toEqual(['log']);
    expect(vi.mocked(search).mock.calls[0][6]).toBe('lemma');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it.each([['a wildcard', 'log*'], ['a one-letter wildcard', 'lo?os'], ['a second word', 'log kai']])(
    'offers nothing for %s', async (_label, text) => {
      render(Search);
      await type('log');
      await list();
      await type(text);
      await new Promise((r) => setTimeout(r, 20));
      expect(screen.queryByRole('listbox')).toBeNull();
      expect(greekBox()).toHaveAttribute('aria-expanded', 'false');
    });

  it('works beside the Beta Code box, which keeps converting and the caret', async () => {
    render(Search);
    await fireEvent.click(document.querySelector('button.tog')!);
    await type('lo/g');
    expect(greekBox().value).toBe('λόγ');
    expect(greekBox().selectionStart).toBe(3);
    expect(heads(await list())).toEqual(['λόγος', 'λογόω', 'λογισμός']);
  });

  it('has no serious axe violations with the list open', async () => {
    const { container } = render(Search);
    await type('log');
    await list();
    await key('ArrowDown');
    const results = await axe.run(container);
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  });
});

describe('Search: the Greek keyboard', () => {
  const kbdButton = () => screen.getByRole('button', { name: 'Greek keyboard' });
  const pad = () => screen.getByRole('group', { name: 'Greek keyboard' });
  const press = (name: string) => fireEvent.click(within(pad()).getByRole('button', { name }));

  it('opens under the box and types ψυχή into it, the search reading it', async () => {
    const { search } = await import('../lib/search');
    render(Search);
    expect(kbdButton()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: 'Greek keyboard' })).toBeNull();
    await fireEvent.click(kbdButton());
    expect(kbdButton()).toHaveAttribute('aria-expanded', 'true');
    for (const k of ['ψ', 'υ', 'χ', 'η']) await press(k);
    await press('acute');
    expect(greekBox().value).toBe('ψυχή');
    await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await vi.waitFor(() => expect(search).toHaveBeenCalled());
    expect(vi.mocked(search).mock.calls[0][0]).toBe('ψυχή');
  });

  it('combines marks with the letter before the caret, and backspace takes a letter', async () => {
    render(Search);
    await fireEvent.click(kbdButton());
    for (const k of ['α', 'iota subscript', 'acute', 'rough breathing']) await press(k);
    expect(greekBox().value).toBe('ᾅ');
    await press('space');
    await press('λ');
    expect(greekBox().value).toBe('ᾅ λ');
    await press('backspace');
    await press('backspace');
    expect(greekBox().value).toBe('ᾅ');
    await press('backspace');
    expect(greekBox().value).toBe('');
  });

  it('types at the caret, not at the end', async () => {
    render(Search);
    await type('λγος', 1);
    await fireEvent.click(kbdButton());
    await press('ο');
    expect(greekBox().value).toBe('λογος');
    await press('acute');
    expect(greekBox().value).toBe('λόγος');
    expect(greekBox().selectionStart).toBe(2);
  });

  it('Esc and the close key shut it and hand focus back to the box', async () => {
    render(Search);
    await fireEvent.click(kbdButton());
    within(pad()).getByRole('button', { name: 'λ' }).focus();
    await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'Greek keyboard' })).toBeNull();
    expect(document.activeElement).toBe(greekBox());
    await fireEvent.click(kbdButton());
    await press('close');
    expect(screen.queryByRole('group', { name: 'Greek keyboard' })).toBeNull();
    expect(document.activeElement).toBe(greekBox());
  });

  it('is a sheet from the bottom on a phone, and a panel under the box elsewhere', async () => {
    const page = render(Search);
    await fireEvent.click(kbdButton());
    expect(pad()).toHaveClass('gk');
    expect(pad()).not.toHaveClass('gk-sheet');
    page.unmount();
    const spy = vi.spyOn(window, 'matchMedia').mockImplementation((media: string) => ({
      matches: media.includes('680px'), media, onchange: null, addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false,
    }) as unknown as MediaQueryList);
    try {
      render(Search);
      await fireEvent.click(kbdButton());
      expect(pad()).toHaveClass('gk-sheet');
    } finally {
      spy.mockRestore();
    }
  });

  it('has no serious axe violations when open', async () => {
    const { container } = render(Search);
    await fireEvent.click(kbdButton());
    const results = await axe.run(container);
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  });
});

describe('Search: "Case exact"', () => {
  // The fixture's hits are Σωκράτης (position 0) and σωκράτης (position 1).
  // Each case waits for the hits to draw, so no <mark> means filtered.
  async function marksFor(url: string): Promise<string[]> {
    const { fetchBook } = await import('../lib/data');
    window.history.replaceState(null, '', url);
    const { container } = render(Search);
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('instances'));
    await vi.waitFor(() => expect(fetchBook).toHaveBeenCalled());
    await vi.waitFor(() => expect(container.querySelector('.inst-body')).not.toBeNull());
    return [...container.querySelectorAll('mark')].map((m) => m.textContent ?? '');
  }
  const g = (q: string) => `/search?g=${encodeURIComponent(q)}`;

  it('is off by default: both cases are hits', async () => {
    expect(await marksFor(g('Σωκράτης'))).toEqual(['Σωκράτης', 'σωκράτης']);
  });

  it('on, a capitalised name finds only the capitalised token', async () => {
    expect(await marksFor(`${g('Σωκράτης')}&cs=1`)).toEqual(['Σωκράτης']);
    expect(screen.getByRole('status')).toHaveTextContent('before case filtering');
  });

  it('on, a lower-case query finds only the lower-case token', async () => {
    expect(await marksFor(`${g('σωκράτης')}&cs=1`)).toEqual(['σωκράτης']);
  });

  it.each([['*swkra/ths', 'Σωκράτης'], ['swkraths', 'σωκράτης'], ['*sw*', 'Σωκράτης']])(
    'reads Beta Code %s by its * capital', async (q, want) => {
      expect(await marksFor(`${g(q)}&cs=1`)).toEqual([want]);
    });

  it('ignores accents unless they are exact too', async () => {
    expect(await marksFor(`${g('Σωκρατης')}&cs=1`)).toEqual(['Σωκράτης']);
  });

  it('with accents exact too, both must hold', async () => {
    expect(await marksFor(`${g('Σωκράτης')}&cs=1&acc=1`)).toEqual(['Σωκράτης']);
  });

  it('applies after the speaker filter', async () => {
    const { search } = await import('../lib/search');
    expect(await marksFor(`${g('Σωκράτης')}&cs=1&sp=only&sn=Meno`)).toEqual(['Σωκράτης']);
    expect(vi.mocked(search).mock.calls[0][8]).toEqual({ mode: 'only', names: ['Meno'] });
  });

  it('is a menu beside Accents, and its choice goes in the address', async () => {
    const { search } = await import('../lib/search');
    render(Search);
    const menu = [...document.querySelectorAll('.sopt summary')].find((el) => /^Case/.test(el.textContent ?? ''))!.closest('details')!;
    expect(menu.previousElementSibling?.querySelector('summary')).toHaveTextContent(/^Accents/);
    expect(menu.querySelector('summary')).toHaveTextContent('Case ignored');
    await fireEvent.click(within(menu).getByRole('checkbox', { name: 'Match case exactly' }));
    expect(menu.querySelector('summary')).toHaveTextContent('Case exact');
    await type('Σωκράτης');
    await key('Escape');
    await fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await vi.waitFor(() => expect(search).toHaveBeenCalled());
    expect(window.location.search).toBe(`?g=${encodeURIComponent('Σωκράτης')}&cs=1`);
  });
});
