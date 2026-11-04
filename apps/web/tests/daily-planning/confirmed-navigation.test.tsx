import { renderPlanning as render } from './render';
import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfirmedStage } from '../../src/components/daily-planning/daily-planning-confirmed';
import type { ReadyPlanningController } from '../../src/components/daily-planning/daily-planning-controller';

vi.mock('../../src/components/daily-planning/daily-planning-agenda', () => ({
  clock: (instant: string) => instant.slice(11, 16),
}));
vi.mock('../../src/components/docket-link', () => ({
  default: (props: { href: string; children: React.ReactNode }) => <a {...props} />,
}));

const originalLocation = window.location;
const assign = vi.fn();

function controller(): ReadyPlanningController {
  return {
    date: '2026-10-06',
    timezone: 'UTC',
    confirming: false,
    deferPending: false,
    isMovingTask: () => false,
    isCurrentDate: () => true,
    fixed: [],
    draft: { date: '2026-10-06', tasks: [], sessions: [] },
    allTasks: new Map(),
    timer: { phase: 'idle', record: null },
    dayQ: { data: { actual: [] } },
    titleFor: (id: string) => id,
    setStage: vi.fn(),
  } as unknown as ReadyPlanningController;
}

beforeEach(() => {
  assign.mockClear();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { assign },
  });
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

describe('confirmed daily plan navigation', () => {
  it('keeps ongoing all-day and timed commitments while excluding events that ended', () => {
    const plan = controller();
    const now = Date.now();
    plan.fixed = [
      {
        id: 'all-day',
        title: 'Cycle context',
        allDay: true,
        startsAt: new Date(now - 6 * 60 * 60_000).toISOString(),
        endsAt: new Date(now + 6 * 60 * 60_000).toISOString(),
      },
      {
        id: 'active',
        title: 'Meeting in progress',
        startsAt: new Date(now - 15 * 60_000).toISOString(),
        endsAt: new Date(now + 15 * 60_000).toISOString(),
      },
      {
        id: 'ended',
        title: 'Finished meeting',
        startsAt: new Date(now - 60 * 60_000).toISOString(),
        endsAt: new Date(now - 30 * 60_000).toISOString(),
      },
    ];
    render(<ConfirmedStage plan={plan} />);
    expect(screen.getByRole('button', { name: 'Cycle context' })).toBeVisible();
    expect(screen.getByText('Cycle context · All day')).toBeVisible();
    expect(screen.getByText('All day')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Meeting in progress' })).toBeVisible();
    expect(screen.queryByText('Finished meeting')).not.toBeInTheDocument();
  });
  it('shows the accepted work and an explicit way to adjust the day', () => {
    const plan = controller();
    plan.draft.tasks = [
      { taskId: 'Prepare meeting notes', organizationId: 'org', plannedMinutes: 45, sort: 0 },
    ];
    render(<ConfirmedStage plan={plan} />);
    expect(screen.getByRole('heading', { name: 'Planned work' })).toBeVisible();
    expect(screen.getByText('45 min planned')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Adjust plan' }));
    expect(plan.setStage).toHaveBeenCalledWith('plan');
  });
  it('labels a continuing timer as active work instead of calling it the next planned task', () => {
    const plan = controller();
    plan.date = new Date().toLocaleDateString('en-CA', { timeZone: 'UTC' });
    plan.timer = {
      ...plan.timer,
      record: { taskId: 'Active task' },
    } as ReadyPlanningController['timer'];
    render(<ConfirmedStage plan={plan} />);
    expect(screen.getByRole('heading', { name: 'Current session' })).toBeVisible();
    expect(screen.getByText('No work was selected for this day.')).toBeVisible();
  });

  it('loads Today as a new document so the planner cannot retain its route content', () => {
    render(<ConfirmedStage plan={controller()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go to Today' }));
    expect(assign).toHaveBeenCalledExactlyOnceWith('/today');
  });

  it.each(['confirming', 'deferPending'] as const)('disables leaving while %s', (pending) => {
    render(<ConfirmedStage plan={{ ...controller(), [pending]: true }} />);
    const button = screen.getByRole('button', { name: 'Go to Today' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(assign).not.toHaveBeenCalled();
  });

  it('guards a pending move before its state update renders', () => {
    render(<ConfirmedStage plan={{ ...controller(), isMovingTask: () => true }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go to Today' }));
    expect(assign).not.toHaveBeenCalled();
  });

  it('ignores a retained button from an old planning date', () => {
    render(<ConfirmedStage plan={{ ...controller(), isCurrentDate: () => false }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Go to Today' }));
    expect(assign).not.toHaveBeenCalled();
  });
});
