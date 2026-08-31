import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  type Column,
  EntityTable,
  type EntityTableGroup,
  type EntityTableSelectionCommand,
} from '../../../src/components/views/EntityTable';

interface Row {
  readonly id: string;
  readonly name: string;
}

const COLUMNS: readonly Column<Row>[] = [
  { key: 'name', header: 'Name', flex: true, render: (row) => row.name },
];

const VIEWPORT = 720;
const ROW_HEIGHT = 40;
let restoreHeight: (() => void) | undefined;
let restoreWidth: (() => void) | undefined;
let restoreRect: (() => void) | undefined;

beforeAll(() => {
  const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  const rect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect');
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      const measured = this.matches('[data-row-height]')
        ? this
        : this.querySelector<HTMLElement>('[data-row-height]');
      return measured ? Number(measured.dataset['rowHeight']) : ROW_HEIGHT;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => VIEWPORT,
  });
  HTMLElement.prototype.getBoundingClientRect = function getRect(): DOMRect {
    return {
      width: VIEWPORT,
      height: VIEWPORT,
      top: 0,
      left: 0,
      right: VIEWPORT,
      bottom: VIEWPORT,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    };
  };
  restoreHeight = () => {
    if (height) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', height);
  };
  restoreWidth = () => {
    if (width) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', width);
  };
  restoreRect = () => {
    if (rect) Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', rect);
  };
});

afterAll(() => {
  restoreHeight?.();
  restoreWidth?.();
  restoreRect?.();
});

function rows(count: number): readonly Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `row-${String(index)}`,
    name: `Resource ${String(index)}`,
  }));
}

describe('EntityTable virtualization', () => {
  it('indexes nested headers, rows, and continuations in one active virtual sequence', async () => {
    const groups: readonly EntityTableGroup<Row>[] = [
      {
        id: 'parent',
        label: 'Parent',
        children: [
          {
            id: 'parent/child',
            label: 'Child',
            rows: [{ id: 'shared', name: 'Nested resource' }],
            continuation: {
              id: 'more-child',
              label: 'Load more child resources',
              state: 'idle',
              onActivate: vi.fn(),
            },
          },
        ],
      },
      { id: 'second', label: 'Second', rows: [{ id: 'shared', name: 'Second resource' }] },
    ];
    render(
      <EntityTable
        aria-label="Nested resources"
        columns={COLUMNS}
        groups={groups}
        continuation={{
          id: 'more-root',
          label: 'Load more resources',
          state: 'idle',
          onActivate: vi.fn(),
        }}
        getRowKey={(row) => row.id}
        virtualized
      />,
    );

    const grid = screen.getByRole('grid', { name: 'Nested resources' });
    await screen.findByRole('row', { name: 'Parent1' });
    expect(grid).toHaveAttribute('aria-rowcount', '8');
    grid.focus();
    for (let index = 0; index < 4; index += 1) fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(grid).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('button', { name: 'Load more child resources' }).closest('[role="row"]')?.id,
    );
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(grid).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('row', { name: 'Second1' }).id,
    );
  });

  it('dispatches keyboard and pointer selection commands with only eligible rows in table order', async () => {
    const onSelectionCommand = vi.fn<(command: EntityTableSelectionCommand) => void>();
    const onActiveEntryChange = vi.fn<(entryKey: string | null) => void>();
    const selectionRows: readonly Row[] = [
      { id: 'a', name: 'Selectable A' },
      { id: 'context', name: 'Context row' },
      { id: 'b', name: 'Selectable B' },
    ];
    render(
      <EntityTable
        aria-label="Selectable resources"
        columns={COLUMNS}
        rows={selectionRows}
        getRowKey={(row) => row.id}
        getRowSelectionKey={(row) => (row.id === 'context' ? undefined : `selection-${row.id}`)}
        selectionAnchorKey="selection-a"
        onSelectionCommand={onSelectionCommand}
        onActiveEntryChange={onActiveEntryChange}
        virtualized
      />,
    );

    const grid = screen.getByRole('grid', { name: 'Selectable resources' });
    await screen.findByRole('row', { name: 'Selectable A' });
    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(onActiveEntryChange).toHaveBeenLastCalledWith('r:a');
    expect(onSelectionCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({ command: 'move-active', activeEntryKey: 'r:a' }),
    );
    fireEvent.keyDown(grid, { key: ' ' });
    expect(onSelectionCommand).toHaveBeenLastCalledWith({
      command: 'toggle',
      activeEntryKey: 'r:a',
      targetSelectionKey: 'selection-a',
      anchorSelectionKey: 'selection-a',
      orderedSelectionKeys: ['selection-a', 'selection-b'],
      modifiers: { shiftKey: false, metaKey: false, ctrlKey: false },
    });

    fireEvent.keyDown(grid, { key: 'ArrowDown', shiftKey: true });
    expect(onSelectionCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({
        command: 'extend-active',
        activeEntryKey: 'r:context',
        targetSelectionKey: null,
        orderedSelectionKeys: ['selection-a', 'selection-b'],
      }),
    );
    fireEvent.keyDown(grid, { key: 'ArrowDown', shiftKey: true });
    expect(onSelectionCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({
        command: 'extend-active',
        activeEntryKey: 'r:b',
        targetSelectionKey: 'selection-b',
        orderedSelectionKeys: ['selection-a', 'selection-b'],
      }),
    );
    fireEvent.keyDown(grid, { key: 'a', metaKey: true });
    expect(onSelectionCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({ command: 'select-all', activeEntryKey: 'r:b' }),
    );
    fireEvent.click(screen.getByRole('row', { name: 'Selectable A' }));
    expect(screen.getByRole('row', { name: 'Selectable A' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(onActiveEntryChange).toHaveBeenLastCalledWith('r:a');
    expect(onSelectionCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({
        command: 'replace',
        targetSelectionKey: 'selection-a',
        modifiers: { shiftKey: false, metaKey: false, ctrlKey: false },
      }),
    );
    fireEvent.click(screen.getByRole('row', { name: 'Selectable B' }), { shiftKey: true });
    expect(onSelectionCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({
        command: 'range',
        targetSelectionKey: 'selection-b',
        modifiers: { shiftKey: true, metaKey: false, ctrlKey: false },
      }),
    );
    fireEvent.click(screen.getByRole('row', { name: 'Selectable B' }), { ctrlKey: true });
    expect(onSelectionCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({
        command: 'toggle',
        targetSelectionKey: 'selection-b',
        modifiers: { shiftKey: false, metaKey: false, ctrlKey: true },
      }),
    );
    fireEvent.keyDown(grid, { key: 'Escape' });
    expect(onSelectionCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({ command: 'clear', activeEntryKey: 'r:b' }),
    );
    expect(grid).not.toHaveAttribute('aria-activedescendant');
    expect(onActiveEntryChange).toHaveBeenLastCalledWith(null);
    for (const row of screen.getAllByRole('row').slice(1))
      expect(row).toHaveAttribute('tabindex', '-1');
  });

  it('clears the host active entry when an update removes every flattened entry', async () => {
    const onActiveEntryChange = vi.fn<(entryKey: string | null) => void>();
    const { rerender } = render(
      <EntityTable
        aria-label="Changing resources"
        columns={COLUMNS}
        rows={[{ id: 'active', name: 'Active resource' }]}
        getRowKey={(row) => row.id}
        onActiveEntryChange={onActiveEntryChange}
        virtualized
      />,
    );

    const grid = screen.getByRole('grid', { name: 'Changing resources' });
    await screen.findByRole('row', { name: 'Active resource' });
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(grid).toHaveAttribute('aria-activedescendant');
    expect(onActiveEntryChange).toHaveBeenLastCalledWith('r:active');

    rerender(
      <EntityTable
        aria-label="Changing resources"
        columns={COLUMNS}
        rows={[]}
        getRowKey={(row) => row.id}
        onActiveEntryChange={onActiveEntryChange}
        virtualized
      />,
    );

    await waitFor(() => {
      expect(grid).not.toHaveAttribute('aria-activedescendant');
      expect(onActiveEntryChange).toHaveBeenLastCalledWith(null);
    });
  });

  it('uses rowHeight for measured rows and keeps the sticky header in the table scrollport', async () => {
    render(
      <EntityTable
        aria-label="Tall resources"
        columns={COLUMNS}
        rows={rows(20)}
        getRowKey={(row) => row.id}
        rowHeight={56}
        virtualized
      />,
    );

    const grid = screen.getByRole('grid', { name: 'Tall resources' });
    const header = screen.getByRole('columnheader', { name: 'Name' }).parentElement;
    expect(header).toHaveClass('sticky', 'top-0');
    expect(header?.parentElement).toBe(grid);
    const firstRow = await screen.findByRole('row', { name: 'Resource 0' });
    expect(firstRow).toHaveStyle({ '--row-h': '56px' });
    expect(firstRow.parentElement).toHaveStyle({ transform: 'translateY(0px)' });
    const secondRow = screen.getByRole('row', { name: 'Resource 1' });
    expect(secondRow.parentElement).toHaveStyle({ transform: 'translateY(56px)' });
    fireEvent.scroll(grid, { target: { scrollTop: 112 } });
    expect(header?.parentElement).toBe(grid);
  });

  it('keeps a 10,000-row collection below 100 mounted row elements', async () => {
    render(
      <EntityTable
        aria-label="Resources"
        columns={COLUMNS}
        rows={rows(10_000)}
        getRowKey={(row) => row.id}
        virtualized
      />,
    );

    await waitFor(() => {
      const mounted = screen.getAllByRole('row').length - 1;
      expect(mounted).toBeGreaterThan(0);
      expect(mounted).toBeLessThanOrEqual(100);
    });
    expect(screen.getByRole('grid', { name: 'Resources' })).toHaveAttribute(
      'aria-rowcount',
      '10001',
    );
  });

  it('exposes the active virtual row through grid accessibility metadata', async () => {
    render(
      <EntityTable
        aria-label="Resources"
        columns={COLUMNS}
        rows={rows(10)}
        getRowKey={(row) => row.id}
        virtualized
      />,
    );

    const grid = screen.getByRole('grid', { name: 'Resources' });
    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' });

    const activeId = grid.getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();
    expect(document.getElementById(activeId ?? '')).toHaveAttribute('aria-rowindex', '2');
    expect(screen.getByRole('row', { name: /Resource 0/ })).toHaveAttribute('aria-rowindex', '2');
  });

  it('activates a linked row with Enter when no row click handler is provided', async () => {
    const onLinkClick = vi.fn<(event: React.MouseEvent<HTMLAnchorElement>) => void>((event) => {
      event.preventDefault();
    });
    render(
      <EntityTable
        aria-label="Resources"
        columns={COLUMNS}
        rows={rows(2)}
        getRowKey={(row) => row.id}
        rowHref={(row) => `/resources/${row.id}`}
        rowLinkColumnKey="name"
        renderRowLink={(props) => <a {...props} onClick={onLinkClick} />}
        virtualized
      />,
    );

    const grid = screen.getByRole('grid', { name: 'Resources' });
    await screen.findByRole('link', { name: 'Resource 0' });
    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'Enter' });

    expect(onLinkClick).toHaveBeenCalledTimes(1);
  });

  it('keeps the active resource when group rows move around it', async () => {
    const original: readonly EntityTableGroup<Row>[] = [
      { id: 'launch', label: 'Q3 launch', rows: [{ id: 'target', name: 'Target' }] },
    ];
    const { rerender } = render(
      <EntityTable
        aria-label="Resources"
        columns={COLUMNS}
        groups={original}
        getRowKey={(row) => row.id}
        virtualized
      />,
    );

    const grid = screen.getByRole('grid', { name: 'Resources' });
    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(screen.getByRole('row', { name: 'Target' })).toHaveAttribute('aria-current', 'true');

    rerender(
      <EntityTable
        aria-label="Resources"
        columns={COLUMNS}
        groups={[
          { id: 'new', label: 'New context', rows: [{ id: 'other', name: 'Other' }] },
          ...original,
        ]}
        getRowKey={(row) => row.id}
        virtualized
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole('row', { name: 'Target' })).toHaveAttribute('aria-current', 'true');
    });
  });

  it('renders group headers, preserves collapse, and keeps keyboard activation', async () => {
    const onRowClick = vi.fn<(row: Row) => void>();
    const groups: readonly EntityTableGroup<Row>[] = [
      { id: 'launch', label: 'Q3 launch', rows: rows(2) },
      { id: 'unreferenced', label: 'Unreferenced', rows: [{ id: 'orphan', name: 'Orphan' }] },
    ];
    render(
      <EntityTable
        aria-label="Resources"
        columns={COLUMNS}
        groups={groups}
        getRowKey={(row) => row.id}
        onRowClick={onRowClick}
        virtualized
      />,
    );

    const grid = screen.getByRole('grid', { name: 'Resources' });
    await screen.findByRole('row', { name: /Q3 launch/ });
    fireEvent.click(screen.getByRole('row', { name: /Q3 launch/ }));
    expect(screen.queryByRole('row', { name: /Resource 0/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('row', { name: /Q3 launch/ }));
    expect(await screen.findByRole('row', { name: /Resource 0/ })).toBeInTheDocument();

    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(onRowClick).toHaveBeenCalledWith({ id: 'row-0', name: 'Resource 0' });
  });

  it('calls the end callback once per loaded extent and renders the end adornment', async () => {
    const onEndReached = vi.fn();
    const { rerender } = render(
      <EntityTable
        aria-label="Resources"
        columns={COLUMNS}
        rows={rows(3)}
        getRowKey={(row) => row.id}
        virtualized
        onEndReached={onEndReached}
        endAdornment={<button type="button">Retry</button>}
      />,
    );

    await waitFor(() => {
      expect(onEndReached).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    rerender(
      <EntityTable
        aria-label="Resources"
        columns={COLUMNS}
        rows={rows(4)}
        getRowKey={(row) => row.id}
        virtualized
        onEndReached={onEndReached}
        endAdornment={<button type="button">Retry</button>}
      />,
    );
    await waitFor(() => {
      expect(onEndReached).toHaveBeenCalledTimes(2);
    });
  });
});
