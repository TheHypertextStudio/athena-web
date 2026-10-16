import { describe, expect, it } from 'vitest';
import {
  cycleWindowContaining,
  cycleWindowsThrough,
  CycleRangeLimitError,
  isWithinWindow,
  normalizeCadenceDays,
  normalizeCadenceWeeks,
  rollingWindow,
} from '../src/cycle-schedule';
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

describe('native team cycle windows', () => {
  const schedule = { anchorDate: '2026-01-01', cadenceDays: 7 };

  it.each([1, 7, 365])('preserves supported %i-day cadences', (days) => {
    expect(normalizeCadenceDays(days)).toBe(days);
  });
  it.each([0, -1, 366, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'uses the weekly compatibility default for invalid cadence %s',
    (days) => {
      expect(normalizeCadenceDays(days)).toBe(7);
    },
  );
  it('normalizes legacy week counts without accepting nonfinite or zero cadence', () => {
    expect(normalizeCadenceWeeks(2.9)).toBe(2);
    for (const weeks of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(normalizeCadenceWeeks(weeks)).toBe(1);
  });
  it('keeps inclusive boundaries and stable identities on either side of the anchor', () => {
    const first = cycleWindowContaining(schedule, '2026-01-01');
    expect(first).toMatchObject({ startDate: '2026-01-01', endDate: '2026-01-07' });
    expect(first.startsAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(first.endsAt.toISOString()).toBe('2026-01-07T23:59:59.999Z');
    expect(cycleWindowContaining(schedule, '2026-01-07')).toEqual(first);
    expect(cycleWindowContaining(schedule, '2026-01-08').startDate).toBe('2026-01-08');
    expect(cycleWindowContaining(schedule, '2025-12-31')).toMatchObject({
      startDate: '2025-12-25',
      endDate: '2025-12-31',
      number: first.number - 7,
    });
  });
  it('includes every intersecting window and returns none for a reversed window range', () => {
    expect(cycleWindowsThrough(schedule, '2026-01-08').map((slot) => slot.startDate)).toEqual([
      '2026-01-01',
      '2026-01-08',
    ]);
    expect(cycleWindowsThrough(schedule, '2026-01-08', '2026-01-07')).toHaveLength(2);
    expect(cycleWindowsThrough(schedule, '2026-01-07', '2026-01-08')).toEqual([]);
  });
  it('accepts exactly 400 windows and refuses a larger materialization atomically', () => {
    const daily = { ...schedule, cadenceDays: 1 };
    const windows = cycleWindowsThrough(daily, '2027-02-04');
    expect(windows).toHaveLength(400);
    expect(windows.at(-1)?.endDate).toBe('2027-02-04');
    expect(() => cycleWindowsThrough(daily, '2027-02-05')).toThrow(CycleRangeLimitError);
  });
  it.each(['2026-02-29', '2026-2-01', 'not-a-date'])(
    'refuses invalid calendar coordinates %s',
    (date) => {
      expect(() => cycleWindowContaining(schedule, date)).toThrow(RangeError);
      expect(() => cycleWindowContaining({ ...schedule, anchorDate: date }, '2026-01-01')).toThrow(
        RangeError,
      );
    },
  );
  it('keeps the legacy rolling preview centered on the same anchored native window', () => {
    const now = new Date('2024-01-17T23:30:00Z');
    const windows = rollingWindow(now, 2);
    expect(windows).toHaveLength(9);
    expect(windows[4]).toEqual(
      cycleWindowContaining({ anchorDate: '2024-01-01', cadenceDays: 14 }, '2024-01-17'),
    );
    expect(windows[3]?.endsAt.getTime()).toBe((windows[4]?.startsAt.getTime() ?? 0) - 1);
    expect(windows[5]?.startsAt.getTime()).toBe((windows[4]?.endsAt.getTime() ?? 0) + 1);
  });
  it('treats both timestamp endpoints as inclusive and excludes adjacent instants', () => {
    const slot = cycleWindowContaining(schedule, '2026-01-01');
    expect(isWithinWindow(slot.startsAt, slot.startsAt, slot.endsAt)).toBe(true);
    expect(isWithinWindow(slot.endsAt, slot.startsAt, slot.endsAt)).toBe(true);
    expect(isWithinWindow(new Date(slot.startsAt.getTime() - 1), slot.startsAt, slot.endsAt)).toBe(
      false,
    );
    expect(isWithinWindow(new Date(slot.endsAt.getTime() + 1), slot.startsAt, slot.endsAt)).toBe(
      false,
    );
  });
});
