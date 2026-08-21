import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  type Column,
  EntityTable,
  type EntityTableGroup,
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
    get: () => ROW_HEIGHT,
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
    expect(onRowClick).toHaveBeenCalledWith(groups[0]?.rows[0]);
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
