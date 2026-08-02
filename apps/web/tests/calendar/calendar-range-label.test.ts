import { describe, expect, it } from 'vitest';

import { calendarRangeLabel } from '../../src/app/(app)/calendar/calendar-range-label';

/** Any weekday name, in the abbreviated or full form a date formatter could produce. */
const WEEKDAY = /mon|tue|wed|thu|fri|sat|sun/i;
/** A bare ISO calendar date — the exact shape this label must never emit. */
const ISO_DATE = /\d{4}-\d{2}-\d{2}/;
/** A standalone day-of-month number (years are four digits, so they do not match). */
const DAY_OF_MONTH = /(?<!\d)\d{1,2}(?!\d)/;

describe('calendarRangeLabel', () => {
  it('names a single visible month with its year', () => {
    expect(calendarRangeLabel('2026-08-02', '2026-08-03')).toBe('August 2026');
  });

  it('collapses a whole month in view to the same single label', () => {
    expect(calendarRangeLabel('2026-08-01', '2026-08-31')).toBe('August 2026');
  });

  it('abbreviates two months that share a year', () => {
    expect(calendarRangeLabel('2026-08-30', '2026-09-02')).toBe('Aug – Sep 2026');
  });

  it('carries both years when the range crosses a year boundary', () => {
    expect(calendarRangeLabel('2026-12-29', '2027-01-04')).toBe('Dec 2026 – Jan 2027');
  });

  it('labels a leap day by its month, not its date', () => {
    expect(calendarRangeLabel('2028-02-29', '2028-02-29')).toBe('February 2028');
  });

  it('normalizes a reversed range instead of reading backwards', () => {
    expect(calendarRangeLabel('2027-01-04', '2026-12-29')).toBe('Dec 2026 – Jan 2027');
  });

  it('abbreviates a standalone month on request, keeping the year intact', () => {
    expect(calendarRangeLabel('2026-08-02', '2026-08-03', 'short')).toBe('Aug 2026');
    expect(calendarRangeLabel('2028-02-29', '2028-02-29', 'short')).toBe('Feb 2028');
  });

  it('leaves the already-abbreviated multi-month shapes unchanged', () => {
    expect(calendarRangeLabel('2026-08-30', '2026-09-02', 'short')).toBe('Aug – Sep 2026');
    expect(calendarRangeLabel('2026-12-29', '2027-01-04', 'short')).toBe('Dec 2026 – Jan 2027');
  });

  it('never emits an ISO date or a day-of-month in the short style either', () => {
    for (const [start, end] of [
      ['2026-08-02', '2026-08-03'],
      ['2026-08-30', '2026-09-02'],
      ['2026-12-29', '2027-01-04'],
    ] as const) {
      const label = calendarRangeLabel(start, end, 'short');
      expect(label).not.toMatch(ISO_DATE);
      expect(label).not.toMatch(WEEKDAY);
      expect(label.replace(/\d{4}/g, '')).not.toMatch(DAY_OF_MONTH);
    }
  });

  it.each([
    ['2026-08-02', '2026-08-03'],
    ['2026-08-30', '2026-09-02'],
    ['2026-12-29', '2027-01-04'],
  ])('never repeats the grid’s date atoms for %s – %s', (start, end) => {
    const label = calendarRangeLabel(start, end);
    expect(label).not.toMatch(WEEKDAY);
    expect(label).not.toMatch(ISO_DATE);
    // Strip the four-digit years, then assert nothing that looks like a day number survives.
    expect(label.replaceAll(/\d{4}/g, '')).not.toMatch(DAY_OF_MONTH);
  });

  it('falls back to the parseable bound when only one is a calendar date', () => {
    expect(calendarRangeLabel('2026-08-02', 'not-a-date')).toBe('August 2026');
    expect(calendarRangeLabel('', '2027-01-04')).toBe('January 2027');
  });

  it('yields nothing rather than leaking a raw value into the heading', () => {
    expect(calendarRangeLabel('not-a-date', 'also-not')).toBe('');
    expect(calendarRangeLabel('2026-13-01', '2026-13-02')).toBe('');
  });
});
