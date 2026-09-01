/**
 * `@docket/api` — deterministic calendar-date recurrence expansion.
 *
 * @remarks
 * These cases are intentionally date-only. They must produce the same values regardless of the
 * server's timezone, daylight-saving transitions, or when the materialization sweep runs.
 */
import type { MaterializationPolicy, RecurrenceSchedule } from '../../src/contracts/recurrence';
import { describe, expect, it } from 'vitest';

import {
  addCalendarDays,
  addCalendarMonths,
  daysInMonth,
  formatCalendarDate,
  parseCalendarDate,
} from '@docket/planning/calendar-date';
import {
  expandCalendarSchedule,
  materializationWindow,
  type RecurrenceDateExceptions,
} from '../../src/lib/recurrence/expand';

const timezone = 'America/Los_Angeles';

describe('expandCalendarSchedule', () => {
  it('expands an interval-based daily schedule with inclusive bounds', () => {
    const schedule = {
      kind: 'daily',
      interval: 2,
      startDate: '2026-08-12',
      timezone,
      end: { kind: 'never' },
    } satisfies RecurrenceSchedule;

    expect(
      expandCalendarSchedule(schedule, {
        from: '2026-08-12',
        through: '2026-08-18',
      }),
    ).toEqual(['2026-08-12', '2026-08-14', '2026-08-16', '2026-08-18']);
  });

  it('expands selected weekdays from the start week without moving the cadence anchor', () => {
    const schedule = {
      kind: 'weekly',
      interval: 1,
      startDate: '2026-08-12',
      timezone,
      weekdays: ['monday', 'wednesday', 'friday'],
      end: { kind: 'never' },
    } satisfies RecurrenceSchedule;

    expect(
      expandCalendarSchedule(schedule, {
        from: '2026-08-12',
        through: '2026-08-20',
      }),
    ).toEqual(['2026-08-12', '2026-08-14', '2026-08-17', '2026-08-19']);
  });

  it('anchors multi-week intervals to the Monday of the start week', () => {
    const schedule = {
      kind: 'weekly',
      interval: 2,
      startDate: '2026-08-12',
      timezone,
      weekdays: ['monday', 'friday'],
      end: { kind: 'never' },
    } satisfies RecurrenceSchedule;

    expect(
      expandCalendarSchedule(schedule, {
        from: '2026-08-01',
        through: '2026-09-08',
      }),
    ).toEqual(['2026-08-14', '2026-08-24', '2026-08-28', '2026-09-07']);
  });

  it('supports skip and last-day overflow for numbered monthly dates', () => {
    const base = {
      kind: 'monthly',
      interval: 1,
      startDate: '2026-08-31',
      timezone,
      end: { kind: 'never' },
    } as const;

    expect(
      expandCalendarSchedule(
        { ...base, pattern: { kind: 'day_of_month', day: 31, overflow: 'skip' } },
        { from: '2026-08-01', through: '2026-10-31' },
      ),
    ).toEqual(['2026-08-31', '2026-10-31']);
    expect(
      expandCalendarSchedule(
        { ...base, pattern: { kind: 'day_of_month', day: 31, overflow: 'last_day' } },
        { from: '2026-08-01', through: '2026-10-31' },
      ),
    ).toEqual(['2026-08-31', '2026-09-30', '2026-10-31']);
  });

  it('expands nth and last weekday monthly patterns', () => {
    const base = {
      kind: 'monthly',
      interval: 1,
      startDate: '2026-09-01',
      timezone,
      end: { kind: 'never' },
    } as const;

    expect(
      expandCalendarSchedule(
        { ...base, pattern: { kind: 'nth_weekday', ordinal: 2, weekday: 'saturday' } },
        { from: '2026-09-01', through: '2026-12-31' },
      ),
    ).toEqual(['2026-09-12', '2026-10-10', '2026-11-14', '2026-12-12']);
    expect(
      expandCalendarSchedule(
        { ...base, pattern: { kind: 'nth_weekday', ordinal: -1, weekday: 'monday' } },
        { from: '2026-09-01', through: '2026-11-30' },
      ),
    ).toEqual(['2026-09-28', '2026-10-26', '2026-11-30']);
  });

  it('handles leap-day yearly schedules without timestamp or DST arithmetic', () => {
    const base = {
      kind: 'yearly',
      interval: 1,
      startDate: '2024-02-29',
      timezone,
      month: 2,
      day: 29,
      end: { kind: 'never' },
    } as const;

    expect(
      expandCalendarSchedule(
        { ...base, overflow: 'skip' },
        { from: '2024-01-01', through: '2028-12-31' },
      ),
    ).toEqual(['2024-02-29', '2028-02-29']);
    expect(
      expandCalendarSchedule(
        { ...base, overflow: 'last_day' },
        { from: '2024-01-01', through: '2027-12-31' },
      ),
    ).toEqual(['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28']);
  });

  it('treats an on-date end as inclusive and counts from the series start', () => {
    const daily = {
      kind: 'daily',
      interval: 1,
      startDate: '2026-08-10',
      timezone,
      end: { kind: 'on_date', date: '2026-08-12' },
    } satisfies RecurrenceSchedule;
    expect(expandCalendarSchedule(daily, { from: '2026-08-01', through: '2026-08-31' })).toEqual([
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
    ]);

    const counted = {
      ...daily,
      end: { kind: 'after_count', count: 3 },
    } satisfies RecurrenceSchedule;
    expect(expandCalendarSchedule(counted, { from: '2026-08-12', through: '2026-08-31' })).toEqual([
      '2026-08-12',
    ]);
  });

  it('applies exclusions, explicit inclusions, and reschedules without duplicates', () => {
    const schedule = {
      kind: 'daily',
      interval: 1,
      startDate: '2026-08-10',
      timezone,
      end: { kind: 'never' },
    } satisfies RecurrenceSchedule;
    const exceptions: RecurrenceDateExceptions = {
      exclude: ['2026-08-11'],
      include: ['2026-08-15', '2026-08-15'],
      reschedule: [
        { from: '2026-08-12', to: '2026-08-14' },
        { from: '2026-08-13', to: '2026-08-15' },
      ],
    };

    expect(
      expandCalendarSchedule(schedule, {
        from: '2026-08-10',
        through: '2026-08-15',
        exceptions,
      }),
    ).toEqual(['2026-08-10', '2026-08-14', '2026-08-15']);
  });

  it('extends a rolling horizon until its minimum upcoming occurrence count is satisfied', () => {
    const schedule = {
      kind: 'yearly',
      interval: 1,
      startDate: '2026-01-01',
      timezone,
      month: 1,
      day: 1,
      overflow: 'skip',
      end: { kind: 'never' },
    } satisfies RecurrenceSchedule;

    expect(
      expandCalendarSchedule(schedule, {
        from: '2026-08-12',
        through: '2026-09-09',
        minimumOccurrences: 2,
      }),
    ).toEqual(['2027-01-01', '2028-01-01']);
  });

  it('returns fewer than the minimum when the configured series end is reached', () => {
    const schedule = {
      kind: 'daily',
      interval: 1,
      startDate: '2026-08-12',
      timezone,
      end: { kind: 'after_count', count: 1 },
    } satisfies RecurrenceSchedule;

    expect(
      expandCalendarSchedule(schedule, {
        from: '2026-08-12',
        through: '2026-08-12',
        minimumOccurrences: 2,
      }),
    ).toEqual(['2026-08-12']);
  });

  it('terminates an impossible yearly skip rule instead of searching forever', () => {
    const schedule = {
      kind: 'yearly',
      interval: 1,
      startDate: '2026-01-01',
      timezone,
      month: 2,
      day: 30,
      overflow: 'skip',
      end: { kind: 'never' },
    } satisfies RecurrenceSchedule;

    expect(
      expandCalendarSchedule(schedule, {
        from: '2026-01-01',
        through: '2026-12-31',
        minimumOccurrences: 2,
      }),
    ).toEqual([]);
  });

  it('rejects completion-anchored schedules because they advance from completion events', () => {
    const schedule = {
      kind: 'after_completion',
      interval: 1,
      unit: 'day',
    } satisfies RecurrenceSchedule;

    expect(() =>
      expandCalendarSchedule(schedule, { from: '2026-08-12', through: '2026-09-09' }),
    ).toThrow(/completion event/i);
  });

  it('rejects unsafe generation bounds and ambiguous occurrence exceptions', () => {
    const invalidInterval = {
      kind: 'daily',
      interval: 0,
      startDate: '2026-08-12',
      timezone,
      end: { kind: 'never' },
    } as RecurrenceSchedule;
    expect(() =>
      expandCalendarSchedule(invalidInterval, { from: '2026-08-12', through: '2026-08-13' }),
    ).toThrow(/positive safe integer/i);

    const daily = {
      kind: 'daily',
      interval: 1,
      startDate: '2026-08-12',
      timezone,
      end: { kind: 'never' },
    } satisfies RecurrenceSchedule;
    expect(() =>
      expandCalendarSchedule(daily, { from: '2026-08-13', through: '2026-08-12' }),
    ).toThrow(/start.*horizon/i);
    expect(() =>
      expandCalendarSchedule(daily, {
        from: '2026-08-12',
        through: '2026-08-13',
        minimumOccurrences: -1,
      }),
    ).toThrow(/nonnegative safe integer/i);
    expect(() =>
      expandCalendarSchedule(daily, {
        from: '2026-08-12',
        through: '2026-08-13',
        exceptions: {
          reschedule: [
            { from: '2026-08-12', to: '2026-08-14' },
            { from: '2026-08-12', to: '2026-08-15' },
          ],
        },
      }),
    ).toThrow(/more than one reschedule/i);
    expect(() =>
      expandCalendarSchedule(daily, {
        from: '2026-08-12',
        through: '2026-08-13',
        exceptions: {
          exclude: ['2026-08-12'],
          reschedule: [{ from: '2026-08-12', to: '2026-08-14' }],
        },
      }),
    ).toThrow(/excluded and rescheduled/i);
  });

  it('omits nonexistent fifth weekdays and replacements outside the visible window', () => {
    const fifthMonday = {
      kind: 'monthly',
      interval: 1,
      startDate: '2026-02-01',
      timezone,
      pattern: { kind: 'nth_weekday', ordinal: 5, weekday: 'monday' },
      end: { kind: 'after_count', count: 1 },
    } satisfies RecurrenceSchedule;
    expect(
      expandCalendarSchedule(fifthMonday, {
        from: '2026-02-01',
        through: '2026-02-28',
        exceptions: { include: ['2026-01-31', '2026-03-01'] },
      }),
    ).toEqual([]);

    const daily = {
      kind: 'daily',
      interval: 1,
      startDate: '2026-08-12',
      timezone,
      end: { kind: 'after_count', count: 1 },
    } satisfies RecurrenceSchedule;
    expect(
      expandCalendarSchedule(daily, {
        from: '2026-08-12',
        through: '2026-08-13',
        exceptions: { reschedule: [{ from: '2026-08-12', to: '2026-08-11' }] },
      }),
    ).toEqual([]);
  });

  it('stops yearly expansion at the supported calendar limit', () => {
    const schedule = {
      kind: 'yearly',
      interval: 1,
      startDate: '9999-01-01',
      timezone,
      month: 1,
      day: 1,
      overflow: 'skip',
      end: { kind: 'never' },
    } satisfies RecurrenceSchedule;
    expect(
      expandCalendarSchedule(schedule, {
        from: '9999-01-01',
        through: '9999-01-01',
        minimumOccurrences: 2,
      }),
    ).toEqual(['9999-01-01']);
  });
});

describe('materializationWindow', () => {
  it('derives the rolling horizon and minimum directly from policy', () => {
    const policy = { horizonDays: 28, minimumOccurrences: 2 } satisfies MaterializationPolicy;
    expect(materializationWindow('2026-08-12', policy)).toEqual({
      from: '2026-08-12',
      through: '2026-09-09',
      minimumOccurrences: 2,
    });
  });

  it('rejects nonpositive or unsafe rolling policy values', () => {
    expect(() =>
      materializationWindow('2026-08-12', {
        horizonDays: 0,
        minimumOccurrences: 2,
      }),
    ).toThrow(/horizon.*positive safe integer/i);
    expect(() =>
      materializationWindow('2026-08-12', {
        horizonDays: 28,
        minimumOccurrences: Number.POSITIVE_INFINITY,
      }),
    ).toThrow(/minimum.*positive safe integer/i);
  });
});

describe('calendar-date arithmetic boundaries', () => {
  it('rejects invalid fields and unsafe arithmetic before computing a date', () => {
    expect(() => daysInMonth(-1, 1)).toThrow(/year/i);
    expect(() => daysInMonth(2026, 13)).toThrow(/month/i);
    expect(() => parseCalendarDate('August 12, 2026')).toThrow(/invalid calendar date/i);
    expect(() => formatCalendarDate({ year: 2026, month: 2, day: 30 })).toThrow(/invalid/i);
    expect(() => addCalendarDays('2026-08-12', Number.NaN)).toThrow(/safe integer/i);
    expect(() => addCalendarMonths('2026-08-12', Number.POSITIVE_INFINITY)).toThrow(
      /safe integer/i,
    );
    expect(() => addCalendarMonths('9999-12-01', 1)).toThrow(/out of range/i);
  });
});
