/**
 * MKCALENDAR handler for CalDAV server.
 *
 * MKCALENDAR is the CalDAV method for creating new calendar collections.
 * This allows CalDAV clients to create calendars on the server.
 *
 * Request:
 * - URL: /dav/calendars/{userId}/{newCalendarName}/
 * - Method: MKCALENDAR
 * - Body: Optional XML with initial properties
 *
 * Response:
 * - 201 Created on success
 * - 403 Forbidden if calendar already exists
 * - 405 Method Not Allowed if URL is not a calendar collection location
 *
 * @packageDocumentation
 */

import type { Context } from 'hono';
import { db } from '../../../db/index.js';
import { calendars } from '../../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import type { DavAuthResult } from '../auth.js';
import { nanoid } from 'nanoid';

/**
 * Parse optional MKCALENDAR request body for initial properties.
 */
function parseMkcalendar(xml: string): {
  displayname?: string;
  description?: string;
  color?: string;
  timezone?: string;
} {
  const result: {
    displayname?: string;
    description?: string;
    color?: string;
    timezone?: string;
  } = {};

  if (!xml.trim()) {
    return result;
  }

  // displayname
  const displaynameMatch = /<(?:d:|D:)?displayname[^>]*>([^<]*)<\/(?:d:|D:)?displayname>/i.exec(
    xml,
  );
  if (displaynameMatch?.[1]) {
    result.displayname = decodeXmlEntities(displaynameMatch[1].trim());
  }

  // calendar-description
  const descMatch =
    /<(?:c:|C:)?calendar-description[^>]*>([^<]*)<\/(?:c:|C:)?calendar-description>/i.exec(xml);
  if (descMatch?.[1]) {
    result.description = decodeXmlEntities(descMatch[1].trim());
  }

  // calendar-color (Apple namespace)
  const colorMatch = /<(?:x:|I:)?calendar-color[^>]*>([^<]*)<\/(?:x:|I:)?calendar-color>/i.exec(
    xml,
  );
  if (colorMatch?.[1]) {
    let color = decodeXmlEntities(colorMatch[1].trim());
    // Strip alpha channel if present (e.g., #FF0000FF -> #FF0000)
    if (color.length === 9 && color.startsWith('#')) {
      color = color.slice(0, 7);
    }
    result.color = color;
  }

  // calendar-timezone
  const tzMatch =
    /<(?:c:|C:)?calendar-timezone[^>]*>([\s\S]*?)<\/(?:c:|C:)?calendar-timezone>/i.exec(xml);
  if (tzMatch?.[1]) {
    const tzContent = tzMatch[1].trim();
    // Extract TZID from VTIMEZONE if present
    const tzidMatch = /TZID:([^\r\n]+)/i.exec(tzContent);
    if (tzidMatch?.[1]) {
      result.timezone = tzidMatch[1].trim();
    } else if (!tzContent.includes('VTIMEZONE')) {
      result.timezone = tzContent;
    }
  }

  return result;
}

/**
 * Decode XML entities.
 */
function decodeXmlEntities(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Generate a URL-safe calendar ID from a display name.
 */
function generateCalendarId(displayname: string): string {
  // Create a slug from the name
  const slug = displayname
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

  // Add a short random suffix for uniqueness
  const suffix = nanoid(8);

  return slug ? `${slug}-${suffix}` : suffix;
}

/**
 * Handle MKCALENDAR requests.
 *
 * Creates a new calendar collection.
 */
export async function handleMkcalendar(c: Context): Promise<Response> {
  const auth = c.get('davAuth') as DavAuthResult | undefined;
  const path = c.req.path.replace(/^\/dav/, '');

  // MKCALENDAR requires authentication
  if (!auth) {
    return c.text('Unauthorized', 401, {
      'WWW-Authenticate': 'Basic realm="Athena"',
    });
  }

  // MKCALENDAR must target a calendar collection URL
  // Expected format: /calendars/{userId}/{calendarId}/
  const calendarMatch = /^\/calendars\/([^/]+)\/([^/]+)\/?$/.exec(path);
  if (!calendarMatch) {
    return c.text('Method Not Allowed', 405, {
      Allow: 'OPTIONS, PROPFIND',
    });
  }

  const userId = calendarMatch[1];
  const requestedId = calendarMatch[2];

  if (!userId || !requestedId) {
    return c.text('Bad Request', 400);
  }

  // Verify ownership
  if (userId !== auth.userId) {
    return c.text('Forbidden', 403);
  }

  // Check if a calendar with this ID already exists
  const existing = await db.query.calendars.findFirst({
    where: and(eq(calendars.userId, auth.userId), eq(calendars.id, requestedId)),
  });

  if (existing) {
    // CalDAV requires 405 for existing resources
    return c.text('Calendar already exists', 405);
  }

  // Parse request body for optional properties
  const body = await c.req.text();
  const props = parseMkcalendar(body);

  // Use provided displayname or derive from URL
  const displayname = props.displayname ?? requestedId;

  // Generate a proper ID (we use the requested ID if it looks valid, otherwise generate one)
  const calendarId = /^[a-z0-9-]+$/i.test(requestedId)
    ? requestedId
    : generateCalendarId(displayname);

  // Check if generated ID conflicts
  if (calendarId !== requestedId) {
    const conflict = await db.query.calendars.findFirst({
      where: and(eq(calendars.userId, auth.userId), eq(calendars.id, calendarId)),
    });
    if (conflict) {
      // Very unlikely but handle gracefully
      return c.text('Calendar ID conflict', 500);
    }
  }

  // Check if user has any existing calendars (for isDefault)
  const existingCalendars = await db.query.calendars.findMany({
    where: eq(calendars.userId, auth.userId),
    columns: { id: true },
  });

  const isDefault = existingCalendars.length === 0;

  // Create the calendar
  const now = new Date();
  await db.insert(calendars).values({
    id: calendarId,
    userId: auth.userId,
    name: displayname,
    description: props.description ?? null,
    color: props.color ?? '#4285F4',
    timezone: props.timezone ?? 'UTC',
    ctag: nanoid(),
    syncToken: 0,
    isDefault,
    isReadOnly: false,
    createdAt: now,
    updatedAt: now,
  });

  // Return 201 Created with Location header
  return c.text('', 201, {
    Location: `/dav/calendars/${auth.userId}/${calendarId}/`,
    'Content-Length': '0',
  });
}
