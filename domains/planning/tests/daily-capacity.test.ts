import { describe, expect, it } from 'vitest';

import { calculateDailyCapacity, taskProgress } from '../src/daily-capacity';

describe('daily planning capacity', () => {
  it('uses only the part of the workday still ahead and counts overlapping events once', () => {
    expect(
      calculateDailyCapacity({
        window: { startsAt: 9 * 60, endsAt: 15 * 60 },
        now: 11 * 60 + 30,
        fixed: [
          { startsAt: 11 * 60, endsAt: 12 * 60 },
          { startsAt: 11 * 60 + 45, endsAt: 12 * 60 + 15 },
          { startsAt: 13 * 60, endsAt: 13 * 60 + 30 },
        ],
        plannedMinutes: 120,
      }),
    ).toEqual({ availableMinutes: 135, plannedMinutes: 120, differenceMinutes: 15 });
  });

  it('never creates capacity after the end of the workday', () => {
    expect(
      calculateDailyCapacity({
        window: { startsAt: 9 * 60, endsAt: 15 * 60 },
        now: 16 * 60,
        fixed: [],
        plannedMinutes: 45,
      }),
    ).toEqual({ availableMinutes: 0, plannedMinutes: 45, differenceMinutes: -45 });
  });
});

describe('planned and actual work', () => {
  it('keeps completed sessions separate from task completion and plan revisions', () => {
    expect(
      taskProgress({
        plannedMinutes: 90,
        scheduledMinutes: [30, 30],
        actualMinutes: [22, 25],
        completed: false,
      }),
    ).toEqual({
      plannedMinutes: 90,
      scheduledMinutes: 60,
      unscheduledMinutes: 30,
      actualMinutes: 47,
      completed: false,
    });
  });
});
