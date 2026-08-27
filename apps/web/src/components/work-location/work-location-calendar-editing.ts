import type {
  WorkLocationAssertionOut,
  WorkLocationAssertionUpdate,
  WorkLocationOccurrenceException,
} from '@docket/types';
import { Temporal } from '@js-temporal/polyfill';

import { resolveScheduleWallInstant } from '@/components/scheduling';

import type { WorkLocationCalendarRegion } from './work-location-calendar-model';

/** Direct assertion patch emitted for one-off location edits. */
export interface WorkLocationAssertionPatchEdit {
  readonly kind: 'assertion_patch';
  readonly assertionId: WorkLocationAssertionOut['id'];
  readonly input: WorkLocationAssertionUpdate;
}

/** Per-date replacement emitted when a visible weekly occurrence changes. */
export interface WorkLocationOccurrenceReplaceEdit {
  readonly kind: 'occurrence_replace';
  readonly assertionId: WorkLocationAssertionOut['id'];
  readonly occurrenceDate: string;
  readonly input: Extract<WorkLocationOccurrenceException, { action: 'replace' }>;
}

/** Mutation payload for a direct calendar edit that remains independent from schedule items. */
export type WorkLocationCalendarEdit =
  WorkLocationAssertionPatchEdit | WorkLocationOccurrenceReplaceEdit;

interface WorkLocationTimedEditInput {
  readonly region: WorkLocationCalendarRegion;
  readonly mode: 'move' | 'resize-start' | 'resize-end';
  readonly sourceDate: string;
  readonly sourceStartMinutes: number;
  readonly sourceEndMinutes: number;
  readonly targetDate: string;
  readonly startMinutes: number;
  readonly endMinutes: number;
  readonly timezone: string;
}

/** Apply one snapped lane delta to the source interval without replacing its clipped portions. */
function editedTimedBounds(input: WorkLocationTimedEditInput): {
  readonly startsAt: string;
  readonly endsAt: string;
} | null {
  try {
    const editsEnd = input.mode === 'resize-end';
    const sourceMinutes = editsEnd ? input.sourceEndMinutes : input.sourceStartMinutes;
    const targetMinutes = editsEnd ? input.endMinutes : input.startMinutes;
    const occurrenceSource = editsEnd ? input.region.sourceEndsAt : input.region.sourceStartsAt;
    const sourceAnchor = resolveScheduleWallInstant(
      input.sourceDate,
      sourceMinutes,
      input.timezone,
      occurrenceSource,
    );
    const targetAnchor = resolveScheduleWallInstant(
      input.targetDate,
      targetMinutes,
      input.timezone,
      occurrenceSource,
    );
    if (sourceAnchor.kind !== 'resolved' || targetAnchor.kind !== 'resolved') return null;

    const sourceStart = Temporal.Instant.from(input.region.sourceStartsAt);
    const sourceEnd = Temporal.Instant.from(input.region.sourceEndsAt);
    const delta =
      Temporal.Instant.from(targetAnchor.instant).epochNanoseconds -
      Temporal.Instant.from(sourceAnchor.instant).epochNanoseconds;
    const editedStart =
      input.mode === 'resize-end'
        ? sourceStart
        : Temporal.Instant.fromEpochNanoseconds(sourceStart.epochNanoseconds + delta);
    const editedEnd =
      input.mode === 'resize-start'
        ? sourceEnd
        : Temporal.Instant.fromEpochNanoseconds(sourceEnd.epochNanoseconds + delta);
    if (Temporal.Instant.compare(editedStart, editedEnd) >= 0) return null;
    return {
      startsAt: new Date(editedStart.epochMilliseconds).toISOString(),
      endsAt: new Date(editedEnd.epochMilliseconds).toISOString(),
    };
  } catch {
    return null;
  }
}

interface WorkLocationAllDayMoveInput {
  readonly region: WorkLocationCalendarRegion;
  readonly targetDate: string;
  readonly timezone: string;
}

/** Wrap an occurrence schedule in the correct one-off patch or weekly exception envelope. */
function editForSchedule(
  region: WorkLocationCalendarRegion,
  schedule: Extract<WorkLocationOccurrenceException, { action: 'replace' }>['schedule'],
): WorkLocationCalendarEdit | null {
  if (!region.editable || !region.assertionId || !region.occurrenceDate) return null;
  if (region.assertionKind === 'one_off') {
    return { kind: 'assertion_patch', assertionId: region.assertionId, input: { schedule } };
  }
  if (region.assertionKind !== 'weekly') return null;
  return {
    kind: 'occurrence_replace',
    assertionId: region.assertionId,
    occurrenceDate: region.occurrenceDate,
    input: {
      action: 'replace',
      date: region.occurrenceDate,
      placeId: region.placeId,
      schedule,
    },
  };
}

/** Translate a snapped timed move or resize into one work-location-only mutation payload. */
export function workLocationTimedEdit(
  input: WorkLocationTimedEditInput,
): WorkLocationCalendarEdit | null {
  const bounds = editedTimedBounds(input);
  if (!bounds) return null;
  return editForSchedule(input.region, {
    type: 'one_off_timed',
    startsAt: bounds.startsAt,
    endsAt: bounds.endsAt,
    timezone: input.timezone,
  });
}

/** Translate an all-day date move into one work-location-only mutation payload. */
export function workLocationAllDayMove(
  input: WorkLocationAllDayMoveInput,
): WorkLocationCalendarEdit | null {
  return editForSchedule(input.region, {
    type: 'one_off_all_day',
    date: input.targetDate,
    timezone: input.timezone,
  });
}
