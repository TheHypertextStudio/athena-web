import type { CalendarAxis } from './calendar-schedule-model';

const INLINE_UPDATE_FAILURE_COPY =
  'Could not update this item. Your previous time has been restored.';

/** Return fixed, application-owned degraded-state copy without exposing server details. */
export function calendarSchedulingError(
  axis: CalendarAxis,
  inlineMutationFailed: boolean,
  dateItemsFailed: boolean,
  peopleFailed: boolean,
): string | null {
  if (inlineMutationFailed) return INLINE_UPDATE_FAILURE_COPY;
  if ((axis === 'dates' && dateItemsFailed) || (axis === 'people' && peopleFailed)) {
    return 'Calendar updates are temporarily unavailable. Showing what we have.';
  }
  return null;
}

/** Return concise loading or empty copy for the active scheduling axis. */
export function calendarSchedulingEmptyMessage(
  axis: CalendarAxis,
  dateItemsPending: boolean,
  comparisonPending: boolean,
  selectedActorCount: number,
): string {
  if (axis === 'dates') {
    return dateItemsPending
      ? 'Loading calendar items…'
      : 'Nothing scheduled. Drag on the grid or choose New to plan time.';
  }
  if (selectedActorCount === 0) return 'Choose people to compare.';
  return comparisonPending ? 'Loading shared schedules…' : 'No shared availability for this date.';
}
