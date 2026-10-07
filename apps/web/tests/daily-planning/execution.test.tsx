import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReadyPlanningController } from '../../src/components/daily-planning/daily-planning-controller';
import { ConfirmedStage } from '../../src/components/daily-planning/daily-planning-confirmed';
import { MissedBlock } from '../../src/components/daily-planning/daily-planning-missed';
import DayPlan from '../../src/components/today/day-plan';

const planningDay = vi.hoisted((): { data: unknown } => ({ data: null }));
vi.mock('../../src/components/daily-planning/daily-planning-queries', () => ({
  useDailyPlanningDay: () => planningDay,
}));

vi.mock('../../src/components/daily-planning/daily-planning-agenda', () => ({
  clock: (instant: string) => instant.slice(11, 16),
}));
vi.mock('../../src/components/active-org', () => ({ useActiveOrg: () => ({ orgs: [] }) }));
vi.mock('../../src/components/time-tracking/time-add-past-dialog', () => ({
  TimeAddPastDialog: (props: {
    open: boolean;
    initialTaskId: string;
    initialStartsAt: string;
    initialEndsAt: string;
  }) =>
    props.open ? (
      <div role="dialog" aria-label="Record time">
        {props.initialTaskId} {props.initialStartsAt} {props.initialEndsAt}
      </div>
    ) : null,
}));
vi.mock('../../src/components/docket-link', () => ({
  default: (props: { href: string; children: React.ReactNode }) => <a {...props} />,
}));

const sessions = [
  {
    id: 'packed',
    startsAt: '2026-10-06T09:00:00.000Z',
    endsAt: '2026-10-06T10:00:00.000Z',
    pinned: true,
    allocations: [
      { taskId: 'completed', plannedMinutes: 30 },
      { taskId: 'unfinished', plannedMinutes: 30 },
    ],
  },
];

function controller(): ReadyPlanningController {
  return {
    date: '2026-10-06',
    timezone: 'UTC',
    fixed: [],
    wasAdjustment: false,
    previousAccepted: null,
    draft: {
      date: '2026-10-06',
      mainTaskId: null,
      finishAt: '2026-10-06T17:00:00.000Z',
      sessions,
      tasks: [
        { taskId: 'completed', organizationId: 'org', plannedMinutes: 30, sort: 0 },
        { taskId: 'unfinished', organizationId: 'org', plannedMinutes: 30, sort: 1 },
      ],
    },
    allTasks: new Map([
      ['completed', { completedAt: '2026-10-06T09:15:00.000Z', title: 'Completed' }],
      ['unfinished', { completedAt: null, title: 'Unfinished' }],
    ]),
    timer: { phase: 'idle', record: null },
    timerControls: { start: vi.fn(), resume: vi.fn() },
    titleFor: (id: string) => (id === 'completed' ? 'Completed' : 'Unfinished'),
    dayQ: { data: { actual: [] } },
  } as unknown as ReadyPlanningController;
}

beforeEach(() => {
  planningDay.data = null;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-06T09:40:00.000Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('daily planning execution screens', () => {
  it('shows the fixed event first on Today when accepted work follows it', () => {
    planningDay.data = {
      accepted: { current: { snapshot: { sessions } } },
      actual: [],
      agenda: {
        entries: [
          {
            kind: 'google_calendar_event',
            event: {
              title: 'Team check-in',
              startsAt: '2026-10-06T09:35:00.000Z',
              endsAt: '2026-10-06T10:00:00.000Z',
            },
          },
        ],
      },
    };
    render(
      <DayPlan
        date="2026-10-06"
        plan={[]}
        orgName={() => 'Workspace'}
        loading={false}
        displayTimezone="UTC"
      />,
    );
    expect(screen.getByRole('article', { name: 'Next event: Team check-in' })).toBeInTheDocument();
  });

  it('offers the next unfinished allocation without starting tracking on confirmation', () => {
    const plan = controller();
    render(<ConfirmedStage plan={plan} />);
    expect(screen.getByRole('button', { name: 'Start Unfinished' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start Completed' })).not.toBeInTheDocument();
    expect(plan.timerControls.start).not.toHaveBeenCalled();
  });

  it('shows a fixed event before later work', () => {
    const plan = controller();
    render(
      <ConfirmedStage
        plan={{
          ...plan,
          fixed: [
            {
              title: 'Check-in',
              startsAt: '2026-10-06T09:35:00.000Z',
              endsAt: '2026-10-06T10:00:00.000Z',
            },
          ],
        }}
      />,
    );
    expect(screen.getByText('Check-in at 09:35')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Start / })).not.toBeInTheDocument();
  });

  it('keeps the active task available to continue when its allocation ended', () => {
    const plan = controller();
    vi.setSystemTime(new Date('2026-10-06T10:20:00.000Z'));
    const timer = {
      ...plan.timer,
      phase: 'running',
      record: { taskId: 'unfinished' },
    } as unknown as ReadyPlanningController['timer'];
    render(<ConfirmedStage plan={{ ...plan, timer }} />);
    expect(screen.getByRole('button', { name: 'Continue Unfinished' })).toBeInTheDocument();
    expect(plan.timerControls.start).not.toHaveBeenCalled();
  });

  it('names active work from the timer when the new plan excludes it', () => {
    const plan = controller();
    const timer = {
      ...plan.timer,
      phase: 'running',
      title: 'Current tracking work',
      record: { taskId: 'live' },
    } as unknown as ReadyPlanningController['timer'];
    render(<ConfirmedStage plan={{ ...plan, timer }} />);
    expect(
      screen.getByRole('button', { name: 'Continue Current tracking work' }),
    ).toBeInTheDocument();
  });

  it('shows tomorrow work while today tracking keeps running', () => {
    const plan = controller();
    const timer = {
      ...plan.timer,
      phase: 'running',
      title: 'Today active work',
      record: { taskId: 'live' },
    } as unknown as ReadyPlanningController['timer'];
    render(
      <ConfirmedStage
        plan={{
          ...plan,
          date: '2026-10-07',
          timer,
          draft: {
            ...plan.draft,
            date: '2026-10-07',
            sessions: sessions.map((session) => ({
              ...session,
              startsAt: session.startsAt.replace('2026-10-06', '2026-10-07'),
              endsAt: session.endsAt.replace('2026-10-06', '2026-10-07'),
            })),
          },
        }}
      />,
    );
    expect(screen.queryByText('Today active work')).not.toBeInTheDocument();
    expect(screen.getAllByText('Unfinished').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^(Start|Continue) / })).not.toBeInTheDocument();
    expect(plan.timerControls.start).not.toHaveBeenCalled();
  });

  it('does not offer an unplaced task whose full daily budget was recorded earlier', () => {
    const plan = controller();
    const dayQ = {
      data: {
        actual: [
          {
            taskId: 'unfinished',
            startedAt: '2026-10-06T07:00:00Z',
            endedAt: '2026-10-06T07:30:00Z',
          },
        ],
      },
    } as unknown as ReadyPlanningController['dayQ'];
    render(<ConfirmedStage plan={{ ...plan, dayQ, draft: { ...plan.draft, sessions: [] } }} />);
    expect(screen.getByText('This plan has no remaining tasks.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Start / })).not.toBeInTheDocument();
  });

  it.each([false, true])(
    'keeps Coming up consistent with fully recorded budget and active override (%s)',
    (active) => {
      const plan = controller();
      const dayQ = {
        data: {
          actual: [
            {
              taskId: 'unfinished',
              startedAt: '2026-10-06T07:00:00Z',
              endedAt: '2026-10-06T07:30:00Z',
            },
          ],
        },
      } as unknown as ReadyPlanningController['dayQ'];
      const timer = active
        ? ({
            ...plan.timer,
            phase: 'running',
            record: { taskId: 'unfinished' },
          } as unknown as ReadyPlanningController['timer'])
        : plan.timer;
      render(
        <ConfirmedStage
          plan={{
            ...plan,
            dayQ,
            timer,
            draft: {
              ...plan.draft,
              sessions: sessions.map((session) => ({
                ...session,
                startsAt: '2026-10-06T11:00:00Z',
                endsAt: '2026-10-06T12:00:00Z',
              })),
            },
          }}
        />,
      );
      const upcoming = within(screen.getByRole('region', { name: 'Upcoming agenda' }));
      if (active) expect(upcoming.getByText('Unfinished')).toBeInTheDocument();
      else expect(upcoming.queryByText('Unfinished')).not.toBeInTheDocument();
    },
  );

  it('does not offer blocked unscheduled work as the next task', () => {
    const plan = controller();
    plan.draft.sessions = [];
    plan.proposalContext = {
      unplaced: [{ taskId: 'unfinished', reason: 'blocked' }],
    } as unknown as NonNullable<ReadyPlanningController['proposalContext']>;
    render(<ConfirmedStage plan={plan} />);
    expect(screen.queryByRole('button', { name: 'Start Unfinished' })).not.toBeInTheDocument();
    expect(screen.getByText('Unfinished is blocked by unfinished work.')).toBeInTheDocument();
  });

  it('routes missed packed work to visible recovery and records only its exact allocation', () => {
    vi.setSystemTime(new Date('2026-10-06T10:20:00.000Z'));
    const plan = controller();
    const day = {
      date: plan.date,
      timezone: plan.timezone,
      actual: [],
      accepted: { current: { snapshot: plan.draft } },
      tasks: [
        {
          taskId: 'completed',
          organizationId: 'org',
          title: 'Completed',
          completedAt: '2026-10-06T09:15:00.000Z',
        },
        { taskId: 'unfinished', organizationId: 'org', title: 'Unfinished', completedAt: null },
      ],
    } as unknown as Parameters<typeof MissedBlock>[0]['day'];
    render(<MissedBlock day={day} onRecorded={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Still working' })).toHaveAttribute(
      'href',
      expect.stringContaining('recovery=still_working'),
    );
    expect(screen.getByRole('link', { name: 'Not started' })).toHaveAttribute(
      'href',
      expect.stringContaining('recovery=not_started'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'unfinished 2026-10-06T09:30:00.000Z 2026-10-06T10:00:00.000Z',
    );
  });
});
