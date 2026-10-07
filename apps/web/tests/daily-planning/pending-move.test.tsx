import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReadyPlanningController } from '../../src/components/daily-planning/daily-planning-controller';

vi.mock('../../src/components/daily-planning/daily-planning-agenda', () => ({
  DailyAgenda: () => null,
}));
vi.mock('../../src/components/daily-planning/daily-planning-assessment', () => ({
  DailyPlanningAssessment: () => null,
}));
vi.mock('../../src/components/daily-planning/daily-planning-schedule-controls', () => ({
  ScheduleControls: () => null,
  WorkdayControls: () => null,
}));
vi.mock('../../src/components/daily-planning/daily-planning-unplaced', () => ({
  UnplacedWork: () => null,
}));
vi.mock('../../src/components/daily-planning/daily-planning-work', () => ({
  WorkColumn: () => null,
}));
vi.mock('../../src/components/daily-planning/daily-planning-session-editor', () => ({
  SessionEditor: () => null,
}));
import { PlanStage } from '../../src/components/daily-planning/daily-planning-plan';

afterEach(cleanup);
function controller(pending: boolean): ReadyPlanningController {
  return {
    date: '2026-10-07',
    stage: 'review',
    deferPending: pending,
    isMovingTask: () => pending,
    isCurrentDate: () => true,
    confirming: false,
    draft: {
      date: '2026-10-07',
      finishAt: '2026-10-07T17:00:00.000Z',
      mainTaskId: null,
      tasks: [],
      sessions: [],
    },
    names: new Map(),
    dayQ: { data: { actual: [], carryover: [] } },
    previousQ: { data: { tasks: [], actual: [] } },
    setConfirming: vi.fn(),
    setWasAdjustment: vi.fn(),
    setPreviousAccepted: vi.fn(),
    setStage: vi.fn(),
    serverRevision: { current: 12 },
    persist: vi.fn(),
    confirm: { isPending: false, mutateAsync: vi.fn() },
    go: vi.fn(),
  } as unknown as ReadyPlanningController;
}
describe('confirmation during a pending move', () => {
  it('does not confirm the prior day after its save resolves on another date', async () => {
    const plan = controller(false);
    let finishSave: (() => void) | undefined;
    vi.mocked(plan.persist).mockImplementation(
      () =>
        new Promise<void>((done) => {
          finishSave = done;
        }),
    );
    let current = true;
    plan.isCurrentDate = () => current;
    render(<PlanStage plan={plan} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm plan' }));
    current = false;
    await act(async () => {
      finishSave?.();
    });
    expect(plan.confirm.mutateAsync).not.toHaveBeenCalled();
    expect(plan.setWasAdjustment).not.toHaveBeenCalled();
  });
  it('does not replace the new day revision with a prior-day confirmation response', async () => {
    const plan = controller(false);
    type Confirmation = Awaited<ReturnType<typeof plan.confirm.mutateAsync>>;
    let finishConfirm: ((value: Confirmation) => void) | undefined;
    vi.mocked(plan.confirm.mutateAsync).mockImplementation(
      () =>
        new Promise<Confirmation>((done) => {
          finishConfirm = done;
        }),
    );
    let current = true;
    plan.isCurrentDate = () => current;
    render(<PlanStage plan={plan} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm plan' }));
    });
    expect(plan.confirm.mutateAsync).toHaveBeenCalledTimes(1);
    current = false;
    plan.serverRevision.current = 20;
    await act(async () => {
      finishConfirm?.({
        date: plan.date,
        revision: 13,
        draft: null,
        accepted: null,
        resumeStep: 'plan_today',
      });
    });
    expect(plan.serverRevision.current).toBe(20);
    expect(plan.setStage).not.toHaveBeenCalled();
  });
  it('disables confirmation and edit-plan navigation while moving a task', () => {
    const plan = controller(true);
    render(<PlanStage plan={plan} />);
    for (const name of ['Confirm plan', 'Edit plan']) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(plan.persist).not.toHaveBeenCalled();
    expect(plan.go).not.toHaveBeenCalled();
  });
  it('guards confirmation before React renders the pending disabled state', () => {
    const plan = { ...controller(false), isMovingTask: () => true };
    render(<PlanStage plan={plan} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm plan' }));
    expect(plan.setConfirming).not.toHaveBeenCalled();
    expect(plan.persist).not.toHaveBeenCalled();
    expect(plan.confirm.mutateAsync).not.toHaveBeenCalled();
  });
});
