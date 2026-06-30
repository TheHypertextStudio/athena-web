import {
  calendarConnection,
  calendarEvent,
  calendarList,
  dailyPlanItem,
  db,
  hub,
  task,
} from '@docket/db';
import type {
  AgendaOut,
  CalendarConnectionOut,
  CalendarEventOut,
  CalendarListOut,
  CalendarSettingsOut,
} from '@docket/types';
import { and, asc, eq, gte, inArray, isNull, lt } from 'drizzle-orm';
import type { Context } from 'hono';
import type { z } from 'zod';

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
  const [connections, calendars] = await Promise.all([
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
  const filters = [
    eq(calendarEvent.userId, userId),
    isNull(calendarEvent.archivedAt),
    eq(calendarList.selected, true),
    gte(calendarEvent.startsAt, start),
    lt(calendarEvent.startsAt, end),
  ];
  if (options.connectionIds && options.connectionIds.length > 0) {
    filters.push(inArray(calendarEvent.connectionId, [...options.connectionIds]));
  }
  if (options.calendarIds && options.calendarIds.length > 0) {
    filters.push(inArray(calendarEvent.calendarId, [...options.calendarIds]));
  }

  const calendarRows =
    options.includeGoogleCalendar === false
      ? []
      : await db
          .select({ event: calendarEvent, connection: calendarConnection, calendar: calendarList })
          .from(calendarEvent)
          .innerJoin(calendarConnection, eq(calendarConnection.id, calendarEvent.connectionId))
          .innerJoin(calendarList, eq(calendarList.id, calendarEvent.calendarId))
          .where(and(...filters));

  const eventEntries = calendarRows.map((row) => ({
    kind: 'google_calendar_event' as const,
    event: toCalendarEventOut(row.event),
    connection: {
      id: row.connection.id,
      accountEmail: row.connection.accountEmail,
      accountName: row.connection.accountName,
    },
    calendar: {
      id: row.calendar.id,
      title: row.calendar.title,
      color: row.calendar.color,
      timezone: row.calendar.timezone,
    },
  }));

  const entries = [...taskEntries, ...eventEntries].sort((a, b) => {
    const aStart = a.kind === 'task_timebox' ? a.startsAt : (a.event.startsAt ?? '');
    const bStart = b.kind === 'task_timebox' ? b.startsAt : (b.event.startsAt ?? '');
    return aStart.localeCompare(bStart);
  });

  return { date: options.date, entries };
}
