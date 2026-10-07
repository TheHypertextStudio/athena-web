import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReadyPlanningController } from '../../src/components/daily-planning/daily-planning-controller';
import { UnplacedWork } from '../../src/components/daily-planning/daily-planning-unplaced';

const title = 'Prepare the launch report';
const actionsName = `Actions for unscheduled ${title}`;
function controller(): ReadyPlanningController {
  return {
    draft: {
      date: '2026-10-08',
      finishAt: '2026-10-08T17:00:00.000Z',
      mainTaskId: null,
      tasks: [{ taskId: 'task', organizationId: 'org', plannedMinutes: 60, sort: 0 }],
      sessions: [],
    },
    preview: null,
    proposalContext: { unplaced: [{ taskId: 'task', reason: 'no_availability' }] },
    dayQ: { data: { actual: [] } },
    deferPending: false,
    confirming: false,
    isMovingTask: () => false,
    titleFor: () => title,
    setEditing: vi.fn(),
    moveTaskToTomorrow: vi.fn(),
    removeTask: vi.fn(),
  } as unknown as ReadyPlanningController;
}
afterEach(cleanup);

describe('unscheduled work actions', () => {
  it('keeps the concrete reason beside Schedule and one Actions menu', () => {
    const plan = controller();
    render(<UnplacedWork plan={plan} />);
    expect(screen.getByText(title)).toBeVisible();
    expect(screen.getByText('60 minutes outside available work hours')).toBeVisible();
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: actionsName })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Move to tomorrow' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(plan.setEditing).toHaveBeenCalledWith({ taskId: 'task' });
  });

  it('opens movement with the keyboard and moves the selected task', async () => {
    const plan = controller();
    const user = userEvent.setup();
    render(<UnplacedWork plan={plan} />);
    screen.getByRole('button', { name: actionsName }).focus();
    await user.keyboard('{Enter}');
    const move = await screen.findByRole('menuitem', { name: 'Move to tomorrow' });
    move.focus();
    await user.keyboard('{Enter}');
    expect(plan.moveTaskToTomorrow).toHaveBeenCalledWith('task', 'org');
    expect(plan.removeTask).not.toHaveBeenCalled();
  });

  it('removes the task through the Actions menu', async () => {
    const plan = controller();
    const user = userEvent.setup();
    render(<UnplacedWork plan={plan} />);
    await user.click(screen.getByRole('button', { name: actionsName }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    expect(plan.removeTask).toHaveBeenCalledWith('task');
    expect(plan.moveTaskToTomorrow).not.toHaveBeenCalled();
  });

  it.each(['deferPending', 'confirming'] as const)(
    'blocks another move while %s without hiding explicit removal',
    async (pending) => {
      const plan = { ...controller(), [pending]: true };
      const user = userEvent.setup();
      render(<UnplacedWork plan={plan} />);
      await user.click(screen.getByRole('button', { name: actionsName }));
      const move = await screen.findByRole('menuitem', { name: 'Move to tomorrow' });
      expect(move).toHaveAttribute('aria-disabled', 'true');
      await user.click(move);
      expect(plan.moveTaskToTomorrow).not.toHaveBeenCalled();
      const remove = screen.getByRole('menuitem', { name: 'Remove' });
      expect(remove).not.toHaveAttribute('aria-disabled', 'true');
      await user.click(remove);
      expect(plan.removeTask).toHaveBeenCalledWith('task');
    },
  );

  it('guards a pending move before React updates the disabled state', async () => {
    const plan = { ...controller(), isMovingTask: () => true };
    const user = userEvent.setup();
    render(<UnplacedWork plan={plan} />);
    await user.click(screen.getByRole('button', { name: actionsName }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move to tomorrow' }));
    expect(plan.moveTaskToTomorrow).not.toHaveBeenCalled();
  });

  it('keeps proposed work visible without allowing edits before Apply', async () => {
    const plan = controller();
    plan.preview = { title: 'Proposed schedule', draft: plan.draft };
    const user = userEvent.setup();
    render(<UnplacedWork plan={plan} />);
    const schedule = screen.getByRole('button', { name: 'Schedule' });
    const actions = screen.getByRole('button', { name: actionsName });
    expect(schedule).toBeDisabled();
    expect(actions).toBeDisabled();
    await user.click(schedule);
    await user.click(actions);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(plan.setEditing).not.toHaveBeenCalled();
    expect(plan.removeTask).not.toHaveBeenCalled();
    expect(plan.moveTaskToTomorrow).not.toHaveBeenCalled();
  });
});
