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
    fireEvent.click(screen.getByText('Ship the roster'));
    expect(onActivate).toHaveBeenCalledWith(task);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Ship the roster' }));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set([task.id]));
  });
});
