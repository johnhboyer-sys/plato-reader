// PR 9, running-text search on the search page: the Form menu's third
// choice, its Punctuation switch, the address bar, the progress line, and its
// hits drawn as word-search hits. The engine runs for real over the pipeline's
// own fixture (pipeline/tests/fixtures/running_text.json); only fetch is faked.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Search from '../components/Search.svelte';
import type { BookData } from '../lib/data';

vi.mock('../lib/search', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/search')>();
  return { ...actual, search: vi.fn(async () => ({ results: [], failedWorks: [] })), speakerRoster: vi.fn(async () => []) };
});
vi.mock('../lib/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/data')>();
  return {
    ...actual,
    fetchBook: vi.fn(async () => BOOK),
    fetchSections: vi.fn(async () => ({ '1': [{ column: '17a', page: 17 }, { column: '17b', page: 17 }] })),
    fetchLemmaPickerShard: vi.fn(async () => ({ ws: { n: 9, c: [{ h: 'ὡς', k: 'w(s', s: 'hos' }] } })),
  };
});

const FIXTURE = JSON.parse(readFileSync(join(__dirname, '../../pipeline/tests/fixtures/running_text.json'), 'utf8'));
// The fixture's sections as the reader's book, read by fetchBook at call time.
const BOOK: BookData = {
  book: 1,
  segments: FIXTURE.book.segments.map((s: BookData['segments'][number]) => ({
    ...s, english: { text: 'Text.', notes: [], markers: [] },
  })),
};
// Crito and Meno load; Euthyphro's running text does not. Laches answers
// only when released, to hold a search in flight.
let release: () => void = () => {};
beforeEach(() => {
  const served: Record<string, unknown> = {};
  for (const w of ['Crito', 'Meno', 'Euthyphro', 'Laches']) {
    if (w !== 'Euthyphro') served[`/data/${w}/search/running.json`] = FIXTURE.running;
    served[`/data/${w}/search/offsets.json`] = FIXTURE.offsets;
    served[`/data/${w}/search/meta.json`] = FIXTURE.meta;
  }
  const held = new Promise<void>((r) => { release = r; });
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    if (String(url) === '/data/Laches/search/running.json') await held;
    const body = served[String(url)];
    return (body ? { ok: true, status: 200, json: async () => structuredClone(body) } : { ok: false, status: 404, json: async () => ({}) }) as Response;
  });
});
afterEach(() => {
  release();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/');
});

const formMenu = () => screen.getByText('Form', { selector: 'summary' }).closest('details')!;

describe('Search: running text', () => {
  it('is the third choice of the Form menu, and brings a Punctuation switch in place of Match and Case', async () => {
    render(Search);
    const radios = [...formMenu().querySelectorAll<HTMLInputElement>('input[name="matchmode"]')];
    expect(radios.map((r) => r.closest('label')!.textContent)).toEqual(['Any form of this word', 'Only as I typed it', 'Running text']);
    expect(screen.queryByText('Punctuation', { selector: 'summary' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Case / })).toBeInTheDocument();
    await fireEvent.click(radios[2]);
    expect(formMenu().querySelector('summary')).toHaveTextContent('Form running text');
    expect(screen.getByText('Punctuation', { selector: 'summary' })).toHaveTextContent('Punctuation ignored');
    expect(screen.queryByRole('button', { name: /^Case / })).toBeNull();
    expect(screen.queryByText('Match', { selector: 'summary' })).toBeNull();
  });

  it('draws a mid-word match as a hit on its word, cited and highlighted (hlt) at its section', async () => {
    window.history.replaceState(null, '', '/search?g=fignoe&m=text&w=Crito');
    const { container } = render(Search);
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 instance'));
    await vi.waitFor(() => expect(container.querySelector('li.instance')).not.toBeNull());
    const hit = container.querySelector('li.instance')!;
    expect([...hit.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['ἀμφιγνοεῖν']);
    const link = hit.querySelector('a.inst-ref')!;
    expect(link).toHaveTextContent('17b');
    expect(link.getAttribute('href')).toContain('hlt=17b:1&');
    expect(link.getAttribute('href')).not.toContain('hlg=');
  });

  it('marks both words of a match across a word boundary', async () => {
    window.history.replaceState(null, '', `/search?g=${encodeURIComponent('ὡς δοκεῖ')}&m=text&w=Crito`);
    const { container } = render(Search);
    await vi.waitFor(() => expect(container.querySelector('li.instance')).not.toBeNull());
    const hit = container.querySelector('li.instance')!;
    expect([...hit.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['ὡς', 'δοκεῖ']);
    expect(hit.querySelector('a.inst-ref')!.getAttribute('href')).toContain('hlt=17b:5,6&');
  });

  it('counts a match across two words once: the count line, the group and the whole-section context (John, 2026-11-11)', async () => {
    window.history.replaceState(null, '', `/search?g=${encodeURIComponent('ὡς δοκεῖ')}&m=text&w=Crito`);
    const first = render(Search);
    await vi.waitFor(() => expect(first.container.querySelector('li.instance')).not.toBeNull());
    expect(screen.getByRole('status')).toHaveTextContent(/^1 instance\b/);
    expect([...first.container.querySelectorAll('.group-count')].map((e) => e.textContent)).toEqual(['1 instance']);
    first.unmount();
    window.history.replaceState(null, '', `/search?g=${encodeURIComponent('ὡς δοκεῖ')}&m=text&w=Crito&ctx=s`);
    const { container } = render(Search);
    await vi.waitFor(() => expect(container.querySelector('li.instance')).not.toBeNull());
    expect([...container.querySelectorAll('.group-count')].map((e) => e.textContent)).toEqual(['1 instance']);
    expect([...container.querySelectorAll('li.instance mark')].map((m) => m.textContent)).toEqual(['ὡς', 'δοκεῖ']);
  });

  it('counts punctuation only with the switch on, and writes it to the address bar', async () => {
    window.history.replaceState(null, '', '/search?g=aqhnaioi%2C&m=text&w=Crito');
    const first = render(Search);
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('No passages found.'));
    first.unmount();
    window.history.replaceState(null, '', '/search?g=aqhnaioi%2C&m=text&pu=1&w=Crito');
    render(Search);
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 instance'));
    expect(screen.getByText('Punctuation', { selector: 'summary' })).toHaveTextContent('Punctuation matched');
    await fireEvent.submit(document.querySelector('form.search-form')!);
    await vi.waitFor(() => expect(window.location.search).toContain('m=text'));
    expect(window.location.search).toContain('pu=1');
  });

  it('says which work did not load, and shows the rest', async () => {
    window.history.replaceState(null, '', `/search?g=${encodeURIComponent('ws dokei')}&m=text&w=Crito,Euthyphro`);
    const { container } = render(Search);
    await vi.waitFor(() => expect(container.textContent).toContain('did not load'));
    expect(container.textContent).toMatch(/The index for Euthyphro did not load/);
    // One match of two words: one instance (John, 2026-11-11).
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 instance'));
  });

  it('reads a + in the pattern as the quantifier, through the address bar and back', async () => {
    window.history.replaceState(null, '', `/search?g=${encodeURIComponent('do+kei')}&m=text&w=Crito`);
    const { container } = render(Search);
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 instance'));
    expect([...container.querySelectorAll('li.instance mark')].map((m) => m.textContent)).toEqual(['δοκεῖ']);
    expect((document.querySelector('#grk-input') as HTMLInputElement).value).toBe('do+kei');
    await fireEvent.submit(document.querySelector('form.search-form')!);
    await vi.waitFor(() => expect(new URLSearchParams(window.location.search).get('g')).toBe('do+kei'));
  });

  it('follows the works as they load', async () => {
    window.history.replaceState(null, '', '/search?g=ws&m=text&w=Crito,Laches');
    const { container } = render(Search);
    await vi.waitFor(() => expect(container.querySelector('.rt-progress')).toHaveTextContent('Searching 1 of 2 works…'));
    release();
    await vi.waitFor(() => expect(container.querySelector('.rt-progress')).toBeNull());
    await vi.waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('2 instances'));
  });

  it('opens no dictionary words under the box', async () => {
    window.history.replaceState(null, '', '/search?g=x&m=text');
    render(Search);
    const box = document.querySelector('#grk-input') as HTMLInputElement;
    box.value = 'ws';
    await fireEvent.input(box);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(box).toHaveAttribute('aria-expanded', 'false');
  });
});
