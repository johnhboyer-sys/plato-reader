import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import BekkerJump from '../components/BekkerJump.svelte';

// BekkerJump is scheme-aware (shared/lib/citation.ts): its placeholder, label,
// and parse behavior all come from the work's citation scheme, not a
// hardcoded Bekker grammar. No stephanus work is in the registry yet (Plato
// works land in a later phase), so a fake work id + a mocked getWork stands in
// for one here.
vi.mock('../lib/works', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/works')>();
  return {
    ...actual,
    getWork: (id: string) =>
      id === 'StephWork'
        ? ({ id: 'StephWork', title: 'Test Dialogue', citation: { scheme: 'stephanus' } } as ReturnType<typeof actual.getWork>)
        : actual.getWork(id),
  };
});

vi.mock('../lib/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/data')>();
  return {
    ...actual,
    fetchColumns: vi.fn(async (work: string) =>
      work === 'StephWork' ? { '34b': [{ book: 1, lo: 1, hi: 20 }] } : { '1097a': [{ book: 1, lo: 1, hi: 20 }] },
    ),
  };
});

describe('BekkerJump — scheme-aware citation entry', () => {
  it('shows the Bekker placeholder/label for a bekker work (default scheme)', async () => {
    render(BekkerJump, { props: { work: 'EN', inputId: 'bk-en' } });
    await fireEvent.click(screen.getByRole('button', { name: /Go to Bekker citation/ }));
    expect(screen.getByPlaceholderText('e.g. 1097a15')).toBeInTheDocument();
    expect(screen.getByLabelText('Bekker citation')).toBeInTheDocument();
  });

  it('shows the Stephanus placeholder/label and accepts a bare column, calling onJump with a null line', async () => {
    const onJump = vi.fn();
    render(BekkerJump, { props: { work: 'StephWork', inputId: 'bk-steph', onJump } });
    await fireEvent.click(screen.getByRole('button', { name: /Go to Stephanus page/ }));
    expect(screen.getByPlaceholderText('e.g. 34b')).toBeInTheDocument();

    const input = screen.getByLabelText('Jump to a Stephanus page');
    await fireEvent.input(input, { target: { value: '34b' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Go' }));

    expect(onJump).toHaveBeenCalledWith(1, '34b', null);
  });

  it('rejects a trailing-digits citation for a lineless (stephanus) scheme', async () => {
    const onJump = vi.fn();
    render(BekkerJump, { props: { work: 'StephWork', inputId: 'bk-steph-bad', onJump } });
    await fireEvent.click(screen.getByRole('button', { name: /Go to Stephanus page/ }));

    const input = screen.getByLabelText('Jump to a Stephanus page');
    await fireEvent.input(input, { target: { value: '34b12' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Go' }));

    expect(onJump).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('stephanus page');
  });

  it('still resolves a full bekker citation (column + line) via onJump', async () => {
    const onJump = vi.fn();
    render(BekkerJump, { props: { work: 'EN', inputId: 'bk-en-full', onJump } });
    await fireEvent.click(screen.getByRole('button', { name: /Go to Bekker citation/ }));

    const input = screen.getByLabelText('Jump to a Bekker citation');
    await fireEvent.input(input, { target: { value: '1097a15' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Go' }));

    expect(onJump).toHaveBeenCalledWith(1, '1097a', 15);
  });
});
