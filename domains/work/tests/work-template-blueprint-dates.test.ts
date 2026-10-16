import { present } from './blueprint-fixtures';
import { describe, expect, it } from 'vitest';
import {
  deriveBlueprintDate,
  offsetBlueprintDate,
  completionCivilDate,
} from '../src/blueprints/dates';
import {
  addCalendarDays,
  addCalendarMonths,
  calendarDaysBetween,
  compareCalendarDates,
  daysInMonth,
  formatCalendarDate,
  isLeapYear,
  parseCalendarDate,
} from '../src/calendar-date';
import { BlueprintDateRule } from '../src/contracts/work-template-blueprint';
const weekdays = [1, 2, 3, 4, 5];
describe('civil relative blueprint timing', () => {
  it('applies signed calendar offsets, working offsets and strict weekday snaps', () => {
    expect(offsetBlueprintDate('2026-10-08', { days: -21, unit: 'calendar' }, weekdays)).toBe(
      '2026-09-17',
    );
    expect(offsetBlueprintDate('2026-10-09', { days: 1, unit: 'working' }, weekdays)).toBe(
      '2026-10-12',
    );
    expect(offsetBlueprintDate('2026-10-12', { days: -1, unit: 'working' }, weekdays)).toBe(
      '2026-10-09',
    );
    expect(offsetBlueprintDate('2026-10-10', { days: 0, unit: 'working' }, weekdays)).toBe(
      '2026-10-10',
    );
    expect(
      offsetBlueprintDate('2026-10-12', { days: 0, unit: 'calendar' }, weekdays, {
        direction: 'next',
        weekday: 1,
        inclusive: false,
      }),
    ).toBe('2026-10-19');
    expect(
      offsetBlueprintDate('2026-10-12', { days: 0, unit: 'calendar' }, weekdays, {
        direction: 'previous',
        weekday: 1,
        inclusive: true,
      }),
    ).toBe('2026-10-12');
  });
  it('is stable across leap days, DST transitions and nonstandard working weeks', () => {
    expect(offsetBlueprintDate('2028-03-01', { days: -1, unit: 'calendar' }, weekdays)).toBe(
      '2028-02-29',
    );
    expect(offsetBlueprintDate('2026-03-07', { days: 2, unit: 'calendar' }, weekdays)).toBe(
      '2026-03-09',
    );
    expect(offsetBlueprintDate('2026-10-09', { days: 1, unit: 'working' }, [7])).toBe('2026-10-11');
    expect(completionCivilDate('2026-03-08T07:30:00Z', 'America/Los_Angeles')).toBe('2026-03-07');
    expect(() =>
      offsetBlueprintDate('1970-01-01', { days: -1, unit: 'calendar' }, weekdays),
    ).toThrow();
  });
  it('waits for every actual sibling completion and ignores canceled siblings', () => {
    const rule = BlueprintDateRule.parse({
      kind: 'after_completion',
      stepKeys: ['one', 'two', 'three'],
      offset: { days: 1, unit: 'working' },
    });
    const completions = [
      '2026-10-08T10:00:00Z',
      '2026-10-09T10:00:00Z',
      '2026-10-07T10:00:00Z',
    ].map((completedAt, i) => ({
      path: [present(['one', 'two', 'three'][i])],
      state: 'completed' as const,
      completedAt,
    }));
    const input = {
      rule,
      parentAnchor: null,
      milestoneAnchors: {},
      scopePath: [],
      completions,
      timezone: 'UTC',
      workingWeekdays: weekdays,
    };
    expect(deriveBlueprintDate(input)).toEqual({ value: '2026-10-12', unresolvedReason: null });
    expect(
      deriveBlueprintDate({
        ...input,
        completions: completions.map((fact, i) =>
          i === 0 ? { ...fact, state: 'canceled' as const } : fact,
        ),
      }),
    ).toEqual({ value: null, unresolvedReason: 'waiting_completion' });
  });
});

it('rejects malformed direct timing operands instead of rounding working offsets', () => {
  expect(() =>
    offsetBlueprintDate('2026-10-08', { days: 0.5, unit: 'working' }, [1, 2, 3, 4, 5]),
  ).toThrow();
});

describe('strict reusable civil-date coordinates', () => {
  it('uses Gregorian century rules and preserves years below 0100', () => {
    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(formatCalendarDate({ year: 9, month: 1, day: 2 })).toBe('0009-01-02');
    expect(addCalendarDays('0099-12-31', 1)).toBe('0100-01-01');
  });
  it.each([-1, 10000, 2026.5])('refuses unsupported year %s', (year) => {
    expect(() => daysInMonth(year, 1)).toThrow(RangeError);
  });
  it.each([0, 13, 1.5])('refuses unsupported month %s', (month) => {
    expect(() => daysInMonth(2026, month)).toThrow(RangeError);
  });
  it.each(['2026-1-01', '2026-00-01', '2026-13-01', '2026-01-00', '2026-04-31'])(
    'refuses malformed or impossible civil date %s',
    (value) => {
      expect(() => parseCalendarDate(value)).toThrow(RangeError);
    },
  );
  it('rejects invalid formatted fields rather than normalizing into another month', () => {
    expect(() => formatCalendarDate({ year: 2026, month: 4, day: 31 })).toThrow(RangeError);
    expect(() => formatCalendarDate({ year: 2026, month: 4, day: 0 })).toThrow(RangeError);
  });
  it('compares and measures signed civil intervals independently of DST', () => {
    expect(compareCalendarDates('2026-03-08', '2026-03-08')).toBe(0);
    expect(compareCalendarDates('2026-03-08', '2026-03-09')).toBe(-1);
    expect(compareCalendarDates('2026-03-09', '2026-03-08')).toBe(1);
    expect(calendarDaysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(calendarDaysBetween('2026-03-09', '2026-03-07')).toBe(-2);
    expect(addCalendarDays('2026-03-08', 0)).toBe('2026-03-08');
  });
  it('moves months from their first day without carrying an invalid source day', () => {
    expect(addCalendarMonths('2026-01-31', 1)).toEqual({ year: 2026, month: 2, day: 1 });
    expect(addCalendarMonths('2026-01-31', -1)).toEqual({ year: 2025, month: 12, day: 1 });
    expect(() => addCalendarMonths('0000-01-01', -1)).toThrow(RangeError);
    expect(() => addCalendarMonths('9999-12-01', 1)).toThrow(RangeError);
  });
  it.each([0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])(
    'refuses unsafe day and month offsets %s',
    (offset) => {
      expect(() => addCalendarDays('2026-01-01', offset)).toThrow(RangeError);
      expect(() => addCalendarMonths('2026-01-01', offset)).toThrow(RangeError);
    },
  );
  it('rejects malformed completion instants and distinguishes absent timing anchors', () => {
    expect(() => completionCivilDate('not-an-instant', 'UTC')).toThrow(/completion instant/i);
    const source = {
      parentAnchor: null,
      milestoneAnchors: {},
      scopePath: [],
      completions: [],
      timezone: 'UTC',
      workingWeekdays: weekdays,
    };
    expect(deriveBlueprintDate({ ...source, rule: { kind: 'none' } })).toEqual({
      value: null,
      unresolvedReason: null,
    });
    expect(
      deriveBlueprintDate({
        ...source,
        rule: BlueprintDateRule.parse({
          kind: 'anchor',
          anchor: { kind: 'milestone', stepKey: 'release' },
          offset: { days: 0, unit: 'calendar' },
        }),
      }),
    ).toEqual({ value: null, unresolvedReason: 'missing_anchor' });
    expect(
      deriveBlueprintDate({
        ...source,
        rule: BlueprintDateRule.parse({
          kind: 'after_completion',
          stepKeys: ['release'],
          offset: { days: 0, unit: 'calendar' },
        }),
      }),
    ).toEqual({ value: null, unresolvedReason: 'waiting_completion' });
  });
  it('snaps strictly backward after signed working-week offsets', () => {
    expect(
      offsetBlueprintDate('2026-10-12', { days: 0, unit: 'calendar' }, weekdays, {
        direction: 'previous',
        weekday: 1,
        inclusive: false,
      }),
    ).toBe('2026-10-05');
    expect(offsetBlueprintDate('2026-10-12', { days: -6, unit: 'working' }, weekdays)).toBe(
      '2026-10-02',
    );
  });
});
