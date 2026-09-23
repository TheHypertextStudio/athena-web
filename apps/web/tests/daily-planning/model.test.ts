import { describe, expect, it } from 'vitest';

import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import {
  capacityMinutes,
  nextAvailableStart,
  placeSession,
  planSummary,
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

  it('counts only time left and reports overload without metadata prose', () => {
    expect(
      capacityMinutes('2026-09-22T16:00:00.000Z', draft.finishAt, [
        { startsAt: '2026-09-22T17:00:00.000Z', endsAt: '2026-09-22T18:00:00.000Z' },
      ]),
    ).toBe(420);
    expect(planSummary(draft, 30, new Map([['a', 'Write launch note']]))).toContain('will not fit');
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
