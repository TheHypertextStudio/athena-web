import { describe, expect, it } from 'vitest';
import { WorkScheduleTrigger } from '@docket/work/work-schedule-trigger';
import {
  firstScheduleRunDate,
  nextCalendarScheduleDate,
  scheduleCivilToday,
} from '../../src/lib/recurrence/schedule-review-date';
import { publicScheduleFailure } from '../../src/lib/recurrence/schedule-history';
function dinner() {
  return WorkScheduleTrigger.parse({
    kind: 'calendar',
    schedule: {
      kind: 'monthly',
      interval: 1,
      startDate: '2026-10-01',
      timezone: 'America/Los_Angeles',
      end: { kind: 'never' },
      pattern: { kind: 'nth_weekday', ordinal: 2, weekday: 'thursday' },
    },
  });
}
describe('scheduled work review facts', () => {
  it('reviews the first dinner date rather than the revision boundary', () => {
    expect(firstScheduleRunDate(dinner(), '2026-10-01')).toBe('2026-10-08');
    expect(firstScheduleRunDate(dinner(), '2026-10-09')).toBe('2026-11-12');
  });
  it('retains inclusive end semantics and reports an exhausted calendar without invented work', () => {
    const trigger = dinner();
    if (trigger.kind !== 'calendar') throw new Error('Expected a calendar fixture');
    expect(
      firstScheduleRunDate(
        {
          ...trigger,
          schedule: { ...trigger.schedule, end: { kind: 'on_date', date: '2026-10-08' } },
        },
        '2026-10-09',
      ),
    ).toBeNull();
    expect(firstScheduleRunDate({ kind: 'manual' }, '2026-10-09')).toBe('2026-10-09');
  });
  it('uses the saved timezone at midnight and across a daylight-saving transition', () => {
    expect(scheduleCivilToday('America/Los_Angeles', new Date('2026-10-16T02:00:00Z'))).toBe(
      '2026-10-15',
    );
    expect(scheduleCivilToday('Pacific/Auckland', new Date('2026-10-16T02:00:00Z'))).toBe(
      '2026-10-16',
    );
    expect(scheduleCivilToday('America/Los_Angeles', new Date('2026-11-01T09:30:00Z'))).toBe(
      '2026-11-01',
    );
  });
  it('keeps the next date in its governing revision when a future cadence is already authored', () => {
    const trigger = dinner();
    expect(
      nextCalendarScheduleDate(
        [
          { effectiveFrom: '2026-10-01', trigger },
          { effectiveFrom: '2026-11-01', trigger: { kind: 'manual' } },
        ],
        new Date('2026-10-02T12:00:00Z'),
      ),
    ).toBe('2026-10-08');
    expect(
      nextCalendarScheduleDate(
        [
          { effectiveFrom: '2026-10-01', trigger },
          { effectiveFrom: '2026-11-01', trigger: { kind: 'manual' } },
        ],
        new Date('2026-10-09T12:00:00Z'),
      ),
    ).toBeNull();
  });
  it('replaces arbitrary legacy/provider failure details with an owned category', () => {
    expect(publicScheduleFailure(null)).toBeNull();
    expect(publicScheduleFailure('schedule_permission_changed')).toBe('permission_changed');
    expect(publicScheduleFailure('private provider response or credentials')).toBe(
      'creation_failed',
    );
  });
});
