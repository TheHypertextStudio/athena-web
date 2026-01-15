/**
 * COPY handler for CalDAV server.
 *
 * COPY creates a duplicate of an event in another calendar (or same calendar).
 * The Destination header specifies where to copy the event.
 *
 * Headers:
 * - Destination: Target URL for the copy
 * - Overwrite: 'T' (default) or 'F' - whether to overwrite existing resource
 *
 * @packageDocumentation
 */

import type { Context } from 'hono';
import { db } from '../../../db/index.js';
import { calendars, events, eventChanges } from '../../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import type { DavAuthResult } from '../auth.js';
import { nanoid } from 'nanoid';

/**
 * Handle COPY requests.
 *
 * Copies an event to another location (calendar).
 */
export async function handleCopy(c: Context): Promise<Response> {
  const auth = c.get('davAuth') as DavAuthResult | undefined;
  const path = c.req.path.replace(/^\/dav/, '');

  // COPY requires authentication
  if (!auth) {
    return c.text('Unauthorized', 401, {
      'WWW-Authenticate': 'Basic realm="Athena"',
    });
  }

  // Get Destination header
  const destination = c.req.header('Destination');
  if (!destination) {
    return c.text('Bad Request - Destination header required', 400);
  }

  // Get Overwrite header (default: T)
  const overwrite = c.req.header('Overwrite') !== 'F';

  // Source: /calendars/{userId}/{calendarId}/{eventId}.ics
  const sourceMatch = /^\/calendars\/([^/]+)\/([^/]+)\/([^/]+)\.ics$/.exec(path);
  if (!sourceMatch) {
    return c.text('Method Not Allowed - Can only COPY events', 405);
  }

  const [, sourceUserId, sourceCalendarId, sourceEventId] = sourceMatch;

  if (!sourceUserId || !sourceCalendarId || !sourceEventId) {
    return c.text('Not Found', 404);
  }

  // Verify source ownership
  if (sourceUserId !== auth.userId) {
    return c.text('Forbidden', 403);
  }

  // Parse destination URL
  const destUrl = new URL(destination);
  const destPath = destUrl.pathname.replace(/^\/dav/, '');
  const destMatch = /^\/calendars\/([^/]+)\/([^/]+)\/([^/]+)\.ics$/.exec(destPath);

  if (!destMatch) {
    return c.text('Bad Request - Invalid destination path', 400);
  }

  const [, destUserId, destCalendarId, destEventId] = destMatch;

  if (!destUserId || !destCalendarId || !destEventId) {
    return c.text('Bad Request - Invalid destination', 400);
  }

  // Verify destination ownership
  if (destUserId !== auth.userId) {
    return c.text('Forbidden - Cannot copy to another user', 403);
  }

  // Fetch source event
  const sourceEvent = await db.query.events.findFirst({
    where: and(eq(events.id, sourceEventId), eq(events.calendarId, sourceCalendarId)),
  });

  if (!sourceEvent) {
    return c.text('Not Found - Source event not found', 404);
  }

  // Verify destination calendar exists
  const destCalendar = await db.query.calendars.findFirst({
    where: and(eq(calendars.id, destCalendarId), eq(calendars.userId, auth.userId)),
  });

  if (!destCalendar) {
    return c.text('Conflict - Destination calendar not found', 409);
  }

  if (destCalendar.isReadOnly) {
    return c.text('Forbidden - Destination calendar is read-only', 403);
  }

  // Check if destination event already exists
  const existingEvent = await db.query.events.findFirst({
    where: and(eq(events.id, destEventId), eq(events.calendarId, destCalendarId)),
  });

  if (existingEvent && !overwrite) {
    return c.text('Precondition Failed - Destination exists and Overwrite is F', 412);
  }

  const now = new Date();
  const newEtag = nanoid();

  if (existingEvent) {
    // Overwrite existing event
    await db
      .update(events)
      .set({
        title: sourceEvent.title,
        description: sourceEvent.description,
        startTime: sourceEvent.startTime,
        endTime: sourceEvent.endTime,
        isAllDay: sourceEvent.isAllDay,
        location: sourceEvent.location,
        recurrenceRule: sourceEvent.recurrenceRule,
        calendarStatus: sourceEvent.calendarStatus,
        transparency: sourceEvent.transparency,
        classification: sourceEvent.classification,
        etag: newEtag,
        updatedAt: now,
      })
      .where(eq(events.id, destEventId));

    // Update calendar ctag and sync token
    const newSyncToken = destCalendar.syncToken + 1;
    await db
      .update(calendars)
      .set({
        ctag: nanoid(),
        syncToken: newSyncToken,
        updatedAt: now,
      })
      .where(eq(calendars.id, destCalendarId));

    // Record change for sync
    await db.insert(eventChanges).values({
      id: nanoid(),
      calendarId: destCalendarId,
      eventId: destEventId,
      changeType: 'updated',
      syncToken: newSyncToken,
      changedAt: now,
    });

    return c.body(null, 204, {
      ETag: `"${newEtag}"`,
    });
  } else {
    // Create new event at destination
    await db.insert(events).values({
      id: destEventId,
      calendarId: destCalendarId,
      creatorId: auth.userId,
      title: sourceEvent.title,
      description: sourceEvent.description,
      startTime: sourceEvent.startTime,
      endTime: sourceEvent.endTime,
      isAllDay: sourceEvent.isAllDay,
      location: sourceEvent.location,
      recurrenceRule: sourceEvent.recurrenceRule,
      calendarStatus: sourceEvent.calendarStatus,
      transparency: sourceEvent.transparency,
      classification: sourceEvent.classification,
      sequence: 0,
      etag: newEtag,
      createdAt: now,
      updatedAt: now,
    });

    // Update calendar ctag and sync token
    const newSyncToken = destCalendar.syncToken + 1;
    await db
      .update(calendars)
      .set({
        ctag: nanoid(),
        syncToken: newSyncToken,
        updatedAt: now,
      })
      .where(eq(calendars.id, destCalendarId));

    // Record change for sync
    await db.insert(eventChanges).values({
      id: nanoid(),
      calendarId: destCalendarId,
      eventId: destEventId,
      changeType: 'created',
      syncToken: newSyncToken,
      changedAt: now,
    });

    return c.text('', 201, {
      ETag: `"${newEtag}"`,
      Location: destination,
    });
  }
}
