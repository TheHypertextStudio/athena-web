import { describe, expect, it } from 'vitest';
import {
  CalendarRecurrenceSchedule,
  RecurrenceSchedule,
  MaterializationPolicy,
} from '../src/contracts/recurrence';

describe('portable existing cadence contracts', () => {
  const start = { startDate: '2026-10-14', timezone: 'America/Los_Angeles' };
  it('retains existing defaults and all calendar/completion arms', () => {
    expect(CalendarRecurrenceSchedule.parse({ kind: 'daily', ...start })).toEqual({
      kind: 'daily',
      ...start,
      interval: 1,
      end: { kind: 'never' },
    });
    expect(
      CalendarRecurrenceSchedule.parse({
        kind: 'weekly',
        ...start,
        weekdays: ['thursday', 'monday'],
      }),
    ).toMatchObject({ weekdays: ['thursday', 'monday'] });
    expect(
      CalendarRecurrenceSchedule.parse({
        kind: 'monthly',
        ...start,
        pattern: { kind: 'nth_weekday', ordinal: 2, weekday: 'thursday' },
      }),
    ).toMatchObject({ pattern: { kind: 'nth_weekday', ordinal: 2, weekday: 'thursday' } });
    expect(
      CalendarRecurrenceSchedule.parse({ kind: 'yearly', ...start, month: 2, day: 29 }),
    ).toMatchObject({ overflow: 'skip' });
    expect(
      RecurrenceSchedule.parse({ kind: 'after_completion', interval: 2, unit: 'week' }),
    ).toEqual({ kind: 'after_completion', interval: 2, unit: 'week' });
    expect(MaterializationPolicy.parse({})).toEqual({ horizonDays: 28, minimumOccurrences: 2 });
  });
  it('preserves strictness, weekday uniqueness and invalid date/end bounds', () => {
    for (const rule of [
      { kind: 'weekly', ...start, weekdays: ['monday', 'monday'] },
      { kind: 'daily', ...start, startDate: '2026-02-29' },
      { kind: 'daily', ...start, interval: 0 },
      {
        kind: 'monthly',
        ...start,
        pattern: { kind: 'nth_weekday', ordinal: 6, weekday: 'thursday' },
      },
      { kind: 'daily', ...start, end: { kind: 'after_count', count: 0 } },
      { kind: 'daily', ...start, teamId: 'literal' },
    ])
      expect(CalendarRecurrenceSchedule.safeParse(rule).success).toBe(false);
  });
});
