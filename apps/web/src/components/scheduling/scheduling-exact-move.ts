import { Temporal } from '@js-temporal/polyfill';

import { resolveScheduleWallInstant } from './scheduling-wall-time';

/** Exact instant bounds produced by moving an existing schedule item. */
export interface MovedScheduleInstantRange {
  readonly startsAt: string;
  readonly endsAt: string;
}

/**
 * Move exact bounds to one wall-clock start while preserving their physical elapsed duration.
 *
 * @remarks
 * A skipped target is rejected. A repeated target is accepted only when the exact source start also
 * occupies a repeated wall time, in which case its earlier/later occurrence is preserved. Duration
 * is carried as exact nanoseconds across either transition.
 */
export function moveScheduleInstantRange({
  startsAt,
  endsAt,
  targetDate,
  startMinutes,
  displayTimezone,
}: {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly targetDate: string;
  readonly startMinutes: number;
  readonly displayTimezone: string;
}): MovedScheduleInstantRange | null {
  try {
    const sourceStart = Temporal.Instant.from(startsAt);
    const sourceEnd = Temporal.Instant.from(endsAt);
    const duration = sourceEnd.epochNanoseconds - sourceStart.epochNanoseconds;
    if (duration <= 0n) return null;
    const target = resolveScheduleWallInstant(targetDate, startMinutes, displayTimezone, startsAt);
    if (target.kind !== 'resolved') return null;
    const movedStart = Temporal.Instant.from(target.instant);
    return {
      startsAt: movedStart.toString(),
      endsAt: Temporal.Instant.fromEpochNanoseconds(
        movedStart.epochNanoseconds + duration,
      ).toString(),
    };
  } catch {
    return null;
  }
}
