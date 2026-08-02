import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InteractionProvider } from '../../src/lib/actions/interaction-provider';
import { SelectionProvider } from '../../src/components/selection/selection-context';

import { TaskList, taskRef } from './harness';

afterEach(() => {
  cleanup();
});

const ITEMS = [taskRef('1'), taskRef('2'), taskRef('3'), taskRef('4'), taskRef('5')];

/** Render the documented list surface inside the app's interaction providers. */
function renderList(options: { onActivate?: (object: ReturnType<typeof taskRef>) => void } = {}) {
  return render(
    <InteractionProvider>
      <SelectionProvider
        items={ITEMS}
        surfaceId="tasks"
        organizationId="org1"
        {...(options.onActivate === undefined ? {} : { onActivate: options.onActivate })}
      >
        <TaskList items={ITEMS} />
      </SelectionProvider>
    </InteractionProvider>,
  );
}

/** The ids of the rows currently marked selected in the DOM. */
function selectedRowIds(): string[] {
  return screen
    .getAllByRole('row')
    .filter((row) => row.getAttribute('aria-selected') === 'true')
    .map((row) => row.getAttribute('data-object-id') ?? '');
}

describe('selection surface: pointer', () => {
  it('selects a contiguous run with click then shift-click', () => {
    renderList();
    fireEvent.click(screen.getByTestId('row-1'));
    fireEvent.click(screen.getByTestId('row-5'), { shiftKey: true });
    expect(selectedRowIds()).toEqual(['1', '2', '3', '4', '5']);
    expect(screen.getByTestId('selection-count')).toHaveTextContent('5');
  });

  it('drops one row from the run with cmd-click', () => {
    renderList();
    fireEvent.click(screen.getByTestId('row-1'));
    fireEvent.click(screen.getByTestId('row-5'), { shiftKey: true });
    fireEvent.click(screen.getByTestId('row-3'), { metaKey: true });
    expect(selectedRowIds()).toEqual(['1', '2', '4', '5']);
    expect(screen.getByTestId('selection-count')).toHaveTextContent('4');
  });

  it('leaves the selection alone when the click lands on the row’s link', () => {
    // The row selects and its title navigates. A click on the link must not also re-select, or
    // opening a row would silently discard a selection the user had built.
    renderList();
    fireEvent.click(screen.getByTestId('row-1'));
    fireEvent.click(screen.getByTestId('row-3'), { metaKey: true });
    fireEvent.click(screen.getByRole('link', { name: 'Task 5' }));
    expect(selectedRowIds()).toEqual(['1', '3']);
  });
});

describe('selection surface: checkboxes', () => {
  it('toggles exactly one row per checkbox', () => {
    renderList();
    fireEvent.click(screen.getByLabelText('Select Task 2'));
    fireEvent.click(screen.getByLabelText('Select Task 4'));
    expect(selectedRowIds()).toEqual(['2', '4']);
    fireEvent.click(screen.getByLabelText('Select Task 2'));
    expect(selectedRowIds()).toEqual(['4']);
  });

  it('never replaces the selection the way a plain row click would', () => {
    // The checkbox is the affordance for people who do not know ⌘-click; if it behaved like a
    // plain click it would clear everything else and be actively worse than useless.
    renderList();
    fireEvent.click(screen.getByTestId('row-1'));
    fireEvent.click(screen.getByLabelText('Select Task 3'));
    expect(selectedRowIds()).toEqual(['1', '3']);
  });

  it('selects and clears everything from the header checkbox', () => {
    renderList();
    fireEvent.click(screen.getByLabelText('Select all rows'));
    expect(selectedRowIds()).toEqual(['1', '2', '3', '4', '5']);
    fireEvent.click(screen.getByLabelText('Clear selection'));
    expect(selectedRowIds()).toEqual([]);
  });

  it('shows the mixed state for a partial selection', () => {
    renderList();
    fireEvent.click(screen.getByTestId('row-2'));
    const header = screen.getByLabelText('Select all rows');
    expect(header).toBeInstanceOf(HTMLInputElement);
    expect((header as HTMLInputElement).indeterminate).toBe(true);
  });
});

describe('selection surface: keyboard', () => {
  it('moves, extends, selects all, and clears without a pointer', () => {
    renderList();
    const grid = screen.getByRole('grid');
    const first = screen.getByTestId('row-1');
    first.focus();

    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(screen.getByTestId('row-1')).toHaveAttribute('data-active', 'true');

    fireEvent.keyDown(document.activeElement ?? grid, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement ?? grid, { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(document.activeElement ?? grid, { key: 'ArrowDown', shiftKey: true });
    expect(selectedRowIds()).toEqual(['2', '3', '4']);

    fireEvent.keyDown(document.activeElement ?? grid, { key: 'a', metaKey: true });
    expect(selectedRowIds()).toEqual(['1', '2', '3', '4', '5']);

    fireEvent.keyDown(document.activeElement ?? grid, { key: 'Escape' });
    expect(selectedRowIds()).toEqual([]);
  });

  it('moves DOM focus with the active row', () => {
    renderList();
    const first = screen.getByTestId('row-1');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement ?? first, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('row-2'));
  });

  it('opens the active row on Enter', () => {
    const onActivate = vi.fn();
    renderList({ onActivate });
    const first = screen.getByTestId('row-1');
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement ?? first, { key: 'Enter' });
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
  });

  it('keeps exactly one row in the tab order', () => {
    renderList();
    const tabbable = screen
      .getAllByRole('row')
      .filter((row) => row.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toBe(screen.getByTestId('row-1'));
  });
});

describe('selection surface: semantics', () => {
  it('announces multi-selectability and per-row selected state', () => {
    renderList();
    expect(screen.getByRole('grid')).toHaveAttribute('aria-multiselectable', 'true');
    for (const row of screen.getAllByRole('row')) {
      expect(row).toHaveAttribute('aria-selected', 'false');
    }
    fireEvent.click(screen.getByTestId('row-2'));
    expect(screen.getByTestId('row-2')).toHaveAttribute('aria-selected', 'true');
  });

  it('identifies itself so global handlers can find its selection', () => {
    renderList();
    expect(screen.getByRole('grid')).toHaveAttribute('data-selection-surface', 'tasks');
  });
});
