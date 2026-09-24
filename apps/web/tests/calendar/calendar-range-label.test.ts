import { describe, expect, it } from 'vitest';

import { calendarRangeLabel } from '../../src/app/(app)/calendar/calendar-range-label';

describe('calendarRangeLabel', () => {
  it('shows every visible date in a same-month range', () => {
    expect(calendarRangeLabel('2026-09-22', '2026-09-28')).toBe('September 22–28, 2026');
    expect(calendarRangeLabel('2026-09-22', '2026-09-28', 'short')).toBe('Sep 22–28');
    expect(calendarRangeLabel('2026-09-22', '2026-09-28', 'tiny')).toBe('22–28');
  });

  it('shows both months when the visible range crosses a month', () => {
    expect(calendarRangeLabel('2026-08-30', '2026-09-02')).toBe('August 30 – September 2, 2026');
    expect(calendarRangeLabel('2026-08-30', '2026-09-02', 'short')).toBe('Aug 30 – Sep 2');
    expect(calendarRangeLabel('2026-08-30', '2026-09-02', 'tiny')).toBe('8/30–9/2');
  });

  it('carries both full years over a year boundary', () => {
    expect(calendarRangeLabel('2026-12-29', '2027-01-04')).toBe(
      'December 29, 2026 – January 4, 2027',
    );
    expect(calendarRangeLabel('2026-12-29', '2027-01-04', 'short')).toBe('Dec 29 – Jan 4');
    expect(calendarRangeLabel('2026-12-29', '2027-01-04', 'tiny')).toBe('12/29–1/4');
  });

  it('shows the year for one visible date and a leap day', () => {
    expect(calendarRangeLabel('2028-02-29', '2028-02-29')).toBe('February 29, 2028');
  });

  it('normalizes reversed ranges and accepts one valid bound', () => {
    expect(calendarRangeLabel('2026-09-28', '2026-09-22')).toBe('September 22–28, 2026');
    expect(calendarRangeLabel('2026-09-22', 'not-a-date')).toBe('September 22, 2026');
  });

  it('does not expose malformed dates', () => {
    expect(calendarRangeLabel('not-a-date', 'also-not')).toBe('');
    expect(calendarRangeLabel('2026-13-01', '2026-13-02')).toBe('');
    expect(calendarRangeLabel('2026-02-30', '2026-02-31')).toBe('');
  });
});
