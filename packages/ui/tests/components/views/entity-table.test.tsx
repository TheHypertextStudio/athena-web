import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  type Column,
  EntityTable,
  type EntityTableGroup,
} from '../../../src/components/views/EntityTable';

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
  it('renders a light, hairline-bordered columnheader band (not an eyebrow)', () => {
    render(<EntityTable aria-label="Items" columns={COLUMNS} rows={ROWS} getRowKey={getRowKey} />);
    const grid = screen.getByRole('grid', { name: 'Items' });
    const headers = within(grid).getAllByRole('columnheader');
    expect(headers).toHaveLength(4);
    // The labelled property headers read as plain text — no uppercase / tracking eyebrow.
    const titleHeader = screen.getByRole('columnheader', { name: 'Title' });
    expect(titleHeader).not.toHaveClass('uppercase', 'tracking-wide');
    // The header band is the light, hairline-divided variant body labels live in.
    const headerRow = titleHeader.parentElement;
    expect(headerRow).toHaveClass('text-on-surface-variant', 'text-xs', 'border-b');
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
    expect(screen.getByRole('grid', { name: 'Items' })).toHaveAttribute('aria-rowcount', '0');
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
    expect(within(links[0]!).getByText('Billing revamp')).toBeInTheDocument();
  });
});

describe('EntityTable — selection', () => {
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
    expect(selectedRow).toHaveClass('bg-surface-container-highest');

    const unselectedRow = screen.getByRole('row', { name: /Billing revamp/ });
    expect(unselectedRow).not.toHaveAttribute('data-selected');
    // Clicking an unselected row asks to select it; clicking a selected one asks to deselect.
    fireEvent.click(unselectedRow);
    expect(onSelect).toHaveBeenLastCalledWith(ROWS[0], true);
    fireEvent.click(selectedRow);
    expect(onSelect).toHaveBeenLastCalledWith(ROWS[1], false);
  });
});

describe('EntityTable — grouping', () => {
  // Group labels deliberately distinct from any cell text so a `row` name matcher is unambiguous.
  const GROUPS: EntityTableGroup<Row>[] = [
    { id: 'g-one', label: 'First bucket', rows: [ROWS[0]!] },
    { id: 'g-two', label: 'Second bucket', rows: [ROWS[1]!] },
  ];

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
      { id: 'g-one', label: 'First bucket', rows: [ROWS[0]!] },
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
});
