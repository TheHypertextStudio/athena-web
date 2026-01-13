/**
 * PROPFIND handler for CalDAV server.
 *
 * PROPFIND is the WebDAV method for discovering resources and their properties.
 * CalDAV clients use this to navigate the server structure and find calendars.
 *
 * Discovery chain:
 * 1. /.well-known/caldav → redirects to /dav/
 * 2. /dav/ → returns current-user-principal
 * 3. /dav/principals/{userId}/ → returns calendar-home-set
 * 4. /dav/calendars/{userId}/ → lists user's calendars
 * 5. /dav/calendars/{userId}/{calendarId}/ → lists events in calendar
 *
 * @packageDocumentation
 */

import type { Context } from 'hono';
import { db } from '../../../db/index.js';
import { calendars, events } from '../../../db/schema/index.js';
import { eq } from 'drizzle-orm';
import { buildMultistatus, parseRequestedProperties, type MultistatusItem } from '../utils/xml.js';
import type { DavAuthResult } from '../auth.js';

/**
 * Handle PROPFIND requests.
 *
 * For root path, allows unauthenticated access and returns minimal discovery info.
 * For all other paths, requires authentication.
 */
export async function handlePropfind(c: Context): Promise<Response> {
  const auth = c.get('davAuth') as DavAuthResult | undefined;
  const path = c.req.path.replace(/^\/dav/, '');
  const depth = c.req.header('depth') ?? '0';

  // Parse requested properties from body
  // NOTE: We parse requestedProps but currently return all properties regardless.
  // A full implementation would filter responses based on what the client requests.
  // This is acceptable per RFC 4918 - servers MAY return more properties than requested.
  const body = await c.req.text();
  const _requestedProps = body ? parseRequestedProperties(body) : ['allprop'];

  // Route to appropriate handler
  if (path === '/' || path === '') {
    return handleRootPropfind(c, auth);
  }

  // Principals collection: /principals/
  if (path === '/principals' || path === '/principals/') {
    return handlePrincipalsCollectionPropfind(c, auth);
  }

  // Principal: /principals/{userId}/
  const principalMatch = /^\/principals\/([^/]+)\/?$/.exec(path);
  if (principalMatch) {
    const userId = principalMatch[1];
    // Auth required to access specific principal
    if (!auth) {
      return unauthorizedResponse(c);
    }
    if (userId !== auth.userId) {
      return c.text('Forbidden', 403);
    }
    return handlePrincipalPropfind(c, auth);
  }

  // Calendars collection: /calendars/
  if (path === '/calendars' || path === '/calendars/') {
    return handleCalendarsCollectionPropfind(c, auth);
  }

  // Calendar home: /calendars/{userId}/
  const calendarHomeMatch = /^\/calendars\/([^/]+)\/?$/.exec(path);
  if (calendarHomeMatch) {
    const userId = calendarHomeMatch[1];
    // Auth required to access user's calendar home
    if (!auth) {
      return unauthorizedResponse(c);
    }
    if (userId !== auth.userId) {
      return c.text('Forbidden', 403);
    }
    return handleCalendarHomePropfind(c, auth, depth);
  }

  // Calendar collection: /calendars/{userId}/{calendarId}/
  const calendarMatch = /^\/calendars\/([^/]+)\/([^/]+)\/?$/.exec(path);
  if (calendarMatch) {
    const [, userId, calendarId] = calendarMatch;
    if (!userId || !calendarId) {
      return c.text('Not Found', 404);
    }
    // Auth required
    if (!auth) {
      return unauthorizedResponse(c);
    }
    if (userId !== auth.userId) {
      return c.text('Forbidden', 403);
    }
    return handleCalendarPropfind(c, auth, calendarId, depth);
  }

  // Event resource: /calendars/{userId}/{calendarId}/{eventId}.ics
  const eventMatch = /^\/calendars\/([^/]+)\/([^/]+)\/([^/]+)\.ics$/.exec(path);
  if (eventMatch) {
    const [, userId, calendarId, eventId] = eventMatch;
    if (!userId || !calendarId || !eventId) {
      return c.text('Not Found', 404);
    }
    // Auth required
    if (!auth) {
      return unauthorizedResponse(c);
    }
    if (userId !== auth.userId) {
      return c.text('Forbidden', 403);
    }
    return handleEventPropfind(c, auth, calendarId, eventId);
  }

  return c.text('Not Found', 404);
}

/**
 * Return a 401 Unauthorized response with proper headers.
 */
function unauthorizedResponse(c: Context): Response {
  return c.text('Unauthorized', 401, {
    'WWW-Authenticate': 'Basic realm="Athena"',
    DAV: '1, 2, 3, calendar-access',
  });
}

/**
 * Principals collection PROPFIND - returns info about the principals collection.
 */
function handlePrincipalsCollectionPropfind(c: Context, auth: DavAuthResult | undefined): Response {
  const response: MultistatusItem[] = [
    {
      href: '/dav/principals/',
      propstat: [
        {
          status: 'HTTP/1.1 200 OK',
          prop: {
            'd:resourcetype': {
              'd:collection': {},
            },
            'd:displayname': 'Principals',
          },
        },
      ],
    },
  ];

  // If authenticated, include the user's principal in the response
  if (auth) {
    response.push({
      href: `/dav/principals/${auth.userId}/`,
      propstat: [
        {
          status: 'HTTP/1.1 200 OK',
          prop: {
            'd:resourcetype': {
              'd:collection': {},
              'd:principal': {},
            },
            'd:displayname': auth.email,
          },
        },
      ],
    });
  }

  return c.body(buildMultistatus(response), 207, {
    'Content-Type': 'application/xml; charset=utf-8',
    DAV: '1, 2, 3, calendar-access',
    'WWW-Authenticate': 'Basic realm="Athena"',
  });
}

/**
 * Calendars collection PROPFIND - returns info about the calendars collection.
 */
function handleCalendarsCollectionPropfind(c: Context, _auth: DavAuthResult | undefined): Response {
  const response: MultistatusItem[] = [
    {
      href: '/dav/calendars/',
      propstat: [
        {
          status: 'HTTP/1.1 200 OK',
          prop: {
            'd:resourcetype': {
              'd:collection': {},
            },
            'd:displayname': 'Calendars',
          },
        },
      ],
    },
  ];

  return c.body(buildMultistatus(response), 207, {
    'Content-Type': 'application/xml; charset=utf-8',
    DAV: '1, 2, 3, calendar-access',
    'WWW-Authenticate': 'Basic realm="Athena"',
  });
}

/**
 * Root PROPFIND - returns current-user-principal.
 *
 * When unauthenticated: Returns minimal info indicating auth is needed for principal.
 * When authenticated: Returns the user's principal URL.
 */
function handleRootPropfind(c: Context, auth: DavAuthResult | undefined): Response {
  // If authenticated, return the user's principal
  if (auth) {
    const response: MultistatusItem[] = [
      {
        href: '/dav/',
        propstat: [
          {
            status: 'HTTP/1.1 200 OK',
            prop: {
              'd:current-user-principal': {
                'd:href': `/dav/principals/${auth.userId}/`,
              },
              'd:resourcetype': {
                'd:collection': {},
              },
            },
          },
        ],
      },
    ];

    return c.body(buildMultistatus(response), 207, {
      'Content-Type': 'application/xml; charset=utf-8',
      DAV: '1, 2, 3, calendar-access',
    });
  }

  // Unauthenticated: Return minimal discovery info
  // Tell the client this is a CalDAV server and they need to authenticate
  // The current-user-principal points to a generic URL that will require auth
  const response: MultistatusItem[] = [
    {
      href: '/dav/',
      propstat: [
        {
          status: 'HTTP/1.1 200 OK',
          prop: {
            'd:resourcetype': {
              'd:collection': {},
            },
            // Indicate principal discovery requires auth
            'd:current-user-principal': {
              'd:unauthenticated': {},
            },
            // Indicate this server supports CalDAV
            'd:supported-report-set': {
              'd:supported-report': [
                { 'c:calendar-query': {} },
                { 'c:calendar-multiget': {} },
                { 'd:sync-collection': {} },
              ],
            },
          },
        },
      ],
    },
  ];

  return c.body(buildMultistatus(response), 207, {
    'Content-Type': 'application/xml; charset=utf-8',
    DAV: '1, 2, 3, calendar-access',
    'WWW-Authenticate': 'Basic realm="Athena"',
  });
}

/**
 * Principal PROPFIND - returns calendar-home-set and addressbook-home-set.
 */
function handlePrincipalPropfind(c: Context, auth: DavAuthResult): Response {
  const response: MultistatusItem[] = [
    {
      href: `/dav/principals/${auth.userId}/`,
      propstat: [
        {
          status: 'HTTP/1.1 200 OK',
          prop: {
            'd:displayname': auth.email,
            'c:calendar-home-set': {
              'd:href': `/dav/calendars/${auth.userId}/`,
            },
            // CardDAV addressbook-home-set (for future contacts support)
            // 'card:addressbook-home-set': {
            //   'd:href': `/dav/addressbooks/${auth.userId}/`,
            // },
            'd:resourcetype': {
              'd:collection': {},
              'd:principal': {},
            },
            'c:calendar-user-address-set': {
              'd:href': `mailto:${auth.email}`,
            },
          },
        },
      ],
    },
  ];

  return c.body(buildMultistatus(response), 207, {
    'Content-Type': 'application/xml; charset=utf-8',
  });
}

/**
 * Calendar home PROPFIND - lists user's calendars.
 */
async function handleCalendarHomePropfind(
  c: Context,
  auth: DavAuthResult,
  depth: string,
): Promise<Response> {
  const userCalendars = await db.query.calendars.findMany({
    where: eq(calendars.userId, auth.userId),
  });

  const responses: MultistatusItem[] = [
    {
      href: `/dav/calendars/${auth.userId}/`,
      propstat: [
        {
          status: 'HTTP/1.1 200 OK',
          prop: {
            'd:resourcetype': {
              'd:collection': {},
            },
            'd:displayname': 'Calendars',
            'd:current-user-privilege-set': {
              'd:privilege': [
                { 'd:read': {} },
                { 'd:write': {} },
                { 'd:bind': {} },
                { 'd:unbind': {} },
              ],
            },
          },
        },
      ],
    },
  ];

  // Include child calendars if depth > 0
  if (depth !== '0') {
    for (const cal of userCalendars) {
      responses.push({
        href: `/dav/calendars/${auth.userId}/${cal.id}/`,
        propstat: [
          {
            status: 'HTTP/1.1 200 OK',
            prop: {
              'd:resourcetype': {
                'd:collection': {},
                'c:calendar': {},
              },
              'd:displayname': cal.name,
              'x:calendar-color': cal.color ?? '#4285F4',
              'c:calendar-description': cal.description ?? '',
              'cs:getctag': cal.ctag,
              'd:sync-token': `http://athena.app/sync/${String(cal.syncToken)}`,
              'c:supported-calendar-component-set': {
                'c:comp': [{ '@name': 'VEVENT' }],
              },
              'd:current-user-privilege-set': {
                'd:privilege': cal.isReadOnly
                  ? [{ 'd:read': {} }]
                  : [{ 'd:read': {} }, { 'd:write': {} }, { 'd:bind': {} }, { 'd:unbind': {} }],
              },
            },
          },
        ],
      });
    }
  }

  return c.body(buildMultistatus(responses), 207, {
    'Content-Type': 'application/xml; charset=utf-8',
  });
}

/**
 * Calendar collection PROPFIND - returns calendar properties and optionally lists events.
 */
async function handleCalendarPropfind(
  c: Context,
  auth: DavAuthResult,
  calendarId: string,
  depth: string,
): Promise<Response> {
  const calendar = await db.query.calendars.findFirst({
    where: eq(calendars.id, calendarId),
  });

  if (calendar?.userId !== auth.userId) {
    return c.text('Not Found', 404);
  }

  const responses: MultistatusItem[] = [
    {
      href: `/dav/calendars/${auth.userId}/${calendarId}/`,
      propstat: [
        {
          status: 'HTTP/1.1 200 OK',
          prop: {
            'd:resourcetype': {
              'd:collection': {},
              'c:calendar': {},
            },
            'd:displayname': calendar.name,
            'x:calendar-color': calendar.color ?? '#4285F4',
            'c:calendar-description': calendar.description ?? '',
            'c:calendar-timezone': calendar.timezone ?? 'UTC',
            'cs:getctag': calendar.ctag,
            'd:sync-token': `http://athena.app/sync/${String(calendar.syncToken)}`,
            'c:supported-calendar-component-set': {
              'c:comp': [{ '@name': 'VEVENT' }],
            },
            'd:current-user-privilege-set': {
              'd:privilege': calendar.isReadOnly
                ? [{ 'd:read': {} }]
                : [{ 'd:read': {} }, { 'd:write': {} }, { 'd:bind': {} }, { 'd:unbind': {} }],
            },
          },
        },
      ],
    },
  ];

  // Include events if depth > 0
  if (depth !== '0') {
    const calendarEvents = await db.query.events.findMany({
      where: eq(events.calendarId, calendarId),
    });

    for (const event of calendarEvents) {
      responses.push({
        href: `/dav/calendars/${auth.userId}/${calendarId}/${event.id}.ics`,
        propstat: [
          {
            status: 'HTTP/1.1 200 OK',
            prop: {
              'd:getetag': `"${event.etag ?? event.id}"`,
              'd:getcontenttype': 'text/calendar; charset=utf-8',
              'd:resourcetype': {},
            },
          },
        ],
      });
    }
  }

  return c.body(buildMultistatus(responses), 207, {
    'Content-Type': 'application/xml; charset=utf-8',
  });
}

/**
 * Event resource PROPFIND - returns event properties.
 */
async function handleEventPropfind(
  c: Context,
  auth: DavAuthResult,
  calendarId: string,
  eventId: string,
): Promise<Response> {
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

  const responses: MultistatusItem[] = [
    {
      href: `/dav/calendars/${auth.userId}/${calendarId}/${eventId}.ics`,
      propstat: [
        {
          status: 'HTTP/1.1 200 OK',
          prop: {
            'd:getetag': `"${event.etag ?? event.id}"`,
            'd:getcontenttype': 'text/calendar; charset=utf-8',
            'd:resourcetype': {},
          },
        },
      ],
    },
  ];

  return c.body(buildMultistatus(responses), 207, {
    'Content-Type': 'application/xml; charset=utf-8',
  });
}
