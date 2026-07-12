import {
  calendarConnection,
  calendarList,
  dailyPlanItem,
  db,
  hub,
  task,
  type calendarEvent,
} from '@docket/db';
import type {
  AgendaOut,
  CalendarConnectionOut,
  CalendarEventOut,
  CalendarItemOut,
  CalendarListOut,
  CalendarSettingsOut,
} from '@docket/types';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Context } from 'hono';
import type { z } from 'zod';

import { readCalendarItemsInRange, readCalendarLayers } from '../calendar/calendar-read';
import type { AppEnv } from '../context';
import { AuthError } from '../error';

type CalendarConnectionRow = typeof calendarConnection.$inferSelect;
type CalendarListRow = typeof calendarList.$inferSelect;
type CalendarEventRow = typeof calendarEvent.$inferSelect;

/** Require an active user session for personal calendar routes. */
export function requireUserId(c: Context<AppEnv>): string {
  const session = c.get('session');
  if (!session?.user.id) throw new AuthError('Authentication required.');
  return session.user.id;
}

/** Serialize a linked calendar account and its computed calendar counts. */
export function toCalendarConnectionOut(
  row: CalendarConnectionRow,
  counts: { total: number; enabled: number },
): z.input<typeof CalendarConnectionOut> {
  return {
    id: row.id,
    provider: 'google',
    externalAccountId: row.externalAccountId,
    accountEmail: row.accountEmail,
    accountName: row.accountName,
    accountPictureUrl: row.accountPictureUrl,
    status:
      row.status === 'connected' || row.status === 'error' || row.status === 'disconnected'
        ? row.status
        : 'error',
    calendarsTotal: counts.total,
    calendarsEnabled: counts.enabled,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastError: row.lastError,
    scopeState: row.scopeState ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Serialize one selectable calendar row. */
export function toCalendarListOut(row: CalendarListRow): z.input<typeof CalendarListOut> {
  return {
    id: row.id,
    connectionId: row.connectionId,
    externalCalendarId: row.externalCalendarId,
    title: row.title,
    description: row.description,
    timezone: row.timezone,
    color: row.color,
    accessRole: row.accessRole,
    primary: row.primary,
    selected: row.selected,
    visibleByDefault: row.visibleByDefault,
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastError: row.lastError,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Serialize one cached Google Calendar event. */
export function toCalendarEventOut(row: CalendarEventRow): z.input<typeof CalendarEventOut> {
  return {
    id: row.id,
    connectionId: row.connectionId,
    calendarId: row.calendarId,
    externalCalendarId: row.externalCalendarId,
    externalEventId: row.externalEventId,
    status: row.status,
    title: row.title,
    description: row.description,
    location: row.location,
    htmlLink: row.htmlLink,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    allDayStartDate: row.allDayStartDate,
    allDayEndDate: row.allDayEndDate,
    organizer: row.organizer ?? null,
    attendees: row.attendees,
    updatedExternalAt: row.updatedExternalAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Read all calendar settings for a user with linked-account counts. */
export async function readCalendarSettings(
  userId: string,
): Promise<z.input<typeof CalendarSettingsOut>> {
  const [connections, calendars, layers] = await Promise.all([
    db
      .select()
      .from(calendarConnection)
      .where(eq(calendarConnection.userId, userId))
      .orderBy(asc(calendarConnection.accountEmail), asc(calendarConnection.createdAt)),
    db
      .select()
      .from(calendarList)
      .where(eq(calendarList.userId, userId))
      .orderBy(asc(calendarList.title)),
    readCalendarLayers(db, userId),
  ]);

  const counts = new Map<string, { total: number; enabled: number }>();
  for (const cal of calendars) {
    const current = counts.get(cal.connectionId) ?? { total: 0, enabled: 0 };
    current.total += 1;
    if (cal.selected) current.enabled += 1;
    counts.set(cal.connectionId, current);
  }

  return {
    connections: connections.map((conn) =>
      toCalendarConnectionOut(conn, counts.get(conn.id) ?? { total: 0, enabled: 0 }),
    ),
    calendars: calendars.map(toCalendarListOut),
    layers,
  };
}

/** Build a combined day agenda for one user. */
export async function buildAgendaPayload(
  userId: string,
  options: {
    date: string;
    includeGoogleCalendar?: boolean;
    connectionIds?: readonly string[];
    calendarIds?: readonly string[];
  },
): Promise<z.input<typeof AgendaOut>> {
  const hubRows = await db.select({ id: hub.id }).from(hub).where(eq(hub.userId, userId)).limit(1);
  const planRows = hubRows[0]
    ? await db
        .select({
          taskId: task.id,
          organizationId: task.organizationId,
          title: task.title,
          state: task.state,
          priority: task.priority,
          startsAt: dailyPlanItem.timeboxStartsAt,
          endsAt: dailyPlanItem.timeboxEndsAt,
        })
        .from(dailyPlanItem)
        .innerJoin(task, eq(task.id, dailyPlanItem.refTaskId))
        .where(and(eq(dailyPlanItem.hubId, hubRows[0].id), eq(dailyPlanItem.date, options.date)))
    : [];

  const taskEntries = planRows.flatMap((row) => {
    if (!row.startsAt || !row.endsAt) return [];
    return [
      {
        kind: 'task_timebox' as const,
        taskId: row.taskId,
        organizationId: row.organizationId,
        title: row.title,
        state: row.state,
        priority: row.priority,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
      },
    ];
  });

  const start = new Date(`${options.date}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  let eventEntries: z.input<typeof AgendaOut>['entries'] = [];
  if (options.includeGoogleCalendar !== false) {
    try {
      eventEntries = await buildGoogleCalendarAgendaEntries(userId, start, end, options);
    } catch (error) {
      // Provider enrichment is additive. A stale/malformed synced row must never suppress the
      // user's Docket timeboxes or turn the shell's always-present agenda into a 500 response.
      console.warn('[agenda] calendar enrichment failed; returning Docket timeboxes', {
        userId,
        date: options.date,
        error,
      });
    }
  }

  const entries = [...taskEntries, ...eventEntries].sort((a, b) => {
    const aStart = a.kind === 'task_timebox' ? a.startsAt : (a.event.startsAt ?? '');
    const bStart = b.kind === 'task_timebox' ? b.startsAt : (b.event.startsAt ?? '');
    return aStart.localeCompare(bStart);
  });

  return { date: options.date, entries };
}

/**
 * Build the `'google_calendar_event'` agenda entries for one day window.
 *
 * @remarks
 * Sourced from the layered-calendar read service (`calendar_item` rows of kind
 * `'provider_event'`) rather than the legacy `calendar_event` table directly, then mapped
 * back to the agenda's existing embedded-event shape so the response contract does not
 * change. `calendarIds` maps onto `layerIds` (a layer's id reuses its originating
 * `calendar_list` row's id) and `connectionIds` is applied as a post-filter, since the
 * read service intentionally does not take a connection-id parameter.
 */
async function buildGoogleCalendarAgendaEntries(
  userId: string,
  start: Date,
  end: Date,
  options: { connectionIds?: readonly string[]; calendarIds?: readonly string[] },
): Promise<z.input<typeof AgendaOut>['entries']> {
  const { layers, items } = await readCalendarItemsInRange(db, {
    userId,
    start,
    end,
    layerIds: options.calendarIds,
    kinds: ['provider_event'],
  });

  const filteredItems =
    options.connectionIds !== undefined && options.connectionIds.length > 0
      ? items.filter(
          (item) =>
            item.connectionId !== null && options.connectionIds?.includes(item.connectionId),
        )
      : items;
  if (filteredItems.length === 0) return [];

  const connectionIds = [
    ...new Set(
      filteredItems.map((item) => item.connectionId).filter((id): id is string => id !== null),
    ),
  ];
  const connectionRows =
    connectionIds.length > 0
      ? await db
          .select()
          .from(calendarConnection)
          .where(
            and(
              eq(calendarConnection.userId, userId),
              inArray(calendarConnection.id, connectionIds),
            ),
          )
      : [];
  const connectionById = new Map(connectionRows.map((row) => [row.id, row]));
  const layerById = new Map(layers.map((layer) => [layer.id, layer]));

  return filteredItems.map((item) => {
    const layer = layerById.get(item.layerId);
    if (!layer) {
      throw new Error(
        `agenda: provider_event calendar item ${item.id} references an unselected/unknown layer`,
      );
    }
    const connection =
      item.connectionId !== null ? connectionById.get(item.connectionId) : undefined;
    if (!connection) {
      throw new Error(
        `agenda: provider_event calendar item ${item.id} has no resolvable connection`,
      );
    }
    return {
      kind: 'google_calendar_event' as const,
      event: toLegacyCalendarEventOut(item),
      connection: {
        id: connection.id,
        accountEmail: connection.accountEmail,
        accountName: connection.accountName,
      },
      calendar: {
        id: layer.id,
        title: layer.title,
        color: layer.color,
        timezone: layer.timezone,
      },
    };
  });
}

/**
 * Map a layered-calendar `provider_event` item back to the legacy `CalendarEventOut`
 * shape the agenda response still embeds.
 *
 * @throws {Error} When a required provider-bound field is missing — a `provider_event`
 *   item without a connection/external ids is a data invariant violation, not a case to
 *   silently paper over with a fallback.
 */
function toLegacyCalendarEventOut(
  item: z.input<typeof CalendarItemOut>,
): z.input<typeof CalendarEventOut> {
  if (item.connectionId === null) {
    throw new Error(`calendar item ${item.id} (provider_event) is missing its connectionId`);
  }
  if (item.externalCalendarId === null) {
    throw new Error(`calendar item ${item.id} (provider_event) is missing its externalCalendarId`);
  }
  if (item.externalEventId === null) {
    throw new Error(`calendar item ${item.id} (provider_event) is missing its externalEventId`);
  }
  return {
    id: item.id,
    connectionId: item.connectionId,
    calendarId: item.layerId,
    externalCalendarId: item.externalCalendarId,
    externalEventId: item.externalEventId,
    status: item.status,
    title: item.title,
    description: item.description,
    location: item.location,
    htmlLink: item.htmlLink,
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    allDayStartDate: item.allDayStartDate,
    allDayEndDate: item.allDayEndDate,
    organizer: item.organizer,
    attendees: item.attendees,
    updatedExternalAt: item.updatedExternalAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}
