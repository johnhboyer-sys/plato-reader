import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
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

  it('opens from a tap on a touch screen, though the tap collapses the selection first', async () => {
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
    const button = await screen.findByRole('button', { name: 'Where else' }, { timeout: 2000 });
    // The tap: the finger lands on the button, the selection collapses, the
    // emulated mouse events follow, then the click.
    await fireEvent.pointerDown(button);
    await fireEvent.touchStart(button);
    sel.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
    await fireEvent.touchEnd(button);
    await fireEvent.mouseDown(button);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404, json: async () => ({}) } as Response);
    await fireEvent.click(screen.getByRole('button', { name: 'Where else' }));
    // The panel, for the words the bar captured (τίνα and the τ of τρόπον).
    const panel = await screen.findByRole('dialog', { name: 'Where else' });
    expect(panel.textContent).toContain('τίνα τ');
  });

  // Grok review round 2: a press on the bar held the bar up for a second, so a
  // touch that only dismissed the selection left it standing; and Copy read
  // the live selection, which a tap has collapsed by the time the click lands.
  async function touchSelect() {
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
    await screen.findByRole('button', { name: 'Copy with citation' }, { timeout: 2000 });
    return sel;
  }

  it('hides the bar on a touch that only dismisses the selection, after a press on the bar was abandoned', async () => {
    const sel = await touchSelect();
    const copy = screen.getByRole('button', { name: 'Copy with citation' });
    // The finger lands on the bar, then slides off it and lifts: no click.
    await fireEvent.pointerDown(copy);
    await fireEvent.pointerUp(copy, { clientX: 500, clientY: 500 });
    // A tap on the text: the selection goes, and the bar with it.
    await fireEvent.pointerDown(document.querySelector('.greek-line')!);
    sel.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
    await tick();
    expect(screen.queryByRole('button', { name: 'Copy with citation' })).toBeNull();
  });

  it('hides the bar on a tap elsewhere just after a press on the bar was cancelled', async () => {
    const sel = await touchSelect();
    const copy = screen.getByRole('button', { name: 'Copy with citation' });
    await fireEvent.pointerDown(copy);
    await fireEvent.pointerCancel(copy);
    sel.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
    await tick();
    expect(screen.queryByRole('button', { name: 'Copy with citation' })).toBeNull();
  });

  it('copies by touch the text the bar captured, though the tap collapsed the selection', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const sel = await touchSelect();
    const copy = screen.getByRole('button', { name: 'Copy with citation' });
    await fireEvent.pointerDown(copy);
    await fireEvent.touchStart(copy);
    sel.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
    await fireEvent.touchEnd(copy);
    await fireEvent.mouseDown(copy);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await fireEvent.click(screen.getByRole('button', { name: 'Copy with citation' }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(String((writeText.mock.calls[0] as unknown[])[0])).toMatch(/^τίνα τ/);
  });

  it('closes the word popup when Where else opens, and Where else when a word is clicked', async () => {
    // Reduced motion: the popup leaves at once instead of flying out.
    vi.spyOn(window, 'matchMedia').mockImplementation((q: string) =>
      ({ matches: q === '(prefers-reduced-motion: reduce)', media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 404, json: async () => ({}) } as Response);
    window.history.replaceState(null, '', '/Republic/book/1');
    render(Reader, { props: { work: 'Republic', bookNum: 1, bookData: book } });
    await screen.findByText('τίνα');
    await new Promise((r) => setTimeout(r, 20));
    await fireEvent.click(screen.getByText('νῦν'));
    expect(await screen.findByRole('dialog', { name: 'Word analysis' })).toBeInTheDocument();
    await select(1, 3);
    await fireEvent.click(screen.getByRole('button', { name: 'Where else' }));
    expect(await screen.findByRole('dialog', { name: 'Where else' })).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Word analysis' })).toBeNull());
    await fireEvent.click(screen.getByText('νῦν'));
    expect(await screen.findByRole('dialog', { name: 'Word analysis' })).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByRole('dialog', { name: 'Where else' })).toBeNull());
  });
});
