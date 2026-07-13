import { scheduleInstantAt, scheduleWallPositionForInstant } from '@/components/scheduling';

import { calendarRangeError } from './calendar-range-validation';
import {
  fromLocalInputValue,
  type LocalInputOccurrence,
  localInputOccurrenceForInstant,
  localInputResolutionError,
  toLocalInputValue,
} from './datetime-input';

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
  /** Explicit occurrence represented by a repeated start wall value. */
  readonly startsOccurrence: LocalInputOccurrence | null;
  /** Explicit occurrence represented by a repeated end wall value. */
  readonly endsOccurrence: LocalInputOccurrence | null;
}

/** Exact range resolved from a creation draft, or application-owned correction guidance. */
export type ResolvedCalendarTimeDraft =
  | { readonly startsAt: string; readonly endsAt: string }
  | { readonly error: string };

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
    startsOccurrence: localInputOccurrenceForInstant(seed.startsAt, displayTimezone),
    endsOccurrence: localInputOccurrenceForInstant(seed.endsAt, displayTimezone),
  };
}

/** Re-render untouched exact seeds in a newly selected display timezone. */
export function rebaseCalendarTimeDraft(
  draft: CalendarTimeDraft,
  displayTimezone: string,
): CalendarTimeDraft {
  return {
    ...draft,
    startsAt: draft.startsEdited
      ? draft.startsAt
      : toLocalInputValue(draft.seed.startsAt, displayTimezone),
    endsAt: draft.endsEdited ? draft.endsAt : toLocalInputValue(draft.seed.endsAt, displayTimezone),
    startsOccurrence: draft.startsEdited
      ? draft.startsOccurrence
      : localInputOccurrenceForInstant(draft.seed.startsAt, displayTimezone),
    endsOccurrence: draft.endsEdited
      ? draft.endsOccurrence
      : localInputOccurrenceForInstant(draft.seed.endsAt, displayTimezone),
  };
}

/** Resolve exact creation bounds while requiring choices only for edited repeated wall times. */
export function resolveCalendarTimeDraft(
  draft: CalendarTimeDraft,
  displayTimezone: string,
): ResolvedCalendarTimeDraft {
  const startError = draft.startsEdited
    ? localInputResolutionError(draft.startsAt, displayTimezone, draft.startsOccurrence, 'start')
    : null;
  const endError = draft.endsEdited
    ? localInputResolutionError(draft.endsAt, displayTimezone, draft.endsOccurrence, 'end')
    : null;
  if (startError || endError) return { error: startError ?? endError ?? 'Choose valid times.' };

  const startsAt = draft.startsEdited
    ? fromLocalInputValue(draft.startsAt, displayTimezone, draft.startsOccurrence)
    : draft.seed.startsAt;
  const endsAt = draft.endsEdited
    ? fromLocalInputValue(draft.endsAt, displayTimezone, draft.endsOccurrence)
    : draft.seed.endsAt;
  const rangeError = calendarRangeError(startsAt, endsAt);
  return rangeError || !startsAt || !endsAt
    ? { error: rangeError ?? 'Choose valid start and end times in your calendar timezone.' }
    : { startsAt, endsAt };
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
