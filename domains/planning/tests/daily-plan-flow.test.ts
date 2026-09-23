import { describe, expect, it } from 'vitest';
import { assertDefined } from '@docket/test-utils';

import { acceptDailyDraft, reviseDailyPlan, type DailyPlanSnapshot } from '../src/daily-plan-flow';

const first: DailyPlanSnapshot = {
  date: '2026-09-22',
  finishAt: '2026-09-22T22:00:00.000Z',
  mainTaskId: 'task-a',
  tasks: [{ taskId: 'task-a', organizationId: 'org-a', plannedMinutes: 90, sort: 0 }],
  sessions: [
    {
      id: 'session-a',
      startsAt: '2026-09-22T16:00:00.000Z',
      endsAt: '2026-09-22T16:45:00.000Z',
      allocations: [{ taskId: 'task-a', plannedMinutes: 45 }],
      pinned: false,
    },
    {
      id: 'session-b',
      startsAt: '2026-09-22T18:00:00.000Z',
      endsAt: '2026-09-22T18:45:00.000Z',
      allocations: [{ taskId: 'task-a', plannedMinutes: 45 }],
      pinned: false,
    },
  ],
};

describe('daily plan acceptance and revision', () => {
  it('keeps the accepted commitment when a later draft moves a session', () => {
    const accepted = acceptDailyDraft(first, '2026-09-22T15:00:00.000Z');
    const revision = reviseDailyPlan(
      accepted,
      {
        ...first,
        sessions: [
          {
            id: 'session-a',
            startsAt: '2026-09-22T19:00:00.000Z',
            endsAt: '2026-09-22T19:45:00.000Z',
            allocations: [{ taskId: 'task-a', plannedMinutes: 45 }],
            pinned: false,
          },
        ],
      },
      '2026-09-22T17:00:00.000Z',
    );

    expect(revision.original.snapshot.sessions).toEqual(first.sessions);
    expect(revision.current.snapshot.sessions[0]?.startsAt).toBe('2026-09-22T19:00:00.000Z');
    expect(revision.history).toHaveLength(2);
    expect(accepted.current.snapshot.sessions).toEqual(first.sessions);
  });

  it('allows several tasks in one block without creating duplicate tasks', () => {
    const snapshot: DailyPlanSnapshot = {
      ...first,
      tasks: [
        assertDefined(first.tasks[0]),
        { taskId: 'task-b', organizationId: 'org-a', plannedMinutes: 30, sort: 1 },
      ],
      sessions: [
        {
          id: 'shared',
          startsAt: '2026-09-22T16:00:00.000Z',
          endsAt: '2026-09-22T17:15:00.000Z',
          allocations: [
            { taskId: 'task-a', plannedMinutes: 45 },
            { taskId: 'task-b', plannedMinutes: 30 },
          ],
          pinned: false,
        },
      ],
    };
    expect(
      acceptDailyDraft(snapshot, '2026-09-22T15:00:00.000Z').current.snapshot.tasks,
    ).toHaveLength(2);
  });

  it('rejects allocations beyond a block and tasks outside the selected work', () => {
    expect(() =>
      acceptDailyDraft(
        {
          ...first,
          sessions: [
            {
              ...assertDefined(first.sessions[0]),
              allocations: [{ taskId: 'task-a', plannedMinutes: 60 }],
            },
          ],
        },
        '2026-09-22T15:00:00.000Z',
      ),
    ).toThrow();
    expect(() =>
      acceptDailyDraft(
        {
          ...first,
          sessions: [
            {
              ...assertDefined(first.sessions[0]),
              allocations: [{ taskId: 'task-b', plannedMinutes: 45 }],
            },
          ],
        },
        '2026-09-22T15:00:00.000Z',
      ),
    ).toThrow();
  });
});
