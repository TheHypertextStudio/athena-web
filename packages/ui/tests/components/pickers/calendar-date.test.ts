import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonths,
  clampIso,
  compareIso,
  daysInMonth,
  endOfMonth,
  formatCalendarDay,
  isIsoDate,
  localeWeekStart,
  monthGrid,
  monthLabel,
  parseIsoDate,
  startOfMonth,
  toCalendarDay,
  toIso,
  todayIso,
  weekdayLabels,
  weekdayOf,
} from '../../../src/components/pickers/calendar-date';

describe('parseIsoDate', () => {
  it('parses a strict YYYY-MM-DD day', () => {
    expect(parseIsoDate('2026-08-02')).toEqual({ year: 2026, month: 8, day: 2 });
  });

  it('rejects a string that does not match the strict shape', () => {
    // Neither a bare instant nor free text is a calendar day this product accepts.
    expect(parseIsoDate('not-a-date')).toBeNull();
    expect(parseIsoDate('2026-08-02T00:00:00.000Z')).toBeNull();
  });

  it('rejects an out-of-range month or day', () => {
    expect(parseIsoDate('2026-13-01')).toBeNull();
    expect(parseIsoDate('2026-01-32')).toBeNull();
    expect(parseIsoDate('2026-00-10')).toBeNull();
    expect(parseIsoDate('2026-05-00')).toBeNull();
  });

  it('rejects an impossible day via the toIso round-trip (Feb 30 rolls to March)', () => {
    expect(parseIsoDate('2026-02-30')).toBeNull();
  });

  it('rejects non-string input', () => {
    expect(parseIsoDate(null)).toBeNull();
    expect(parseIsoDate(undefined)).toBeNull();
  });
});

describe('toIso', () => {
  it('serializes a calendar day to YYYY-MM-DD', () => {
    expect(toIso({ year: 2026, month: 8, day: 2 })).toBe('2026-08-02');
  });

  it('normalizes two-digit years instead of letting Date.UTC map them into 1900-1999', () => {
    expect(toIso({ year: 50, month: 1, day: 1 })).toBe('0050-01-01');
  });
});

describe('isIsoDate', () => {
  it('is true for a valid day and false otherwise', () => {
    expect(isIsoDate('2026-08-02')).toBe(true);
    expect(isIsoDate('garbage')).toBe(false);
  });
});

describe('toCalendarDay', () => {
  it('takes the leading day off an ISO instant', () => {
    expect(toCalendarDay('2026-08-02T00:00:00.000Z')).toBe('2026-08-02');
  });

  it('returns null for unreadable input', () => {
    expect(toCalendarDay('not-a-date')).toBeNull();
    expect(toCalendarDay(null)).toBeNull();
    expect(toCalendarDay(undefined)).toBeNull();
  });
});

describe('compareIso', () => {
  it('is chronological', () => {
    expect(compareIso('2026-01-01', '2026-01-01')).toBe(0);
    expect(compareIso('2026-01-01', '2026-01-02')).toBe(-1);
    expect(compareIso('2026-01-02', '2026-01-01')).toBe(1);
  });
});

describe('clampIso', () => {
  it('clamps a day below the minimum up to it', () => {
    expect(clampIso('1960-01-01', '1970-01-01', '2200-12-31')).toBe('1970-01-01');
  });

  it('clamps a day above the maximum down to it', () => {
    expect(clampIso('2300-01-01', '1970-01-01', '2200-12-31')).toBe('2200-12-31');
  });

  it('leaves an in-range day untouched', () => {
    expect(clampIso('2026-08-02', '1970-01-01', '2200-12-31')).toBe('2026-08-02');
  });
});

describe('addDays', () => {
  it('shifts forward and backward, rolling across a month boundary', () => {
    expect(addDays('2026-08-02', 1)).toBe('2026-08-03');
    expect(addDays('2026-08-01', -1)).toBe('2026-07-31');
  });

  it('passes an unparseable value through unchanged', () => {
    expect(addDays('not-a-date', 5)).toBe('not-a-date');
  });
});

describe('addMonths', () => {
  it('shifts forward across a year boundary', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
  });

  it('shifts backward across a year boundary', () => {
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });

  it('holds the day-of-month where the target month is long enough, else clamps it', () => {
    // Jan 31 + 1 month is Feb 28 in a non-leap year, not an overflow into March.
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('passes an unparseable value through unchanged', () => {
    expect(addMonths('not-a-date', 1)).toBe('not-a-date');
  });
});

describe('daysInMonth', () => {
  it('knows February in a leap year vs. a common year', () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
  });
});

describe('weekdayOf', () => {
  it('resolves the correct day of week', () => {
    // 2026-08-02 is a Sunday.
    expect(weekdayOf('2026-08-02')).toBe(0);
  });

  it('returns 0 for an unparseable value', () => {
    expect(weekdayOf('not-a-date')).toBe(0);
  });
});

describe('startOfMonth / endOfMonth', () => {
  it('resolve the first and last day of the month', () => {
    expect(startOfMonth('2026-08-17')).toBe('2026-08-01');
    expect(endOfMonth('2026-08-17')).toBe('2026-08-31');
  });

  it('pass an unparseable value through unchanged', () => {
    expect(startOfMonth('not-a-date')).toBe('not-a-date');
    expect(endOfMonth('not-a-date')).toBe('not-a-date');
  });
});

describe('todayIso', () => {
  it('reads the local calendar day off a supplied Date', () => {
    expect(todayIso(new Date(2026, 7, 2))).toBe('2026-08-02');
  });
});

describe('monthGrid', () => {
  it('builds six weeks of seven days including the leading/trailing adjacent-month days', () => {
    const weeks = monthGrid('2026-08-15', 0);
    expect(weeks).toHaveLength(6);
    for (const week of weeks) expect(week).toHaveLength(7);
    // 2026-08-01 is a Saturday, so with a Sunday week start the grid leads with a July day.
    expect(weeks[0]?.[0]?.inMonth).toBe(false);
  });
});

describe('formatCalendarDay', () => {
  it('formats a valid day', () => {
    expect(formatCalendarDay('2026-08-02')).toBe('Aug 2, 2026');
  });

  it('returns null instead of "Invalid Date" for unreadable input', () => {
    expect(formatCalendarDay('not-a-date')).toBeNull();
    expect(formatCalendarDay(null)).toBeNull();
  });
});

describe('weekdayLabels', () => {
  it('returns seven labels starting at the given week start', () => {
    const sunday = weekdayLabels(0);
    expect(sunday).toHaveLength(7);
    expect(sunday[0]).toBe('Sun');
    const monday = weekdayLabels(1);
    expect(monday[0]).toBe('Mon');
  });
});

describe('monthLabel', () => {
  it('formats the month and year', () => {
    expect(monthLabel('2026-08-02')).toBe('August 2026');
  });

  it('falls back to the raw first-7-characters slice when the anchor is unreadable', () => {
    expect(monthLabel('not-a-date')).toBe('not-a-date'.slice(0, 7));
  });
});

describe('localeWeekStart', () => {
  it('resolves the runtime locale with no argument', () => {
    expect(localeWeekStart()).toBeGreaterThanOrEqual(0);
    expect(localeWeekStart()).toBeLessThanOrEqual(6);
  });

  it('resolves an explicit locale string', () => {
    // en-US weeks start on Sunday.
    expect(localeWeekStart('en-US')).toBe(0);
  });

  it('resolves the first entry of an array of locales', () => {
    expect(localeWeekStart(['en-US', 'fr-FR'])).toBe(0);
  });

  it('falls back to 0 rather than throwing for a malformed locale tag', () => {
    expect(localeWeekStart('this is not valid!!')).toBe(0);
  });
});
