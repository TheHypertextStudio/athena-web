import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReadyPlanningController } from '../../src/components/daily-planning/daily-planning-controller';
import { DailyPlanningEntry } from '../../src/components/daily-planning/daily-planning-entry';
import { YesterdayStage } from '../../src/components/daily-planning/daily-planning-yesterday';

vi.mock('../../src/components/daily-planning/daily-planning-queries', () => ({
  useDailyPlanningDay: () => ({ data: { timezone: 'UTC', accepted: null, draft: null } }),
}));
vi.mock('../../src/components/daily-planning/daily-planning-missed', () => ({
  MissedBlock: () => null,
}));
vi.mock('../../src/components/docket-link', () => ({
  default: (props: { href: string; children: React.ReactNode }) => <a {...props} />,
}));
vi.mock('../../src/components/date-picker', () => ({
  formatDay: (value: string) => value,
  DatePicker: () => null,
}));

function reviewController(): ReadyPlanningController {
  const tasks = [
    { taskId: 'kept', organizationId: 'org', title: 'Keep tomorrow work', planItemId: 'kept-item' },
    {
      taskId: 'backlog',
      organizationId: 'org',
      title: 'Return planned work',
      planItemId: 'backlog-item',
    },
    {
      taskId: 'done',
      organizationId: 'org',
      title: 'Finish planned work',
      planItemId: 'done-item',
    },
  ];
  return {
    date: '2026-10-07',
    previousDate: '2026-10-06',
    timezone: 'UTC',
    dayReview: true,
    reviewLabel: 'Review today',
    draft: {
      date: '2026-10-07',
      mainTaskId: 'backlog',
      finishAt: '2026-10-07T17:00:00.000Z',
      tasks: tasks.map((task, sort) => ({ ...task, plannedMinutes: 30, sort })),
      sessions: [
        {
          id: 'packed',
          startsAt: '2026-10-07T10:00:00.000Z',
          endsAt: '2026-10-07T11:30:00.000Z',
          pinned: true,
          allocations: tasks.map((task) => ({ taskId: task.taskId, plannedMinutes: 30 })),
        },
      ],
    },
    dayQ: { data: { carryover: tasks } },
    previousQ: { data: { tasks: [], actual: [{ recordedMinutes: 15 }] } },
    reviewChoices: { kept: 'today', backlog: 'backlog', done: 'done' },
    reviewDates: {},
    setReviewChoices: vi.fn(),
    completeReview: { mutateAsync: vi.fn(), isPending: false },
    applyReview: { mutateAsync: vi.fn(), isPending: false },
    editDraft: vi.fn(),
    go: vi.fn(),
    setError: vi.fn(),
  } as unknown as ReadyPlanningController;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-06T16:00:00.000Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('reviewing the current day', () => {
  it('offers Review day after 15:00 and opens tomorrow with the review entry', () => {
    render(<DailyPlanningEntry date="2026-10-06" />);
    expect(screen.getByRole('link', { name: 'Review day' })).toHaveAttribute(
      'href',
      '/plan/day?date=2026-10-07&review=day',
    );
  });

  it('keeps the end-of-day review entry hidden before 15:00', () => {
    vi.setSystemTime(new Date('2026-10-06T14:59:00.000Z'));
    render(<DailyPlanningEntry date="2026-10-06" />);
    expect(screen.queryByRole('link', { name: 'Review day' })).not.toBeInTheDocument();
  });

  it('shows today actuals and all unfinished decisions even when tomorrow already contains them', () => {
    render(<YesterdayStage plan={reviewController()} />);
    expect(screen.getByText('Work from today')).toBeInTheDocument();
    expect(screen.getByText('15 minutes recorded')).toBeInTheDocument();
    expect(screen.getAllByRole('combobox', { name: /^Decision for/ })).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Move all to tomorrow' })).toBeInTheDocument();
  });

  it('defaults already selected tomorrow work to Tomorrow without changing its saved budget', async () => {
    const plan = { ...reviewController(), reviewChoices: {} };
    render(<YesterdayStage plan={plan} />);
    expect(screen.getByRole('combobox', { name: 'Decision for Keep tomorrow work' })).toHaveValue(
      'today',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => {
      expect(plan.go).toHaveBeenCalled();
    });
    expect(plan.editDraft).toHaveBeenCalledWith(
      expect.objectContaining({ tasks: plan.draft.tasks, sessions: plan.draft.sessions }),
    );
  });

  it('applies backlog and Done to tasks already in the tomorrow draft without losing retained work', async () => {
    const plan = reviewController();
    render(<YesterdayStage plan={plan} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => {
      expect(plan.go).toHaveBeenCalled();
    });
    expect(plan.completeReview.mutateAsync).toHaveBeenCalledWith('done-item');
    expect(plan.applyReview.mutateAsync).toHaveBeenCalledWith([
      { planItemId: 'kept-item', action: 'today' },
      { planItemId: 'backlog-item', action: 'backlog' },
      { planItemId: 'done-item', action: 'done' },
    ]);
    expect(plan.go).toHaveBeenCalledWith(
      'plan',
      expect.objectContaining({
        mainTaskId: null,
        tasks: [expect.objectContaining({ taskId: 'kept', plannedMinutes: 30 })],
        sessions: [
          expect.objectContaining({
            id: 'packed',
            pinned: true,
            allocations: [{ taskId: 'kept', plannedMinutes: 30 }],
          }),
        ],
        settings: expect.objectContaining({ excludedTaskIds: ['backlog', 'done'] }),
      }),
    );
  });
});
