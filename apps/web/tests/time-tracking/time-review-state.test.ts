import { describe, expect, it } from 'vitest';

import {
  applyTimeReviewPatch,
  navigateTimeReviewPeriod,
  parseTimeReviewState,
  resolveTimeReviewRange,
  serializeTimeReviewState,
  todayTimeReviewState,
} from '../../src/components/time-tracking/time-review-state';

describe('personal time review state', () => {
  it('uses calendar-week bounds in the supplied Hub timezone', () => {
    const state = parseTimeReviewState(new URLSearchParams(), 'America/Los_Angeles', '2026-08-19');

    expect(resolveTimeReviewRange(state, 'America/Los_Angeles')).toEqual({
      start: '2026-08-17T07:00:00Z',
      end: '2026-08-24T07:00:00Z',
      label: 'Aug 17 – 23, 2026',
    });
  });

  it('keeps custom dates as an inclusive start and exclusive end across daylight saving time', () => {
    const state = parseTimeReviewState(
      new URLSearchParams('period=custom&start=2026-03-08&end=2026-03-10'),
      'America/Los_Angeles',
      '2026-03-08',
    );

    expect(resolveTimeReviewRange(state, 'America/Los_Angeles')).toEqual({
      start: '2026-03-08T08:00:00Z',
      end: '2026-03-10T07:00:00Z',
      label: 'Mar 8 – 9, 2026',
    });
  });

  it('drops dependent filters when a parent filter changes', () => {
    const current = parseTimeReviewState(
      new URLSearchParams('workspaceId=workspace-a&projectId=project-a&taskId=task-a'),
      'UTC',
      '2026-08-19',
    );

    expect(applyTimeReviewPatch(current, { workspaceId: 'workspace-b' })).toMatchObject({
      workspaceId: 'workspace-b',
      projectId: undefined,
      taskId: undefined,
    });
    expect(applyTimeReviewPatch(current, { projectId: 'project-b' })).toMatchObject({
      workspaceId: 'workspace-a',
      projectId: 'project-b',
      taskId: undefined,
    });
  });

  it('round-trips the settled URL state', () => {
    const state = parseTimeReviewState(
      new URLSearchParams(
        'view=breakdown&period=month&anchor=2026-08-19&measure=agent&workspaceId=workspace-a&captureSource=manual',
      ),
      'UTC',
      '2026-08-19',
    );

    expect(serializeTimeReviewState(state).toString()).toBe(
      'view=breakdown&period=month&anchor=2026-08-19&measure=agent&workspaceId=workspace-a&captureSource=manual',
    );
  });
});

const cycles = [
  {
    id: 'later',
    workspaceId: 'b',
    workspaceName: 'B',
    name: 'Later',
    startsAt: '2026-08-24T00:00:00Z',
    endsAt: '2026-08-31T00:00:00Z',
  },
  {
    id: 'earlier',
    workspaceId: 'a',
    workspaceName: 'A',
    name: 'Earlier',
    startsAt: '2026-08-17T00:00:00Z',
    endsAt: '2026-08-24T00:00:00Z',
  },
];

describe('time review navigation', () => {
  it('moves between chronologically ordered cycles and clears dependent foreign-workspace filters', () => {
    const state = parseTimeReviewState(
      new URLSearchParams('period=cycle&cycleId=earlier&workspaceId=a&projectId=p&taskId=t'),
      'UTC',
      '2026-08-19',
    );
    const next = navigateTimeReviewPeriod(state, 1, cycles);
    expect(next).toMatchObject({
      cycleId: 'later',
      workspaceId: 'b',
      projectId: undefined,
      taskId: undefined,
    });
    expect(resolveTimeReviewRange(next, 'UTC', cycles)).toEqual({
      start: '2026-08-24T00:00:00Z',
      end: '2026-08-31T00:00:00Z',
      label: 'Later',
    });
    expect(navigateTimeReviewPeriod(next, -1, cycles).cycleId).toBe('earlier');
  });

  it('leaves unavailable cycle edges and unknown selections unchanged', () => {
    const first = parseTimeReviewState(
      new URLSearchParams('period=cycle&cycleId=earlier'),
      'UTC',
      '2026-08-19',
    );
    expect(navigateTimeReviewPeriod(first, -1, cycles)).toEqual(first);
    const missing = { ...first, cycleId: 'unavailable' };
    expect(navigateTimeReviewPeriod(missing, 1, cycles)).toEqual(missing);
    expect(navigateTimeReviewPeriod(first, 1, [])).toEqual(first);
  });

  it('returns to the timezone-local day while retaining the settled view and filters', () => {
    const state = parseTimeReviewState(
      new URLSearchParams(
        'period=month&anchor=2026-08-01&view=breakdown&measure=agent&workspaceId=a&projectId=p&taskId=t&categoryId=c&captureSource=manual',
      ),
      'UTC',
      '2026-08-19',
    );
    expect(
      todayTimeReviewState(state, 'America/Los_Angeles', cycles, '2026-08-25T06:30:00Z'),
    ).toEqual({ ...state, anchor: '2026-08-24' });
  });

  it('returns from an old cycle to the current cycle and falls back to today when no cycle exists', () => {
    const state = parseTimeReviewState(
      new URLSearchParams('period=cycle&cycleId=earlier&workspaceId=b'),
      'UTC',
      '2026-08-19',
    );
    expect(todayTimeReviewState(state, 'UTC', cycles, '2026-08-25T12:00:00Z')).toMatchObject({
      period: 'cycle',
      cycleId: 'later',
      anchor: '2026-08-25',
      workspaceId: 'b',
    });
    expect(todayTimeReviewState(state, 'UTC', cycles, '2026-09-01T12:00:00Z')).toMatchObject({
      period: 'day',
      cycleId: undefined,
      anchor: '2026-09-01',
      workspaceId: 'b',
    });
  });

  it('moves a custom window to today without changing its length', () => {
    const state = parseTimeReviewState(
      new URLSearchParams('period=custom&start=2026-08-01&end=2026-08-04'),
      'UTC',
      '2026-08-19',
    );
    expect(todayTimeReviewState(state, 'UTC', [], '2026-08-25T12:00:00Z')).toMatchObject({
      period: 'custom',
      anchor: '2026-08-25',
      start: '2026-08-25',
      end: '2026-08-28',
    });
  });
});
