import { Temporal } from '@js-temporal/polyfill';

import { resolveScheduleWallInstant } from './scheduling-wall-time';

/** Exact instant bounds produced by resizing one edge of a schedule item. */
export interface ResizedScheduleInstantRange {
  readonly startsAt: string;
  readonly endsAt: string;
}

/**
 * Resolve one edited edge at its requested wall-clock position while preserving the other edge.
 *
 * @remarks
 * Skipped targets are rejected. A repeated target is accepted only when that exact source edge
 * already owns an earlier/later occurrence, which is then preserved. Resolving the requested wall
 * edge directly keeps preview labels and persisted bounds aligned across clock changes.
 */
export function resizeScheduleInstantRange({
  startsAt,
  endsAt,
  edge,
  targetDate,
  edgeMinutes,
  displayTimezone,
}: {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly edge: 'start' | 'end';
  readonly targetDate: string;
  readonly edgeMinutes: number;
  readonly displayTimezone: string;
}): ResizedScheduleInstantRange | null {
  try {
    const sourceStart = Temporal.Instant.from(startsAt);
    const sourceEnd = Temporal.Instant.from(endsAt);
    const target = resolveScheduleWallInstant(
      targetDate,
      edgeMinutes,
      displayTimezone,
      edge === 'start' ? startsAt : endsAt,
    );
    if (target.kind !== 'resolved') return null;
    const targetInstant = Temporal.Instant.from(target.instant);
    const resizedStart = edge === 'start' ? targetInstant : sourceStart;
    const resizedEnd = edge === 'end' ? targetInstant : sourceEnd;
    if (Temporal.Instant.compare(resizedStart, resizedEnd) >= 0) return null;

    return {
      startsAt: resizedStart.toString(),
      endsAt: resizedEnd.toString(),
    };
  } catch {
    return null;
  }
}
