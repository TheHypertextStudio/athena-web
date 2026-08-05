import type { CalendarItemOut, CalendarItemTaskRole } from '@docket/types';

import { shiftISODate } from '@/components/agenda/agenda-context';
import { formatScheduleInstantRange } from '@/components/scheduling';
import { formatCalendarDate } from '@/lib/format-date';
import { formatClock } from '@/lib/format-time';

/** Task roles in the order used by the calendar-item task stack. */
export const TASK_ROLE_ORDER: readonly CalendarItemTaskRole[] = [
  'prep',
  'agenda',
  'follow_up',
  'outcome',
  'contained',
  'related',
];

/** User-facing label for every calendar-item task role. */
export const TASK_ROLE_LABEL: Record<CalendarItemTaskRole, string> = {
  prep: 'Prep',
  agenda: 'Agenda',
  follow_up: 'Follow-up',
  outcome: 'Outcome',
  contained: 'Contained',
  related: 'Related',
};

/**
 * Shared classes for a destructive action inside a confirmation dialog.
 *
 * @remarks
 * `text-label-large` carries the emphasis that `font-medium` used to add by hand — one token that
 * sets size, line height, weight and tracking together, per the type scale. The drop shadow is gone
 * for the same reason: a button inside a dialog is not an overlay, and only overlays may cast one.
 */
export const DESTRUCTIVE_CONFIRM_CLASS =
  'focus-visible:ring-ring bg-error text-on-error hover:bg-error/90 text-label-large rounded-md px-3 py-1.5 transition-colors outline-none focus-visible:ring-1';

/** Shared classes for the cancel action inside a confirmation dialog. */
export const CANCEL_CLASS =
  'focus-visible:ring-ring text-on-surface-variant hover:bg-surface-container-high text-label-large rounded-md px-3 py-1.5 transition-colors outline-none focus-visible:ring-1';

/** Format one calendar item as a concise range in the selected display timezone. */
export function itemTimeLabel(item: CalendarItemOut, displayTimezone: string): string {
  if (item.startsAt && item.endsAt) {
    const dayFormatter = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: displayTimezone,
    });
    const startDay = dayFormatter.format(new Date(item.startsAt));
    const endDay = dayFormatter.format(new Date(item.endsAt));
    const exactRange = formatScheduleInstantRange(item.startsAt, item.endsAt, displayTimezone);
    const start = formatClock(item.startsAt, displayTimezone);
    const end = formatClock(item.endsAt, displayTimezone);
    return startDay === endDay
      ? `${startDay} · ${exactRange ?? `${start} – ${end}`}`
      : `${exactRange ?? `${start} – ${end}`} · ${startDay} – ${endDay}`;
  }
  if (item.allDayStartDate && item.allDayEndDate) {
    return `All day · ${formatCalendarDate(item.allDayStartDate) ?? item.allDayStartDate}`;
  }
  return 'No time set';
}

/** Convert an exclusive all-day end date to the inclusive value shown in a date input. */
export function localAllDayEndSeed(date: string | null): string {
  return date ? shiftISODate(date, -1) : '';
}

/** Convert an inclusive date-input value to the exclusive all-day end date stored by the API. */
export function fromAllDayEndSeed(date: string): string {
  return shiftISODate(date, 1);
}
