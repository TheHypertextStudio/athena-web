import type { WorkScheduleTrigger } from '@docket/work/work-schedule-trigger';
import { addCalendarDays } from '@docket/work/calendar-date';
import { expandCalendarSchedule, type RecurrenceDateExceptions } from './expand';

/** Resolve a clock instant to the schedule's saved civil timezone. */
export function scheduleCivilToday(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}
/** First civil occurrence for a review, using the existing recurrence engine's calendar semantics. */
export function firstScheduleRunDate(
  trigger: WorkScheduleTrigger,
  effectiveFrom: string,
): string | null {
  return trigger.kind === 'calendar'
    ? (expandCalendarSchedule(trigger.schedule, {
        from: effectiveFrom,
        through: effectiveFrom,
        minimumOccurrences: 1,
      })[0] ?? null)
    : effectiveFrom;
}
/** One immutable trigger boundary and its explicit civil-date exceptions. */
export interface ScheduleDateSegment {
  readonly effectiveFrom: string;
  readonly trigger: WorkScheduleTrigger;
  readonly exceptions?: RecurrenceDateExceptions | undefined;
}
/** Respect future revision boundaries without replacing the retained calendar expansion engine. */
export function nextCalendarScheduleDate(
  segments: readonly ScheduleDateSegment[],
  now = new Date(),
): string | null {
  const ordered = [...segments].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  const candidates = ordered.flatMap((segment, index) => {
    if (segment.trigger.kind !== 'calendar') return [];
    const today = scheduleCivilToday(segment.trigger.schedule.timezone, now);
    const from = today > segment.effectiveFrom ? today : segment.effectiveFrom;
    const next = ordered[index + 1];
    const through = next ? addCalendarDays(next.effectiveFrom, -1) : null;
    if (through && from > through) return [];
    return expandCalendarSchedule(segment.trigger.schedule, {
      from,
      through: from,
      minimumOccurrences: 1,
      ...(segment.exceptions ? { exceptions: segment.exceptions } : {}),
    })
      .filter((date) => through === null || date <= through)
      .slice(0, 1);
  });
  return candidates.sort()[0] ?? null;
}
