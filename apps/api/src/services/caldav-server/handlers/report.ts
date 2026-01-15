/**
 * REPORT handler for CalDAV server.
 *
 * Implements CalDAV REPORT operations:
 * - calendar-query: Time-range filtering with VEVENT component filtering
 * - calendar-multiget: Batch fetch specific events by href
 * - sync-collection: Incremental sync using sync tokens
 *
 * @packageDocumentation
 */

import type { Context } from 'hono';
import { db } from '../../../db/index.js';
import { calendars, events, eventChanges } from '../../../db/schema/index.js';
import { eq, and, gte, lte, gt, inArray } from 'drizzle-orm';
import { generateICS, type ICSEvent } from '../utils/ics.js';
import {
  buildMultistatus,
  buildError,
  detectReportType,
  parseCalendarQuery,
  parseCalendarMultiget,
  parseSyncCollection,
  type MultistatusItem,
} from '../utils/xml.js';
import type { DavAuthResult } from '../auth.js';

const SYNC_TOKEN_PREFIX = 'http://athena.app/ns/sync/';

/**
 * Handle REPORT requests for calendar queries and sync.
 */
export async function handleReport(c: Context): Promise<Response> {
  const auth = c.get('davAuth') as DavAuthResult | undefined;
  const path = c.req.path.replace(/^\/dav/, '');

  // REPORT requires authentication
  if (!auth) {
    return c.text('Unauthorized', 401, {
      'WWW-Authenticate': 'Basic realm="Athena CalDAV"',
    });
  }

  // Calendar collection: /calendars/{userId}/{calendarId}/
  const calendarMatch = /^\/calendars\/([^/]+)\/([^/]+)\/?$/.exec(path);
  if (!calendarMatch) {
    return c.text('Not Found', 404);
  }

  const [, pathUserId, pathCalendarId] = calendarMatch;
  if (!pathUserId || !pathCalendarId) {
    return c.text('Not Found', 404);
  }

  // Verify ownership
  if (pathUserId !== auth.userId) {
    return c.text('Forbidden', 403);
  }

  // Verify calendar exists and belongs to user
  const calendar = await db.query.calendars.findFirst({
    where: and(eq(calendars.id, pathCalendarId), eq(calendars.userId, auth.userId)),
  });

  if (!calendar) {
    return c.text('Not Found', 404);
  }

  // Parse request body
  const body = await c.req.text();
  const reportType = detectReportType(body);

  switch (reportType) {
    case 'calendar-query':
      return handleCalendarQuery(c, calendar, body, path);
    case 'calendar-multiget':
      return handleCalendarMultiget(c, calendar, body, path);
    case 'sync-collection':
      return handleSyncCollection(c, calendar, body, path);
    default:
      return c.body(buildError('d:supported-report', 'Unsupported report type'), 400, {
        'Content-Type': 'application/xml; charset=utf-8',
      });
  }
}

/**
 * Handle calendar-query REPORT.
 * Returns events matching the specified filter criteria.
 */
async function handleCalendarQuery(
  c: Context,
  calendar: { id: string; userId: string },
  body: string,
  basePath: string,
): Promise<Response> {
  const { timeRange } = parseCalendarQuery(body);

  // Build query conditions
  const conditions = [eq(events.calendarId, calendar.id)];

  if (timeRange?.start) {
    conditions.push(gte(events.startTime, timeRange.start));
  }
  if (timeRange?.end) {
    // For time-range queries, include events that start before end
    // or events that haven't ended yet
    conditions.push(lte(events.startTime, timeRange.end));
  }

  // Fetch matching events
  const matchingEvents = await db.query.events.findMany({
    where: and(...conditions),
  });

  // Build multistatus response
  const responses: MultistatusItem[] = matchingEvents.map((event) => {
    const href = `${basePath}${event.id}.ics`;
    const icsEvent = eventToICS(event);
    const icsContent = generateICS(icsEvent);
    const etag = event.etag ?? event.id;

    return {
      href,
      propstat: [
        {
          status: 'HTTP/1.1 200 OK',
          prop: {
            'd:getetag': `"${etag}"`,
            'c:calendar-data': icsContent,
          },
        },
      ],
    };
  });

  return c.body(buildMultistatus(responses), 207, {
    'Content-Type': 'application/xml; charset=utf-8',
  });
}

/**
 * Handle calendar-multiget REPORT.
 * Returns specific events requested by href.
 */
async function handleCalendarMultiget(
  c: Context,
  calendar: { id: string; userId: string },
  body: string,
  _basePath: string,
): Promise<Response> {
  const { hrefs } = parseCalendarMultiget(body);

  // Extract event IDs from hrefs
  const eventIds: string[] = [];
  for (const href of hrefs) {
    const match = /([^/]+)\.ics$/.exec(href);
    if (match?.[1]) {
      eventIds.push(match[1]);
    }
  }

  if (eventIds.length === 0) {
    return c.body(buildMultistatus([]), 207, {
      'Content-Type': 'application/xml; charset=utf-8',
    });
  }

  // Fetch requested events
  const requestedEvents = await db.query.events.findMany({
    where: and(eq(events.calendarId, calendar.id), inArray(events.id, eventIds)),
  });

  // Create a map for quick lookup
  const eventMap = new Map(requestedEvents.map((e) => [e.id, e]));

  // Build multistatus response for each requested href
  const responses: MultistatusItem[] = hrefs.map((href) => {
    const match = /([^/]+)\.ics$/.exec(href);
    const eventId = match?.[1];
    const event = eventId ? eventMap.get(eventId) : undefined;

    if (!event) {
      return {
        href,
        propstat: [
          {
            status: 'HTTP/1.1 404 Not Found',
            prop: {},
          },
        ],
      };
    }

    const icsEvent = eventToICS(event);
    const icsContent = generateICS(icsEvent);
    const etag = event.etag ?? event.id;

    return {
      href,
      propstat: [
        {
          status: 'HTTP/1.1 200 OK',
          prop: {
            'd:getetag': `"${etag}"`,
            'c:calendar-data': icsContent,
          },
        },
      ],
    };
  });

  return c.body(buildMultistatus(responses), 207, {
    'Content-Type': 'application/xml; charset=utf-8',
  });
}

/**
 * Handle sync-collection REPORT.
 * Returns changes since the client's last sync token.
 */
async function handleSyncCollection(
  c: Context,
  calendar: { id: string; userId: string; syncToken: number },
  body: string,
  basePath: string,
): Promise<Response> {
  const { syncToken: clientSyncToken } = parseSyncCollection(body);

  // Parse client's sync token (format: http://athena.app/ns/sync/{token})
  let lastSyncToken = 0;
  if (clientSyncToken) {
    const tokenMatch = new RegExp(`^${SYNC_TOKEN_PREFIX}(\\d+)$`).exec(clientSyncToken);
    if (tokenMatch?.[1]) {
      lastSyncToken = parseInt(tokenMatch[1], 10);
    } else if (clientSyncToken && !clientSyncToken.startsWith(SYNC_TOKEN_PREFIX)) {
      // Invalid sync token format - client should do full sync
      return c.body(
        buildError('d:valid-sync-token', 'Invalid sync token format. Perform full sync.'),
        403,
        { 'Content-Type': 'application/xml; charset=utf-8' },
      );
    }
  }

  // If lastSyncToken is 0 or empty, return all current events (full sync)
  if (lastSyncToken === 0) {
    return handleFullSync(c, calendar, basePath);
  }

  // Incremental sync: fetch changes since last sync token
  const changes = await db.query.eventChanges.findMany({
    where: and(eq(eventChanges.calendarId, calendar.id), gt(eventChanges.syncToken, lastSyncToken)),
    orderBy: (eventChanges, { asc }) => [asc(eventChanges.syncToken)],
  });

  // Group changes by event ID, keeping only the latest change per event
  const latestChanges = new Map<string, { changeType: string; eventId: string }>();
  for (const change of changes) {
    latestChanges.set(change.eventId, {
      changeType: change.changeType,
      eventId: change.eventId,
    });
  }

  // Fetch current state of non-deleted events
  const nonDeletedEventIds = Array.from(latestChanges.values())
    .filter((c) => c.changeType !== 'deleted')
    .map((c) => c.eventId);

  const currentEvents =
    nonDeletedEventIds.length > 0
      ? await db.query.events.findMany({
          where: and(eq(events.calendarId, calendar.id), inArray(events.id, nonDeletedEventIds)),
        })
      : [];

  const eventMap = new Map(currentEvents.map((e) => [e.id, e]));

  // Build multistatus response
  const responses: MultistatusItem[] = [];

  for (const [eventId, change] of Array.from(latestChanges.entries())) {
    const href = `${basePath}${eventId}.ics`;

    if (change.changeType === 'deleted') {
      // Deleted event - return 404 status to indicate removal
      responses.push({
        href,
        propstat: [
          {
            status: 'HTTP/1.1 404 Not Found',
            prop: {},
          },
        ],
      });
    } else {
      const event = eventMap.get(eventId);
      if (event) {
        const icsEvent = eventToICS(event);
        const icsContent = generateICS(icsEvent);
        const etag = event.etag ?? event.id;

        responses.push({
          href,
          propstat: [
            {
              status: 'HTTP/1.1 200 OK',
              prop: {
                'd:getetag': `"${etag}"`,
                'c:calendar-data': icsContent,
              },
            },
          ],
        });
      }
    }
  }

  // Build response with new sync token
  const newSyncToken = `${SYNC_TOKEN_PREFIX}${String(calendar.syncToken)}`;
  const multistatusXml = buildSyncCollectionResponse(responses, newSyncToken);

  return c.body(multistatusXml, 207, {
    'Content-Type': 'application/xml; charset=utf-8',
  });
}

/**
 * Handle full sync (initial sync or invalid token).
 * Returns all current events in the calendar.
 */
async function handleFullSync(
  c: Context,
  calendar: { id: string; userId: string; syncToken: number },
  basePath: string,
): Promise<Response> {
  // Fetch all events in calendar
  const allEvents = await db.query.events.findMany({
    where: eq(events.calendarId, calendar.id),
  });

  const responses: MultistatusItem[] = allEvents.map((event) => {
    const href = `${basePath}${event.id}.ics`;
    const icsEvent = eventToICS(event);
    const icsContent = generateICS(icsEvent);
    const etag = event.etag ?? event.id;

    return {
      href,
      propstat: [
        {
          status: 'HTTP/1.1 200 OK',
          prop: {
            'd:getetag': `"${etag}"`,
            'c:calendar-data': icsContent,
          },
        },
      ],
    };
  });

  const newSyncToken = `${SYNC_TOKEN_PREFIX}${String(calendar.syncToken)}`;
  const multistatusXml = buildSyncCollectionResponse(responses, newSyncToken);

  return c.body(multistatusXml, 207, {
    'Content-Type': 'application/xml; charset=utf-8',
  });
}

/**
 * Build a sync-collection response with sync-token.
 */
function buildSyncCollectionResponse(responses: MultistatusItem[], syncToken: string): string {
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/">',
  ];

  for (const response of responses) {
    lines.push('  <d:response>');
    lines.push(`    <d:href>${escapeXml(response.href)}</d:href>`);

    for (const propstat of response.propstat) {
      lines.push('    <d:propstat>');
      lines.push('      <d:prop>');

      for (const [key, value] of Object.entries(propstat.prop)) {
        if (value === undefined) continue;
        if (typeof value === 'string') {
          if (value === '') {
            lines.push(`        <${key}/>`);
          } else {
            lines.push(`        <${key}>${escapeXml(value)}</${key}>`);
          }
        }
      }

      lines.push('      </d:prop>');
      lines.push(`      <d:status>${propstat.status}</d:status>`);
      lines.push('    </d:propstat>');
    }

    lines.push('  </d:response>');
  }

  // Include sync-token in response
  lines.push(`  <d:sync-token>${escapeXml(syncToken)}</d:sync-token>`);
  lines.push('</d:multistatus>');

  return lines.join('\n');
}

/**
 * Convert database event to ICS event format.
 */
function eventToICS(event: {
  id: string;
  title: string;
  description: string | null;
  startTime: Date;
  endTime: Date | null;
  isAllDay: boolean;
  location: string | null;
  recurrenceRule: string | null;
  calendarStatus: string | null;
  transparency: string | null;
  classification: string | null;
  sequence: number;
}): ICSEvent {
  return {
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

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
