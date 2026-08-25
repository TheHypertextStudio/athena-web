import { describe, expect, it } from 'vitest';

import {
  applyTimeReviewPatch,
  parseTimeReviewState,
  resolveTimeReviewRange,
  serializeTimeReviewState,
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
