/**
 * `calendar/item-drawer/schedule-commit` — resolving a schedule edit into one patch, or one error.
 *
 * @remarks
 * Pure, and extracted deliberately. This branching used to live inside the editor component, which
 * is why that component scored 38 on the complexity gate: it held the timed and all-day paths, the
 * daylight-saving fold resolution, the range check, and the no-op guard, all inside a React render.
 * Pulled out here the same rules get their own tests, and the component that renders the fields no
 * longer has to be read to find out when a save happens.
 *
 * The fold resolution is the subtle part. A wall-clock time inside a repeated hour names two
 * instants, so an edit in that window is refused until the person says which one they meant.
 */
import type { CalendarItemOut } from '@docket/planning/calendar-contract';

import { calendarRangeError } from '../calendar-range-validation';
import {
  fromLocalInputValue,
  type LocalInputOccurrence,
  localInputResolutionError,
} from '../datetime-input';
import { fromAllDayEndSeed, localAllDayEndSeed } from './presentation';

/** One edited wall-clock field and the fold it resolved to, if the person chose. */
export interface ScheduleDraftField {
  /** The `datetime-local` value as typed. */
  readonly wallValue: string;
  /** Which instant a repeated wall-clock hour refers to, once chosen. */
  readonly occurrence: LocalInputOccurrence | null;
  /** Whether this field differs from what is saved. */
  readonly edited: boolean;
}

/** Everything needed to decide what a schedule edit should write. */
export interface ScheduleCommitInput {
  /** The saved item the draft is measured against. */
  readonly item: CalendarItemOut;
  /** The hub timezone the wall-clock values are read in. */
  readonly displayTimezone: string;
  /** The timed start draft; ignored for an all-day item. */
  readonly start: ScheduleDraftField;
  /** The timed end draft; ignored for an all-day item. */
  readonly end: ScheduleDraftField;
  /** The all-day start date draft; ignored for a timed item. */
  readonly allDayStart: string;
  /** The all-day end date draft, inclusive as a person reads it. */
  readonly allDayEnd: string;
}

/** The patch a schedule edit should send. */
export interface SchedulePatch {
  readonly startsAt?: string | undefined;
  readonly endsAt?: string | undefined;
  readonly allDayStartDate?: string;
  readonly allDayEndDate?: string;
}

/** What a schedule edit resolved to. */
export type ScheduleCommit =
  | { readonly kind: 'noop' }
  | { readonly kind: 'error'; readonly reason: string }
  | { readonly kind: 'patch'; readonly patch: SchedulePatch };

/**
 * Decide what a schedule edit should write, or why it cannot be written yet.
 *
 * @param input - The {@link ScheduleCommitInput} describing the draft and what it is measured against.
 * @returns a no-op, an application-owned reason it cannot be saved, or the patch to send.
 */
export function resolveSchedulePatch(input: ScheduleCommitInput): ScheduleCommit {
  return input.item.startsAt === null ? resolveAllDayPatch(input) : resolveTimedPatch(input);
}

function resolveTimedPatch(input: ScheduleCommitInput): ScheduleCommit {
  const { item, displayTimezone, start, end } = input;
  if (!start.edited && !end.edited) return { kind: 'noop' };

  const foldError =
    (start.edited
      ? localInputResolutionError(start.wallValue, displayTimezone, start.occurrence, 'start')
      : null) ??
    (end.edited
      ? localInputResolutionError(end.wallValue, displayTimezone, end.occurrence, 'end')
      : null);
  if (foldError) return { kind: 'error', reason: foldError };

  const startInstant = start.edited
    ? fromLocalInputValue(start.wallValue, displayTimezone, start.occurrence)
    : item.startsAt;
  const endInstant = end.edited
    ? fromLocalInputValue(end.wallValue, displayTimezone, end.occurrence)
    : item.endsAt;
  const rangeError = calendarRangeError(startInstant, endInstant);
  if (rangeError) return { kind: 'error', reason: rangeError };

  return {
    kind: 'patch',
    patch: { startsAt: startInstant ?? undefined, endsAt: endInstant ?? undefined },
  };
}

function resolveAllDayPatch(input: ScheduleCommitInput): ScheduleCommit {
  const { item, allDayStart, allDayEnd } = input;
  const unchanged =
    allDayStart === (item.allDayStartDate ?? '') &&
    allDayEnd === localAllDayEndSeed(item.allDayEndDate);
  if (unchanged) return { kind: 'noop' };

  // The API stores an exclusive end date; a person picks the last day they mean to include.
  const exclusiveEnd = fromAllDayEndSeed(allDayEnd);
  const rangeError = calendarRangeError(allDayStart, exclusiveEnd);
  if (rangeError) return { kind: 'error', reason: rangeError };

  return { kind: 'patch', patch: { allDayStartDate: allDayStart, allDayEndDate: exclusiveEnd } };
}
