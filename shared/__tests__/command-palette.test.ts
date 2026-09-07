import { fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CommandPalette from '../components/CommandPalette.svelte';

vi.mock('../lib/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/data')>();
  return {
    ...actual,
    fetchColumns: vi.fn(async () => []),
    fetchLemmata: vi.fn(async () => ({
      logos: { slug: 'logos', head: 'λόγος', count: 2 },
    })),
  };
});

afterEach(() => vi.clearAllMocks());

const open = async () => {
  const view = render(CommandPalette, { props: { work: 'EN', onNavigate: null } });
  await fireEvent.keyDown(window, { key: 'k', metaKey: true });
  return view;
};

describe('CommandPalette rows', () => {
  // A row used to be a <button> inside its own role="option". That is invalid
  // ARIA and, in an aria-activedescendant listbox, a tab stop the pattern does
  // not want: the input holds focus and names the active row by id. The row is
  // the option now, so these pin what that must not cost.
  it('opens on the shortcut and offers the corpus search for what was typed', async () => {
    await open();
    await fireEvent.input(screen.getByRole('combobox'), { target: { value: 'logos' } });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByRole('option').length).toBeGreaterThan(0);
  });

  it('navigates when a row is clicked', async () => {
    const onNavigate = vi.fn();
    render(CommandPalette, { props: { work: 'EN', onNavigate } });
    await fireEvent.keyDown(window, { key: 'k', metaKey: true });
    await fireEvent.input(screen.getByRole('combobox'), { target: { value: 'logos' } });
    const rows = screen.getAllByRole('option');
    await fireEvent.click(rows[0]);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate.mock.calls[0][0]).toEqual(expect.stringContaining('logos'));
  });

  it('tracks the pointer, and keeps the keyboard selection on the input', async () => {
    await open();
    const input = screen.getByRole('combobox');
    await fireEvent.input(input, { target: { value: 'logos' } });
    const rows = screen.getAllByRole('option');
    if (rows.length > 1) {
      await fireEvent.mouseMove(rows[1]);
      expect(rows[1]).toHaveAttribute('aria-selected', 'true');
      expect(rows[0]).toHaveAttribute('aria-selected', 'false');
    }
    // No row is focusable: the pattern selects by aria-activedescendant, and a
    // focusable row would put a second tab stop inside the dialog.
    for (const row of rows) expect(row).not.toHaveAttribute('tabindex');
    expect(input).toHaveAttribute('aria-activedescendant');
  });
});
