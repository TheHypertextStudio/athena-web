import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TaskViewDefinition, TaskViewRow } from '@docket/types';

import { WorkBoard } from '../../src/components/work-views/work-board';

const definition = TaskViewDefinition.parse({
  version: 2,
  target: 'task',
  filter: null,
  arrangement: { groupBy: 'status', subGroupBy: 'priority', orderBy: [] },
  presentation: {
    layout: 'board',
    properties: ['assignee', 'dueDate'],
    density: 'compact',
    showEmptyGroups: true,
  },
});

function task(id: string, title: string) {
  return TaskViewRow.parse({
    target: 'task',
    organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
    id,
    title,
    status: 'todo',
    priority: 'medium',
    assignee: null,
    delegate: null,
    team: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
    project: null,
    program: null,
    cycle: null,
    milestone: null,
    parent: null,
    labels: [],
    creator: null,
    startDate: null,
    dueDate: null,
    createdAt: '2026-08-21T12:00:00.000Z',
    updatedAt: '2026-08-21T12:00:00.000Z',
    estimate: null,
    estimateMinutes: null,
    blocked: false,
    blocking: false,
    unfiled: true,
    archived: false,
    manualRank: 'a0',
    isContext: false,
  });
}

describe('WorkBoard', () => {
  it('renders root rows in one column when the view has no grouping', () => {
    const rootRows = Array.from({ length: 101 }, (_, index) =>
      task(
        `01ARZ3NDEKTSV4RRFFQ6${String(index).padStart(6, '0')}`,
        index === 0
          ? 'First root task'
          : index === 100
            ? 'Last root task'
            : `Root task ${String(index)}`,
      ),
    );
    const onLoadMoreRows = vi.fn();
    const ungroupedDefinition = TaskViewDefinition.parse({
      ...definition,
      arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
    });
    const props = {
      target: 'task' as const,
      definition: ungroupedDefinition,
      rows: rootRows,
      groups: [],
      groupPages: [],
      hiddenColumns: new Set<string>(),
      selectedIds: new Set<string>(),
      onSelectionChange: vi.fn(),
      onCreate: vi.fn(),
      onActivate: vi.fn(),
      onDrop: vi.fn(),
      onLoadMore: vi.fn(),
      hasMoreRows: true,
      loadingMoreRows: false,
      onLoadMoreRows,
    };

    render(<WorkBoard {...props} />);

    expect(screen.getByRole('region', { name: 'All tasks column' })).toBeVisible();
    expect(screen.getByRole('article', { name: 'First root task' })).toBeVisible();
    expect(screen.getByRole('article', { name: 'Last root task' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Load more tasks' }));
    expect(onLoadMoreRows).toHaveBeenCalledOnce();
  });

  it('omits hidden columns and keeps create inside the destination column', () => {
    const onCreate = vi.fn();
    const onActivate = vi.fn();
    const onHideColumn = vi.fn();
    const onShowAllColumns = vi.fn();
    render(
      <WorkBoard
        target="task"
        definition={definition}
        groups={[
          { path: ['todo'], key: 'todo', label: 'Todo', count: 1 },
          { path: ['done'], key: 'done', label: 'Done', count: 0 },
          { path: ['todo', 'medium'], key: 'medium', label: 'Medium', count: 1 },
        ]}
        groupPages={[
          {
            path: ['todo', 'medium'],
            rows: [task('01ARZ3NDEKTSV4RRFFQ69G5FD0', 'Board task')],
            nextCursor: null,
            loading: false,
          },
        ]}
        hiddenColumns={new Set(['done'])}
        selectedIds={new Set()}
        onSelectionChange={vi.fn()}
        onCreate={onCreate}
        onActivate={onActivate}
        onDrop={vi.fn()}
        onLoadMore={vi.fn()}
        onHideColumn={onHideColumn}
        onShowAllColumns={onShowAllColumns}
      />,
    );

    expect(screen.getByRole('region', { name: 'Todo column' })).toBeVisible();
    expect(
      screen.getByRole('checkbox', { name: 'Select Board task' }).parentElement?.parentElement,
    ).toHaveClass('opacity-0');
    const rowLink = screen.getByRole('link', { name: /Board task/ });
    expect(rowLink).toHaveAttribute(
      'href',
      '/orgs/01ARZ3NDEKTSV4RRFFQ69G5FA0/tasks/01ARZ3NDEKTSV4RRFFQ69G5FD0',
    );
    fireEvent.click(rowLink);
    expect(onActivate).toHaveBeenCalledOnce();
    onActivate.mockClear();
    fireEvent.click(rowLink, { ctrlKey: true });
    expect(onActivate).not.toHaveBeenCalled();
    expect(screen.queryByRole('region', { name: 'Done column' })).not.toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Todo column' })).getByRole('button', {
        name: /Create/,
      }),
    );
    expect(onCreate).toHaveBeenCalledWith(['todo']);
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 hidden column' }));
    expect(onShowAllColumns).toHaveBeenCalledOnce();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'More Todo column actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Hide column' }));
    expect(onHideColumn).toHaveBeenCalledWith('todo');
  });

  it('paginates one swimlane and opens a card from one click without native dragging', () => {
    const onLoadMore = vi.fn();
    const onActivate = vi.fn();
    const row = task('01ARZ3NDEKTSV4RRFFQ69G5FD1', 'Movable task');
    render(
      <WorkBoard
        target="task"
        definition={definition}
        groups={[
          { path: ['todo'], key: 'todo', label: 'Todo', count: 1 },
          { path: ['started'], key: 'started', label: 'Started', count: 0 },
          { path: ['todo', 'medium'], key: 'medium', label: 'Medium', count: 1 },
          { path: ['started', 'medium'], key: 'medium', label: 'Medium', count: 0 },
        ]}
        groupPages={[
          { path: ['todo', 'medium'], rows: [row], nextCursor: 'next', loading: false },
          { path: ['started', 'medium'], rows: [], nextCursor: null, loading: false },
        ]}
        hiddenColumns={new Set()}
        selectedIds={new Set()}
        onSelectionChange={vi.fn()}
        onCreate={vi.fn()}
        onActivate={onActivate}
        onDrop={vi.fn()}
        onLoadMore={onLoadMore}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Load more Medium in Todo' }));
    expect(onLoadMore).toHaveBeenCalledWith(['todo', 'medium']);

    const card = screen.getByRole('article', { name: 'Movable task' });
    expect(card).toHaveAttribute('data-object-kind', 'task');
    expect(card).toHaveAttribute('data-object-id', row.id);
    expect(card).not.toHaveAttribute('draggable');
    fireEvent.click(card);
    expect(onActivate).toHaveBeenCalledWith(row);
  });

  it('renders the projected assignee name instead of the relation id', () => {
    const row = TaskViewRow.parse({
      ...task('01ARZ3NDEKTSV4RRFFQ69G5FC8', 'Owned task'),
      assignee: '01ARZ3NDEKTSV4RRFFQ69G5FE0',
      assigneeActor: {
        id: '01ARZ3NDEKTSV4RRFFQ69G5FE0',
        kind: 'human',
        displayName: 'Willie Chalmers III',
        avatar: null,
      },
    });
    const assigneeDefinition = TaskViewDefinition.parse({
      ...definition,
      arrangement: { groupBy: 'status', subGroupBy: null, orderBy: [] },
      presentation: { ...definition.presentation, properties: ['assignee'] },
    });

    render(
      <WorkBoard
        target="task"
        definition={assigneeDefinition}
        groups={[{ path: ['todo'], key: 'todo', label: 'Todo', count: 1 }]}
        groupPages={[{ path: ['todo'], rows: [row], nextCursor: null, loading: false }]}
        hiddenColumns={new Set()}
        selectedIds={new Set()}
        onSelectionChange={vi.fn()}
        onCreate={vi.fn()}
        onActivate={vi.fn()}
        onDrop={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );

    expect(screen.getByText('Willie Chalmers III')).toBeVisible();
  });
});
