import { describe, expect, it } from 'vitest';

import {
  WorkScheduleExceptionCreate,
  WorkSchedulePlanCreate,
  WorkSchedulePlanOut,
} from '../src/contracts/work-location';
import type { WorkSchedulePlanOut as WorkSchedulePlan } from '../src/contracts/work-location';
import { WorkPlaceId, WorkScheduleExceptionId, WorkSchedulePlanId } from '../src/ids';
import { expandWorkSchedulePlan, selectCurrentOrNextWorkSchedulePlan } from '../src/work-schedule';

const HOME_ID = WorkPlaceId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const OFFICE_ID = WorkPlaceId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ');
const PLAN_ID = WorkSchedulePlanId.parse('01BX5ZZKBKACTAV9WEVGEMMVS0');
const EXCEPTION_ID = WorkScheduleExceptionId.parse('01BX5ZZKBKACTAV9WEVGEMMVT1');

function segment(
  startMinute: number,
  durationMinutes: number,
  placeId: typeof OFFICE_ID = OFFICE_ID,
) {
  return {
    startMinute,
    durationMinutes,
    location: { type: 'saved_place' as const, placeId },
  };
}

function plan(overrides: Partial<WorkSchedulePlan> = {}): WorkSchedulePlan {
  return WorkSchedulePlanOut.parse({
    id: PLAN_ID,
    anchorDate: '2026-09-07',
    timezone: 'America/Los_Angeles',
    effectiveFrom: '2026-09-07',
    effectiveUntil: null,
    cycleDays: [
      { segments: [segment(540, 480)] },
      { segments: [segment(540, 480)] },
      { segments: [segment(540, 480)] },
      { segments: [segment(540, 480)] },
      { segments: [segment(540, 480)] },
      { segments: [] },
      { segments: [] },
    ],
    revision: 1,
    createdAt: '2026-09-05T16:00:00.000Z',
    updatedAt: '2026-09-05T16:00:00.000Z',
    ...overrides,
  });
}

describe('work schedule contracts', () => {
  it.each([0, 29])('rejects a %i-day cycle', (length) => {
    const result = WorkSchedulePlanCreate.safeParse({
      anchorDate: '2026-09-07',
      timezone: 'America/Los_Angeles',
      effectiveFrom: '2026-09-07',
      effectiveUntil: null,
      cycleDays: Array.from({ length }, () => ({ segments: [] })),
    });

    expect(result.success).toBe(false);
  });

  it('rejects overlapping split shifts on one cycle day', () => {
    const result = WorkSchedulePlanCreate.safeParse({
      anchorDate: '2026-09-07',
      timezone: 'America/Los_Angeles',
      effectiveFrom: '2026-09-07',
      effectiveUntil: null,
      cycleDays: [{ segments: [segment(540, 240), segment(720, 240, HOME_ID)] }],
    });

    expect(result.success).toBe(false);
  });

  it('rejects an overnight segment that overlaps the next cycle day', () => {
    const result = WorkSchedulePlanCreate.safeParse({
      anchorDate: '2026-09-07',
      timezone: 'America/Los_Angeles',
      effectiveFrom: '2026-09-07',
      effectiveUntil: null,
      cycleDays: [{ segments: [segment(1_320, 240)] }, { segments: [segment(60, 180, HOME_ID)] }],
    });

    expect(result.success).toBe(false);
  });

  it('rejects a segment that overlaps itself when the cycle repeats', () => {
    const result = WorkSchedulePlanCreate.safeParse({
      anchorDate: '2026-09-07',
      timezone: 'America/Los_Angeles',
      effectiveFrom: '2026-09-07',
      effectiveUntil: null,
      cycleDays: [{ segments: [segment(0, 1_441)] }],
    });

    expect(result.success).toBe(false);
  });

  it('rejects a version that ends before it starts', () => {
    const result = WorkSchedulePlanCreate.safeParse({
      anchorDate: '2026-09-07',
      timezone: 'America/Los_Angeles',
      effectiveFrom: '2026-09-07',
      effectiveUntil: '2026-09-06',
      cycleDays: [{ segments: [] }],
    });

    expect(result.success).toBe(false);
  });

  it('rejects a timezone that the runtime cannot resolve', () => {
    const result = WorkSchedulePlanCreate.safeParse({
      anchorDate: '2026-09-07',
      timezone: 'Las Vegas Standard Time',
      effectiveFrom: '2026-09-07',
      effectiveUntil: null,
      cycleDays: [{ segments: [] }],
    });

    expect(result.success).toBe(false);
  });

  it('allows a dated replacement to contain one seven-day assignment', () => {
    const result = WorkScheduleExceptionCreate.safeParse({
      date: '2026-09-07',
      segments: [segment(60, 10_080)],
    });

    expect(result.success).toBe(true);
  });

  it('rejects overlapping segments in one dated replacement', () => {
    const result = WorkScheduleExceptionCreate.safeParse({
      date: '2026-09-07',
      segments: [segment(540, 240), segment(720, 240, HOME_ID)],
    });

    expect(result.success).toBe(false);
  });
});

describe('work schedule expansion', () => {
  it('keeps a current plan selected until a future version takes effect', () => {
    const current = plan({ effectiveFrom: '2026-09-01', effectiveUntil: '2026-09-09' });
    const future = plan({
      id: WorkSchedulePlanId.parse('01BX5ZZKBKACTAV9WEVGEMMVS1'),
      effectiveFrom: '2026-09-10',
      effectiveUntil: null,
    });

    expect(
      selectCurrentOrNextWorkSchedulePlan([current, future], new Date('2026-09-06T18:00:00.000Z'))
        ?.id,
    ).toBe(current.id);
    expect(
      selectCurrentOrNextWorkSchedulePlan([future], new Date('2026-09-06T18:00:00.000Z'))?.id,
    ).toBe(future.id);
  });

  it('rejects a request whose date range moves backward', () => {
    expect(() =>
      expandWorkSchedulePlan({
        plan: plan(),
        exceptions: [],
        startDate: '2026-09-08',
        endDate: '2026-09-07',
      }),
    ).toThrow(RangeError);
  });

  it('clips expansion to the plan effective dates and skips disjoint requests', () => {
    const finitePlan = plan({ effectiveUntil: '2026-09-08' });
    const expanded = expandWorkSchedulePlan({
      plan: finitePlan,
      exceptions: [],
      startDate: '2026-09-01',
      endDate: '2026-09-20',
    });

    expect(expanded.map(({ date }) => date)).toEqual(['2026-09-07', '2026-09-08']);
    expect(
      expandWorkSchedulePlan({
        plan: finitePlan,
        exceptions: [],
        startDate: '2026-09-01',
        endDate: '2026-09-06',
      }),
    ).toEqual([]);
    expect(
      expandWorkSchedulePlan({
        plan: finitePlan,
        exceptions: [],
        startDate: '2026-09-09',
        endDate: '2026-09-20',
      }),
    ).toEqual([]);
  });

  it('expands a seven-day plan with split shifts and no-work days', () => {
    const expanded = expandWorkSchedulePlan({
      plan: plan({
        cycleDays: [
          {
            segments: [segment(480, 240, HOME_ID), segment(780, 240, OFFICE_ID)],
          },
          { segments: [] },
          { segments: [] },
          { segments: [] },
          { segments: [] },
          { segments: [] },
          { segments: [] },
        ],
      }),
      exceptions: [],
      startDate: '2026-09-07',
      endDate: '2026-09-08',
    });

    expect(expanded).toEqual([
      {
        date: '2026-09-07',
        source: 'plan',
        planVersionId: PLAN_ID,
        exceptionId: null,
        segments: [
          {
            startsAt: '2026-09-07T15:00:00.000Z',
            endsAt: '2026-09-07T19:00:00.000Z',
            location: { type: 'saved_place', placeId: HOME_ID },
          },
          {
            startsAt: '2026-09-07T20:00:00.000Z',
            endsAt: '2026-09-08T00:00:00.000Z',
            location: { type: 'saved_place', placeId: OFFICE_ID },
          },
        ],
      },
      {
        date: '2026-09-08',
        source: 'plan',
        planVersionId: PLAN_ID,
        exceptionId: null,
        segments: [],
      },
    ]);
  });

  it('uses the anchor date for a nine-day rotation', () => {
    const rotation = plan({
      cycleDays: Array.from({ length: 9 }, (_, index) => ({
        segments: index === 8 ? [segment(360, 360)] : [],
      })),
    });

    const expanded = expandWorkSchedulePlan({
      plan: rotation,
      exceptions: [],
      startDate: '2026-09-15',
      endDate: '2026-09-16',
    });

    expect(expanded[0]?.segments).toHaveLength(1);
    expect(expanded[1]?.segments).toHaveLength(0);
  });

  it('keeps an overnight segment together across a daylight-saving change', () => {
    const expanded = expandWorkSchedulePlan({
      plan: plan({
        anchorDate: '2026-10-31',
        effectiveFrom: '2026-10-31',
        cycleDays: [{ segments: [segment(1_320, 480)] }],
      }),
      exceptions: [],
      startDate: '2026-10-31',
      endDate: '2026-10-31',
    });

    expect(expanded[0]?.segments[0]).toMatchObject({
      startsAt: '2026-11-01T05:00:00.000Z',
      endsAt: '2026-11-01T14:00:00.000Z',
    });
  });

  it('preserves mobile and undecided location states', () => {
    const expanded = expandWorkSchedulePlan({
      plan: plan({
        cycleDays: [
          {
            segments: [
              { startMinute: 480, durationMinutes: 120, location: { type: 'mobile' } },
              { startMinute: 660, durationMinutes: 120, location: { type: 'undecided' } },
            ],
          },
        ],
      }),
      exceptions: [],
      startDate: '2026-09-07',
      endDate: '2026-09-07',
    });

    expect(expanded[0]?.segments.map((item) => item.location.type)).toEqual([
      'mobile',
      'undecided',
    ]);
  });

  it('replaces the complete day with a dated no-work exception', () => {
    const expanded = expandWorkSchedulePlan({
      plan: plan(),
      exceptions: [
        {
          id: EXCEPTION_ID,
          planVersionId: PLAN_ID,
          date: '2026-09-07',
          segments: [],
          origin: 'docket',
          createdAt: '2026-09-05T16:00:00.000Z',
          updatedAt: '2026-09-05T16:00:00.000Z',
        },
      ],
      startDate: '2026-09-07',
      endDate: '2026-09-07',
    });

    expect(expanded).toEqual([
      {
        date: '2026-09-07',
        source: 'exception',
        planVersionId: PLAN_ID,
        exceptionId: EXCEPTION_ID,
        segments: [],
      },
    ]);
  });
});
