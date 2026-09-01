import '@testing-library/jest-dom/vitest';

import { EntityTable, type EntityTableGroup } from '@docket/ui/components';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  entityTableSelectionIntent,
  useEntityTableSelection,
} from '../../src/components/selection/entity-table-selection';
import { SelectionProvider, useSelection } from '../../src/components/selection/selection-context';
import { objectKey, type ObjectRef } from '../../src/lib/actions/object';

interface Row {
  readonly id: string;
  readonly name: string;
  readonly owner: string;
}

const ROUTE_ORG = 'org-route';
const FOREIGN_ORG = 'org-foreign';
const FIRST: Row = { id: 'first', name: 'First', owner: ROUTE_ORG };
const FOREIGN: Row = { id: 'foreign', name: 'Foreign', owner: FOREIGN_ORG };
const SECOND: Row = { id: 'second', name: 'Second', owner: ROUTE_ORG };

function objectFor(row: Row): ObjectRef {
  return { kind: 'task', id: row.id, organizationId: row.owner, title: row.name };
}

function selectableObject(row: Row): ObjectRef | null {
  return row.owner === ROUTE_ORG ? objectFor(row) : null;
}

function SelectionProbe(): ReactNode {
  const selection = useSelection();
  return (
    <>
      <output data-testid="selected">
        {selection.selectedObjects.map(({ id }) => id).join(',')}
      </output>
      <output data-testid="anchor">{selection.anchorKey ?? 'none'}</output>
      <output data-testid="active">{selection.activeKey ?? 'none'}</output>
    </>
  );
}

function TableHarness({
  rows,
  groups,
  continuation,
}: {
  readonly rows?: readonly Row[];
  readonly groups?: readonly EntityTableGroup<Row>[];
  readonly continuation?: {
    readonly id: string;
    readonly label: string;
    readonly state: 'idle';
    readonly onActivate: () => void;
  };
}): ReactNode {
  const selection = useEntityTableSelection(selectableObject);
  return (
    <>
      <EntityTable
        aria-label="Roster"
        columns={[{ key: 'name', header: 'Name', render: (row) => row.name }]}
        {...(groups === undefined ? { rows } : { groups })}
        getRowKey={(row) => row.id}
        rowHref={(row) => `/rows/${row.id}`}
        rowLinkColumnKey="name"
        {...selection}
        {...(continuation === undefined ? {} : { continuation })}
      />
      <SelectionProbe />
    </>
  );
}

function Surface({
  execution,
  rows = [FIRST, FOREIGN, SECOND],
  children,
}: {
  readonly execution: string;
  readonly rows?: readonly Row[];
  readonly children?: ReactNode;
}): ReactNode {
  const items = rows.flatMap((row) => {
    const object = selectableObject(row);
    return object === null ? [] : [object];
  });
  const surfaceId = `${ROUTE_ORG}:task:${execution}`;
  return (
    <SelectionProvider
      key={surfaceId}
      surfaceId={surfaceId}
      organizationId={ROUTE_ORG}
      actionScope="all"
      items={items}
    >
      {children ?? <TableHarness rows={rows} />}
    </SelectionProvider>
  );
}

describe('EntityTable selection bridge', () => {
  it('maps pointer and table keyboard commands while leaving one grid focus owner', () => {
    const loadMore = vi.fn();
    const groups: readonly EntityTableGroup<Row>[] = [
      { id: 'group', label: 'Group', rows: [FIRST, FOREIGN, SECOND] },
    ];
    render(
      <Surface execution="query-a">
        <TableHarness
          groups={groups}
          continuation={{
            id: 'continue',
            label: 'Load more rows',
            state: 'idle',
            onActivate: loadMore,
          }}
        />
      </Surface>,
    );

    const grid = screen.getByRole('grid', { name: 'Roster' });
    expect(grid).toHaveAttribute('tabindex', '0');
    expect(grid).not.toHaveAttribute('aria-activedescendant');
    expect(
      screen
        .getAllByRole('row')
        .slice(1)
        .every((row) => row.getAttribute('tabindex') !== '0'),
    ).toBe(true);

    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(grid).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('row', { name: /Group/ }).id,
    );
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: ' ' });
    expect(screen.getByTestId('selected')).toHaveTextContent('first');

    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(screen.getByTestId('active')).toHaveTextContent(objectKey(objectFor(FIRST)));
    fireEvent.keyDown(grid, { key: 'ArrowDown', shiftKey: true });
    expect(screen.getByTestId('selected')).toHaveTextContent('first,second');
    expect(screen.getByTestId('anchor')).toHaveTextContent(objectKey(objectFor(FIRST)));

    fireEvent.keyDown(grid, { key: 'a', metaKey: true });
    expect(screen.getByTestId('selected')).toHaveTextContent('first,second');
    fireEvent.keyDown(grid, { key: 'Escape' });
    expect(screen.getByTestId('selected')).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole('row', { name: /Foreign/ }));
    expect(screen.getByTestId('selected')).toBeEmptyDOMElement();
    fireEvent.click(screen.getByRole('row', { name: /First/ }));
    expect(screen.getByTestId('selected')).toHaveTextContent('first');

    fireEvent.keyDown(grid, { key: 'Home' });
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(screen.queryByRole('row', { name: /First/ })).not.toBeInTheDocument();
    fireEvent.keyDown(grid, { key: 'End' });
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(loadMore).toHaveBeenCalledOnce();
  });

  it('applies ranges in table order and rejects keys outside provider items', () => {
    function OrderedDispatch(): ReactNode {
      const selection = useSelection();
      return (
        <>
          <button
            type="button"
            onClick={() => {
              selection.dispatch({ type: 'replace', key: 'task:first' });
            }}
          >
            Anchor first
          </button>
          <button
            type="button"
            onClick={() => {
              selection.dispatchInOrder({ type: 'range', key: 'task:second' }, [
                'task:first',
                'unknown',
                'task:second',
              ]);
            }}
          >
            Range in table order
          </button>
          <SelectionProbe />
        </>
      );
    }

    render(
      <SelectionProvider
        items={[objectFor(FIRST), { ...objectFor(FIRST), id: 'middle' }, objectFor(SECOND)]}
        actionScope="all"
      >
        <OrderedDispatch />
      </SelectionProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Anchor first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Range in table order' }));
    expect(screen.getByTestId('selected')).toHaveTextContent('first,second');
  });

  it('prunes settled removals and resets selection when query execution identity changes', () => {
    const view = render(<Surface execution="search:alpha" />);
    fireEvent.click(screen.getByRole('row', { name: /First/ }));
    expect(screen.getByTestId('selected')).toHaveTextContent('first');

    view.rerender(<Surface execution="search:alpha" rows={[SECOND]} />);
    expect(screen.getByTestId('selected')).toBeEmptyDOMElement();

    fireEvent.click(screen.getByRole('row', { name: /Second/ }));
    view.rerender(<Surface execution="saved-view:bravo" rows={[SECOND]} />);
    expect(screen.getByTestId('selected')).toBeEmptyDOMElement();
  });

  it('translates typed table commands without rebuilding row order', () => {
    const base = {
      activeEntryKey: 'r:first',
      targetSelectionKey: 'task:first',
      anchorSelectionKey: null,
      orderedSelectionKeys: ['task:first'],
      modifiers: { shiftKey: false, metaKey: false, ctrlKey: false },
    } as const;
    expect(entityTableSelectionIntent({ ...base, command: 'replace' })).toEqual({
      type: 'replace',
      key: 'task:first',
    });
    expect(
      entityTableSelectionIntent({ ...base, command: 'move-active', targetSelectionKey: null }),
    ).toBeNull();
    expect(entityTableSelectionIntent({ ...base, command: 'select-all' })).toEqual({
      type: 'select-all',
    });
    expect(entityTableSelectionIntent({ ...base, command: 'clear' })).toEqual({ type: 'clear' });
  });
});
