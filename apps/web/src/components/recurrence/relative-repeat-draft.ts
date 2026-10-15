import type { RelativeCalendarRecurrenceSchedule } from '@docket/work/work-schedule-defaults';
/** Change a relative cadence without fabricating an absolute date or timezone. */
export function relativeCadence(
  kind: RelativeCalendarRecurrenceSchedule['kind'],
  previous?: RelativeCalendarRecurrenceSchedule,
): RelativeCalendarRecurrenceSchedule {
  const common = {
    interval: previous?.interval ?? 1,
    startOffsetDays: previous?.startOffsetDays ?? 0,
    end: previous?.end ?? { kind: 'never' as const },
  };
  if (kind === 'daily') return { kind, ...common };
  if (kind === 'weekly') return { kind, ...common, weekdays: ['monday'] };
  if (kind === 'monthly')
    return { kind, ...common, pattern: { kind: 'day_of_month', day: 1, overflow: 'last_day' } };
  return { kind, ...common, month: 1, day: 1, overflow: 'last_day' };
}
