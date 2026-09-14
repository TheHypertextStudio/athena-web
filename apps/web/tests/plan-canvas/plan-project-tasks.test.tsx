import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { PlanCanvasActions } from '../../src/components/plan-canvas/plan-canvas-context';
import type {
  PlanMiniTask,
  PlanProjectNodeData,
} from '../../src/components/plan-canvas/plan-nodes';
import {
  PlanMiniTaskList,
  PlanProjectBody,
  PlanTasksToggle,
} from '../../src/components/plan-canvas/plan-project-tasks';

const TASKS: PlanMiniTask[] = [
  { ref: 't1', title: 'Segment lapsed donors', status: 'confirmed' },
  { ref: 't2', title: 'Write the appeal letter', status: 'draft' },
  { ref: 't3', title: 'Book the mail house', status: 'draft' },
  { ref: 't4', title: 'Thank-you calls', status: 'draft' },
  { ref: 't5', title: 'Daily social schedule', status: 'draft' },
];

const NODE: PlanProjectNodeData = {
  ref: 'p1',
  kind: 'project',
  orgId: 'org_1',
  title: 'Donor outreach',
  status: 'draft',
  href: null,
  entered: false,
  changedFields: [],
  canEdit: true,
  summary: null,
  lead: null,
  targetDate: null,
  taskCount: TASKS.length,
  tasks: TASKS,
  expanded: false,
  alsoIn: [],
  canAddTask: true,
};

function actions(): PlanCanvasActions {
  return {
    canEdit: true,
    addProject: vi.fn(),
    addTask: vi.fn(),
    toggleTasks: vi.fn(),
    removeDependency: vi.fn(),
    open: vi.fn(),
  };
}

describe('PlanMiniTaskList', () => {
  it('names a few tasks, counts the rest, and shows the rows on one click', () => {
    const onExpand = vi.fn();
    render(<PlanMiniTaskList tasks={TASKS} onExpand={onExpand} />);
    const list = screen.getByRole('button', { name: 'Show 5 tasks' });
    expect(list).toHaveAttribute('aria-expanded', 'false');
    expect(list).toHaveTextContent('Segment lapsed donors');
    expect(list).toHaveTextContent('Book the mail house');
    expect(list).not.toHaveTextContent('Thank-you calls');
    expect(list).toHaveTextContent('+2 more');
    fireEvent.click(list);
    expect(onExpand).toHaveBeenCalledTimes(1);
  });
});

describe('PlanTasksToggle', () => {
  it('reads as the same command in both states', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<PlanTasksToggle expanded={false} count={1} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show 1 task' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<PlanTasksToggle expanded count={1} onToggle={onToggle} />);
    expect(screen.getByRole('button', { name: 'Hide tasks' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });
});

describe('PlanProjectBody', () => {
  it('shows the miniature list while collapsed and routes its click to the toggle', () => {
    const acts = actions();
    render(<PlanProjectBody id="p1" node={NODE} actions={acts} />);
    fireEvent.click(screen.getByTestId('plan-mini-tasks'));
    expect(acts.toggleTasks).toHaveBeenCalledWith('p1');
    expect(screen.queryByRole('button', { name: /add task/i })).toBeNull();
  });

  it('offers Add task once the rows are shown, and for a container with no tasks', () => {
    const acts = actions();
    const { rerender } = render(
      <PlanProjectBody id="p1" node={{ ...NODE, expanded: true }} actions={acts} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /add task/i }));
    expect(acts.addTask).toHaveBeenCalledWith('p1');
    rerender(
      <PlanProjectBody id="p1" node={{ ...NODE, tasks: [], taskCount: 0 }} actions={acts} />,
    );
    expect(screen.getByRole('button', { name: /add task/i })).toBeInTheDocument();
    expect(screen.queryByTestId('plan-mini-tasks')).toBeNull();
  });

  it('renders nothing a read-only viewer could act on', () => {
    const { container } = render(
      <PlanProjectBody
        id="p1"
        node={{ ...NODE, tasks: [], taskCount: 0, canAddTask: false }}
        actions={null}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
