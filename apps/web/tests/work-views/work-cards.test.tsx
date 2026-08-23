import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { TaskViewDefinition, TaskViewRow } from '@docket/types';
import { describe, expect, it, vi } from 'vitest';

import { WorkCards } from '../../src/components/work-views/work-cards';

const definition = TaskViewDefinition.parse({
  version: 2,
  target: 'task',
  filter: null,
  arrangement: { groupBy: null, subGroupBy: null, orderBy: [] },
  presentation: {
    layout: 'cards',
    properties: ['status', 'priority'],
    density: 'compact',
    showEmptyGroups: false,
  },
});

const task = TaskViewRow.parse({
  target: 'task',
  organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
  id: '01ARZ3NDEKTSV4RRFFQ69G5FA1',
  title: 'Ship the roster',
  status: 'todo',
  priority: 'high',
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
  createdAt: '2026-08-23T00:00:00.000Z',
  updatedAt: '2026-08-23T00:00:00.000Z',
  estimate: null,
  estimateMinutes: null,
  blocked: false,
  blocking: false,
  unfiled: true,
  archived: false,
  manualRank: 'a0',
  isContext: false,
});

describe('WorkCards', () => {
  it('renders a target-neutral card grid with selection and activation', () => {
    const onActivate = vi.fn();
    const onSelectionChange = vi.fn();
    render(
      <WorkCards
        target="task"
        definition={definition}
        rows={[task]}
        selectedIds={new Set()}
        onSelectionChange={onSelectionChange}
        onActivate={onActivate}
      />,
    );

    expect(screen.getByRole('list', { name: 'Task cards' })).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Select Ship the roster' }).parentElement?.parentElement,
    ).toHaveClass('opacity-0');
    const link = screen.getByRole('link', { name: /Ship the roster/ });
    expect(link).toHaveAttribute('href', `/orgs/${task.organizationId}/tasks/${task.id}`);
    fireEvent.click(link);
    expect(onActivate).toHaveBeenCalledWith(task);
    onActivate.mockClear();
    fireEvent.click(link, { metaKey: true });
    expect(onActivate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ship the roster' }));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set([task.id]));
  });

  it('continues the root roster after the first page', () => {
    const onLoadMoreRows = vi.fn();
    const props = {
      target: 'task' as const,
      definition,
      rows: [task],
      selectedIds: new Set<string>(),
      onSelectionChange: vi.fn(),
      onActivate: vi.fn(),
      hasMoreRows: true,
      loadingMoreRows: false,
      onLoadMoreRows,
    };

    render(<WorkCards {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Load more tasks' }));
    expect(onLoadMoreRows).toHaveBeenCalledOnce();
  });

  it('renders the projected assignee name instead of the relation id', () => {
    const assignedTask = TaskViewRow.parse({
      ...task,
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
      presentation: { ...definition.presentation, properties: ['assignee'] },
    });

    render(
      <WorkCards
        target="task"
        definition={assigneeDefinition}
        rows={[assignedTask]}
        selectedIds={new Set()}
        onSelectionChange={vi.fn()}
        onActivate={vi.fn()}
      />,
    );

    expect(screen.getByText('Willie Chalmers III')).toBeVisible();
  });
});
