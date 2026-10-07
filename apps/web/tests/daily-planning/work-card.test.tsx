import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReadyPlanningController } from '../../src/components/daily-planning/daily-planning-controller';
import { WorkColumn } from '../../src/components/daily-planning/daily-planning-work';

vi.mock('../../src/components/dnd/use-draggable', () => ({
  useDraggable: () => ({ ref: vi.fn(), className: '', 'data-drag-state': 'idle' }),
}));
vi.mock('../../src/components/dnd', () => ({
  useWorkRowDropTarget: () => ({ ref: vi.fn(), isOver: false, placement: 'before' }),
}));

const title = 'Prepare the complete launch report';
function mount(scheduledMinutes: number) {
  const entry = { taskId: 'task', organizationId: 'org', plannedMinutes: 60, sort: 0 };
  const controller = {
    stage: 'plan_today',
    draft: {
      date: '2026-10-08',
      mainTaskId: null,
      finishAt: '2026-10-08T17:00:00.000Z',
      tasks: [entry],
      sessions:
        scheduledMinutes > 0
          ? [
              {
                id: 'existing',
                startsAt: '2026-10-08T10:00:00.000Z',
                endsAt: new Date(
                  Date.parse('2026-10-08T10:00:00.000Z') + scheduledMinutes * 60_000,
                ).toISOString(),
                pinned: false,
                allocations: [{ taskId: 'task', plannedMinutes: scheduledMinutes }],
              },
            ]
          : [],
    },
    allTasks: new Map([['task', { projectName: 'Docket launch' }]]),
    titleFor: () => title,
    dayQ: { data: { actual: [], tasks: [] } },
    timer: { phase: 'idle', record: null },
    setEditing: vi.fn(),
    editDraft: vi.fn(),
    renameTask: vi.fn(),
    setStage: vi.fn(),
    removeTask: vi.fn(),
    setError: vi.fn(),
  } as unknown as ReadyPlanningController;
  render(<WorkColumn plan={controller} />);
  return controller;
}
afterEach(cleanup);

describe('compact work card actions', () => {
  it('keeps direct title and time editing with one actions menu', () => {
    const controller = mount(60);
    expect(screen.queryByRole('button', { name: `Schedule ${title}` })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: `Actions for ${title}` })).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: `Drag ${title} to reorder or schedule` }),
    ).toBeVisible();
    expect(screen.getByRole('textbox', { name: `Task title: ${title}` })).toHaveValue(title);
    expect(screen.getByText('Docket launch')).toBeVisible();
    const planned = screen.getByRole('spinbutton', { name: `Planned time for ${title}` });
    fireEvent.change(planned, { target: { value: '90' } });
    fireEvent.blur(planned);
    expect(controller.editDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        tasks: [expect.objectContaining({ plannedMinutes: 90 })],
      }),
    );
  });

  it('opens a fully scheduled block through the menu with the keyboard', async () => {
    const controller = mount(60);
    const user = userEvent.setup();
    screen.getByRole('button', { name: `Actions for ${title}` }).focus();
    await user.keyboard('{Enter}');
    const move = await screen.findByRole('menuitem', { name: 'Move block' });
    expect(move).not.toHaveAttribute('aria-disabled', 'true');
    move.focus();
    await user.keyboard('{Enter}');
    expect(controller.setEditing).toHaveBeenCalledWith({ taskId: 'task', sessionId: 'existing' });
  });

  it.each([
    [0, 'Schedule'],
    [30, 'Add session'],
  ] as const)('opens new session editing for %s scheduled minutes', async (minutes, action) => {
    const controller = mount(minutes);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: `Actions for ${title}` }));
    await user.click(await screen.findByRole('menuitem', { name: action }));
    expect(controller.setEditing).toHaveBeenCalledWith({ taskId: 'task' });
  });
});
