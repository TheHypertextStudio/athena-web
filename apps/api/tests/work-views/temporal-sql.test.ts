import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  resolveTemporalRange,
  type TemporalField,
  type TemporalSqlContext,
} from '../../src/lib/work-views/temporal-sql';

const DATE_FIELD: TemporalField = { kind: 'date' };
const DATETIME_FIELD: TemporalField = { kind: 'datetime' };
const TUESDAY_NOON_UTC: TemporalSqlContext = {
  now: new Date('2026-09-22T12:00:00.000Z'),
  timeZone: 'UTC',
};

describe('resolveTemporalRange calendar periods', () => {
  it('returns the whole current month for a this-month preset', () => {
    expect(
      resolveTemporalRange({ kind: 'preset', value: 'this-month' }, DATE_FIELD, TUESDAY_NOON_UTC),
    ).toEqual({ start: '2026-09-01', end: '2026-10-01' });
  });

  it('returns the previous month for a last-month preset across a year boundary', () => {
    expect(
      resolveTemporalRange({ kind: 'preset', value: 'last-month' }, DATE_FIELD, {
        now: new Date('2026-01-15T12:00:00.000Z'),
        timeZone: 'UTC',
      }),
    ).toEqual({ start: '2025-12-01', end: '2026-01-01' });
  });

  it('starts a next-week preset on the following Monday', () => {
    expect(
      resolveTemporalRange({ kind: 'preset', value: 'next-week' }, DATE_FIELD, TUESDAY_NOON_UTC),
    ).toEqual({ start: '2026-09-28', end: '2026-10-05' });
  });

  it('resolves a relative calendar quarter to its three-month window', () => {
    expect(
      resolveTemporalRange(
        { kind: 'relative', anchor: 'today', unit: 'quarter', offset: 1 },
        DATE_FIELD,
        TUESDAY_NOON_UTC,
      ),
    ).toEqual({ start: '2026-10-01', end: '2027-01-01' });
  });

  it('resolves a relative calendar year to the whole previous year', () => {
    expect(
      resolveTemporalRange(
        { kind: 'relative', anchor: 'today', unit: 'year', offset: -1 },
        DATE_FIELD,
        TUESDAY_NOON_UTC,
      ),
    ).toEqual({ start: '2025-01-01', end: '2026-01-01' });
  });

  it('treats a now-anchored operand on a date field as a calendar period', () => {
    expect(
      resolveTemporalRange(
        { kind: 'relative', anchor: 'now', unit: 'month', offset: 0 },
        DATE_FIELD,
        TUESDAY_NOON_UTC,
      ),
    ).toEqual({ start: '2026-09-01', end: '2026-10-01' });
  });

  it('bounds a timestamp month by local midnights in the viewer timezone', () => {
    expect(
      resolveTemporalRange({ kind: 'preset', value: 'this-month' }, DATETIME_FIELD, {
        now: new Date('2026-09-22T12:00:00.000Z'),
        timeZone: 'America/New_York',
      }),
    ).toEqual({
      start: new Date('2026-09-01T04:00:00.000Z'),
      end: new Date('2026-10-01T04:00:00.000Z'),
    });
  });

  it('uses the local calendar day in the viewer timezone rather than the UTC day', () => {
    expect(
      resolveTemporalRange({ kind: 'preset', value: 'today' }, DATE_FIELD, {
        now: new Date('2026-09-22T02:00:00.000Z'),
        timeZone: 'America/Los_Angeles',
      }),
    ).toEqual({ start: '2026-09-21', end: '2026-09-22' });
  });
});

describe('resolveTemporalRange rolling instants', () => {
  it('measures a rolling week backwards from the frozen instant', () => {
    expect(
      resolveTemporalRange(
        { kind: 'relative', anchor: 'now', unit: 'week', offset: -1 },
        DATETIME_FIELD,
        TUESDAY_NOON_UTC,
      ),
    ).toEqual({
      start: new Date('2026-09-15T12:00:00.000Z'),
      end: new Date('2026-09-22T12:00:00.000Z'),
    });
  });

  it('starts a zero-offset rolling month at the frozen instant and clamps its end to month length', () => {
    expect(
      resolveTemporalRange(
        { kind: 'relative', anchor: 'now', unit: 'month', offset: 0 },
        DATETIME_FIELD,
        { now: new Date('2026-01-31T15:00:00.000Z'), timeZone: 'UTC' },
      ),
    ).toEqual({
      start: new Date('2026-01-31T15:00:00.000Z'),
      end: new Date('2026-02-28T15:00:00.000Z'),
    });
  });

  it('moves a rolling quarter forward by three calendar months', () => {
    expect(
      resolveTemporalRange(
        { kind: 'relative', anchor: 'now', unit: 'quarter', offset: 1 },
        DATETIME_FIELD,
        TUESDAY_NOON_UTC,
      ),
    ).toEqual({
      start: new Date('2026-12-22T12:00:00.000Z'),
      end: new Date('2027-03-22T12:00:00.000Z'),
    });
  });

  it('clamps a rolling year from a leap day to the last day of February', () => {
    expect(
      resolveTemporalRange(
        { kind: 'relative', anchor: 'now', unit: 'year', offset: -1 },
        DATETIME_FIELD,
        { now: new Date('2028-02-29T09:30:00.000Z'), timeZone: 'UTC' },
      ),
    ).toEqual({
      start: new Date('2027-02-28T09:30:00.000Z'),
      end: new Date('2028-02-28T09:30:00.000Z'),
    });
  });

  it('keeps the local wall-clock time when a rolling month crosses a daylight-saving change', () => {
    expect(
      resolveTemporalRange(
        { kind: 'relative', anchor: 'now', unit: 'month', offset: 1 },
        DATETIME_FIELD,
        { now: new Date('2026-10-15T16:00:00.000Z'), timeZone: 'America/New_York' },
      ),
    ).toEqual({
      start: new Date('2026-11-15T17:00:00.000Z'),
      end: new Date('2026-12-15T17:00:00.000Z'),
    });
  });
});

describe('resolveTemporalRange defaults', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the current clock and UTC when the context omits both', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T23:30:00.000Z'));

    expect(resolveTemporalRange({ kind: 'preset', value: 'tomorrow' }, DATE_FIELD, {})).toEqual({
      start: '2026-09-23',
      end: '2026-09-24',
    });
  });

  it('returns null for an absolute operand', () => {
    expect(
      resolveTemporalRange({ kind: 'absolute', value: '2026-09-22' }, DATE_FIELD, TUESDAY_NOON_UTC),
    ).toBeNull();
  });
});
