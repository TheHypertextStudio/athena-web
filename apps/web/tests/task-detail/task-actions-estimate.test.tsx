/**
 * The masthead's time estimate beside Track: editable with edit rights, shown as text without
 * them, and absent when unset for a viewer who cannot set it.
 */
import '@testing-library/jest-dom/vitest';

import type { TaskDetail } from '@docket/work/task-model';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { TaskActionsProps } from '../../src/components/task-detail/task-actions';

vi.mock('../../src/components/clipboard', () => ({ useCopyOutcome: () => vi.fn() }));
vi.mock('../../src/components/time-tracking', () => ({
  TaskTimerButton: () => <button type="button">Track this task</button>,
}));
vi.mock('../../src/components/task-detail/task-delete-dialog', () => ({
  TaskDeleteDialog: () => null,
  useTaskDeletePrompt: () => ({ open: false, onOpenChange: vi.fn() }),
}));

const { TaskActions } = await import('../../src/components/task-detail/task-actions');

/** Render the masthead actions for a task with the given estimate and rights. */
function renderActions(estimateMinutes: number | null, canEdit: boolean): TaskActionsProps {
  const props: TaskActionsProps = {
    orgId: 'org_1',
    task: {
      id: 'task_1',
      organizationId: 'org_1',
      title: 'Ship it',
      estimateMinutes,
    } as TaskDetail,
    canEdit,
    canManage: false,
    mutations: {
      resetDelete: vi.fn(),
      deleteTask: vi.fn(),
      deletePending: false,
      deleteError: null,
      patchTask: vi.fn(),
    },
    expansion: { pending: false, notice: null, undoToken: null, expand: vi.fn(), undo: vi.fn() },
  };
  render(<TaskActions {...props} />);
  return props;
}

describe('TaskActions time estimate', () => {
  it('patches the time estimate chosen beside Track', async () => {
    const props = renderActions(null, true);

    fireEvent.click(screen.getByRole('button', { name: /^Time estimate/ }));
    const option = await screen.findByRole('option', { name: /0:45/ });
    fireEvent.click(within(option).getByRole('button'));

    expect(props.mutations.patchTask).toHaveBeenCalledWith({ estimateMinutes: 45 });
  });

  it('shows the estimate as text without edit rights', () => {
    renderActions(90, false);

    expect(screen.queryByRole('button', { name: /^Time estimate/ })).not.toBeInTheDocument();
    expect(screen.getByText('1:30')).toBeInTheDocument();
  });

  it('shows nothing for an unset estimate without edit rights', () => {
    renderActions(null, false);

    expect(screen.queryByText('—')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Time estimate/ })).not.toBeInTheDocument();
  });
});
