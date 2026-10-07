import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReadyPlanningController } from '../../src/components/daily-planning/daily-planning-controller';
import { WorkdayControls } from '../../src/components/daily-planning/daily-planning-schedule-controls';

afterEach(cleanup);

function controller(stage: 'plan' | 'review'): ReadyPlanningController {
  return {
    stage,
    date: '2026-10-07',
    timezone: 'UTC',
    startAt: '2026-10-07T09:00:00.000Z',
    proposalContext: { workScheduleMissing: true },
    draft: {
      date: '2026-10-07',
      finishAt: '2026-10-07T17:00:00.000Z',
      mainTaskId: null,
      tasks: [],
      sessions: [],
      settings: { bufferPercent: 15 },
    },
    editDraft: vi.fn(),
  } as unknown as ReadyPlanningController;
}

it('keeps review settings closed while allowing a keyboard edit of the finish time', async () => {
  const plan = controller('review');
  render(<WorkdayControls plan={plan} />);
  const trigger = screen.getByRole('button', { name: 'Workday settings' });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByLabelText('Finish')).not.toBeInTheDocument();
  trigger.focus();
  await userEvent.keyboard('{Enter}');
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  fireEvent.change(screen.getByLabelText('Finish'), { target: { value: '18:00' } });
  expect(plan.editDraft).toHaveBeenCalledWith({
    ...plan.draft,
    finishAt: '2026-10-07T18:00:00.000Z',
  });
});

it('shows editable bounds in planning when no work schedule has been saved', () => {
  render(<WorkdayControls plan={controller('plan')} />);
  expect(screen.getByText('Timezone: UTC')).toBeVisible();
  expect(screen.getByLabelText('Start')).toHaveValue('09:00');
  expect(screen.getByLabelText('Finish')).toHaveValue('17:00');
  expect(screen.getByLabelText('Buffer %')).toHaveValue(15);
});

it('expands missing work hours when proposal context arrives after the first render', () => {
  const plan = controller('plan');
  const pending = { ...plan, proposalContext: null };
  const view = render(<WorkdayControls plan={pending} />);
  expect(screen.getByRole('button', { name: 'Workday settings' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  view.rerender(<WorkdayControls plan={plan} />);
  expect(screen.getByLabelText('Start')).toHaveValue('09:00');
  expect(screen.getByRole('button', { name: 'Workday settings' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});

it.each([true, false])(
  'preserves an explicit open choice of %s when proposal context arrives',
  async (open) => {
    const plan = controller('plan');
    const view = render(<WorkdayControls plan={{ ...plan, proposalContext: null }} />);
    const user = userEvent.setup();
    const trigger = screen.getByRole('button', { name: 'Workday settings' });
    await user.click(trigger);
    if (!open) await user.click(trigger);
    view.rerender(<WorkdayControls plan={plan} />);
    expect(trigger).toHaveAttribute('aria-expanded', String(open));
  },
);
