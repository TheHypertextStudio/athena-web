import { scheduleInstantAt, scheduleWallPositionForInstant } from '@/components/scheduling';

import { toLocalInputValue } from './datetime-input';

/** Exact draft region supplied by the scheduling canvas or toolbar. */
export interface CalendarRegionSelection {
  /** Inclusive exact start instant. */
  readonly startsAt: string;
  /** Exclusive exact end instant. */
  readonly endsAt: string;
}

/** Exact seeds, rendered wall values, and independent edit ownership for one creation draft. */
export interface CalendarTimeDraft {
  /** Exact instants that created this draft and remain authoritative for untouched fields. */
  readonly seed: CalendarRegionSelection;
  /** Start wall value rendered in the current display timezone. */
  readonly startsAt: string;
  /** End wall value rendered in the current display timezone. */
  readonly endsAt: string;
  /** Whether the user owns the current start wall value. */
  readonly startsEdited: boolean;
  /** Whether the user owns the current end wall value. */
  readonly endsEdited: boolean;
}

/** Initialize wall fields and independent edit ownership from exact seed instants. */
export function calendarTimeDraftFromSeed(
  seed: CalendarRegionSelection,
  displayTimezone: string,
): CalendarTimeDraft {
  return {
    seed,
    startsAt: toLocalInputValue(seed.startsAt, displayTimezone),
    endsAt: toLocalInputValue(seed.endsAt, displayTimezone),
    startsEdited: false,
    endsEdited: false,
  };
}

/** Create the next future half-hour region on the selected timezone's wall clock. */
export function defaultCalendarRegionSelection(displayTimezone: string): CalendarRegionSelection {
  const now = new Date().toISOString();
  const position = scheduleWallPositionForInstant(now, displayTimezone);
  const roundedMinutes = position ? Math.floor(position.wallMinutes / 30) * 30 + 30 : 0;
  let startsAt = now;
  if (position) {
    const nowEpoch = Date.parse(now);
    for (let wallMinutes = roundedMinutes; wallMinutes <= 24 * 60; wallMinutes += 30) {
      const candidates = new Set(
        (['earlier', 'later'] as const)
          .map((disambiguation) =>
            scheduleInstantAt(position.date, wallMinutes, displayTimezone, disambiguation),
          )
          .filter((candidate): candidate is string => candidate !== null),
      );
      const nextCandidate = [...candidates]
        .filter((candidate) => {
          const roundTrip = scheduleWallPositionForInstant(candidate, displayTimezone);
          const matchesRequestedWall =
            wallMinutes === 24 * 60
              ? roundTrip?.wallMinutes === 0
              : roundTrip?.date === position.date && roundTrip.wallMinutes === wallMinutes;
          return Date.parse(candidate) > nowEpoch && matchesRequestedWall;
        })
        .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
      if (nextCandidate) {
        startsAt = nextCandidate;
        break;
      }
    }
  }
  return {
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 30 * 60_000).toISOString(),
  };
}
