import { completionCivilDate } from '@docket/work/blueprints';
import {
  addCalendarDays,
  addCalendarMonths,
  daysInMonth,
  formatCalendarDate,
  parseCalendarDate,
} from '@docket/work/calendar-date';

/** Actual lifecycle facts; deleted work is absent rather than recreated from an expected path. */
export interface NativeScheduleCompletionWork {
  readonly kind: string;
  readonly id: string;
  readonly state: 'unstarted' | 'started' | 'completed' | 'canceled';
}
/** A run closes only from its living actual roots and descendants, without an independent instance state. */
export function nativeCompletionState(
  roots: readonly { readonly kind: string; readonly id: string }[],
  work: readonly NativeScheduleCompletionWork[],
): 'open' | 'completed' | 'canceled' {
  if (
    !roots.length ||
    roots.some((root) => !work.some((entry) => entry.id === root.id && entry.kind === root.kind))
  )
    return 'open';
  const rootStates = roots.map(
    (root) => work.find((entry) => entry.id === root.id && entry.kind === root.kind)?.state,
  );
  if (rootStates.some((state) => state === 'canceled')) return 'canceled';
  return work
    .filter((entry) => entry.kind !== 'milestone')
    .every((entry) => entry.state === 'completed' || entry.state === 'canceled')
    ? 'completed'
    : 'open';
}
/** Add completion cadence to its actual civil date in the saved schedule timezone, clamping month ends. */
export function nativeNextCompletionDate(
  completedAt: string,
  timezone: string,
  interval: number,
  unit: 'day' | 'week' | 'month',
): string {
  const completedOn = completionCivilDate(completedAt, timezone);
  if (unit !== 'month') return addCalendarDays(completedOn, interval * (unit === 'week' ? 7 : 1));
  const source = parseCalendarDate(completedOn);
  const target = addCalendarMonths(completedOn, interval);
  return formatCalendarDate({
    year: target.year,
    month: target.month,
    day: Math.min(source.day, daysInMonth(target.year, target.month)),
  });
}
