/**
 * Unit tests for the Time Ledger create/update DTOs' cross-field validation.
 */
import { describe, expect, it } from 'vitest';

import {
  TimeAllocationReplace,
  TimeBreakdownQuery,
  TimeIntervalCreate,
  TimeIntervalRepair,
  TimeRecordCreate,
  TimeSubmissionCreate,
  TimeTimelineQuery,
} from '../../src/time';

const ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const START = '2026-08-01T09:00:00.000Z';
const END = '2026-08-01T10:00:00.000Z';

describe('TimeRecordCreate', () => {
  const context = { label: 'Ship the launch plan' };

  it('starts a live tracker with no historical bounds', () => {
    expect(TimeRecordCreate.safeParse({ context, startNow: true }).success).toBe(true);
  });

  it('refuses live tracking that also supplies historical bounds', () => {
    expect(
      TimeRecordCreate.safeParse({
        context,
        startNow: true,
        startsAt: START,
        endsAt: END,
      }).success,
    ).toBe(false);
  });

  it('requires both a start and an end for manual (non-live) time', () => {
    expect(TimeRecordCreate.safeParse({ context, startNow: false }).success).toBe(false);
    expect(TimeRecordCreate.safeParse({ context, startNow: false, startsAt: START }).success).toBe(
      false,
    );
    expect(
      TimeRecordCreate.safeParse({
        context,
        startNow: false,
        startsAt: START,
        endsAt: END,
      }).success,
    ).toBe(true);
  });

  it('refuses a manual entry whose end is not after its start', () => {
    expect(
      TimeRecordCreate.safeParse({
        context,
        startNow: false,
        startsAt: END,
        endsAt: START,
      }).success,
    ).toBe(false);
  });
});

describe('TimeIntervalCreate', () => {
  it('accepts an interval whose end is after its start', () => {
    expect(TimeIntervalCreate.safeParse({ startsAt: START, endsAt: END }).success).toBe(true);
  });

  it('refuses an interval whose end is not after its start', () => {
    expect(TimeIntervalCreate.safeParse({ startsAt: END, endsAt: START }).success).toBe(false);
    expect(TimeIntervalCreate.safeParse({ startsAt: START, endsAt: START }).success).toBe(false);
  });
});

describe('TimeIntervalRepair', () => {
  it('accepts replacement bounds without accepting a source rewrite', () => {
    const result = TimeIntervalRepair.safeParse({
      startsAt: START,
      endsAt: END,
      source: 'manual_entry',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({ startsAt: START, endsAt: END });
  });
});

describe('TimeAllocationReplace', () => {
  it('accepts an empty allocation set (nothing to sum)', () => {
    expect(TimeAllocationReplace.safeParse({ allocations: [] }).success).toBe(true);
  });

  it('accepts allocations that sum to exactly 10,000 basis points', () => {
    expect(
      TimeAllocationReplace.safeParse({
        allocations: [
          { targetKind: 'task', targetId: ID, basisPoints: 6_000 },
          { targetKind: 'project', targetId: ID, basisPoints: 4_000 },
        ],
      }).success,
    ).toBe(true);
  });

  it('refuses a non-empty allocation set that does not sum to 10,000 basis points', () => {
    expect(
      TimeAllocationReplace.safeParse({
        allocations: [{ targetKind: 'task', targetId: ID, basisPoints: 5_000 }],
      }).success,
    ).toBe(false);
  });
});

describe('TimeTimelineQuery', () => {
  it('accepts a bounded window whose end is after its start', () => {
    expect(TimeTimelineQuery.safeParse({ start: START, end: END }).success).toBe(true);
  });

  it('refuses a window whose end is not after its start', () => {
    expect(TimeTimelineQuery.safeParse({ start: END, end: START }).success).toBe(false);
  });

  it('preserves personal-ledger filters instead of silently stripping them', () => {
    const query = {
      start: START,
      end: END,
      workspaceId: ID,
      projectId: 'project_123',
      taskId: 'task_123',
      categoryId: ID,
      captureSource: 'manual',
    };

    const result = TimeTimelineQuery.safeParse(query);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject(query);
  });

  it('gives breakdown reads the same filter contract as the session timeline', () => {
    const result = TimeBreakdownQuery.safeParse({
      start: START,
      end: END,
      groupBy: 'capture_source',
      workspaceId: ID,
      projectId: 'project_123',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      groupBy: 'capture_source',
      workspaceId: ID,
      projectId: 'project_123',
    });
  });
});

describe('TimeSubmissionCreate', () => {
  const base = {
    periodStartsAt: START,
    periodEndsAt: END,
    timezone: 'America/Chicago',
    measure: 'human_effort' as const,
    timeRecordIds: [ID],
  };

  it('accepts a submission period whose end is after its start', () => {
    expect(TimeSubmissionCreate.safeParse(base).success).toBe(true);
  });

  it('refuses a submission period whose end is not after its start', () => {
    expect(
      TimeSubmissionCreate.safeParse({
        ...base,
        periodStartsAt: END,
        periodEndsAt: START,
      }).success,
    ).toBe(false);
  });
});
