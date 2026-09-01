import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  type Column,
  EntityTable,
  type EntityTableGroup,
  type EntityTableProps,
  type EntityTableRowInteraction,
} from '../../../src/components/views/EntityTable';
import { priorityVisibility } from '../../../src/components/views/entity-table-columns';
import { assertDefined } from '@docket/test-utils';

/** A minimal row shape for the table under test. */
interface Row {
  id: string;
  name: string;
  status: string;
  estimate: string;
}

const ROWS: Row[] = [
  { id: 'r1', name: 'Billing revamp', status: 'Active', estimate: '1h 30m' },
  { id: 'r2', name: 'Auth migration', status: 'Planned', estimate: '45m' },
  { id: 'r3', name: 'Search rewrite', status: 'Completed', estimate: '2h' },
];

/** A representative column set: a glyph, the flexing title, and aligned property columns. */
const COLUMNS: Column<Row>[] = [
  {
    key: 'glyph',
    header: '',
    width: '1.25rem',
    priority: 'always',
    render: (row) => <span data-testid={`glyph-${row.id}`}>•</span>,
  },
  {
    key: 'name',
    header: 'Title',
    flex: true,
    render: (row) => <span className="truncate">{row.name}</span>,
  },
  {
    key: 'status',
    header: 'Status',
    width: '6rem',
    priority: 2,
    render: (row) => <span>{row.status}</span>,
  },
  {
    key: 'estimate',
    header: 'Estimate',
    align: 'end',
    minWidth: '4rem',
    priority: 3,
    render: (row) => <span className="tabular-nums">{row.estimate}</span>,
  },
];

function getRowKey(row: Row): string {
  return row.id;
}

describe('EntityTable — header band', () => {
  it('renders a quiet columnheader band without a divider', () => {
    render(<EntityTable aria-label="Items" columns={COLUMNS} rows={ROWS} getRowKey={getRowKey} />);
    const grid = screen.getByRole('grid', { name: 'Items' });
    const headers = within(grid).getAllByRole('columnheader');
    expect(headers).toHaveLength(4);
    // The labelled property headers read as plain text — no uppercase / tracking eyebrow.
    const titleHeader = screen.getByRole('columnheader', { name: 'Title' });
    expect(titleHeader).not.toHaveClass('uppercase', 'tracking-wide');
    // The header band uses type and whitespace instead of adding a non-MD3 divider.
    const headerRow = titleHeader.parentElement;
    expect(headerRow).toHaveClass('text-on-surface-variant', 'text-xs');
    expect(headerRow).not.toHaveClass('border-b', 'border-outline-variant');
  });

  it('omits the header band when hideHeader is set', () => {
    render(
      <EntityTable
        aria-label="Items"
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={getRowKey}
        hideHeader
      />,
    );
    expect(screen.queryByRole('columnheader')).not.toBeInTheDocument();
  });

  it('marks sortable columns with aria-sort and leaves the rest unmarked', () => {
    const cols: Column<Row>[] = [
      { key: 'name', header: 'Title', flex: true, sortable: true, render: (r) => r.name },
      { key: 'status', header: 'Status', render: (r) => r.status },
    ];
    render(<EntityTable aria-label="Items" columns={cols} rows={ROWS} getRowKey={getRowKey} />);
    expect(screen.getByRole('columnheader', { name: 'Title' })).toHaveAttribute(
      'aria-sort',
      'none',
    );
    expect(screen.getByRole('columnheader', { name: 'Status' })).not.toHaveAttribute('aria-sort');
  });
});

describe('EntityTable — column alignment + sizing', () => {
  it('keeps a flex column minimum aligned between its header and every data row', () => {
    const columns: Column<Row>[] = [
      {
        key: 'name',
        header: 'Title',
        flex: true,
        minWidth: '22rem',
        render: (row) => row.name,
      },
    ];
    const { container } = render(
      <EntityTable aria-label="Items" columns={columns} rows={ROWS} getRowKey={getRowKey} />,
    );

    const nameCells = container.querySelectorAll('[data-col="name"]');
    expect(nameCells).toHaveLength(4);
    nameCells.forEach((cell) => {
      expect(cell).toHaveStyle({ minWidth: '22rem' });
    });
  });

  it('uses the same container tier for each responsive header and data cell', () => {
    const expected = [
      [1, 'hidden @md/table:flex'],
      [2, 'hidden @lg/table:flex'],
      [3, 'hidden @xl/table:flex'],
      [4, 'hidden @2xl/table:flex'],
      [5, 'hidden @3xl/table:flex'],
      [6, 'hidden @4xl/table:flex'],
      [7, 'hidden @5xl/table:flex'],
      [8, 'hidden @6xl/table:flex'],
      [9, 'hidden @7xl/table:flex'],
    ] as const;
    const columns: Column<Row>[] = expected.map(([priority]) => ({
      key: `priority-${String(priority)}`,
      header: `Priority ${String(priority)}`,
      priority,
      render: (row) => row.name,
    }));
    const { container } = render(
      <EntityTable
        aria-label="Priority table"
        columns={columns}
        rows={[assertDefined(ROWS[0])]}
        getRowKey={getRowKey}
      />,
    );

    for (const [priority, classes] of expected) {
      expect(priorityVisibility(priority)).toBe(classes);
      const cells = container.querySelectorAll(`[data-col="priority-${String(priority)}"]`);
      expect(cells).toHaveLength(2);
      cells.forEach((cell) => {
        for (const className of classes.split(' ')) expect(cell).toHaveClass(className);
      });
    }
  });

  it('locks every cell to its header width/alignment so columns line up', () => {
    const { container } = render(
      <EntityTable aria-label="Items" columns={COLUMNS} rows={ROWS} getRowKey={getRowKey} />,
    );
    // A fixed-width property column carries the same inline width on header + every body cell.
    const statusCells = container.querySelectorAll('[data-col="status"]');
    expect(statusCells.length).toBe(4); // 1 header + 3 body rows
    statusCells.forEach((cell) => {
      expect(cell).toHaveStyle({ width: '6rem' });
    });
    // The flex/title column flexes and truncates; the end-aligned column right-justifies.
    const titleCell = container.querySelector('[data-col="name"][role="gridcell"]');
    expect(titleCell).toHaveClass('flex-1', 'min-w-0');
    const estimateCell = container.querySelector('[data-col="estimate"][role="gridcell"]');
    expect(estimateCell).toHaveClass('justify-end', 'text-right');
  });

  it('applies the responsive priority visibility so low-priority columns hide on narrow containers', () => {
    const { container } = render(
      <EntityTable aria-label="Items" columns={COLUMNS} rows={ROWS} getRowKey={getRowKey} />,
    );
    // priority 'always' (glyph) + flex (title) are always shown; status (2) and estimate (3) gate.
    const glyphCell = container.querySelector('[data-col="glyph"][role="gridcell"]');
    expect(glyphCell).toHaveClass('flex');
    expect(glyphCell).not.toHaveClass('hidden');
    const statusCell = container.querySelector('[data-col="status"][role="gridcell"]');
    expect(statusCell).toHaveClass('hidden', '@lg/table:flex');
    const estimateCell = container.querySelector('[data-col="estimate"][role="gridcell"]');
    expect(estimateCell).toHaveClass('hidden', '@xl/table:flex');
  });

  it('is its own container and scrolls horizontally within its panel (no app overflow)', () => {
    render(<EntityTable aria-label="Items" columns={COLUMNS} rows={ROWS} getRowKey={getRowKey} />);
    const grid = screen.getByRole('grid', { name: 'Items' });
    expect(grid).toHaveClass('@container/table', 'overflow-x-auto', 'rounded-xl', 'border');
  });
});

describe('EntityTable — rows + chrome', () => {
  it('renders caller-owned hierarchy metadata on data rows in treegrid mode', () => {
    render(
      <EntityTable
        aria-label="Hierarchy"
        gridRole="treegrid"
        columns={COLUMNS}
        rows={[assertDefined(ROWS[0])]}
        getRowKey={getRowKey}
        getRowAria={() => ({ level: 3, posInSet: 2, setSize: 5, expanded: false })}
      />,
    );

    expect(screen.getByRole('treegrid', { name: 'Hierarchy' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Billing revamp/ })).toHaveAttribute('aria-level', '3');
    expect(screen.getByRole('row', { name: /Billing revamp/ })).toHaveAttribute(
      'aria-posinset',
      '2',
    );
    expect(screen.getByRole('row', { name: /Billing revamp/ })).toHaveAttribute(
      'aria-setsize',
      '5',
    );
    expect(screen.getByRole('row', { name: /Billing revamp/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('keeps the outlined default and makes the table itself the tonal roster surface', () => {
    const { rerender } = render(
      <EntityTable aria-label="Items" columns={COLUMNS} rows={ROWS} getRowKey={getRowKey} />,
    );
    expect(screen.getByRole('grid', { name: 'Items' })).toHaveClass(
      'bg-surface',
      'border',
      'rounded-xl',
    );

    rerender(
      <EntityTable
        aria-label="Items"
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={getRowKey}
        tone="tonal"
      />,
    );
    expect(screen.getByRole('grid', { name: 'Items' })).toHaveClass(
      'bg-surface-container-low',
      'rounded-xl',
    );
    expect(screen.getByRole('grid', { name: 'Items' })).not.toHaveClass('border');
    expect(screen.getByRole('row', { name: /Billing revamp/ })).toHaveClass(
      'bg-surface-container-low',
    );
  });

  it('renders one role=row per data row with cells reconciled to the row density', () => {
    render(<EntityTable aria-label="Items" columns={COLUMNS} rows={ROWS} getRowKey={getRowKey} />);
    // 1 header row + 3 data rows.
    expect(screen.getAllByRole('row')).toHaveLength(4);
    const dataRow = screen.getByRole('row', { name: /Billing revamp/ });
    expect(dataRow).toHaveClass(
      'min-h-(--row-h)',
      'px-3',
      'py-(--row-py)',
      'border-b',
      'focus-visible:ring-1',
    );
    expect(within(dataRow).getByTestId('glyph-r1')).toBeInTheDocument();
  });

  it('renders a button row by default and fires onRowClick on click and Enter', () => {
    const onRowClick = vi.fn<(row: Row) => void>();
    render(
      <EntityTable
        aria-label="Items"
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={getRowKey}
        onRowClick={onRowClick}
      />,
    );
    const row = screen.getByRole('row', { name: /Billing revamp/ });
    expect(row.tagName).toBe('BUTTON');
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: 'x' });
    expect(onRowClick).toHaveBeenCalledTimes(2);
    expect(onRowClick).toHaveBeenLastCalledWith(ROWS[0]);
  });

  it('renders an anchor row when rowHref returns a target and does not synthesize Enter activation', () => {
    const onRowClick = vi.fn<(row: Row) => void>();
    render(
      <EntityTable
        aria-label="Items"
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={getRowKey}
        rowHref={(row) => `/items/${row.id}`}
        onRowClick={onRowClick}
      />,
    );
    const row = screen.getByRole('row', { name: /Billing revamp/ });
    expect(row.tagName).toBe('A');
    expect(row).toHaveAttribute('href', '/items/r1');
    row.addEventListener('click', (event) => {
      event.preventDefault();
    });
    fireEvent.click(row); // click still records (selection/recording) + navigates
    fireEvent.keyDown(row, { key: 'Enter' }); // Enter is left to the browser's navigation
    expect(onRowClick).toHaveBeenCalledTimes(1);
  });

  it('renders an inert button row with no handlers and does not throw on click/Enter', () => {
    render(<EntityTable aria-label="Items" columns={COLUMNS} rows={ROWS} getRowKey={getRowKey} />);
    const row = screen.getByRole('row', { name: /Billing revamp/ });
    expect(() => {
      fireEvent.click(row);
      fireEvent.keyDown(row, { key: 'Enter' });
    }).not.toThrow();
  });

  it('renders an empty table (no rows, no groups) with just the header band', () => {
    render(<EntityTable aria-label="Items" columns={COLUMNS} getRowKey={getRowKey} />);
    // Only the header row remains; there are no data rows.
    expect(screen.getAllByRole('row')).toHaveLength(1);
    expect(screen.getByRole('grid', { name: 'Items' })).toHaveAttribute('aria-rowcount', '1');
  });

  it('marks a link row both active (keyboard) and selected with the matching data/aria attributes', () => {
    render(
      <EntityTable
        aria-label="Items"
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={getRowKey}
        rowHref={(row) => `/items/${row.id}`}
        selected={new Set(['r1'])}
        onSelect={vi.fn()}
      />,
    );
    const grid = screen.getByRole('grid', { name: 'Items' });
    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' }); // -> first data row (Billing revamp) active
    const row = screen.getByRole('row', { name: /Billing revamp/ });
    expect(row).toHaveAttribute('aria-current', 'true');
    expect(row).toHaveAttribute('aria-selected', 'true');
    expect(row).toHaveAttribute('data-active', '');
    expect(row).toHaveAttribute('data-selected', '');
  });

  it('renders via a custom renderRowLink slot (a router Link)', () => {
    render(
      <EntityTable
        aria-label="Items"
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={getRowKey}
        rowHref={(row) => `/items/${row.id}`}
        renderRowLink={(lp) => (
          <a data-testid={`link`} href={lp.href} className={lp.className} onClick={lp.onClick}>
            {lp.children}
          </a>
        )}
      />,
    );
    const links = screen.getAllByTestId('link');
    expect(links[0]).toHaveAttribute('href', '/items/r1');
    expect(links[0]).toHaveClass('min-h-(--row-h)');
    expect(within(assertDefined(links[0])).getByText('Billing revamp')).toBeInTheDocument();
  });
});

describe('EntityTable — selection', () => {
  it('opens once from row whitespace and leaves nested controls in charge', () => {
    const onRowClick = vi.fn();
    const anchorClick = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const columns: Column<Row>[] = [
      { key: 'name', header: 'Name', flex: true, render: (row) => row.name },
      {
        key: 'control',
        header: 'Control',
        render: () => <button type="button">Edit</button>,
      },
    ];
    render(
      <EntityTable
        aria-label="Items"
        columns={columns}
        rows={[assertDefined(ROWS[0])]}
        getRowKey={getRowKey}
        rowHref={(row) => `/items/${row.id}`}
        rowLinkColumnKey="name"
        onRowClick={onRowClick}
      />,
    );

    const row = screen.getByRole('row', { name: /Billing revamp/ });
    fireEvent.click(row);
    expect(onRowClick).toHaveBeenCalledOnce();

    fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    expect(onRowClick).toHaveBeenCalledOnce();

    fireEvent(row, new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(anchorClick.mock.instances[0]).toHaveAttribute('href', '/items/r1');
    expect(anchorClick.mock.instances[0]).toHaveAttribute('target', '_blank');
  });

  it('binds injected drag and drop refs without giving the row a second focus model', () => {
    const onRowClick = vi.fn();
    const register = vi.fn();
    const columns: Column<Row>[] = [
      { key: 'select', header: 'Select', width: '1rem', render: () => <input type="checkbox" /> },
      ...COLUMNS,
    ];
    render(
      <EntityTable
        aria-label="Items"
        columns={columns}
        rows={[assertDefined(ROWS[0])]}
        getRowKey={getRowKey}
        rowHref={(row) => `/items/${row.id}`}
        rowLinkColumnKey="name"
        onRowClick={onRowClick}
        renderRowInteraction={({ children }) =>
          children({
            selected: true,
            interactionRef: register,
            rowProps: {
              'aria-selected': true,
              'data-selected': true,
              onClick: onRowClick,
            },
            className: 'ring-primary',
          })
        }
      />,
    );

    const row = screen.getByRole('row', { name: /Billing revamp/ });
    expect(row.tagName).toBe('DIV');
    expect(row).toHaveAttribute('aria-selected', 'true');
    expect(row).not.toHaveAttribute('tabindex', '0');
    expect(row).toHaveClass('bg-secondary-container', 'ring-primary');
    expect(register).toHaveBeenCalledWith(row);
    expect(within(row).getByRole('checkbox')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Billing revamp' })).toHaveAttribute(
      'href',
      '/items/r1',
    );
    fireEvent.click(row);
    expect(onRowClick).toHaveBeenCalledOnce();
  });

  it('rejects injected container keyboard ownership and row focus props at the type boundary', () => {
    const container = {
      ref: (_element: HTMLElement | null) => undefined,
      onScroll: () => undefined,
    } satisfies NonNullable<EntityTableProps<Row>['containerInteraction']>;
    const interaction = {
      selected: false,
      interactionRef: (_element: HTMLElement | null) => undefined,
      rowProps: {
        'aria-selected': false,
        'data-selected': false,
        onClick: () => undefined,
      },
    } satisfies EntityTableRowInteraction;

    const invalidContainer = {
      // @ts-expect-error EntityTable is the only container keyboard owner.
      onKeyDown: () => undefined,
    } satisfies NonNullable<EntityTableProps<Row>['containerInteraction']>;
    const invalidRow = {
      selected: false,
      rowProps: {
        'aria-selected': false,
        'data-selected': false,
        // @ts-expect-error EntityTable rows never receive an injected roving tab index.
        tabIndex: 0,
      },
    } satisfies EntityTableRowInteraction;

    expect(container.onScroll).toBeTypeOf('function');
    expect(interaction.interactionRef).toBeTypeOf('function');
    expect(invalidContainer).toBeDefined();
    expect(invalidRow).toBeDefined();
  });

  it('adopts the MD3 selected tone for rows in the selected set and toggles via onSelect', () => {
    const onSelect = vi.fn<(row: Row, next: boolean) => void>();
    render(
      <EntityTable
        aria-label="Items"
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={getRowKey}
        selected={new Set(['r2'])}
        onSelect={onSelect}
      />,
    );
    const selectedRow = screen.getByRole('row', { name: /Auth migration/ });
    expect(selectedRow).toHaveAttribute('data-selected', '');
    expect(selectedRow).toHaveClass('bg-secondary-container');

    const unselectedRow = screen.getByRole('row', { name: /Billing revamp/ });
    expect(unselectedRow).not.toHaveAttribute('data-selected');
    // Clicking an unselected row asks to select it; clicking a selected one asks to deselect.
    fireEvent.click(unselectedRow);
    expect(onSelect).toHaveBeenLastCalledWith(ROWS[0], true);
    fireEvent.click(selectedRow);
    expect(onSelect).toHaveBeenLastCalledWith(ROWS[1], false);
  });

  it('treats every row as unselected when the selected prop is entirely omitted', () => {
    const onSelect = vi.fn<(row: Row, next: boolean) => void>();
    render(
      <EntityTable
        aria-label="Items"
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={getRowKey}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole('row', { name: /Billing revamp/ }));
    expect(onSelect).toHaveBeenCalledWith(ROWS[0], true);
  });
});

describe('EntityTable — prefetch', () => {
  it('warms the row destination cache on hover/focus via onRowPrefetch (link rows only)', () => {
    const onRowPrefetch = vi.fn<(row: Row) => void>();
    render(
      <EntityTable
        aria-label="Items"
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={getRowKey}
        rowHref={(row) => `/items/${row.id}`}
        onRowPrefetch={onRowPrefetch}
      />,
    );
    const row = screen.getByRole('row', { name: /Billing revamp/ });
    fireEvent.mouseEnter(row);
    expect(onRowPrefetch).toHaveBeenCalledWith(ROWS[0]);
    fireEvent.focus(row);
    expect(onRowPrefetch).toHaveBeenCalledTimes(2);
  });
});

describe('EntityTable — grouping', () => {
  // Group labels deliberately distinct from any cell text so a `row` name matcher is unambiguous.
  const GROUPS: EntityTableGroup<Row>[] = [
    { id: 'g-one', label: 'First bucket', rows: [assertDefined(ROWS[0])] },
    { id: 'g-two', label: 'Second bucket', rows: [assertDefined(ROWS[1])] },
  ];

  it('preserves nested server order, authoritative counts, full-path row keys, and collapse scope', () => {
    const nestedGroups: readonly EntityTableGroup<Row>[] = [
      {
        id: 'release%2Falpha',
        label: 'Release alpha',
        count: 8,
        children: [
          {
            id: 'release%2Falpha/active%20work',
            label: 'Active work',
            count: 5,
            rows: [{ id: 'duplicate', name: 'Alpha duplicate', status: 'Active', estimate: '1h' }],
          },
        ],
      },
      {
        id: 'release%2Fbeta',
        label: 'Release beta',
        count: 4,
        rows: [{ id: 'duplicate', name: 'Beta duplicate', status: 'Planned', estimate: '2h' }],
      },
    ];
    render(
      <EntityTable
        aria-label="Nested items"
        columns={COLUMNS}
        groups={nestedGroups}
        getRowKey={getRowKey}
      />,
    );

    const rows = screen.getAllByRole('row');
    expect(rows.map((row) => row.textContent)).toEqual([
      'TitleStatusEstimate',
      expect.stringContaining('Release alpha8'),
      expect.stringContaining('Active work5'),
      expect.stringContaining('Alpha duplicate'),
      expect.stringContaining('Release beta4'),
      expect.stringContaining('Beta duplicate'),
    ]);
    expect(screen.getByRole('row', { name: /Active work/ })).toHaveAttribute('data-level', '1');
    expect(screen.getByRole('row', { name: /Alpha duplicate/ })).toHaveAttribute(
      'data-entry-key',
      'r:release%2Falpha/active%20work:duplicate',
    );
    expect(screen.getByRole('row', { name: /Beta duplicate/ })).toHaveAttribute(
      'data-entry-key',
      'r:release%2Fbeta:duplicate',
    );

    fireEvent.click(screen.getByRole('row', { name: /Active work/ }));
    expect(screen.queryByRole('row', { name: /Alpha duplicate/ })).not.toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Beta duplicate/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Release alpha/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('activates idle group and error root continuations through pointer and Enter', () => {
    const loadGroup = vi.fn();
    const retryRoot = vi.fn();
    const groups: readonly EntityTableGroup<Row>[] = [
      {
        id: 'release',
        label: 'Release',
        rows: [assertDefined(ROWS[0])],
        continuation: {
          id: 'continue-release',
          label: 'Load more release items',
          state: 'idle',
          onActivate: loadGroup,
        },
      },
    ];
    const { unmount } = render(
      <EntityTable
        aria-label="Grouped items"
        columns={COLUMNS}
        groups={groups}
        getRowKey={getRowKey}
      />,
    );

    const groupAction = screen.getByRole('button', { name: 'Load more release items' });
    expect(groupAction).toHaveAttribute('id', 'continue-release');
    expect(groupAction).toHaveAttribute('tabindex', '-1');
    expect(groupAction.closest('[role="row"]')).toContainElement(
      groupAction.closest('[role="gridcell"]'),
    );
    fireEvent.click(groupAction);
    const groupedGrid = screen.getByRole('grid', { name: 'Grouped items' });
    expect(groupedGrid).toHaveAttribute(
      'aria-activedescendant',
      groupAction.closest('[role="row"]')?.id,
    );
    fireEvent.keyDown(groupedGrid, { key: 'End' });
    fireEvent.keyDown(groupedGrid, { key: 'Enter' });
    expect(loadGroup).toHaveBeenCalledTimes(2);

    unmount();
    render(
      <EntityTable
        aria-label="Root items"
        columns={COLUMNS}
        rows={[assertDefined(ROWS[0])]}
        getRowKey={getRowKey}
        continuation={{
          id: 'retry-root',
          label: 'Retry loading items',
          state: 'error',
          onActivate: retryRoot,
        }}
      />,
    );
    const rootGrid = screen.getByRole('grid', { name: 'Root items' });
    fireEvent.keyDown(rootGrid, { key: 'End' });
    fireEvent.keyDown(rootGrid, { key: 'Enter' });
    expect(retryRoot).toHaveBeenCalledOnce();
  });

  it('keeps loading continuations busy and unable to start duplicate requests', () => {
    const loadMore = vi.fn();
    const { rerender } = render(
      <EntityTable
        aria-label="Loading items"
        columns={COLUMNS}
        rows={[assertDefined(ROWS[0])]}
        getRowKey={getRowKey}
        continuation={{
          id: 'loading-root',
          label: 'Load more items',
          state: 'idle',
          onActivate: loadMore,
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load more items' }));
    expect(loadMore).toHaveBeenCalledOnce();

    rerender(
      <EntityTable
        aria-label="Loading items"
        columns={COLUMNS}
        rows={[assertDefined(ROWS[0])]}
        getRowKey={getRowKey}
        continuation={{ id: 'loading-root', label: 'Loading more items', state: 'loading' }}
      />,
    );

    const loading = screen.getByRole('button', { name: 'Loading more items' });
    expect(loading).toHaveAttribute('aria-disabled', 'true');
    expect(loading).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(loading);
    const grid = screen.getByRole('grid', { name: 'Loading items' });
    fireEvent.keyDown(grid, { key: 'End' });
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(loadMore).toHaveBeenCalledOnce();
  });

  it('renders full-width group header rows spanning the table with their data rows beneath', () => {
    render(
      <EntityTable aria-label="Items" columns={COLUMNS} groups={GROUPS} getRowKey={getRowKey} />,
    );
    // The group header rows expose aria-expanded (the GroupHeader contract) + a count.
    const groupHeader = screen.getByRole('row', { name: /First bucket/ });
    expect(groupHeader).toHaveAttribute('aria-expanded', 'true');
    expect(within(groupHeader).getByText('1')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Billing revamp/ })).toBeInTheDocument();
  });

  it('collapses a group (uncontrolled): its data rows are omitted but the header stays', () => {
    render(
      <EntityTable
        aria-label="Items"
        columns={COLUMNS}
        groups={GROUPS}
        getRowKey={getRowKey}
        defaultCollapsed={['g-one']}
      />,
    );
    expect(screen.getByRole('row', { name: /First bucket/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('row', { name: /Billing revamp/ })).not.toBeInTheDocument();
    // The non-collapsed group still shows its rows.
    expect(screen.getByRole('row', { name: /Auth migration/ })).toBeInTheDocument();
  });

  it('toggles a group on header click (uncontrolled)', () => {
    render(
      <EntityTable aria-label="Items" columns={COLUMNS} groups={GROUPS} getRowKey={getRowKey} />,
    );
    const header = screen.getByRole('row', { name: /First bucket/ });
    expect(screen.getByRole('row', { name: /Billing revamp/ })).toBeInTheDocument();
    fireEvent.click(header);
    expect(screen.queryByRole('row', { name: /Billing revamp/ })).not.toBeInTheDocument();
  });

  it('re-expands an already-collapsed group on a second header click (uncontrolled)', () => {
    render(
      <EntityTable
        aria-label="Items"
        columns={COLUMNS}
        groups={GROUPS}
        getRowKey={getRowKey}
        defaultCollapsed={['g-one']}
      />,
    );
    expect(screen.queryByRole('row', { name: /Billing revamp/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('row', { name: /First bucket/ }));
    expect(screen.getByRole('row', { name: /Billing revamp/ })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /First bucket/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('drives collapse externally in controlled mode via collapsed + onToggleGroup', () => {
    const onToggleGroup = vi.fn<(id: string) => void>();
    render(
      <EntityTable
        aria-label="Items"
        columns={COLUMNS}
        groups={GROUPS}
        getRowKey={getRowKey}
        collapsed={new Set(['g-two'])}
        onToggleGroup={onToggleGroup}
      />,
    );
    // Controlled: 'g-two' is collapsed and internal state never changes it.
    expect(screen.queryByRole('row', { name: /Auth migration/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('row', { name: /First bucket/ }));
    expect(onToggleGroup).toHaveBeenCalledWith('g-one');
    // Still collapsed (host owns the state) and the first group's row is still shown.
    expect(screen.queryByRole('row', { name: /Auth migration/ })).not.toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Billing revamp/ })).toBeInTheDocument();
  });
});

describe('EntityTable — keyboard navigation', () => {
  it('moves the active row with arrows and activates it with Enter', () => {
    const onRowClick = vi.fn<(row: Row) => void>();
    render(
      <EntityTable
        aria-label="Items"
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={getRowKey}
        onRowClick={onRowClick}
      />,
    );
    const grid = screen.getByRole('grid', { name: 'Items' });
    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' }); // -> first data row active
    expect(screen.getByRole('row', { name: /Billing revamp/ })).toHaveAttribute('data-active', '');
    fireEvent.keyDown(grid, { key: 'ArrowDown' }); // -> second
    expect(screen.getByRole('row', { name: /Auth migration/ })).toHaveAttribute('data-active', '');
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(onRowClick).toHaveBeenCalledWith(ROWS[1]);
  });

  it('Enter on an active group header row toggles that group', () => {
    const GROUPS: EntityTableGroup<Row>[] = [
      { id: 'g-one', label: 'First bucket', rows: [assertDefined(ROWS[0])] },
    ];
    render(
      <EntityTable aria-label="Items" columns={COLUMNS} groups={GROUPS} getRowKey={getRowKey} />,
    );
    const grid = screen.getByRole('grid', { name: 'Items' });
    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' }); // -> the group header is the first flat row
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(screen.queryByRole('row', { name: /Billing revamp/ })).not.toBeInTheDocument();
  });

  it('clears the active row on Escape', () => {
    render(<EntityTable aria-label="Items" columns={COLUMNS} rows={ROWS} getRowKey={getRowKey} />);
    const grid = screen.getByRole('grid', { name: 'Items' });
    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(screen.getByRole('row', { name: /Billing revamp/ })).toHaveAttribute('data-active', '');
    fireEvent.keyDown(grid, { key: 'Escape' });
    expect(screen.getByRole('row', { name: /Billing revamp/ })).not.toHaveAttribute('data-active');
  });

  it('moves the active cursor to the nearest remaining row when filtering removes it', () => {
    const view = render(
      <EntityTable aria-label="Items" columns={COLUMNS} rows={ROWS} getRowKey={getRowKey} />,
    );
    const grid = screen.getByRole('grid', { name: 'Items' });
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(screen.getByRole('row', { name: /Auth migration/ })).toHaveAttribute('data-active', '');

    view.rerender(
      <EntityTable
        aria-label="Items"
        columns={COLUMNS}
        rows={[assertDefined(ROWS[0]), assertDefined(ROWS[2])]}
        getRowKey={getRowKey}
      />,
    );

    expect(screen.getByRole('row', { name: /Search rewrite/ })).toHaveAttribute('data-active', '');
  });

  it('restores focus to the nearest flattened entry when a group collapses around the active row', () => {
    const groups: readonly EntityTableGroup<Row>[] = [
      {
        id: 'first',
        label: 'First group',
        rows: [assertDefined(ROWS[0]), assertDefined(ROWS[1])],
      },
      { id: 'second', label: 'Second group', rows: [assertDefined(ROWS[2])] },
    ];
    render(
      <EntityTable
        aria-label="Grouped items"
        columns={COLUMNS}
        groups={groups}
        getRowKey={getRowKey}
      />,
    );
    const grid = screen.getByRole('grid', { name: 'Grouped items' });
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(screen.getByRole('row', { name: /Auth migration/ })).toHaveAttribute('data-active', '');

    fireEvent.click(screen.getByRole('row', { name: /First group/ }));

    expect(screen.getByRole('row', { name: /Second group/ })).toHaveClass(
      'bg-surface-container-high',
    );
  });
});

describe('EntityTable — property-key hotkeys', () => {
  it('forwards a property key with the active row and its anchor element', () => {
    const onRowPropertyKey =
      vi.fn<(key: string, row: Row, anchor: HTMLElement | null) => boolean>();
    render(
      <EntityTable
        aria-label="Items"
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={getRowKey}
        onRowPropertyKey={onRowPropertyKey}
      />,
    );
    const grid = screen.getByRole('grid', { name: 'Items' });
    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'l' });
    expect(onRowPropertyKey).toHaveBeenCalledTimes(1);
    const [key, row, anchor] = assertDefined(onRowPropertyKey.mock.calls[0]);
    expect(key).toBe('l');
    expect(row).toBe(ROWS[0]);
    expect(anchor).toBe(screen.getByRole('row', { name: /Billing revamp/ }));
  });

  it('resolves the anchor when rows render through a custom renderRowLink', () => {
    const onRowPropertyKey =
      vi.fn<(key: string, row: Row, anchor: HTMLElement | null) => boolean>();
    render(
      <EntityTable
        aria-label="Items"
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={getRowKey}
        rowHref={(row) => `/items/${row.id}`}
        renderRowLink={({ children, ...linkProps }) => (
          <a data-testid="link" {...linkProps}>
            {children}
          </a>
        )}
        onRowPropertyKey={onRowPropertyKey}
      />,
    );
    const grid = screen.getByRole('grid', { name: 'Items' });
    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'l' });
    expect(onRowPropertyKey).toHaveBeenCalledWith('l', ROWS[0], screen.getAllByTestId('link')[0]);
  });

  it('never forwards a property key when the active row is a group header', () => {
    const onRowPropertyKey =
      vi.fn<(key: string, row: Row, anchor: HTMLElement | null) => boolean>();
    const GROUPS: EntityTableGroup<Row>[] = [
      { id: 'g-one', label: 'First bucket', rows: [assertDefined(ROWS[0])] },
    ];
    render(
      <EntityTable
        aria-label="Items"
        columns={COLUMNS}
        groups={GROUPS}
        getRowKey={getRowKey}
        onRowPropertyKey={onRowPropertyKey}
      />,
    );
    const grid = screen.getByRole('grid', { name: 'Items' });
    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' }); // -> the group header is the first flat row
    fireEvent.keyDown(grid, { key: 'l' });
    expect(onRowPropertyKey).not.toHaveBeenCalled();
  });

  it('prevents the default keydown when onRowPropertyKey reports it handled the key', () => {
    const onRowPropertyKey = vi.fn().mockReturnValue(true);
    render(
      <EntityTable
        aria-label="Items"
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={getRowKey}
        onRowPropertyKey={onRowPropertyKey}
      />,
    );
    const grid = screen.getByRole('grid', { name: 'Items' });
    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    const notCancelled = fireEvent.keyDown(grid, { key: 'l' });
    expect(notCancelled).toBe(false); // dispatchEvent returns false once preventDefault runs
  });

  it('does nothing when no onRowPropertyKey handler is supplied', () => {
    render(<EntityTable aria-label="Items" columns={COLUMNS} rows={ROWS} getRowKey={getRowKey} />);
    const grid = screen.getByRole('grid', { name: 'Items' });
    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(() => {
      fireEvent.keyDown(grid, { key: 'l' });
    }).not.toThrow();
  });
});
