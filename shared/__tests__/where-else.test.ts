import { render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Reader from '../components/Reader.svelte';
import type { BookData } from '../lib/data';

// Republic 327a: six Greek words, so a selection can cover one to six of them.
const { book } = vi.hoisted(() => {
  const words: [string, string][] = [
    ['ποιήσουσιν', 'poih/sousin'], ['τίνα', 'ti/na'], ['τρόπον', 'tro/pon'],
    ['ἅτε', 'a(/te'], ['νῦν', 'nu=n'], ['πρῶτον', 'prw=ton'],
  ];
  let o = 0;
  const tokens = words.map(([t, k]) => {
    const tok = { t, o, k };
    o += t.length + 1;
    return tok;
  });
  return {
    book: {
      book: 1,
      segments: [{
        id: 'seg1',
        column: '327a',
        greek: [{ n: 1, text: words.map(([t]) => t).join(' '), tokens }],
        english: { text: 'in what manner they would conduct it', notes: [], markers: [], bekker: [] },
      }],
    } as unknown as BookData,
  };
});

vi.mock('../lib/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/data')>();
  return {
    ...actual,
    fetchBook: vi.fn(async () => book),
    fetchChapters: vi.fn(async () => ({})),
    fetchSections: vi.fn(async () => ({})),
  };
});

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

// Select words [from, to) of the line and release the mouse, as a reader does.
async function select(from: number, to: number) {
  const toks = document.querySelectorAll<HTMLElement>('.greek-line .tok');
  const range = document.createRange();
  range.setStart(toks[from].firstChild!, 0);
  range.setEnd(toks[to - 1].firstChild!, 1);
  // happy-dom lays nothing out; the bar needs a box to stand over.
  vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(
    { x: 10, y: 10, top: 10, left: 10, right: 60, bottom: 30, width: 50, height: 20, toJSON() {} } as DOMRect,
  );
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Copy with citation' })).toBeInTheDocument());
}

describe('Reader: Where else on the selection bar', () => {
  it('is offered for two to five Greek words and not for one or six', async () => {
    window.history.replaceState(null, '', '/Republic/book/1');
    render(Reader, { props: { work: 'Republic', bookNum: 1, bookData: book } });
    await screen.findByText('τίνα');
    // The mouseup listener is attached once the book has rendered.
    await new Promise((r) => setTimeout(r, 20));

    const offered: Record<number, boolean> = {};
    for (const n of [1, 2, 3, 5, 6]) {
      await select(0, n);
      offered[n] = !!screen.queryByRole('button', { name: 'Where else' });
    }
    expect(offered).toEqual({ 1: false, 2: true, 3: true, 5: true, 6: false });
  });

  it('appears on a touch screen, where a selection ends without a mouseup', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((q: string) =>
      ({ matches: q === '(pointer: coarse)', media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList);
    window.history.replaceState(null, '', '/Republic/book/1');
    render(Reader, { props: { work: 'Republic', bookNum: 1, bookData: book } });
    await screen.findByText('τίνα');
    await new Promise((r) => setTimeout(r, 20));
    const toks = document.querySelectorAll<HTMLElement>('.greek-line .tok');
    const range = document.createRange();
    range.setStart(toks[1].firstChild!, 0);
    range.setEnd(toks[2].firstChild!, 1);
    vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue(
      { x: 10, y: 10, top: 10, left: 10, right: 60, bottom: 30, width: 50, height: 20, toJSON() {} } as DOMRect,
    );
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    expect(await screen.findByRole('button', { name: 'Where else' }, { timeout: 2000 })).toBeInTheDocument();
  });
});
