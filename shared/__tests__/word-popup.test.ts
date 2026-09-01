// Regression tests for the 2026-07-29 Gorgias bug report: with the word panel
// open, clicking another Greek word must swap the analysis in place — the old
// full-page backdrop swallowed that click and forced close/reopen with two
// page snaps.
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import WordPopup from '../components/WordPopup.svelte';
import { lookupWord } from '../lib/data';

vi.mock('../lib/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/data')>();
  return {
    ...actual,
    fetchLemmata: vi.fn(async () => ({})),
    fetchLsjHeads: vi.fn(async () => ({})),
    lookupWord: vi.fn(async (_work: string, k: string) => ({
      analyses: [
        k === 'logos'
          ? { lemma: 'logos', gloss: 'word, account', parse: 'noun nom sg', lsj: [] }
          : { lemma: 'areth', gloss: 'goodness, excellence', parse: 'noun nom sg', lsj: [] },
      ],
      lsj: [],
    })),
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

const baseProps = {
  work: 'EN',
  token: { t: 'λόγος', k: 'logos' },
  anchor: { x: 0, y: 0 },
};

describe('WordPopup', () => {
  it('re-runs the lookup when the token changes (word-to-word jump)', async () => {
    const { rerender } = render(WordPopup, {
      props: { ...baseProps, onClose: vi.fn() },
    });
    await screen.findByText('word, account');

    await rerender({ token: { t: 'ἀρετή', k: 'areth' } });
    await screen.findByText('goodness, excellence');
    expect(lookupWord).toHaveBeenCalledTimes(2);
    // withLsj:false is the website path — grammata serves the entry, so no LSJ
    // shard is fetched. It is true only in a packaged offline build.
    expect(lookupWord).toHaveBeenLastCalledWith('EN', 'areth', { withLsj: false });
  });

  it('closes on click outside, but not on the panel or on a Greek token', async () => {
    const tok = document.createElement('span');
    tok.className = 'tok';
    document.body.appendChild(tok);

    const onClose = vi.fn();
    render(WordPopup, { props: { ...baseProps, onClose } });
    await screen.findByText('word, account');

    // On a Greek token: the token's own handler swaps the word — no close.
    tok.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(onClose).not.toHaveBeenCalled();

    // Inside the panel: no close.
    document.querySelector('.word-sidebar')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(onClose).not.toHaveBeenCalled();

    // A press alone (a touch pan starts with one) must NOT close.
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await tick();
    expect(onClose).not.toHaveBeenCalled();

    // A right-button press must NOT close either.
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2 }));
    await tick();
    expect(onClose).not.toHaveBeenCalled();

    // Inside another overlay (command palette, footnote popup, settings…):
    // that layer owns the click — no close.
    for (const cls of ['cp-backdrop', 'footnote-popup', 'settings-sidebar']) {
      const overlay = document.createElement('div');
      overlay.className = cls;
      document.body.appendChild(overlay);
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await tick();
      expect(onClose, cls).not.toHaveBeenCalled();
      overlay.remove();
    }

    // A completed click anywhere else: close.
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);

    tok.remove();
  });

  it('closes even when the outside click stops propagation (footnote marker)', async () => {
    // Reader's fn-marker / Bekker-info / print-menu handlers stopPropagation();
    // the close listener runs in the capture phase so it still sees the click
    // (John's ruling 2026-07-29: a click that raises another popup closes the
    // word panel).
    const marker = document.createElement('button');
    marker.className = 'fn-marker';
    marker.addEventListener('click', (e) => e.stopPropagation());
    document.body.appendChild(marker);

    const onClose = vi.fn();
    render(WordPopup, { props: { ...baseProps, onClose } });
    await screen.findByText('word, account');

    marker.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await tick();
    expect(onClose).toHaveBeenCalledTimes(1);

    marker.remove();
  });

  it('is non-modal: no aria-modal claim, no Tab focus trap', async () => {
    render(WordPopup, { props: { ...baseProps, onClose: vi.fn() } });
    await screen.findByText('word, account');
    const dialog = document.querySelector('.word-sidebar')!;
    expect(dialog.getAttribute('aria-modal')).toBeNull();
    // Tab from the dialog must not be intercepted and rewired.
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    dialog.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('renders no click-blocking backdrop', async () => {
    render(WordPopup, { props: { ...baseProps, onClose: vi.fn() } });
    await screen.findByText('word, account');
    expect(document.querySelector('.popup-backdrop')).toBeNull();
  });
});
