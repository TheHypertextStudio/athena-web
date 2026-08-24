import '@testing-library/jest-dom/vitest';

import { DropdownMenuItem } from '@docket/ui/primitives';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/components/time-tracking/task-timer-button', () => ({
  TaskTimerMenuItem: () => <DropdownMenuItem>Track this task</DropdownMenuItem>,
}));

vi.mock('../../src/components/athena/athena-context-action', () => ({
  AthenaContextMenuItem: () => <DropdownMenuItem>Have Athena handle this</DropdownMenuItem>,
}));

const { TaskHeaderControls, TaskHeaderOverflowMenu } =
  await import('../../src/components/task-detail/task-header-controls');

afterEach(() => {
  cleanup();
});

function openSubmenu(name: string): void {
  const trigger = screen.getByRole('menuitem', { name });
  fireEvent.pointerMove(trigger);
  fireEvent.click(trigger);
}

function openMenu(): void {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Task actions' }), {
    button: 0,
    ctrlKey: false,
  });
}

describe('TaskHeaderControls', () => {
  it('keeps one non-wrapping row and collapses controls by named-container tier', () => {
    const { container } = render(
      <TaskHeaderControls
        status={<button type="button">Status</button>}
        priority={<button type="button">Priority</button>}
        assignee={<button type="button">Assignee</button>}
        delegate={<span>Delegate</span>}
        actions={<button type="button">Tracking</button>}
        overflow={<button type="button">Task actions</button>}
      />,
    );

    const root = container.firstElementChild;
    expect(root).toHaveClass('@container/task-header', 'flex-nowrap', 'min-w-0');
    expect(root?.querySelectorAll('[class*="flex-wrap"]')).toHaveLength(0);
    expect(screen.getByText('Priority').parentElement).toHaveClass(
      'hidden',
      '@md/task-header:flex',
    );
    expect(screen.getByText('Delegate').parentElement).toHaveClass(
      'hidden',
      '@3xl/task-header:flex',
    );
    expect(screen.getByRole('button', { name: 'Task actions' })).toBeInTheDocument();
  });
});

describe('TaskHeaderOverflowMenu', () => {
  const commonProps = {
    taskId: 'task_1',
    title: 'Ship it',
    athenaContext: {
      workspaceId: 'org_1',
      source: { type: 'task' as const, id: 'task_1', label: 'Ship it' },
    },
    priority: 'medium' as const,
    priorityPending: false,
    memberOptions: [
      { value: 'actor_1', label: 'Ada Lovelace' },
      { value: 'actor_2', label: 'Grace Hopper' },
    ],
    assigneeId: 'actor_1',
    canEdit: true,
    onPriorityChange: vi.fn(),
    onAssigneeChange: vi.fn(),
    onDelete: vi.fn(),
  };

  it('is available to non-managers and exposes every collapsed control', async () => {
    render(<TaskHeaderOverflowMenu {...commonProps} canManage={false} />);

    openMenu();

    expect(await screen.findByRole('menuitem', { name: 'Priority' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Assignee' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Track this task' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Have Athena handle this' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete task' })).not.toBeInTheDocument();
  });

  it('routes priority selections through the supplied mutation', async () => {
    const onPriorityChange = vi.fn();
    render(
      <TaskHeaderOverflowMenu
        {...commonProps}
        canManage={false}
        onPriorityChange={onPriorityChange}
      />,
    );

    openMenu();
    openSubmenu('Priority');
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'High' }));
    expect(onPriorityChange).toHaveBeenCalledWith('high');
  });

  it('routes assignee selections through the supplied mutation', async () => {
    const onAssigneeChange = vi.fn();
    render(
      <TaskHeaderOverflowMenu
        {...commonProps}
        canManage={false}
        onAssigneeChange={onAssigneeChange}
      />,
    );

    openMenu();
    openSubmenu('Assignee');
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Grace Hopper' }));
    await waitFor(() => {
      expect(onAssigneeChange).toHaveBeenCalledWith('actor_2');
    });
  });

  it('opens the member roster only from the assignee submenu', async () => {
    const onAssigneeOpenChange = vi.fn();
    render(
      <TaskHeaderOverflowMenu
        {...commonProps}
        canManage={false}
        onAssigneeOpenChange={onAssigneeOpenChange}
      />,
    );

    openMenu();
    openSubmenu('Priority');
    expect(onAssigneeOpenChange).not.toHaveBeenCalled();
    await screen.findByRole('menuitemradio', { name: 'High' });
    openSubmenu('Assignee');
    expect(onAssigneeOpenChange).toHaveBeenCalledWith(true);
  });

  it('keeps delete management-only and invokes the existing confirmation callback', async () => {
    const onDelete = vi.fn();
    render(<TaskHeaderOverflowMenu {...commonProps} canManage onDelete={onDelete} />);

    openMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete task' }));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledOnce();
    });
  });
});
