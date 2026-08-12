/** Exhaustive normalized-storage coverage for recurrence trigger discriminants. */
import type { recurrenceSeriesRevision } from '@docket/db';
import { describe, expect, it } from 'vitest';

import { triggerFromStorage, utcCalendarDate } from '../../src/lib/recurrence/series';

type StoredRevision = typeof recurrenceSeriesRevision.$inferSelect;

const now = new Date('2026-08-12T12:00:00.000Z');

/** Build one complete storage row before overriding the discriminant-specific columns. */
function stored(overrides: Partial<StoredRevision> = {}): StoredRevision {
  return {
    id: 'revision-1',
    organizationId: 'org-1',
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    seriesId: 'series-1',
    processRevisionId: 'process-revision-1',
    number: 1,
    effectiveFrom: '2026-08-12',
    triggerKind: 'manual',
    scheduleKind: null,
    interval: null,
    startDate: null,
    timezone: null,
    endKind: null,
    endDate: null,
    endCount: null,
    monthlyPatternKind: null,
    monthDay: null,
    nthWeekdayOrdinal: null,
    nthWeekday: null,
    yearMonth: null,
    yearDay: null,
    overflow: null,
    intervalUnit: null,
    missedPolicy: null,
    horizonDays: null,
    minimumOccurrences: null,
    eventKind: null,
    eventSubjectType: null,
    eventSource: null,
    eventEntityKind: null,
    ...overrides,
  };
}

/** Calendar columns shared by every stored calendar schedule. */
const calendar = {
  triggerKind: 'calendar',
  scheduleKind: 'daily',
  interval: 1,
  startDate: '2026-08-12',
  timezone: 'America/Los_Angeles',
  endKind: 'never',
  missedPolicy: 'skip',
  horizonDays: 28,
  minimumOccurrences: 2,
} as const;

describe('triggerFromStorage', () => {
  it('round-trips manual, completion, and sparse or fully qualified event triggers', () => {
    expect(triggerFromStorage(stored(), [])).toEqual({ kind: 'manual' });
    expect(
      triggerFromStorage(
        stored({ triggerKind: 'after_completion', interval: 2, intervalUnit: 'week' }),
        [],
      ),
    ).toEqual({ kind: 'after_completion', interval: 2, unit: 'week' });
    expect(triggerFromStorage(stored({ triggerKind: 'event', eventKind: 'created' }), [])).toEqual({
      kind: 'event',
      event: { kind: 'created' },
    });
    expect(
      triggerFromStorage(
        stored({
          triggerKind: 'event',
          eventKind: 'updated',
          eventSubjectType: 'calendar_event',
          eventSource: 'google',
          eventEntityKind: 'workshop',
        }),
        [],
      ),
    ).toEqual({
      kind: 'event',
      event: {
        kind: 'updated',
        subjectType: 'calendar_event',
        source: 'google',
        entityKind: 'workshop',
      },
    });
  });

  it('rejects either missing completion interval column', () => {
    expect(() =>
      triggerFromStorage(
        stored({ triggerKind: 'after_completion', interval: null, intervalUnit: 'week' }),
        [],
      ),
    ).toThrow(/incomplete/i);
    expect(() =>
      triggerFromStorage(
        stored({ triggerKind: 'after_completion', interval: 2, intervalUnit: null }),
        [],
      ),
    ).toThrow(/incomplete/i);
  });

  it('reconstructs every calendar schedule and end discriminant', () => {
    expect(triggerFromStorage(stored(calendar), [])).toMatchObject({
      kind: 'calendar',
      schedule: { kind: 'daily', end: { kind: 'never' } },
    });
    expect(
      triggerFromStorage(stored({ ...calendar, endKind: 'on_date', endDate: '2026-12-31' }), []),
    ).toMatchObject({ schedule: { end: { kind: 'on_date', date: '2026-12-31' } } });
    expect(
      triggerFromStorage(stored({ ...calendar, endKind: 'after_count', endCount: 8 }), []),
    ).toMatchObject({ schedule: { end: { kind: 'after_count', count: 8 } } });
    expect(
      triggerFromStorage(stored({ ...calendar, scheduleKind: 'weekly' }), [1, 3, 5]),
    ).toMatchObject({
      schedule: { kind: 'weekly', weekdays: ['monday', 'wednesday', 'friday'] },
    });
    expect(
      triggerFromStorage(
        stored({
          ...calendar,
          scheduleKind: 'monthly',
          monthlyPatternKind: 'day_of_month',
          monthDay: 31,
          overflow: 'last_day',
        }),
        [],
      ),
    ).toMatchObject({
      schedule: {
        kind: 'monthly',
        pattern: { kind: 'day_of_month', day: 31, overflow: 'last_day' },
      },
    });
    expect(
      triggerFromStorage(
        stored({
          ...calendar,
          scheduleKind: 'monthly',
          monthlyPatternKind: 'nth_weekday',
          nthWeekdayOrdinal: -1,
          nthWeekday: 7,
        }),
        [],
      ),
    ).toMatchObject({
      schedule: {
        kind: 'monthly',
        pattern: { kind: 'nth_weekday', ordinal: -1, weekday: 'sunday' },
      },
    });
    expect(
      triggerFromStorage(
        stored({
          ...calendar,
          scheduleKind: 'yearly',
          yearMonth: 2,
          yearDay: 29,
          overflow: 'skip',
        }),
        [],
      ),
    ).toMatchObject({
      schedule: { kind: 'yearly', month: 2, day: 29, overflow: 'skip' },
    });
  });

  it('rejects each incomplete shared calendar column', () => {
    for (const overrides of [
      { scheduleKind: null },
      { interval: null },
      { startDate: null },
      { timezone: null },
      { endKind: null },
      { missedPolicy: null },
      { horizonDays: null },
      { minimumOccurrences: null },
    ] satisfies Partial<StoredRevision>[]) {
      expect(() => triggerFromStorage(stored({ ...calendar, ...overrides }), [])).toThrow(
        /incomplete/i,
      );
    }
  });

  it('rejects incomplete calendar end payloads', () => {
    expect(() =>
      triggerFromStorage(stored({ ...calendar, endKind: 'on_date', endDate: null }), []),
    ).toThrow(/end is incomplete/i);
    expect(() =>
      triggerFromStorage(stored({ ...calendar, endKind: 'after_count', endCount: null }), []),
    ).toThrow(/end is incomplete/i);
  });

  it('rejects incomplete monthly pattern payloads', () => {
    for (const overrides of [
      { monthlyPatternKind: null },
      { monthlyPatternKind: 'day_of_month', monthDay: null, overflow: 'skip' },
      { monthlyPatternKind: 'day_of_month', monthDay: 1, overflow: null },
      { monthlyPatternKind: 'nth_weekday', nthWeekdayOrdinal: null, nthWeekday: 1 },
      { monthlyPatternKind: 'nth_weekday', nthWeekdayOrdinal: 1, nthWeekday: null },
    ] satisfies Partial<StoredRevision>[]) {
      expect(() =>
        triggerFromStorage(stored({ ...calendar, scheduleKind: 'monthly', ...overrides }), []),
      ).toThrow(/monthly trigger is incomplete/i);
    }
  });

  it('rejects either incomplete yearly date column', () => {
    expect(() =>
      triggerFromStorage(
        stored({ ...calendar, scheduleKind: 'yearly', yearMonth: null, yearDay: 1 }),
        [],
      ),
    ).toThrow(/yearly trigger is incomplete/i);
    expect(() =>
      triggerFromStorage(
        stored({ ...calendar, scheduleKind: 'yearly', yearMonth: 1, yearDay: null }),
        [],
      ),
    ).toThrow(/yearly trigger is incomplete/i);
    expect(() =>
      triggerFromStorage(
        stored({
          ...calendar,
          scheduleKind: 'yearly',
          yearMonth: 1,
          yearDay: 1,
          overflow: null,
        }),
        [],
      ),
    ).toThrow(/yearly trigger is incomplete/i);
  });
});

describe('utcCalendarDate', () => {
  it('uses a supplied instant and supports the default clock', () => {
    expect(utcCalendarDate(now)).toBe('2026-08-12');
    expect(utcCalendarDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
