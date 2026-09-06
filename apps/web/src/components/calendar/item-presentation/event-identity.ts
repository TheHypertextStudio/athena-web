/**
 * `calendar/item-presentation/event-identity` — the facts every calendar-event surface renders.
 *
 * @remarks
 * The peek popover and the detail dialog show the same event. When each one derived its own kind
 * label, its own time string, and its own read-only wording, the two disagreed in public: the
 * agenda rail called a `provider_event` "Calendar" while the calendar called it "Event", and a
 * conflicted item read "Conflict" on the grid but a bare "Read-only" in the drawer. Both tiers now
 * read these, so a disagreement is a compile error rather than a screenshot someone notices later.
 */
import type {
  CalendarItemKind,
  CalendarItemOut,
  CalendarItemPermission,
} from '@docket/planning/calendar-contract';
import { Calendar, Layers, type LucideIcon, Schedule, TaskAlt } from '@docket/ui/icons';

import { formatScheduleInstantRange } from '@/components/scheduling';
import { formatCalendarDate } from '@/lib/format-date';
import { formatEstimate } from '@/lib/format-estimate';
import { formatClock } from '@/lib/format-time';

const MILLISECONDS_PER_MINUTE = 60_000;

/** The icon glyph for each layered-calendar item kind. */
export const CALENDAR_ITEM_KIND_ICON: Record<CalendarItemKind, LucideIcon> = {
  provider_event: Calendar,
  native_event: Calendar,
  native_block: Layers,
  timebox: Layers,
  task_timebox: TaskAlt,
  availability_block: Schedule,
};

/** The compact kind label shown wherever an item names what sort of time object it is. */
export const CALENDAR_ITEM_KIND_LABEL: Record<CalendarItemKind, string> = {
  provider_event: 'Event',
  native_event: 'Event',
  native_block: 'Block',
  timebox: 'Timebox',
  task_timebox: 'Timebox',
  availability_block: 'Availability',
};

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

/**
 * The item's day, written out — `Sunday, September 6`.
 *
 * @param item - The calendar item to describe.
 * @param displayTimezone - The hub timezone the viewer reads the calendar in.
 * @returns the long-form day, or `null` when the item has no resolvable start.
 */
export function itemDayLabel(item: CalendarItemOut, displayTimezone: string): string | null {
  const start = item.startsAt ?? item.allDayStartDate;
  if (!start) return null;
  // An all-day date is a plain `YYYY-MM-DD` with no zone, so anchoring it at UTC noon keeps it on
  // its own day for every viewer timezone; a timed item already carries an instant.
  const instant = item.startsAt ? new Date(item.startsAt) : new Date(`${start}T12:00:00Z`);
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: item.startsAt ? displayTimezone : 'UTC',
  }).format(instant);
}

/**
 * The item's clock range — `3:52 – 4:56 PM` — or the all-day marker.
 *
 * @param item - The calendar item to describe.
 * @param displayTimezone - The hub timezone the viewer reads the calendar in.
 * @returns the range, or `null` when the item has no time set.
 */
export function itemClockRangeLabel(item: CalendarItemOut, displayTimezone: string): string | null {
  if (!item.startsAt || !item.endsAt) return item.allDayStartDate ? 'All day' : null;
  return (
    formatScheduleInstantRange(item.startsAt, item.endsAt, displayTimezone) ??
    `${formatClock(item.startsAt, displayTimezone)} – ${formatClock(item.endsAt, displayTimezone)}`
  );
}

/**
 * How long the item runs — `1h 4m`.
 *
 * @param item - The calendar item to measure.
 * @returns the duration, or `null` for an all-day item or one with no bounds.
 */
export function itemDurationLabel(item: CalendarItemOut): string | null {
  if (!item.startsAt || !item.endsAt) return null;
  const minutes = (Date.parse(item.endsAt) - Date.parse(item.startsAt)) / MILLISECONDS_PER_MINUTE;
  return formatEstimate(minutes);
}

/** Human labels for {@link CalendarItemPermission.readOnlyReason}. */
export const READ_ONLY_REASON_LABEL: Record<
  NonNullable<CalendarItemPermission['readOnlyReason']>,
  string
> = {
  provider_scope: 'Read-only — editing access was not granted',
  layer_access_role: 'Read-only — your role on this layer cannot edit',
  event_capability: 'Read-only — this event cannot be edited',
  recurrence_unsupported: 'Read-only — recurring event editing is not yet supported',
  // A conflicted item is not merely unwritable, and the scheduling grid has always said so. Saying
  // "Read-only" here too left the drawer unable to explain a state the grid named `Conflict`.
  conflict: 'Conflict — this event changed in the source calendar',
  kind: 'Read-only',
};
