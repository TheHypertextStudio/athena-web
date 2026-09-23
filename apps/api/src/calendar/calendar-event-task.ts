/**
 * `@docket/api` — the attachment a task created from a synced calendar event carries.
 *
 * @remarks
 * `POST /v1/me/calendar/events/:id/create-task` creates a native task and attaches the event to it
 * as context. The attachment row is built here so the route stays a sequence of steps.
 */
import type { attachment, calendarConnection, calendarEvent, calendarList } from '@docket/db';

import type { OwnedCreatedRow } from '../lib/provenance/record-created';

/** The cached event a task is being created from, with its calendar and account. */
export interface CalendarEventSource {
  readonly event: typeof calendarEvent.$inferSelect;
  readonly calendar: typeof calendarList.$inferSelect;
  readonly connection: typeof calendarConnection.$inferSelect;
}

/**
 * The attachment that carries a calendar event onto the task created from it.
 *
 * @param source - The cached event, its calendar, and its account.
 * @param created - The new task.
 * @returns the attachment row to insert.
 */
export function calendarEventAttachment(
  source: CalendarEventSource,
  created: OwnedCreatedRow,
): typeof attachment.$inferInsert {
  const { event, calendar, connection } = source;
  return {
    organizationId: created.organizationId,
    createdBy: created.createdBy,
    subjectType: 'task',
    subjectId: created.id,
    kind: 'calendar_event',
    title: event.title,
    externalId: event.externalEventId,
    url: event.htmlLink,
    metadata: {
      connectionId: connection.id,
      calendarId: calendar.id,
      externalCalendarId: event.externalCalendarId,
      startsAt: event.startsAt?.toISOString() ?? null,
      endsAt: event.endsAt?.toISOString() ?? null,
      accountEmail: connection.accountEmail,
      calendarTitle: calendar.title,
    },
  };
}
