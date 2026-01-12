/**
 * PUT handler for CalDAV server.
 *
 * Creates or updates calendar events from iCalendar (.ics) files.
 * Supports ETag-based conflict detection via If-Match/If-None-Match headers.
 *
 * @packageDocumentation
 */

import type { Context } from 'hono';
import * as crypto from 'node:crypto';
import { db } from '../../../db/index.js';
import { calendars, events, eventChanges } from '../../../db/schema/index.js';
import { eq, sql } from 'drizzle-orm';
import { parseICS } from '../utils/ics.js';
import type { DavAuthResult } from '../auth.js';

/**
 * Handle PUT requests to create/update event resources.
 */
export async function handlePut(c: Context): Promise<Response> {
  const auth = c.get('davAuth') as DavAuthResult;
  const path = c.req.path.replace(/^\/dav/, '');

  // Event resource: /calendars/{userId}/{calendarId}/{eventId}.ics
  const eventMatch = /^\/calendars\/([^/]+)\/([^/]+)\/([^/]+)\.ics$/.exec(path);
  if (!eventMatch) {
    return c.text('Bad Request', 400);
  }

  const [, userId, calendarId, eventId] = eventMatch;

  if (!userId || !calendarId || !eventId) {
    return c.text('Bad Request', 400);
  }

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

  // Parse iCalendar content
  const icsContent = await c.req.text();
  let parsedEvent;
  try {
    parsedEvent = parseICS(icsContent);
  } catch {
    return c.text('Bad Request - invalid iCalendar data', 400);
  }

  // Get conflict detection headers
  const ifMatch = c.req.header('if-match')?.replace(/"/g, '');
  const ifNoneMatch = c.req.header('if-none-match');

  // Check if event exists
  const existing = await db.query.events.findFirst({
    where: eq(events.id, eventId),
  });

  const newEtag = crypto.randomUUID();
  const nextSyncToken = calendar.syncToken + 1;

  if (existing) {
    // UPDATE existing event
    if (ifNoneMatch === '*') {
      // Client expects to create, but event exists
      return c.text('Precondition Failed', 412);
    }

    if (ifMatch && existing.etag !== ifMatch) {
      // ETag mismatch - concurrent modification
      return c.text('Precondition Failed', 412);
    }

    // Verify event belongs to the specified calendar
    if (existing.calendarId !== calendarId) {
      return c.text('Conflict - event belongs to different calendar', 409);
    }

    // Update event in transaction
    await db.transaction(async (tx) => {
      await tx
        .update(events)
        .set({
          title: parsedEvent.summary,
          description: parsedEvent.description ?? null,
          startTime: parsedEvent.dtstart,
          endTime: parsedEvent.dtend ?? null,
          isAllDay: parsedEvent.isAllDay,
          location: parsedEvent.location ?? null,
          recurrenceRule: parsedEvent.rrule ?? null,
          calendarStatus: parsedEvent.status ?? 'CONFIRMED',
          transparency: parsedEvent.transp ?? 'OPAQUE',
          classification: parsedEvent.class ?? 'PUBLIC',
          etag: newEtag,
          sequence: sql`${events.sequence} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(events.id, eventId));

      // Update calendar ctag and sync token
      await tx
        .update(calendars)
        .set({
          ctag: crypto.randomUUID(),
          syncToken: sql`${calendars.syncToken} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(calendars.id, calendarId));

      // Record change for sync-collection
      await tx.insert(eventChanges).values({
        id: crypto.randomUUID(),
        calendarId,
        eventId,
        changeType: 'updated',
        syncToken: nextSyncToken,
      });
    });

    return c.body(null, 204, {
      ETag: `"${newEtag}"`,
    });
  } else {
    // CREATE new event
    if (ifMatch) {
      // Client expects to update, but event doesn't exist
      return c.text('Precondition Failed', 412);
    }

    // Create event in transaction
    await db.transaction(async (tx) => {
      await tx.insert(events).values({
        id: eventId,
        creatorId: auth.userId,
        calendarId,
        title: parsedEvent.summary,
        description: parsedEvent.description ?? null,
        startTime: parsedEvent.dtstart,
        endTime: parsedEvent.dtend ?? null,
        isAllDay: parsedEvent.isAllDay,
        location: parsedEvent.location ?? null,
        recurrenceRule: parsedEvent.rrule ?? null,
        calendarStatus: parsedEvent.status ?? 'CONFIRMED',
        transparency: parsedEvent.transp ?? 'OPAQUE',
        classification: parsedEvent.class ?? 'PUBLIC',
        etag: newEtag,
        sequence: 0,
      });

      // Update calendar ctag and sync token
      await tx
        .update(calendars)
        .set({
          ctag: crypto.randomUUID(),
          syncToken: sql`${calendars.syncToken} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(calendars.id, calendarId));

      // Record change for sync-collection
      await tx.insert(eventChanges).values({
        id: crypto.randomUUID(),
        calendarId,
        eventId,
        changeType: 'created',
        syncToken: nextSyncToken,
      });
    });

    return c.text('', 201, {
      ETag: `"${newEtag}"`,
      Location: `/dav/calendars/${userId}/${calendarId}/${eventId}.ics`,
    });
  }
}
