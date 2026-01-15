/**
 * PROPPATCH handler for CalDAV server.
 *
 * PROPPATCH is the WebDAV method for modifying resource properties.
 * CalDAV clients use this to change calendar settings like name, color,
 * description, and timezone.
 *
 * Supported properties:
 * - d:displayname - Calendar name
 * - c:calendar-description - Calendar description
 * - x:calendar-color (Apple) - Calendar color (hex)
 * - c:calendar-timezone - Calendar timezone (IANA identifier)
 *
 * @packageDocumentation
 */

import type { Context } from 'hono';
import { db } from '../../../db/index.js';
import { calendars } from '../../../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { buildMultistatus, type MultistatusItem, type Propstat } from '../utils/xml.js';
import type { DavAuthResult } from '../auth.js';
import { nanoid } from 'nanoid';

/**
 * Properties that can be modified via PROPPATCH.
 */
interface PropertyUpdate {
  displayname?: string;
  calendarDescription?: string;
  calendarColor?: string;
  calendarTimezone?: string;
}

/**
 * Parse PROPPATCH request body.
 *
 * Extracts set and remove operations from the XML.
 */
function parsePropPatch(xml: string): {
  set: PropertyUpdate;
  remove: string[];
} {
  const set: PropertyUpdate = {};
  const remove: string[] = [];

  // Parse <d:set> operations
  const setMatch = /<(?:d:|D:)?set[^>]*>([\s\S]*?)<\/(?:d:|D:)?set>/i.exec(xml);
  if (setMatch?.[1]) {
    const setContent = setMatch[1];

    // displayname
    const displaynameMatch = /<(?:d:|D:)?displayname[^>]*>([^<]*)<\/(?:d:|D:)?displayname>/i.exec(
      setContent,
    );
    if (displaynameMatch?.[1]) {
      set.displayname = decodeXmlEntities(displaynameMatch[1].trim());
    }

    // calendar-description
    const descMatch =
      /<(?:c:|C:)?calendar-description[^>]*>([^<]*)<\/(?:c:|C:)?calendar-description>/i.exec(
        setContent,
      );
    if (descMatch?.[1]) {
      set.calendarDescription = decodeXmlEntities(descMatch[1].trim());
    }

    // calendar-color (Apple namespace or generic)
    const colorMatch = /<(?:x:|I:)?calendar-color[^>]*>([^<]*)<\/(?:x:|I:)?calendar-color>/i.exec(
      setContent,
    );
    if (colorMatch?.[1]) {
      // Normalize color - some clients send with alpha channel (e.g., #FF0000FF)
      let color = decodeXmlEntities(colorMatch[1].trim());
      if (color.length === 9 && color.startsWith('#')) {
        // Strip alpha channel
        color = color.slice(0, 7);
      }
      set.calendarColor = color;
    }

    // calendar-timezone
    const tzMatch =
      /<(?:c:|C:)?calendar-timezone[^>]*>([\s\S]*?)<\/(?:c:|C:)?calendar-timezone>/i.exec(
        setContent,
      );
    if (tzMatch?.[1]) {
      // The timezone value might be a VTIMEZONE component or just a name
      const tzContent = tzMatch[1].trim();
      // Extract TZID from VTIMEZONE if present
      const tzidMatch = /TZID:([^\r\n]+)/i.exec(tzContent);
      if (tzidMatch?.[1]) {
        set.calendarTimezone = tzidMatch[1].trim();
      } else if (!tzContent.includes('VTIMEZONE')) {
        // Assume it's a timezone name directly
        set.calendarTimezone = tzContent;
      }
    }
  }

  // Parse <d:remove> operations
  const removeMatch = /<(?:d:|D:)?remove[^>]*>([\s\S]*?)<\/(?:d:|D:)?remove>/i.exec(xml);
  if (removeMatch?.[1]) {
    const removeContent = removeMatch[1];

    if (/<(?:c:|C:)?calendar-description/i.test(removeContent)) {
      remove.push('calendar-description');
    }
    if (/<(?:x:|I:)?calendar-color/i.test(removeContent)) {
      remove.push('calendar-color');
    }
    if (/<(?:c:|C:)?calendar-timezone/i.test(removeContent)) {
      remove.push('calendar-timezone');
    }
  }

  return { set, remove };
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
 * Handle PROPPATCH requests.
 *
 * Modifies calendar properties. Only calendar collections support PROPPATCH.
 */
export async function handleProppatch(c: Context): Promise<Response> {
  const auth = c.get('davAuth') as DavAuthResult | undefined;
  const path = c.req.path.replace(/^\/dav/, '');

  // PROPPATCH requires authentication
  if (!auth) {
    return c.text('Unauthorized', 401, {
      'WWW-Authenticate': 'Basic realm="Athena"',
    });
  }

  // Only calendar collections support PROPPATCH
  const calendarMatch = /^\/calendars\/([^/]+)\/([^/]+)\/?$/.exec(path);
  if (!calendarMatch) {
    return c.text('Method Not Allowed', 405, {
      Allow: 'OPTIONS, PROPFIND, GET, PUT, DELETE, REPORT',
    });
  }

  const userId = calendarMatch[1];
  const calendarId = calendarMatch[2];

  if (!userId || !calendarId) {
    return c.text('Not Found', 404);
  }

  // Verify ownership
  if (userId !== auth.userId) {
    return c.text('Forbidden', 403);
  }

  // Fetch calendar
  const calendar = await db.query.calendars.findFirst({
    where: eq(calendars.id, calendarId),
  });

  if (calendar?.userId !== auth.userId) {
    return c.text('Not Found', 404);
  }

  // Don't allow modifications to read-only calendars
  if (calendar.isReadOnly) {
    return c.text('Forbidden - Calendar is read-only', 403);
  }

  // Parse request body
  const body = await c.req.text();
  const { set, remove } = parsePropPatch(body);

  // Build database update
  const updates: Partial<typeof calendars.$inferInsert> = {};
  const successProps: string[] = [];
  const failedProps: { name: string; reason: string }[] = [];

  // Process set operations
  if (set.displayname !== undefined) {
    if (set.displayname.trim() === '') {
      failedProps.push({ name: 'd:displayname', reason: 'Cannot be empty' });
    } else {
      updates.name = set.displayname;
      successProps.push('d:displayname');
    }
  }

  if (set.calendarDescription !== undefined) {
    updates.description = set.calendarDescription;
    successProps.push('c:calendar-description');
  }

  if (set.calendarColor !== undefined) {
    // Validate color format
    if (/^#[0-9A-Fa-f]{6}$/.test(set.calendarColor)) {
      updates.color = set.calendarColor;
      successProps.push('x:calendar-color');
    } else {
      failedProps.push({ name: 'x:calendar-color', reason: 'Invalid color format' });
    }
  }

  if (set.calendarTimezone !== undefined) {
    updates.timezone = set.calendarTimezone;
    successProps.push('c:calendar-timezone');
  }

  // Process remove operations
  if (remove.includes('calendar-description')) {
    updates.description = null;
    successProps.push('c:calendar-description');
  }

  if (remove.includes('calendar-color')) {
    updates.color = '#4285F4'; // Reset to default
    successProps.push('x:calendar-color');
  }

  if (remove.includes('calendar-timezone')) {
    updates.timezone = 'UTC'; // Reset to default
    successProps.push('c:calendar-timezone');
  }

  // Apply updates if any
  if (Object.keys(updates).length > 0) {
    updates.updatedAt = new Date();
    updates.ctag = nanoid(); // Update ctag on property change

    await db.update(calendars).set(updates).where(eq(calendars.id, calendarId));
  }

  // Build response - start with propstat arrays we'll populate
  const successPropstat: Propstat[] = [];
  const failedPropstats: Propstat[] = [];

  // Add successful properties
  if (successProps.length > 0) {
    const successProp: Record<string, string> = {};
    for (const prop of successProps) {
      successProp[prop] = '';
    }
    successPropstat.push({
      status: 'HTTP/1.1 200 OK',
      prop: successProp,
    });
  }

  // Add failed properties
  for (const failed of failedProps) {
    failedPropstats.push({
      status: 'HTTP/1.1 403 Forbidden',
      prop: {
        [failed.name]: '',
        'd:error-description': failed.reason,
      },
    });
  }

  const responses: MultistatusItem[] = [
    {
      href: `/dav/calendars/${auth.userId}/${calendarId}/`,
      propstat: [...successPropstat, ...failedPropstats],
    },
  ];

  return c.body(buildMultistatus(responses), 207, {
    'Content-Type': 'application/xml; charset=utf-8',
  });
}
