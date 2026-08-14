import { TASK_DATE_MAX, TASK_DATE_MIN } from '@docket/types';
import { describe, expect, it } from 'vitest';

import {
  CALENDAR_MAX_DAY,
  CALENDAR_MIN_DAY,
  addDays,
  addMonths,
  clampIso,
  compareIso,
  daysInMonth,
  endOfMonth,
  formatCalendarDay,
  isIsoDate,
  monthGrid,
  parseIsoDate,
  startOfMonth,
  toCalendarDay,
  toIso,
  todayIso,
  weekdayOf,
} from '@docket/ui/components';

import {
  DATE_PICKER_MAX,
  DATE_PICKER_MIN,
  formatDay,
  formatDayRange,
} from '@/components/date-picker';
import { assertDefined } from '@docket/test-utils';

/**
 * The calendar arithmetic behind every date picker.
 *
 * @remarks
 * These are the two defects the module exists to prevent — a day that shifts across time zones,
 * and the literal string `"Invalid Date"` reaching the screen — so they are asserted directly
 * rather than through a rendered picker.
 */
describe('calendar day arithmetic', () => {
  it('parses only strict calendar days', () => {
    expect(parseIsoDate('2026-08-02')).toEqual({ year: 2026, month: 8, day: 2 });
    // 2026 is not a leap year; 2024 is. The round-trip check catches the difference.
    expect(parseIsoDate('2026-02-29')).toBeNull();
    expect(parseIsoDate('2024-02-29')).toEqual({ year: 2024, month: 2, day: 29 });
  });

  it('rejects impossible and mis-shaped days without throwing', () => {
    for (const bad of [
      '',
      'not-a-date',
      '2026-13-45',
      '2026-02-30',
      '2026-00-10',
      '2026-8-2',
      '2026/08/02',
      null,
      undefined,
    ]) {
      expect(parseIsoDate(bad)).toBeNull();
      expect(isIsoDate(bad)).toBe(false);
    }
  });

  it('reads the calendar day off a full ISO instant without shifting it', () => {
    expect(toCalendarDay('2026-08-02T00:00:00.000Z')).toBe('2026-08-02');
    expect(toCalendarDay('2026-08-02')).toBe('2026-08-02');
    expect(toCalendarDay('2026-08-02T23:59:59-11:00')).toBe('2026-08-02');
    expect(toCalendarDay('garbage')).toBeNull();
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('adds months without rolling a long day into the following month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
    expect(addMonths('2026-01-15', 12)).toBe('2027-01-15');
  });

  it('answers month geometry', () => {
    expect(startOfMonth('2026-08-17')).toBe('2026-08-01');
    expect(endOfMonth('2026-02-17')).toBe('2026-02-28');
    expect(endOfMonth('2024-02-17')).toBe('2024-02-29');
    expect(daysInMonth(2026, 8)).toBe(31);
    // 2026-08-02 is a Sunday.
    expect(weekdayOf('2026-08-02')).toBe(0);
  });

  it('compares and clamps', () => {
    expect(compareIso('2026-01-01', '2026-01-02')).toBe(-1);
    expect(compareIso('2026-01-02', '2026-01-02')).toBe(0);
    expect(compareIso('2026-01-03', '2026-01-02')).toBe(1);
    expect(clampIso('1799-01-01', CALENDAR_MIN_DAY, CALENDAR_MAX_DAY)).toBe(CALENDAR_MIN_DAY);
    expect(clampIso('3999-01-01', CALENDAR_MIN_DAY, CALENDAR_MAX_DAY)).toBe(CALENDAR_MAX_DAY);
    expect(clampIso('2026-08-02', CALENDAR_MIN_DAY, CALENDAR_MAX_DAY)).toBe('2026-08-02');
  });

  it('serializes overflow days by normalizing them', () => {
    expect(toIso({ year: 2026, month: 1, day: 32 })).toBe('2026-02-01');
    expect(toIso({ year: 2026, month: 13, day: 1 })).toBe('2027-01-01');
  });

  it('reads today from the LOCAL clock, so the day never shifts west of Greenwich', () => {
    // 23:30 local on the 2nd is 06:30 UTC on the 3rd at UTC+7 — a naive
    // `toISOString().slice(0,10)` would report the wrong day for the person looking at it.
    const lateEvening = new Date(2026, 7, 2, 23, 30, 0);
    expect(todayIso(lateEvening)).toBe('2026-08-02');
    const earlyMorning = new Date(2026, 7, 2, 0, 15, 0);
    expect(todayIso(earlyMorning)).toBe('2026-08-02');
  });

  it('builds a six-week grid whose height never changes', () => {
    for (const anchor of ['2026-02-01', '2026-08-15', '2024-02-29', '2026-12-31']) {
      const weeks = monthGrid(anchor, 0);
      expect(weeks).toHaveLength(6);
      for (const week of weeks) expect(week).toHaveLength(7);
    }
  });

  it('marks only the anchor month inside the grid, and runs consecutively', () => {
    const weeks = monthGrid('2026-08-15', 0);
    const flat = weeks.flat();
    for (let index = 1; index < flat.length; index += 1) {
      expect(assertDefined(flat[index]).iso).toBe(addDays(assertDefined(flat[index - 1]).iso, 1));
    }
    const inMonth = flat.filter((cell) => cell.inMonth).map((cell) => cell.iso);
    expect(inMonth[0]).toBe('2026-08-01');
    expect(inMonth.at(-1)).toBe('2026-08-31');
    expect(inMonth).toHaveLength(31);
  });
});

describe('day formatting never emits a broken string', () => {
  it('returns null instead of "Invalid Date" for anything unreadable', () => {
    for (const bad of ['', 'not-a-date', '2026-13-45', 'undefined', null, undefined]) {
      expect(formatCalendarDay(bad)).toBeNull();
      expect(formatDay(bad)).toBeNull();
    }
  });

  it('reproduces the shipped defect and shows the helper is immune to it', () => {
    // The exact expression that shipped on the global task list, with the value the API returns.
    const fromApi = '2026-08-02T00:00:00.000Z';
    const shipped = new Date(`${fromApi}T00:00:00`).toLocaleDateString('en-US');
    expect(shipped).toBe('Invalid Date');
    expect(formatDay(fromApi, { month: 'short', day: 'numeric', year: 'numeric' })).toBe(
      'Aug 2, 2026',
    );
  });

  it('formats the stored day, not a zone-shifted one', () => {
    expect(formatCalendarDay('2026-01-01', { month: 'short', day: 'numeric' }, 'en-US')).toBe(
      'Jan 1',
    );
    expect(
      formatCalendarDay('2026-01-01T00:00:00.000Z', { month: 'short', day: 'numeric' }, 'en-US'),
    ).toBe('Jan 1');
  });

  it('formats a window, and keeps a half-open one visible', () => {
    const short: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    expect(formatDayRange('2026-08-02', '2026-08-09', short)).toBe('Aug 2 → Aug 9');
    expect(formatDayRange('2026-08-02', null, short)).toBe('Aug 2 → —');
    expect(formatDayRange(null, '2026-08-09', short)).toBe('— → Aug 9');
    expect(formatDayRange(null, null, short)).toBeNull();
    expect(formatDayRange('nonsense', 'rubbish', short)).toBeNull();
  });
});

describe('picker bounds agree with the DTO bounds', () => {
  it('offers exactly the window the API accepts', () => {
    expect(DATE_PICKER_MIN).toBe(TASK_DATE_MIN);
    expect(DATE_PICKER_MAX).toBe(TASK_DATE_MAX);
    expect(CALENDAR_MIN_DAY).toBe(TASK_DATE_MIN);
    expect(CALENDAR_MAX_DAY).toBe(TASK_DATE_MAX);
  });
});
