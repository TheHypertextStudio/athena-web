import type { AgendaOut, CalendarItemOut, CalendarItemsRangeOut, HubTodayOut } from '@docket/types';

import { todayISODate } from '@/lib/today';

/** Stable transition name for an agenda entry across arrangements. */
export function agendaEntryTransitionName(entryId: string): string {
  return `agenda-entry-${entryId}`;
}

/** Shift a bare ISO date by whole calendar days. */
export function shiftISODate(iso: string, deltaDays: number): string {
  const day = new Date(`${iso}T00:00:00`);
  day.setDate(day.getDate() + deltaDays);
  return todayISODate(day);
}

/** The projection that produced an agenda entry. */
export type AgendaEntrySource = 'task' | 'google_calendar_event' | 'calendar_item';

/** One planned thing or external event on the agenda. */
export interface AgendaEntry {
  /** Stable key used for rendering and view transitions. */
  id: string;
  /** Projection that produced the entry. */
  source: AgendaEntrySource;
  /** Underlying task id for task entries. */
  taskId?: string;
  /** Organization that owns the task, when applicable. */
  organizationId?: string;
  /** User-visible entry title. */
  title: string;
  /** Exact timebox start instant. */
  startsAt?: string;
  /** Exact timebox end instant. */
  endsAt?: string;
  /** Stable order within the source projection. */
  sort: number;
  /** Whether the daily-plan entry is complete. */
  done: boolean;
  /** Daily-plan item id used by plan mutations. */
  planItemId?: string;
  /** Provider deep link for external events. */
  externalUrl?: string | null;
  /** Calendar/account presentation metadata. */
  calendar?: { title: string; color: string | null; accountEmail: string | null };
  /** Full normalized layered-calendar item used by the shared drawer and cards. */
  calendarItem?: CalendarItemOut;
  /** Owning layer color for layered-calendar entries. */
  layerColor?: string | null;
}

/** An agenda entry with exact start and end instants. */
export type TimeboxedEntry = AgendaEntry & { startsAt: string; endsAt: string };

/** Narrow an entry to one with exact start and end instants. */
export function isTimeboxed(entry: AgendaEntry): entry is TimeboxedEntry {
  return entry.startsAt != null && entry.endsAt != null;
}

/**
 * Normalize a Hub today or agenda projection into shared entries.
 *
 * @remarks
 * Plan tasks retain plan order and attach matching timeboxes. Orphan timeboxes are appended so a
 * scheduled block is never silently omitted from the timeline.
 */
export function toAgendaEntries(data: HubTodayOut | AgendaOut | null): AgendaEntry[] {
  if (!data) return [];
  if ('entries' in data) {
    return data.entries.map((entry, i) =>
      entry.kind === 'task_timebox'
        ? {
            id: entry.taskId,
            source: 'task',
            taskId: entry.taskId,
            organizationId: entry.organizationId,
            title: entry.title,
            startsAt: entry.startsAt,
            endsAt: entry.endsAt,
            sort: i,
            done: false,
          }
        : {
            id: entry.event.id,
            source: 'google_calendar_event',
            title: entry.event.title,
            startsAt: entry.event.startsAt ?? undefined,
            endsAt: entry.event.endsAt ?? undefined,
            sort: i,
            done: false,
            externalUrl: entry.event.htmlLink,
            calendar: {
              title: entry.calendar.title,
              color: entry.calendar.color,
              accountEmail: entry.connection.accountEmail,
            },
          },
    );
  }
  const box = new Map(data.calendar.map((block) => [block.taskId, block]));
  const planned: AgendaEntry[] = data.plan.map((task, i) => {
    const block = box.get(task.id);
    return {
      id: task.id,
      source: 'task',
      taskId: task.id,
      organizationId: task.organizationId,
      title: task.title,
      startsAt: block?.startsAt,
      endsAt: block?.endsAt,
      sort: i,
      done: false,
    };
  });
  const planIds = new Set(data.plan.map((task) => task.id));
  return [
    ...planned,
    ...data.calendar
      .filter((block) => !planIds.has(block.taskId))
      .map((block, i) => ({
        id: block.taskId,
        source: 'task' as const,
        taskId: block.taskId,
        organizationId: block.organizationId,
        title: 'Timeboxed work',
        startsAt: block.startsAt,
        endsAt: block.endsAt,
        sort: planned.length + i,
        done: false,
      })),
  ];
}

/**
 * Normalize one layered calendar item into a provider-neutral entry.
 *
 * @remarks
 * The full item remains attached so cards and the workspace drawer retain permissions, provider
 * state, relationships, and item kind without another source-specific adapter.
 */
export function toAgendaEntryFromCalendarItem(
  item: CalendarItemOut,
  sort: number,
  layerColor?: string | null,
): AgendaEntry {
  return {
    id: item.id,
    source: 'calendar_item',
    title: item.title,
    startsAt: item.startsAt ?? undefined,
    endsAt: item.endsAt ?? undefined,
    sort,
    done: false,
    externalUrl: item.htmlLink,
    calendarItem: item,
    layerColor: layerColor ?? null,
  };
}

/** Normalize a layered calendar range into agenda entries while resolving owning-layer colors. */
export function calendarItemsToAgendaEntries(range: CalendarItemsRangeOut): AgendaEntry[] {
  const colorByLayer = new Map(range.layers.map((layer) => [layer.id, layer.color]));
  return range.items.map((item, i) =>
    toAgendaEntryFromCalendarItem(item, i, colorByLayer.get(item.layerId)),
  );
}

/** Supported agenda arrangements. */
export type AgendaView = 'list' | 'timeline';
