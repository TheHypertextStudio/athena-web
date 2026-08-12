/** `@docket/api` — the intentionally bounded RFC 5545 RRULE adapter. */
import type { RecurrenceSchedule } from '@docket/types';
import { describe, expect, it } from 'vitest';

import { exportRRule, importRRule } from '../../src/lib/recurrence/rrule';

const timezone = 'America/Los_Angeles';

describe('exportRRule', () => {
  it('exports daily and weekly schedules with stable field ordering', () => {
    expect(
      exportRRule({
        kind: 'daily',
        interval: 2,
        startDate: '2026-08-12',
        timezone,
        end: { kind: 'never' },
      }),
    ).toEqual({ dtstart: '2026-08-12', timezone, rrule: 'FREQ=DAILY;INTERVAL=2' });

    expect(
      exportRRule({
        kind: 'weekly',
        interval: 1,
        startDate: '2026-08-12',
        timezone,
        weekdays: ['friday', 'monday', 'wednesday'],
        end: { kind: 'on_date', date: '2026-12-31' },
      }),
    ).toEqual({
      dtstart: '2026-08-12',
      timezone,
      rrule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR;UNTIL=20261231',
    });
  });

  it('exports supported monthly and yearly patterns', () => {
    expect(
      exportRRule({
        kind: 'monthly',
        interval: 1,
        startDate: '2026-08-12',
        timezone,
        pattern: { kind: 'day_of_month', day: 12, overflow: 'skip' },
        end: { kind: 'after_count', count: 6 },
      }),
    ).toEqual({
      dtstart: '2026-08-12',
      timezone,
      rrule: 'FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=12;COUNT=6',
    });
    expect(
      exportRRule({
        kind: 'monthly',
        interval: 2,
        startDate: '2026-09-01',
        timezone,
        pattern: { kind: 'nth_weekday', ordinal: -1, weekday: 'monday' },
        end: { kind: 'never' },
      }),
    ).toEqual({
      dtstart: '2026-09-01',
      timezone,
      rrule: 'FREQ=MONTHLY;INTERVAL=2;BYDAY=-1MO',
    });
    expect(
      exportRRule({
        kind: 'yearly',
        interval: 1,
        startDate: '2024-02-29',
        timezone,
        month: 2,
        day: 29,
        overflow: 'skip',
        end: { kind: 'never' },
      }),
    ).toEqual({
      dtstart: '2024-02-29',
      timezone,
      rrule: 'FREQ=YEARLY;INTERVAL=1;BYMONTH=2;BYMONTHDAY=29',
    });
  });

  it('rejects last-day overflow because RRULE cannot preserve that behavior', () => {
    expect(() =>
      exportRRule({
        kind: 'monthly',
        interval: 1,
        startDate: '2026-01-31',
        timezone,
        pattern: { kind: 'day_of_month', day: 31, overflow: 'last_day' },
        end: { kind: 'never' },
      }),
    ).toThrow(/last.day/i);

    expect(() =>
      exportRRule({
        kind: 'yearly',
        interval: 1,
        startDate: '2024-02-29',
        timezone,
        month: 2,
        day: 29,
        overflow: 'last_day',
        end: { kind: 'never' },
      }),
    ).toThrow(/last.day/i);
  });

  it('rejects completion-anchored schedules rather than changing their semantics', () => {
    const schedule = {
      kind: 'after_completion',
      interval: 1,
      unit: 'week',
    } satisfies RecurrenceSchedule;
    expect(() => exportRRule(schedule)).toThrow(/completion/i);
  });
});

describe('importRRule', () => {
  it('imports each supported frequency into the canonical schedule union', () => {
    expect(
      importRRule({
        dtstart: '2026-08-12',
        timezone,
        rrule: 'FREQ=DAILY;INTERVAL=2;COUNT=5',
      }),
    ).toEqual({
      kind: 'daily',
      interval: 2,
      startDate: '2026-08-12',
      timezone,
      end: { kind: 'after_count', count: 5 },
    });
    expect(
      importRRule({
        dtstart: '2026-08-12',
        timezone,
        rrule: 'FREQ=WEEKLY;BYDAY=FR,MO,WE;UNTIL=20261231',
      }),
    ).toEqual({
      kind: 'weekly',
      interval: 1,
      startDate: '2026-08-12',
      timezone,
      weekdays: ['monday', 'wednesday', 'friday'],
      end: { kind: 'on_date', date: '2026-12-31' },
    });
    expect(
      importRRule({
        dtstart: '2026-09-01',
        timezone,
        rrule: 'FREQ=MONTHLY;INTERVAL=2;BYDAY=-1MO',
      }),
    ).toEqual({
      kind: 'monthly',
      interval: 2,
      startDate: '2026-09-01',
      timezone,
      pattern: { kind: 'nth_weekday', ordinal: -1, weekday: 'monday' },
      end: { kind: 'never' },
    });
    expect(
      importRRule({
        dtstart: '2024-02-29',
        timezone,
        rrule: 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29',
      }),
    ).toEqual({
      kind: 'yearly',
      interval: 1,
      startDate: '2024-02-29',
      timezone,
      month: 2,
      day: 29,
      overflow: 'skip',
      end: { kind: 'never' },
    });
  });

  it('rejects ambiguous or unsupported RRULE constructs', () => {
    expect(() =>
      importRRule({
        dtstart: '2026-08-12',
        timezone,
        rrule: 'FREQ=MONTHLY;BYDAY=MO;BYSETPOS=2',
      }),
    ).toThrow(/unsupported/i);
    expect(() =>
      importRRule({
        dtstart: '2026-08-12',
        timezone,
        rrule: 'FREQ=WEEKLY',
      }),
    ).toThrow(/BYDAY/i);
    expect(() =>
      importRRule({
        dtstart: '2026-08-12',
        timezone,
        rrule: 'FREQ=DAILY;COUNT=3;UNTIL=20261231',
      }),
    ).toThrow(/COUNT.*UNTIL/i);
  });

  it('rejects malformed dates, intervals, and unknown fields', () => {
    expect(() => importRRule({ dtstart: '2026-02-30', timezone, rrule: 'FREQ=DAILY' })).toThrow(
      /date/i,
    );
    expect(() =>
      importRRule({ dtstart: '2026-08-12', timezone, rrule: 'FREQ=DAILY;INTERVAL=0' }),
    ).toThrow(/INTERVAL/i);
    expect(() =>
      importRRule({ dtstart: '2026-08-12', timezone, rrule: 'FREQ=DAILY;WKST=MO' }),
    ).toThrow(/unsupported/i);
  });

  it.each([
    {
      name: 'a blank timezone',
      envelope: { dtstart: '2026-08-12', timezone: ' ', rrule: 'FREQ=DAILY' },
      message: /timezone.*blank/i,
    },
    {
      name: 'an unknown timezone',
      envelope: { dtstart: '2026-08-12', timezone: 'Mars/Olympus', rrule: 'FREQ=DAILY' },
      message: /unknown.*timezone/i,
    },
    {
      name: 'a blank rule',
      envelope: { dtstart: '2026-08-12', timezone, rrule: '  ' },
      message: /must not be blank/i,
    },
    {
      name: 'a field without a value',
      envelope: { dtstart: '2026-08-12', timezone, rrule: 'FREQ=' },
      message: /malformed/i,
    },
    {
      name: 'a field without a key',
      envelope: { dtstart: '2026-08-12', timezone, rrule: '=DAILY' },
      message: /malformed/i,
    },
    {
      name: 'a duplicate field',
      envelope: { dtstart: '2026-08-12', timezone, rrule: 'FREQ=DAILY;FREQ=WEEKLY' },
      message: /more than once/i,
    },
    {
      name: 'a non-numeric interval',
      envelope: { dtstart: '2026-08-12', timezone, rrule: 'FREQ=DAILY;INTERVAL=two' },
      message: /positive integer/i,
    },
    {
      name: 'an interval above the supported bound',
      envelope: { dtstart: '2026-08-12', timezone, rrule: 'FREQ=DAILY;INTERVAL=1000001' },
      message: /between 1 and 1000000/i,
    },
    {
      name: 'an UNTIL value with the wrong shape',
      envelope: { dtstart: '2026-08-12', timezone, rrule: 'FREQ=DAILY;UNTIL=2026-12-31' },
      message: /YYYYMMDD/i,
    },
    {
      name: 'an impossible UNTIL date',
      envelope: { dtstart: '2026-08-12', timezone, rrule: 'FREQ=DAILY;UNTIL=20260230' },
      message: /date/i,
    },
    {
      name: 'an invalid weekly weekday',
      envelope: { dtstart: '2026-08-12', timezone, rrule: 'FREQ=WEEKLY;BYDAY=MO,XX' },
      message: /weekday codes/i,
    },
    {
      name: 'a duplicate weekly weekday',
      envelope: { dtstart: '2026-08-12', timezone, rrule: 'FREQ=WEEKLY;BYDAY=MO,MO' },
      message: /must not repeat/i,
    },
    {
      name: 'a monthly rule with neither supported selector',
      envelope: { dtstart: '2026-08-12', timezone, rrule: 'FREQ=MONTHLY' },
      message: /exactly one/i,
    },
    {
      name: 'a monthly rule with both supported selectors',
      envelope: {
        dtstart: '2026-08-12',
        timezone,
        rrule: 'FREQ=MONTHLY;BYDAY=2MO;BYMONTHDAY=12',
      },
      message: /exactly one/i,
    },
    {
      name: 'an out-of-range monthly day',
      envelope: { dtstart: '2026-08-12', timezone, rrule: 'FREQ=MONTHLY;BYMONTHDAY=32' },
      message: /between 1 and 31/i,
    },
    {
      name: 'a non-ordinal monthly weekday',
      envelope: { dtstart: '2026-08-12', timezone, rrule: 'FREQ=MONTHLY;BYDAY=MO' },
      message: /ordinal weekday/i,
    },
    {
      name: 'a yearly rule without a month',
      envelope: { dtstart: '2026-08-12', timezone, rrule: 'FREQ=YEARLY;BYMONTHDAY=12' },
      message: /BYMONTH.*positive integer/i,
    },
    {
      name: 'a yearly rule without a day',
      envelope: { dtstart: '2026-08-12', timezone, rrule: 'FREQ=YEARLY;BYMONTH=8' },
      message: /BYMONTHDAY.*positive integer/i,
    },
    {
      name: 'an unsupported frequency',
      envelope: { dtstart: '2026-08-12', timezone, rrule: 'FREQ=HOURLY' },
      message: /unsupported.*HOURLY/i,
    },
    {
      name: 'a missing frequency',
      envelope: { dtstart: '2026-08-12', timezone, rrule: 'INTERVAL=2' },
      message: /unsupported.*missing/i,
    },
  ])('rejects $name instead of guessing its semantics', ({ envelope, message }) => {
    expect(() => importRRule(envelope)).toThrow(message);
  });
});
