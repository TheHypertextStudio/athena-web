/**
 * MOVE handler for CalDAV server.
 *
 * MOVE relocates an event to another calendar (or renames within same calendar).
 * Essentially a COPY followed by DELETE of the source.
 * The Destination header specifies where to move the event.
 *
 * Headers:
 * - Destination: Target URL for the move
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
 * Handle MOVE requests.
 *
 * Moves an event to another location (calendar) or renames it.
 */
export async function handleMove(c: Context): Promise<Response> {
  const auth = c.get('davAuth') as DavAuthResult | undefined;
  const path = c.req.path.replace(/^\/dav/, '');

  // MOVE requires authentication
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
    return c.text('Method Not Allowed - Can only MOVE events', 405);
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
    return c.text('Forbidden - Cannot move to another user', 403);
  }

  // Fetch source event and calendar
  const [sourceEvent, sourceCalendar] = await Promise.all([
    db.query.events.findFirst({
      where: and(eq(events.id, sourceEventId), eq(events.calendarId, sourceCalendarId)),
    }),
    db.query.calendars.findFirst({
      where: and(eq(calendars.id, sourceCalendarId), eq(calendars.userId, auth.userId)),
    }),
  ]);

  if (!sourceEvent) {
    return c.text('Not Found - Source event not found', 404);
  }

  if (!sourceCalendar) {
    return c.text('Not Found - Source calendar not found', 404);
  }

  if (sourceCalendar.isReadOnly) {
    return c.text('Forbidden - Source calendar is read-only', 403);
  }

  // Check if moving to same location (rename operation)
  const isSameCalendar = sourceCalendarId === destCalendarId;
  const isSameEvent = sourceEventId === destEventId;

  if (isSameCalendar && isSameEvent) {
    // No-op: source and destination are the same
    return c.body(null, 204);
  }

  // Verify destination calendar exists
  const destCalendar = isSameCalendar
    ? sourceCalendar
    : await db.query.calendars.findFirst({
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
  // Status 204 if overwriting existing, 201 if creating new
  const statusCode: 201 | 204 = existingEvent ? 204 : 201;

  // Use transaction for atomicity
  await db.transaction(async (tx) => {
    // If destination exists, delete it first
    if (existingEvent) {
      await tx.delete(events).where(eq(events.id, destEventId));
    }

    if (isSameCalendar) {
      // Same calendar: just update the event ID (rename)
      // Since we can't change the primary key, we need to create new and delete old
      await tx.insert(events).values({
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
        sequence: sourceEvent.sequence,
        etag: newEtag,
        createdAt: sourceEvent.createdAt,
        updatedAt: now,
      });

      await tx.delete(events).where(eq(events.id, sourceEventId));

      // Update calendar ctag and sync token
      const newSyncToken = sourceCalendar.syncToken + 1;
      await tx
        .update(calendars)
        .set({
          ctag: nanoid(),
          syncToken: newSyncToken,
          updatedAt: now,
        })
        .where(eq(calendars.id, sourceCalendarId));

      // Record changes for sync
      await tx.insert(eventChanges).values([
        {
          id: nanoid(),
          calendarId: sourceCalendarId,
          eventId: sourceEventId,
          changeType: 'deleted',
          syncToken: newSyncToken,
          changedAt: now,
        },
        {
          id: nanoid(),
          calendarId: sourceCalendarId,
          eventId: destEventId,
          changeType: 'created',
          syncToken: newSyncToken,
          changedAt: now,
        },
      ]);
    } else {
      // Different calendars: create at destination, delete from source
      await tx.insert(events).values({
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
        sequence: sourceEvent.sequence,
        etag: newEtag,
        createdAt: sourceEvent.createdAt,
        updatedAt: now,
      });

      await tx.delete(events).where(eq(events.id, sourceEventId));

      // Update source calendar
      const sourceSyncToken = sourceCalendar.syncToken + 1;
      await tx
        .update(calendars)
        .set({
          ctag: nanoid(),
          syncToken: sourceSyncToken,
          updatedAt: now,
        })
        .where(eq(calendars.id, sourceCalendarId));

      // Update destination calendar
      const destSyncToken = destCalendar.syncToken + 1;
      await tx
        .update(calendars)
        .set({
          ctag: nanoid(),
          syncToken: destSyncToken,
          updatedAt: now,
        })
        .where(eq(calendars.id, destCalendarId));

      // Record changes for sync
      await tx.insert(eventChanges).values([
        {
          id: nanoid(),
          calendarId: sourceCalendarId,
          eventId: sourceEventId,
          changeType: 'deleted',
          syncToken: sourceSyncToken,
          changedAt: now,
        },
        {
          id: nanoid(),
          calendarId: destCalendarId,
          eventId: destEventId,
          changeType: 'created',
          syncToken: destSyncToken,
          changedAt: now,
        },
      ]);
    }
  });

  if (statusCode === 201) {
    return c.text('', 201, {
      ETag: `"${newEtag}"`,
      Location: destination,
    });
  } else {
    return c.body(null, 204, {
      ETag: `"${newEtag}"`,
    });
  }
}
