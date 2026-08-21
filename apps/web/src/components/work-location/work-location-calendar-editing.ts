import type {
  WorkLocationAssertionOut,
  WorkLocationAssertionUpdate,
  WorkLocationOccurrenceException,
} from '@docket/types';

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
  | WorkLocationAssertionPatchEdit
  | WorkLocationOccurrenceReplaceEdit;

interface WorkLocationTimedEditInput {
  readonly region: WorkLocationCalendarRegion;
  readonly targetDate: string;
  readonly startMinutes: number;
  readonly endMinutes: number;
  readonly timezone: string;
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
  const start = resolveScheduleWallInstant(input.targetDate, input.startMinutes, input.timezone);
  const end = resolveScheduleWallInstant(input.targetDate, input.endMinutes, input.timezone);
  if (start.kind !== 'resolved' || end.kind !== 'resolved') return null;
  return editForSchedule(input.region, {
    type: 'one_off_timed',
    startsAt: new Date(start.instant).toISOString(),
    endsAt: new Date(end.instant).toISOString(),
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
