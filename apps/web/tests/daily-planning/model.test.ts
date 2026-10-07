import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import {
  capacityMinutes,
  includeSessionBudget,
  resizeSession,
  unplacedMinutes,
  addTaskToSession,
  movePlannedTask,
  nextAvailableStart,
  placeSession,
  remainingMinutes,
  setPlannedMinutes,
} from '../../src/components/daily-planning/daily-planning-model';

const draft: DailyPlanSnapshot = {
  date: '2026-09-22',
  finishAt: '2026-09-23T00:00:00.000Z',
  mainTaskId: null,
  tasks: [{ taskId: 'a', organizationId: 'org', plannedMinutes: 90, sort: 0 }],
  sessions: [],
};

describe('daily planning model', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T00:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it('preserves pinned allocations when reducing daily intent', () => {
    const pinned = {
      id: 'pin',
      startsAt: '2026-09-22T16:00:00.000Z',
      endsAt: '2026-09-22T17:00:00.000Z',
      allocations: [{ taskId: 'a', plannedMinutes: 60 }],
      pinned: true,
    };
    const next = setPlannedMinutes({ ...draft, sessions: [pinned] }, 'a', 30);
    expect(next.tasks[0]?.plannedMinutes).toBe(60);
    expect(next.sessions[0]).toEqual(pinned);
  });
  it('does not shrink an unrelated manual block when planned time changes', () => {
    const unrelated = {
      id: 'other',
      startsAt: '2099-09-22T16:00:00.000Z',
      endsAt: '2099-09-22T17:00:00.000Z',
      allocations: [{ taskId: 'b', plannedMinutes: 30 }],
      pinned: false,
      placementSource: 'manual' as const,
    };
    const next = setPlannedMinutes(
      {
        ...draft,
        tasks: [
          ...draft.tasks,
          { taskId: 'b', organizationId: 'org', plannedMinutes: 30, sort: 1 },
        ],
        sessions: [unrelated],
      },
      'a',
      45,
    );
    expect(next.sessions[0]?.endsAt).toBe(unrelated.endsAt);
  });
  it('does not report recorded work as unplaced work', () => {
    const sessions = [
      {
        id: 'past',
        startsAt: '2026-09-22T16:00:00.000Z',
        endsAt: '2026-09-22T16:30:00.000Z',
        allocations: [{ taskId: 'a', plannedMinutes: 30 }],
        pinned: false,
      },
      {
        id: 'future',
        startsAt: '2026-09-22T20:00:00.000Z',
        endsAt: '2026-09-22T20:30:00.000Z',
        allocations: [{ taskId: 'a', plannedMinutes: 30 }],
        pinned: false,
      },
    ];
    expect(
      unplacedMinutes(
        { ...draft, sessions },
        'a',
        [{ taskId: 'a', recordedMinutes: 60 }],
        Date.parse('2026-09-22T18:00:00.000Z'),
      ),
    ).toBe(0);
  });
  it('counts a later task in a running block as future work', () => {
    const session = {
      id: 'packed',
      startsAt: '2026-09-22T16:00:00.000Z',
      endsAt: '2026-09-22T17:00:00.000Z',
      allocations: [
        { taskId: 'b', plannedMinutes: 30 },
        { taskId: 'a', plannedMinutes: 30 },
      ],
      pinned: false,
    };
    expect(
      unplacedMinutes(
        { ...draft, sessions: [session] },
        'a',
        [{ taskId: 'a', recordedMinutes: 60 }],
        Date.parse('2026-09-22T16:15:00.000Z'),
      ),
    ).toBe(0);
  });
  it('adds a manual future commitment after work was already recorded', () => {
    const session = {
      id: 'new',
      startsAt: '2026-09-22T18:00:00.000Z',
      endsAt: '2026-09-22T18:30:00.000Z',
      allocations: [{ taskId: 'a', plannedMinutes: 30 }],
      pinned: false,
    };
    const next = includeSessionBudget(
      { ...draft, tasks: [{ taskId: 'a', organizationId: 'org', sort: 0, plannedMinutes: 60 }] },
      session,
      [{ taskId: 'a', recordedMinutes: 60 }],
      Date.parse('2026-09-22T17:00:00.000Z'),
    );
    expect(next.tasks[0]?.plannedMinutes).toBe(90);
    expect(
      unplacedMinutes(
        { ...next, sessions: [session] },
        'a',
        [{ taskId: 'a', recordedMinutes: 60 }],
        Date.parse('2026-09-22T17:00:00.000Z'),
      ),
    ).toBe(0);
  });
  it.each([
    ['inside the current allocation', '2026-09-22T16:00:00.000Z', '2026-09-22T16:10:00.000Z', 30],
    ['outside the current allocation', '2026-09-22T15:00:00.000Z', '2026-09-22T15:10:00.000Z', 20],
    ['in an active interval', '2026-09-22T16:05:00.000Z', null, 30],
    ['in a cached active interval', '2026-09-22T16:00:00.000Z', null, 30],
  ] as const)('reconciles ten recorded minutes %s', (_label, startedAt, endedAt, expected) => {
    const session = {
      id: 'current',
      startsAt: '2026-09-22T16:00:00.000Z',
      endsAt: '2026-09-22T16:30:00.000Z',
      allocations: [{ taskId: 'a', plannedMinutes: 30 }],
      pinned: false,
    };
    const snapshot = {
      ...draft,
      tasks: [{ taskId: 'a', organizationId: 'org', sort: 0, plannedMinutes: 60 }],
      sessions: [session],
    };
    const actual = [{ taskId: 'a', recordedMinutes: 10, startedAt, endedAt }];
    const now = Date.parse('2026-09-22T16:15:00.000Z');
    expect(unplacedMinutes(snapshot, 'a', actual, now)).toBe(expected);
    const smaller = {
      ...snapshot,
      tasks: [{ taskId: 'a', organizationId: 'org', sort: 0, plannedMinutes: 25 }],
    };
    expect(includeSessionBudget(smaller, session, actual, now).tasks[0]?.plannedMinutes).toBe(
      60 - expected,
    );
  });
  it('subtracts the union of overlapping recorded intervals from the current allocation once', () => {
    const session = {
      id: 'current',
      startsAt: '2026-09-22T16:00:00.000Z',
      endsAt: '2026-09-22T16:30:00.000Z',
      allocations: [{ taskId: 'a', plannedMinutes: 30 }],
      pinned: false,
    };
    const actual = [
      {
        taskId: 'a',
        recordedMinutes: 10,
        startedAt: '2026-09-22T16:00:00.000Z',
        endedAt: '2026-09-22T16:10:00.000Z',
      },
      {
        taskId: 'a',
        recordedMinutes: 10,
        startedAt: '2026-09-22T16:05:00.000Z',
        endedAt: '2026-09-22T16:15:00.000Z',
      },
    ];
    expect(
      unplacedMinutes(
        {
          ...draft,
          tasks: [{ taskId: 'a', organizationId: 'org', sort: 0, plannedMinutes: 60 }],
          sessions: [session],
        },
        'a',
        actual,
        Date.parse('2026-09-22T16:15:00.000Z'),
      ),
    ).toBe(25);
  });
  it('rounds overlap in the same direction as recorded totals at thirty seconds', () => {
    const session = {
      id: 'current',
      startsAt: '2026-09-22T16:00:00.000Z',
      endsAt: '2026-09-22T16:30:00.000Z',
      allocations: [{ taskId: 'a', plannedMinutes: 30 }],
      pinned: false,
    };
    expect(
      unplacedMinutes(
        { ...draft, sessions: [session] },
        'a',
        [
          {
            taskId: 'a',
            recordedMinutes: 1,
            startedAt: session.startsAt,
            endedAt: '2026-09-22T16:00:30.000Z',
          },
        ],
        Date.parse('2026-09-22T16:00:30.000Z'),
      ),
    ).toBe(60);
  });
  it('keeps elapsed intent when recorded work overlaps a current reservation', () => {
    const sessions = [
      {
        id: 'past',
        startsAt: '2026-09-22T15:00:00.000Z',
        endsAt: '2026-09-22T15:30:00.000Z',
        allocations: [{ taskId: 'a', plannedMinutes: 30 }],
        pinned: false,
      },
      {
        id: 'current',
        startsAt: '2026-09-22T16:00:00.000Z',
        endsAt: '2026-09-22T16:30:00.000Z',
        allocations: [{ taskId: 'a', plannedMinutes: 30 }],
        pinned: false,
      },
    ];
    expect(
      unplacedMinutes(
        { ...draft, sessions },
        'a',
        [
          {
            taskId: 'a',
            recordedMinutes: 10,
            startedAt: '2026-09-22T16:00:00.000Z',
            endedAt: '2026-09-22T16:10:00.000Z',
          },
        ],
        Date.parse('2026-09-22T16:15:00.000Z'),
      ),
    ).toBe(30);
  });
  it('resizes allocations and adds only the changed time to the task budget', () => {
    const session = {
      id: 's',
      startsAt: '2026-09-22T16:00:00.000Z',
      endsAt: '2026-09-22T16:30:00.000Z',
      allocations: [{ taskId: 'a', plannedMinutes: 30 }],
      pinned: false,
    };
    const next = resizeSession(
      { ...draft, sessions: [session] },
      session,
      session.startsAt,
      '2026-09-22T16:45:00.000Z',
    );
    expect(next.session.allocations[0]?.plannedMinutes).toBe(45);
    expect(next.draft.tasks[0]?.plannedMinutes).toBe(105);
    expect(next.session.placementSource).toBe('manual');
  });
  it('adds work to an existing block and extends only the time it needs', () => {
    const grouped = {
      ...draft,
      tasks: [...draft.tasks, { taskId: 'b', organizationId: 'org', plannedMinutes: 30, sort: 1 }],
      sessions: [
        {
          id: 'group',
          startsAt: '2026-09-22T16:00:00.000Z',
          endsAt: '2026-09-22T16:40:00.000Z',
          allocations: [{ taskId: 'a', plannedMinutes: 30 }],
          pinned: false,
        },
      ],
    };
    const next = addTaskToSession(grouped, 'b', 'group', [], {
      startAt: '2026-09-22T00:00:00.000Z',
    });
    expect(next.sessions[0]?.allocations).toEqual([
      { taskId: 'a', plannedMinutes: 30 },
      { taskId: 'b', plannedMinutes: 30 },
    ]);
    expect(next.sessions[0]?.endsAt).toBe('2026-09-22T17:00:00.000Z');
    expect(next.tasks).toHaveLength(2);
  });

  it('rejects a block extension that would overlap a fixed event', () => {
    const grouped = {
      ...draft,
      tasks: [...draft.tasks, { taskId: 'b', organizationId: 'org', plannedMinutes: 30, sort: 1 }],
      sessions: [
        {
          id: 'group',
          startsAt: '2026-09-22T16:00:00.000Z',
          endsAt: '2026-09-22T16:30:00.000Z',
          allocations: [{ taskId: 'a', plannedMinutes: 30 }],
          pinned: false,
        },
      ],
    };
    expect(() =>
      addTaskToSession(
        grouped,
        'b',
        'group',
        [{ startsAt: '2026-09-22T16:45:00.000Z', endsAt: '2026-09-22T17:30:00.000Z' }],
        { startAt: '2026-09-22T00:00:00.000Z' },
      ),
    ).toThrow('That time overlaps an event or another block.');
    expect(grouped.sessions[0]?.allocations).toHaveLength(1);
  });
  it('reorders work without changing task time or scheduled sessions', () => {
    const withThree = {
      ...draft,
      tasks: [
        { taskId: 'a', organizationId: 'org', plannedMinutes: 90, sort: 0 },
        { taskId: 'b', organizationId: 'org', plannedMinutes: 30, sort: 1 },
        { taskId: 'c', organizationId: 'org', plannedMinutes: 60, sort: 2 },
      ],
      sessions: [
        {
          id: 's1',
          startsAt: '2026-09-22T16:00:00.000Z',
          endsAt: '2026-09-22T16:30:00.000Z',
          allocations: [{ taskId: 'a', plannedMinutes: 30 }],
          pinned: false,
        },
      ],
    };
    const reordered = movePlannedTask(withThree, 'a', 'c', 'after');
    expect(reordered.tasks.map((task) => [task.taskId, task.sort])).toEqual([
      ['b', 0],
      ['c', 1],
      ['a', 2],
    ]);
    expect(reordered.tasks[2]?.plannedMinutes).toBe(90);
    expect(reordered.sessions).toBe(withThree.sessions);
  });

  it('places two sessions for one task without creating a second task', () => {
    const first = placeSession(
      draft,
      {
        id: 's1',
        startsAt: '2026-09-22T16:00:00.000Z',
        endsAt: '2026-09-22T16:30:00.000Z',
        allocations: [{ taskId: 'a', plannedMinutes: 30 }],
        pinned: false,
      },
      [],
      '2026-09-22T00:00:00.000Z',
    );
    const second = placeSession(
      first,
      {
        id: 's2',
        startsAt: '2026-09-22T17:00:00.000Z',
        endsAt: '2026-09-22T18:00:00.000Z',
        allocations: [{ taskId: 'a', plannedMinutes: 60 }],
        pinned: false,
      },
      [],
      '2026-09-22T00:00:00.000Z',
    );
    expect(second.tasks).toHaveLength(1);
    expect(second.sessions).toHaveLength(2);
    expect(remainingMinutes(second, 'a')).toBe(0);
  });

  it('rejects event overlap and leaves the original draft alone', () => {
    expect(() =>
      placeSession(
        draft,
        {
          id: 's1',
          startsAt: '2026-09-22T16:00:00.000Z',
          endsAt: '2026-09-22T16:30:00.000Z',
          allocations: [{ taskId: 'a', plannedMinutes: 30 }],
          pinned: false,
        },
        [{ startsAt: '2026-09-22T16:15:00.000Z', endsAt: '2026-09-22T16:45:00.000Z' }],
        '2026-09-22T00:00:00.000Z',
      ),
    ).toThrow('That time overlaps an event or another block.');
    expect(draft.sessions).toHaveLength(0);
  });

  it('counts only time left after fixed events', () => {
    expect(
      capacityMinutes('2026-09-22T16:00:00.000Z', draft.finishAt, [
        { startsAt: '2026-09-22T17:00:00.000Z', endsAt: '2026-09-22T18:00:00.000Z' },
      ]),
    ).toBe(420);
  });

  it('opens a scheduling control at the first free slot after a late start', () => {
    expect(
      nextAvailableStart('2026-09-22T19:07:00.000Z', 30, '2026-09-23T00:00:00.000Z', [
        { startsAt: '2026-09-22T19:15:00.000Z', endsAt: '2026-09-22T20:00:00.000Z' },
      ]),
    ).toBe('2026-09-22T20:00:00.000Z');
  });

  it('reduces planned time without erasing an earlier scheduled session', () => {
    const placed = {
      ...draft,
      sessions: [
        {
          id: 'first',
          startsAt: '2026-09-22T16:00:00.000Z',
          endsAt: '2026-09-22T16:30:00.000Z',
          allocations: [{ taskId: 'a', plannedMinutes: 30 }],
          pinned: false,
        },
        {
          id: 'second',
          startsAt: '2026-09-22T17:00:00.000Z',
          endsAt: '2026-09-22T18:00:00.000Z',
          allocations: [{ taskId: 'a', plannedMinutes: 60 }],
          pinned: false,
        },
      ],
    };
    const changed = setPlannedMinutes(placed, 'a', 45);
    expect(changed.sessions).toHaveLength(2);
    expect(changed.sessions[0]?.allocations[0]?.plannedMinutes).toBe(30);
    expect(changed.sessions[1]?.allocations[0]?.plannedMinutes).toBe(15);
  });
});
