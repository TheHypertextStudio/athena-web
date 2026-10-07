import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReadyPlanningController } from '../../src/components/daily-planning/daily-planning-controller';
import { DailyPlanningHeader } from '../../src/components/daily-planning/daily-planning-header';

afterEach(cleanup);
function controller(confirming: boolean): ReadyPlanningController {
  return {
    date: '2026-10-07',
    timezone: 'UTC',
    stage: 'review',
    dayReview: false,
    reviewLabel: 'Review yesterday',
    confirming,
    deferPending: false,
    isMovingTask: () => false,
    dayQ: { data: { carryover: [] } },
    previousQ: { data: { tasks: [], actual: [] } },
    savedDraftReview: { draft: { tasks: [], sessions: [] } },
    applySavedDraft: vi.fn(),
    conflict: true,
    error: 'Your edits are still here.',
    reviewSavedDraft: vi.fn(),
    go: vi.fn(),
  } as unknown as ReadyPlanningController;
}
describe('confirmation freezes saved-plan recovery controls', () => {
  it('disables saved-plan and recovery actions throughout confirmation', () => {
    const plan = controller(true);
    render(<DailyPlanningHeader plan={plan} />);
    const apply = screen.getByRole('button', { name: 'Use saved plan' });
    const review = screen.getByRole('button', { name: 'Review saved plan' });
    expect(apply).toBeDisabled();
    expect(review).toBeDisabled();
    fireEvent.click(apply);
    fireEvent.click(review);
    expect(plan.applySavedDraft).not.toHaveBeenCalled();
    expect(plan.reviewSavedDraft).not.toHaveBeenCalled();
  });
  it('restores the explicit saved-plan choice after confirmation ends', () => {
    const plan = controller(false);
    render(<DailyPlanningHeader plan={plan} />);
    fireEvent.click(screen.getByRole('button', { name: 'Use saved plan' }));
    expect(plan.applySavedDraft).toHaveBeenCalledTimes(1);
  });
  it('disables navigation and saved-plan replacement while a task moves', () => {
    const plan = { ...controller(false), deferPending: true, isMovingTask: () => true };
    render(<DailyPlanningHeader plan={plan} />);
    for (const name of [
      'Today',
      /^Plan (day|today|tomorrow)$/,
      'Review plan',
      'Use saved plan',
      'Review saved plan',
    ]) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(plan.go).not.toHaveBeenCalled();
    expect(plan.applySavedDraft).not.toHaveBeenCalled();
  });
  it('names the reviewed current day in the title and current step', () => {
    render(
      <DailyPlanningHeader
        plan={{
          ...controller(false),
          stage: 'yesterday',
          dayReview: true,
          reviewLabel: 'Review today',
        }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Review today' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Review today' })).toHaveAttribute(
      'aria-current',
      'step',
    );
  });
});
