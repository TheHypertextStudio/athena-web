import { describe, expect, it } from 'vitest';

import {
  addCalendarDays,
  addCalendarMonths,
  calendarDaysBetween,
  compareCalendarDates,
  daysInMonth,
  formatCalendarDate,
  isLeapYear,
  mondayWeekdayIndex,
  parseCalendarDate,
} from '../src/calendar-date';

describe('calendar-date arithmetic', () => {
  it('applies Gregorian leap-year rules', () => {
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(2024)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2025)).toBe(false);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2025, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 1)).toBe(31);
  });

  it.each([
    [-1, 1],
    [10_000, 1],
    [2026, 0],
    [2026, 13],
  ])('rejects invalid month coordinates %i-%i', (year, month) => {
    expect(() => daysInMonth(year, month)).toThrow(RangeError);
  });

  it('parses and formats strict calendar dates including years below 100', () => {
    expect(parseCalendarDate('0099-01-02')).toEqual({ year: 99, month: 1, day: 2 });
    expect(formatCalendarDate({ year: 99, month: 1, day: 2 })).toBe('0099-01-02');
    expect(() => parseCalendarDate('2026-2-01')).toThrow('Invalid calendar date');
    expect(() => parseCalendarDate('2026-02-30')).toThrow('Invalid calendar date');
    expect(() => formatCalendarDate({ year: 2026, month: 2, day: 30 })).toThrow(RangeError);
  });

  it('compares, shifts, and measures dates without a local timezone', () => {
    expect(compareCalendarDates('2026-08-31', '2026-08-31')).toBe(0);
    expect(compareCalendarDates('2026-08-30', '2026-08-31')).toBe(-1);
    expect(compareCalendarDates('2026-09-01', '2026-08-31')).toBe(1);
    expect(addCalendarDays('0099-12-31', 1)).toBe('0100-01-01');
    expect(addCalendarDays('2024-02-28', 2)).toBe('2024-03-01');
    expect(calendarDaysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(() => addCalendarDays('2026-08-31', Number.MAX_VALUE)).toThrow(RangeError);
  });

  it('uses a Monday-zero weekday index', () => {
    expect(mondayWeekdayIndex('2026-08-31')).toBe(0);
    expect(mondayWeekdayIndex('2026-09-06')).toBe(6);
  });

  it('shifts to the first day of a destination month', () => {
    expect(addCalendarMonths('2026-01-31', 1)).toEqual({ year: 2026, month: 2, day: 1 });
    expect(addCalendarMonths('2026-01-31', -2)).toEqual({ year: 2025, month: 11, day: 1 });
    expect(() => addCalendarMonths('2026-01-01', 1.5)).toThrow(RangeError);
    expect(() => addCalendarMonths('0000-01-01', -1)).toThrow(RangeError);
    expect(() => addCalendarMonths('9999-12-01', 1)).toThrow(RangeError);
  });
});
