import { describe, expect, it } from 'vitest';

import {
  localDateOf,
  localDayFor,
  localDayStartOf,
  nextLocalDayStart,
  zonedParts,
} from '../../../src/lib/activity/local-day';
import { assertDefined } from '@docket/test-utils';

/** Whether `instant` really is midnight on `localDate` in `tz`, read back through the zone. */
function isLocalMidnightOn(instant: Date, localDate: string, tz: string): boolean {
  const parts = zonedParts(instant, tz);
  return localDateOf(parts) === localDate && parts.h === 0 && parts.mi === 0;
}

describe('zonedParts', () => {
  it('reads the wall clock in the zone, not on the host', () => {
    // 23:30 UTC is already the next day in Auckland and still the same evening in New York, which is
    // why a day boundary cannot be computed from a UTC timestamp alone.
    const instant = new Date('2026-08-12T23:30:00.000Z');
    expect(zonedParts(instant, 'Pacific/Auckland')).toMatchObject({ y: 2026, mo: 8, d: 13, h: 11 });
    expect(zonedParts(instant, 'America/New_York')).toMatchObject({ y: 2026, mo: 8, d: 12, h: 19 });
  });

  it('uses a 24-hour clock, so midnight reads as hour 0', () => {
    // `hourCycle: 'h23'` is load-bearing: the default renders midnight as 24, and `h === 0` is what
    // every day-boundary comparison in this module tests.
    expect(zonedParts(new Date('2026-08-12T00:00:00.000Z'), 'UTC').h).toBe(0);
  });
});

describe('localDayStartOf', () => {
  it('lands on real local midnight across DST transitions in both directions', () => {
    // The single-pass version sampled the zone offset at the wall clock read as UTC, which can sit on
    // the far side of a transition from the midnight being solved for. Auckland and Sydney came out an
    // hour late and Santiago an hour early — both directions, so no fixed correction would have done.
    const cases: readonly { tz: string; date: string }[] = [
      { tz: 'Pacific/Auckland', date: '2026-04-05' },
      { tz: 'Australia/Sydney', date: '2026-04-05' },
      { tz: 'America/Santiago', date: '2026-04-05' },
      { tz: 'America/New_York', date: '2026-03-08' },
      { tz: 'America/New_York', date: '2026-11-01' },
      { tz: 'Europe/London', date: '2026-03-29' },
      { tz: 'Europe/London', date: '2026-10-25' },
      // A zone with no DST, and one on a half-hour offset.
      { tz: 'Asia/Kolkata', date: '2026-04-05' },
      { tz: 'UTC', date: '2026-04-05' },
    ];
    for (const { tz, date } of cases) {
      const start = localDayStartOf(date, tz);
      expect(start, `${tz} ${date}`).not.toBeNull();
      expect(isLocalMidnightOn(assertDefined(start), date, tz), `${tz} ${date}`).toBe(true);
    }
  });

  it('puts Auckland’s 5 April midnight an hour before the naive answer', () => {
    // Pinned as an instant rather than only as "a valid midnight": the loop above would also accept a
    // regression that happened to land on midnight of the wrong side of the change.
    expect(localDayStartOf('2026-04-05', 'Pacific/Auckland')?.toISOString()).toBe(
      '2026-04-04T11:00:00.000Z',
    );
  });

  it('refuses anything that is not an ISO calendar date', () => {
    // The null is what makes a malformed `?date=` a validation error rather than a silent fallback to
    // some other day.
    for (const bad of ['', '2026-4-5', '2026-04-05T00:00:00Z', 'yesterday', '20260405']) {
      expect(localDayStartOf(bad, 'UTC'), bad).toBeNull();
    }
  });
});

describe('localDayFor', () => {
  it('agrees with localDayStartOf for an instant inside the day it returns', () => {
    // The two entry points must describe one boundary: the sweep resolves a day from `now` while the
    // read resolves one from a date string, and a disagreement would split a day between them.
    const day = localDayFor(new Date('2026-04-05T06:00:00.000Z'), 'Pacific/Auckland');
    expect(localDayStartOf(day.localDate, 'Pacific/Auckland')?.toISOString()).toBe(
      day.startsAt.toISOString(),
    );
  });

  it('carries the zone through, so a day knows which zone it is a day in', () => {
    const day = localDayFor(new Date('2026-08-12T23:30:00.000Z'), 'Pacific/Auckland');
    expect(day).toMatchObject({ localDate: '2026-08-13', timezone: 'Pacific/Auckland' });
  });
});

describe('localDateOf', () => {
  it('zero-pads month and day so dates compare and sort as strings', () => {
    expect(localDateOf({ y: 2026, mo: 4, d: 5, h: 0, mi: 0 })).toBe('2026-04-05');
  });
});

describe('nextLocalDayStart', () => {
  it('is 23 or 25 hours after the start on a DST-transition day', () => {
    // The reason this exists rather than `start + 24h`. A fixed duration ends the short day an hour
    // late — pulling the next day's first hour into this date — and ends the long day an hour early,
    // silently dropping an hour of work from it.
    const cases: readonly { tz: string; date: string; hours: number }[] = [
      // Clocks go forward: a 23-hour day.
      { tz: 'America/New_York', date: '2026-03-08', hours: 23 },
      { tz: 'Europe/London', date: '2026-03-29', hours: 23 },
      // Clocks go back: a 25-hour day.
      { tz: 'America/New_York', date: '2026-11-01', hours: 25 },
      { tz: 'Europe/London', date: '2026-10-25', hours: 25 },
      // An ordinary day, and a zone that never transitions at all.
      { tz: 'America/New_York', date: '2026-08-12', hours: 24 },
      { tz: 'Asia/Kolkata', date: '2026-03-29', hours: 24 },
    ];
    for (const { tz, date, hours } of cases) {
      const start = localDayStartOf(date, tz);
      const end = nextLocalDayStart(date, tz);
      expect(end, `${tz} ${date}`).not.toBeNull();
      const spanHours = (assertDefined(end).getTime() - assertDefined(start).getTime()) / 3_600_000;
      expect(spanHours, `${tz} ${date}`).toBe(hours);
    }
  });

  it('is exactly the next day\u2019s own midnight, and rolls over month and year ends', () => {
    // Stated as an identity rather than as arithmetic: whatever the zone did in between, the end of
    // one day is the start of the next, so no activity can fall between them or be counted twice.
    const pairs: readonly (readonly [string, string])[] = [
      ['2026-08-12', '2026-08-13'],
      ['2026-01-31', '2026-02-01'],
      ['2026-02-28', '2026-03-01'],
      ['2026-12-31', '2027-01-01'],
    ];
    for (const [date, next] of pairs) {
      expect(nextLocalDayStart(date, 'Pacific/Auckland')?.toISOString()).toBe(
        localDayStartOf(next, 'Pacific/Auckland')?.toISOString(),
      );
    }
  });

  it('refuses anything that is not an ISO calendar date', () => {
    expect(nextLocalDayStart('not-a-date', 'UTC')).toBeNull();
  });
});
