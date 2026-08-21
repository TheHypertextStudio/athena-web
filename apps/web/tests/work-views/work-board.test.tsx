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
  it('omits hidden columns and keeps create inside the destination column', () => {
    const onCreate = vi.fn();
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
        onActivate={vi.fn()}
        onDrop={vi.fn()}
        onLoadMore={vi.fn()}
      />,
    );

    expect(screen.getByRole('region', { name: 'Todo column' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Done column' })).not.toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Todo column' })).getByRole('button', {
        name: /Create/,
      }),
    );
    expect(onCreate).toHaveBeenCalledWith(['todo']);
  });

  it('paginates one swimlane and routes a mutable drop through its full group path', () => {
    const onDrop = vi.fn();
    const onLoadMore = vi.fn();
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
        onActivate={vi.fn()}
        onDrop={onDrop}
        onLoadMore={onLoadMore}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Load more Medium in Todo' }));
    expect(onLoadMore).toHaveBeenCalledWith(['todo', 'medium']);

    const card = screen.getByRole('article', { name: 'Movable task' });
    const values = new Map<string, string>();
    const transfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? '',
    };
    fireEvent.dragStart(card, { dataTransfer: transfer });
    fireEvent.drop(screen.getByTestId('board-cell-started-medium'), { dataTransfer: transfer });
    expect(onDrop).toHaveBeenCalledWith({
      item: row,
      sourcePath: ['todo', 'medium'],
      destinationPath: ['started', 'medium'],
      beforeId: null,
      afterId: null,
    });
  });
});
