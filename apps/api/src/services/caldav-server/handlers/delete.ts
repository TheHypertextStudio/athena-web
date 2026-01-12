/**
 * DELETE handler for CalDAV server.
 *
 * Deletes calendar events.
 *
 * @packageDocumentation
 */

import type { Context } from 'hono';
import * as crypto from 'node:crypto';
import { db } from '../../../db/index.js';
import { calendars, events, eventChanges } from '../../../db/schema/index.js';
import { eq, sql } from 'drizzle-orm';
import type { DavAuthResult } from '../auth.js';

/**
 * Handle DELETE requests for event resources.
 */
export async function handleDelete(c: Context): Promise<Response> {
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

  // Verify calendar exists and user owns it
  const calendar = await db.query.calendars.findFirst({
    where: eq(calendars.id, calendarId),
  });

  if (!calendar) {
    return c.text('Not Found', 404);
  }

  if (calendar.userId !== auth.userId) {
    return c.text('Not Found', 404);
  }

  if (calendar.isReadOnly) {
    return c.text('Forbidden - calendar is read-only', 403);
  }

  // Get event
  const event = await db.query.events.findFirst({
    where: eq(events.id, eventId),
  });

  if (event?.calendarId !== calendarId) {
    // Return 204 even if not found (idempotent delete)
    return c.body(null, 204);
  }

  // Check If-Match header for ETag validation
  const ifMatch = c.req.header('if-match')?.replace(/"/g, '');
  if (ifMatch && event.etag !== ifMatch) {
    return c.text('Precondition Failed', 412);
  }

  // Delete event in transaction
  const nextSyncToken = calendar.syncToken + 1;

  await db.transaction(async (tx) => {
    await tx.delete(events).where(eq(events.id, eventId));

    // Update calendar ctag and sync token
    await tx
      .update(calendars)
      .set({
        ctag: crypto.randomUUID(),
        syncToken: sql`${calendars.syncToken} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(calendars.id, calendarId));

    // Record change for sync-collection (deleted events tracked by ID)
    await tx.insert(eventChanges).values({
      id: crypto.randomUUID(),
      calendarId,
      eventId,
      changeType: 'deleted',
      syncToken: nextSyncToken,
    });
  });

  return c.body(null, 204);
}
