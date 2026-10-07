import { describe, expect, it } from 'vitest';
import { assertDefined } from '@docket/test-utils';

import type { DailyPlanSession } from '../src/daily-plan-flow';
import {
  dailyAllocations,
  selectDailyExecution,
  missedDailyAllocation,
} from '../src/daily-plan-execution';

const now = Date.parse('2026-10-06T10:20:00.000Z');
const sessions: DailyPlanSession[] = [
  {
    id: 'morning',
    startsAt: '2026-10-06T09:00:00.000Z',
    endsAt: '2026-10-06T10:00:00.000Z',
    pinned: true,
    allocations: [
      { taskId: 'launch', plannedMinutes: 30 },
      { taskId: 'review', plannedMinutes: 30 },
    ],
  },
  {
    id: 'later',
    startsAt: '2026-10-06T10:00:00.000Z',
    endsAt: '2026-10-06T11:00:00.000Z',
    pinned: false,
    allocations: [
      { taskId: 'review', plannedMinutes: 30 },
      { taskId: 'launch', plannedMinutes: 30 },
    ],
  },
];

describe('accepted daily execution', () => {
  it('preserves sequential allocation boundaries across repeated tasks and pinned blocks', () => {
    expect(
      dailyAllocations(sessions).map((part) => [
        part.sessionId,
        part.taskId,
        part.startsAt,
        part.endsAt,
      ]),
    ).toEqual([
      ['morning', 'launch', '2026-10-06T09:00:00.000Z', '2026-10-06T09:30:00.000Z'],
      ['morning', 'review', '2026-10-06T09:30:00.000Z', '2026-10-06T10:00:00.000Z'],
      ['later', 'review', '2026-10-06T10:00:00.000Z', '2026-10-06T10:30:00.000Z'],
      ['later', 'launch', '2026-10-06T10:30:00.000Z', '2026-10-06T11:00:00.000Z'],
    ]);
  });

  it('chooses the current allocation and the next allocation rather than the first timebox', () => {
    const result = selectDailyExecution({ sessions, now, actionableTaskIds: ['launch', 'review'] });
    expect(result.now?.taskId).toBe('review');
    expect(result.after?.taskId).toBe('launch');
    expect(result.now?.sessionId).toBe('later');
  });

  it('skips a completed task but retains future sessions after recorded work', () => {
    const actual = [
      {
        taskId: 'review',
        startedAt: assertDefined(sessions[0]).startsAt,
        endedAt: assertDefined(sessions[0]).endsAt,
      },
    ];
    const result = selectDailyExecution({ sessions, actual, now, actionableTaskIds: ['review'] });
    expect(result.now?.taskId).toBe('review');
    expect(result.now?.sessionId).toBe('later');
    expect(result.after).toBeNull();
  });

  it('advances past a recorded allocation without treating its task as completed', () => {
    const actual = [
      {
        taskId: 'review',
        startedAt: assertDefined(sessions[1]).startsAt,
        endedAt: '2026-10-06T10:30:00.000Z',
      },
    ];
    const result = selectDailyExecution({
      sessions,
      actual,
      now,
      actionableTaskIds: ['launch', 'review'],
    });
    expect(result.now?.taskId).toBe('launch');
  });

  it('shows a fixed event before later work and preserves an active timer during that event', () => {
    const events = [
      {
        title: 'Team check-in',
        startsAt: '2026-10-06T10:15:00.000Z',
        endsAt: '2026-10-06T10:45:00.000Z',
      },
    ];
    const input = {
      sessions: [assertDefined(sessions[1])],
      events,
      now,
      actionableTaskIds: ['launch'],
    };
    expect(selectDailyExecution(input).event?.title).toBe('Team check-in');
    expect(selectDailyExecution(input).now).toBeNull();
    const active = selectDailyExecution({ ...input, activeTaskId: 'launch' });
    expect(active.event).toBeNull();
    expect(active.now?.taskId).toBe('launch');
  });

  it('skips a task whose daily budget was recorded before its scheduled window', () => {
    const actual = [
      { taskId: 'review', startedAt: '2026-10-06T07:00:00Z', endedAt: '2026-10-06T07:45:00Z' },
    ];
    const input = {
      sessions,
      actual,
      now,
      actionableTaskIds: ['launch', 'review'],
      taskBudgets: [{ taskId: 'review', plannedMinutes: 45 }],
    };
    expect(selectDailyExecution(input).now?.taskId).toBe('launch');
    expect(missedDailyAllocation({ ...input, actionableTaskIds: ['review'] })).toBeNull();
    expect(selectDailyExecution({ ...input, activeTaskId: 'review' }).now?.taskId).toBe('review');
  });

  it.each([
    ['2026-10-06T07:29:29Z', 'review'],
    ['2026-10-06T07:29:30Z', 'launch'],
    ['2026-10-06T07:29:40Z', 'launch'],
  ])('matches the rounded daily read model at %s', (endedAt, nextTaskId) => {
    const actual = [
      { taskId: 'review', startedAt: '2026-10-06T07:00:00Z', endedAt: '2026-10-06T07:14:45Z' },
      { taskId: 'review', startedAt: '2026-10-06T07:14:40Z', endedAt },
    ];
    expect(
      selectDailyExecution({
        sessions,
        actual,
        now,
        actionableTaskIds: ['launch', 'review'],
        taskBudgets: [{ taskId: 'review', plannedMinutes: 30 }],
      }).now?.taskId,
    ).toBe(nextTaskId);
  });

  it('retains future work when actual time has covered only part of the full task budget', () => {
    const actual = [
      { taskId: 'review', startedAt: '2026-10-06T07:00:00Z', endedAt: '2026-10-06T07:45:00Z' },
    ];
    expect(
      selectDailyExecution({
        sessions,
        actual,
        now,
        actionableTaskIds: ['review'],
        taskBudgets: [{ taskId: 'review', plannedMinutes: 90 }],
      }).now?.taskId,
    ).toBe('review');
  });

  it('offers recovery for a pinned missed allocation after skipping completed and recorded work', () => {
    const actual = [
      {
        taskId: 'launch',
        startedAt: assertDefined(sessions[0]).startsAt,
        endedAt: '2026-10-06T09:30:00.000Z',
      },
    ];
    expect(
      missedDailyAllocation({ sessions, actual, now, actionableTaskIds: ['launch', 'review'] })
        ?.taskId,
    ).toBe('review');
    expect(
      missedDailyAllocation({ sessions, actual, now, actionableTaskIds: ['launch'] }),
    ).toBeNull();
  });

  it('does not classify an active or partly recorded allocation as not started', () => {
    const actual = [{ taskId: 'review', startedAt: '2026-10-06T09:45:00.000Z', endedAt: null }];
    expect(
      missedDailyAllocation({
        sessions,
        actual,
        now,
        actionableTaskIds: ['review'],
        activeTaskId: 'review',
      }),
    ).toBeNull();
  });
});
