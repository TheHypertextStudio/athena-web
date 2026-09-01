import { describe, expect, it } from 'vitest';

import {
  addDays,
  instantAt,
  localClock,
  localDateString,
  localMinuteOfDay,
  minutesBetween,
  weekdayOf,
  weekDates,
  weekStartOf,
  zonedParts,
} from '../src/zoned-time';

describe('zoned planning time', () => {
  it('projects exact instants into local parts, dates, minutes, and clocks', () => {
    const instant = new Date('2026-09-01T02:45:00.000Z');
    expect(zonedParts(instant, 'America/Los_Angeles')).toEqual({
      year: 2026,
      month: 8,
      day: 31,
      hour: 19,
      minute: 45,
    });
    expect(localDateString(instant, 'America/Los_Angeles')).toBe('2026-08-31');
    expect(localMinuteOfDay(instant, 'America/Los_Angeles')).toBe(19 * 60 + 45);
    expect(localClock(instant, 'America/Los_Angeles')).toBe('19:45');
  });

  it('resolves ordinary local clock positions and extended next-day minutes', () => {
    expect(instantAt('2026-08-31', 9 * 60, 'America/Los_Angeles').toISOString()).toBe(
      '2026-08-31T16:00:00.000Z',
    );
    expect(instantAt('2026-08-31', 25 * 60, 'UTC').toISOString()).toBe('2026-09-01T01:00:00.000Z');
  });

  it('resolves a skipped spring-forward wall time deterministically', () => {
    const instant = instantAt('2026-03-08', 2 * 60 + 30, 'America/Los_Angeles');
    expect(instant.toISOString()).toBe('2026-03-08T09:30:00.000Z');
    expect(localClock(instant, 'America/Los_Angeles')).toBe('01:30');
  });

  it('rejects unsupported timezones through Intl', () => {
    expect(() => zonedParts(new Date(), 'Mars/Olympus')).toThrow(RangeError);
  });

  it('shifts local dates and identifies weekdays', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(weekdayOf('2026-08-31')).toBe(1);
    expect(weekdayOf('2026-09-06')).toBe(0);
  });

  it('builds Monday-first week boundaries from weekdays and Sundays', () => {
    expect(weekStartOf('2026-09-02')).toBe('2026-08-31');
    expect(weekStartOf('2026-09-06')).toBe('2026-08-31');
    expect(weekDates('2026-08-31')).toEqual([
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
      '2026-09-04',
      '2026-09-05',
      '2026-09-06',
    ]);
  });

  it('measures whole signed minutes toward zero', () => {
    expect(minutesBetween(new Date(0), new Date(90_999))).toBe(1);
    expect(minutesBetween(new Date(90_999), new Date(0))).toBe(-1);
  });
});
