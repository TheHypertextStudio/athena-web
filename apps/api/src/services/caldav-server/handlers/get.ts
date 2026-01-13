/**
 * GET handler for CalDAV server.
 *
 * Returns calendar events as iCalendar (.ics) files.
 *
 * @packageDocumentation
 */

import type { Context } from 'hono';
import { db } from '../../../db/index.js';
import { calendars, events } from '../../../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { generateICS, type ICSEvent } from '../utils/ics.js';
import type { DavAuthResult } from '../auth.js';

/**
 * Handle GET requests for event resources.
 */
export async function handleGet(c: Context): Promise<Response> {
  const auth = c.get('davAuth') as DavAuthResult;
  const path = c.req.path.replace(/^\/dav/, '');

  // Event resource: /calendars/{userId}/{calendarId}/{eventId}.ics
  const eventMatch = /^\/calendars\/([^/]+)\/([^/]+)\/([^/]+)\.ics$/.exec(path);
  if (!eventMatch) {
    return c.text('Not Found', 404);
  }

  const [, pathUserId, pathCalendarId, pathEventId] = eventMatch;

  // These are guaranteed to exist if the regex matched
  if (!pathUserId || !pathCalendarId || !pathEventId) {
    return c.text('Not Found', 404);
  }

  const userId = pathUserId;
  const calendarId = pathCalendarId;
  const eventId = pathEventId;

  if (userId !== auth.userId) {
    return c.text('Forbidden', 403);
  }

  // Fetch event and calendar in parallel for better performance
  const [event, calendar] = await Promise.all([
    db.query.events.findFirst({
      where: eq(events.id, eventId),
    }),
    db.query.calendars.findFirst({
      where: eq(calendars.id, calendarId),
    }),
  ]);

  // Verify event belongs to the specified calendar
  if (event?.calendarId !== calendarId) {
    return c.text('Not Found', 404);
  }

  // Verify calendar ownership
  if (calendar?.userId !== auth.userId) {
    return c.text('Forbidden', 403);
  }

  // Convert to iCalendar format
  const icsEvent: ICSEvent = {
    uid: event.id,
    summary: event.title,
    description: event.description ?? undefined,
    dtstart: event.startTime,
    dtend: event.endTime ?? undefined,
    isAllDay: event.isAllDay,
    location: event.location ?? undefined,
    rrule: event.recurrenceRule ?? undefined,
    status: mapStatus(event.calendarStatus),
    transp: mapTransparency(event.transparency),
    class: mapClassification(event.classification),
    sequence: event.sequence,
  };

  const icsContent = generateICS(icsEvent);
  const etag = event.etag ?? event.id;

  return c.body(icsContent, 200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    ETag: `"${etag}"`,
  });
}

function mapStatus(status: string | null): ICSEvent['status'] {
  switch (status?.toUpperCase()) {
    case 'TENTATIVE':
      return 'TENTATIVE';
    case 'CANCELLED':
      return 'CANCELLED';
    default:
      return 'CONFIRMED';
  }
}

function mapTransparency(transp: string | null): ICSEvent['transp'] {
  return transp?.toUpperCase() === 'TRANSPARENT' ? 'TRANSPARENT' : 'OPAQUE';
}

function mapClassification(cls: string | null): ICSEvent['class'] {
  switch (cls?.toUpperCase()) {
    case 'PRIVATE':
      return 'PRIVATE';
    case 'CONFIDENTIAL':
      return 'CONFIDENTIAL';
    default:
      return 'PUBLIC';
  }
}
