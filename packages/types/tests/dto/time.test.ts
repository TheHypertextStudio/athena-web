/**
 * Unit tests for the Time Ledger create/update DTOs' cross-field validation.
 */
import { describe, expect, it } from 'vitest';

import {
  TimeAllocationReplace,
  TimeIntervalCreate,
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
