import { scheduleInstantAt, scheduleWallPositionForInstant } from '@/components/scheduling';

import { calendarRangeError } from './calendar-range-validation';
import {
  fromLocalInputValue,
  type LocalInputOccurrence,
  localInputOccurrenceForInstant,
  localInputResolutionError,
  toLocalInputValue,
} from './datetime-input';

/** Exact timed draft region supplied by the scheduling canvas or toolbar. */
export interface CalendarTimedRegionSelection {
  /** Inclusive exact start instant. */
  readonly startsAt: string;
  /** Exclusive exact end instant. */
  readonly endsAt: string;
}

/** Calendar-date draft region supplied by an all-day creation target. */
export interface CalendarAllDayRegionSelection {
  /** Inclusive all-day start date. */
  readonly allDayStartDate: string;
  /** Exclusive all-day end date. */
  readonly allDayEndDate: string;
}

/** One exact timed or all-day local creation region. */
export type CalendarRegionSelection = CalendarTimedRegionSelection | CalendarAllDayRegionSelection;

/** Narrow a local creation region to exact timed bounds. */
export function isCalendarTimedRegionSelection(
  selection: CalendarRegionSelection,
): selection is CalendarTimedRegionSelection {
  return 'startsAt' in selection;
}

/** One separate date/time wall field in a creation draft. */
export interface CalendarWallDraftField {
  readonly date: string;
  readonly time: string;
  readonly edited: boolean;
  readonly occurrence: LocalInputOccurrence | null;
}

/** Exact seeds, separate wall fields, and independently selected timezones. */
export interface CalendarTimeDraft {
  readonly seed: CalendarTimedRegionSelection;
  readonly start: CalendarWallDraftField;
  readonly end: CalendarWallDraftField;
  readonly startTimezone: string;
  readonly endTimezone: string;
  readonly timezoneEdited: boolean;
}

/** Exact range resolved from a creation draft, or the field whose state is incomplete. */
export type ResolvedCalendarTimeDraft =
  | {
      readonly startsAt: string;
      readonly endsAt: string;
      readonly timezone: string;
      readonly endTimezone: string;
    }
  | { readonly invalidField: 'start' | 'end' | 'range' };

function wallFieldForInstant(
  instant: string,
  timezone: string,
  edited = false,
): CalendarWallDraftField {
  const value = toLocalInputValue(instant, timezone);
  return {
    date: value.slice(0, 10),
    time: value.slice(11),
    edited,
    occurrence: localInputOccurrenceForInstant(instant, timezone),
  };
}

function wallInput(field: CalendarWallDraftField): string {
  return `${field.date}T${field.time}`;
}

/** Initialize separate wall fields and timezone metadata from exact seed instants. */
export function calendarTimeDraftFromSeed(
  seed: CalendarTimedRegionSelection,
  displayTimezone: string,
): CalendarTimeDraft {
  return {
    seed,
    start: wallFieldForInstant(seed.startsAt, displayTimezone),
    end: wallFieldForInstant(seed.endsAt, displayTimezone),
    startTimezone: displayTimezone,
    endTimezone: displayTimezone,
    timezoneEdited: false,
  };
}

/** Replace the start wall field and mark it as user-owned. */
export function updateCalendarDraftStart(
  draft: CalendarTimeDraft,
  value: {
    readonly date: string;
    readonly time: string;
    readonly occurrence?: LocalInputOccurrence;
  },
): CalendarTimeDraft {
  return {
    ...draft,
    start: {
      date: value.date,
      time: value.time,
      edited: true,
      occurrence: value.occurrence ?? null,
    },
  };
}

/** Replace the end wall field and mark it as user-owned. */
export function updateCalendarDraftEnd(
  draft: CalendarTimeDraft,
  value: {
    readonly date: string;
    readonly time: string;
    readonly occurrence?: LocalInputOccurrence;
  },
): CalendarTimeDraft {
  return {
    ...draft,
    end: {
      date: value.date,
      time: value.time,
      edited: true,
      occurrence: value.occurrence ?? null,
    },
  };
}

/** Preserve wall fields while assigning one or two explicit timezones. */
export function applyCalendarDraftTimezones(
  draft: CalendarTimeDraft,
  startTimezone: string,
  endTimezone: string,
): CalendarTimeDraft {
  return {
    ...draft,
    start: { ...draft.start, edited: true, occurrence: null },
    end: { ...draft.end, edited: true, occurrence: null },
    startTimezone,
    endTimezone,
    timezoneEdited: true,
  };
}

/** Re-render untouched exact seeds when the Agenda display timezone changes. */
export function rebaseCalendarTimeDraft(
  draft: CalendarTimeDraft,
  displayTimezone: string,
): CalendarTimeDraft {
  if (draft.timezoneEdited) return draft;
  return {
    ...draft,
    start: draft.start.edited
      ? draft.start
      : wallFieldForInstant(draft.seed.startsAt, displayTimezone),
    end: draft.end.edited ? draft.end : wallFieldForInstant(draft.seed.endsAt, displayTimezone),
    startTimezone: displayTimezone,
    endTimezone: displayTimezone,
  };
}

/** Resolve exact bounds in the independently selected start and end timezones. */
export function resolveCalendarTimeDraft(draft: CalendarTimeDraft): ResolvedCalendarTimeDraft {
  const startValue = wallInput(draft.start);
  const endValue = wallInput(draft.end);
  if (localInputResolutionError(startValue, draft.startTimezone, draft.start.occurrence, 'start')) {
    return { invalidField: 'start' };
  }
  if (localInputResolutionError(endValue, draft.endTimezone, draft.end.occurrence, 'end')) {
    return { invalidField: 'end' };
  }

  const startsAt = fromLocalInputValue(startValue, draft.startTimezone, draft.start.occurrence);
  const endsAt = fromLocalInputValue(endValue, draft.endTimezone, draft.end.occurrence);
  if (!startsAt) return { invalidField: 'start' };
  if (!endsAt) return { invalidField: 'end' };
  if (calendarRangeError(startsAt, endsAt)) return { invalidField: 'range' };
  return {
    startsAt,
    endsAt,
    timezone: draft.startTimezone,
    endTimezone: draft.endTimezone,
  };
}

/** Create the next future half-hour region on the selected timezone's wall clock. */
export function defaultCalendarRegionSelection(
  displayTimezone: string,
): CalendarTimedRegionSelection {
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
