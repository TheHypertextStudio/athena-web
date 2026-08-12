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
});
