/**
 * CalDAV/CardDAV routes.
 *
 * Provides WebDAV endpoints for native calendar app integration.
 * iOS/macOS Calendar.app and other CalDAV clients connect here.
 *
 * URL structure:
 * - /dav/                          → Root (current-user-principal discovery)
 * - /dav/principals/{userId}/      → User principal
 * - /dav/calendars/{userId}/       → Calendar home (list calendars)
 * - /dav/calendars/{userId}/{id}/  → Calendar collection
 * - /dav/calendars/{userId}/{id}/{eventId}.ics → Event resource
 *
 * @packageDocumentation
 */

import type { Context, Next } from 'hono';
import { createRoute, z, type RouteConfig } from '@hono/zod-openapi';
import {
  requireDavAuth,
  authenticateDav,
  handlePropfind,
  handleProppatch,
  handleGet,
  handlePut,
  handleDelete,
  handleReport,
  handleMkcalendar,
  handleMkcol,
  handleCopy,
  handleMove,
} from '../services/caldav-server/index.js';
import { createOpenAPIApp } from '../lib/openapi.js';

const davRoutes = createOpenAPIApp();

const davHeadersSchema = z.object({
  authorization: z.string().optional(),
  depth: z.string().optional(),
  'if-match': z.string().optional(),
  'if-none-match': z.string().optional(),
  destination: z.string().optional(),
  overwrite: z.string().optional(),
  prefer: z.string().optional(),
  'content-type': z.string().optional(),
});

const davWildcardPath = '/*';
const davResponseContent = {
  '*/*': {
    schema: z.string(),
  },
};

type DavMethod =
  | 'PROPFIND'
  | 'PROPPATCH'
  | 'REPORT'
  | 'MKCALENDAR'
  | 'MKCOL'
  | 'COPY'
  | 'MOVE';

type DavRouteConfig = Omit<RouteConfig, 'method'> & { method: DavMethod };

// OpenAPI doesn't support WebDAV methods; hide these and cast for routing/validation.
const createDavRoute = (route: DavRouteConfig): RouteConfig =>
  ({ ...route, hide: true } as unknown as RouteConfig);

const davOptionsRoute = createRoute({
  method: 'options',
  path: davWildcardPath,
  tags: ['DAV'],
  summary: 'DAV capabilities',
  description: 'Advertise DAV capabilities and supported methods.',
  request: {
    headers: davHeadersSchema,
  },
  responses: {
    200: {
      description: 'DAV capabilities response',
    },
  },
});

// OPTIONS - Advertise DAV capabilities (NO AUTH REQUIRED)
// This must be defined BEFORE auth middleware so clients can discover the server
davRoutes.openapi(davOptionsRoute, (c) => {
  return c.text('', 200, {
    DAV: '1, 2, 3, calendar-access',
    Allow:
      'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, MKCALENDAR, MKCOL, COPY, MOVE',
    'Access-Control-Allow-Methods':
      'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, MKCALENDAR, MKCOL, COPY, MOVE',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, Depth, If-Match, If-None-Match, Prefer, Destination, Overwrite',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Credentials': 'true',
  });
});

// Apply CalDAV authentication
// PROPFIND requests are allowed without auth for discovery - they return appropriate
// responses based on auth state. Other methods (GET, PUT, DELETE) always require auth.
davRoutes.use('*', async (c: Context, next: Next) => {
  // Skip auth for OPTIONS (already handled above)
  if (c.req.method === 'OPTIONS') {
    return next();
  }

  // PROPFIND is used for discovery - allow without auth, handler will return appropriate response
  if (c.req.method === 'PROPFIND') {
    const authHeader = c.req.header('authorization');

    // Try to authenticate if credentials provided
    if (authHeader?.startsWith('Basic ')) {
      const auth = await authenticateDav(c);
      if (auth) {
        c.set('davAuth', auth);
        c.set('userId', auth.userId);
      }
      // If auth fails, still continue - handler will return 401 for protected resources
    }

    // Continue to handler - it decides what to return based on auth state
    return next();
  }

  // All other methods (GET, PUT, DELETE, etc.) require authentication
  return requireDavAuth('caldav')(c, next);
});

const davGetRoute = createRoute({
  method: 'get',
  path: davWildcardPath,
  tags: ['DAV'],
  summary: 'Retrieve DAV resource',
  description: 'Retrieve calendar data or an event resource.',
  request: {
    headers: davHeadersSchema,
  },
  responses: {
    200: {
      description: 'DAV resource response',
      content: davResponseContent,
    },
    403: {
      description: 'Forbidden',
      content: davResponseContent,
    },
    404: {
      description: 'Not Found',
      content: davResponseContent,
    },
  },
});

// GET - Retrieve event as .ics
davRoutes.openapi(davGetRoute, handleGet);

const davPutRoute = createRoute({
  method: 'put',
  path: davWildcardPath,
  tags: ['DAV'],
  summary: 'Create or update DAV resource',
  description: 'Create or update calendar events via CalDAV.',
  request: {
    headers: davHeadersSchema,
  },
  responses: {
    201: {
      description: 'DAV resource created',
      content: davResponseContent,
    },
    204: {
      description: 'DAV resource updated',
      content: davResponseContent,
    },
    400: {
      description: 'Bad Request',
      content: davResponseContent,
    },
    403: {
      description: 'Forbidden',
      content: davResponseContent,
    },
    404: {
      description: 'Not Found',
      content: davResponseContent,
    },
    409: {
      description: 'Conflict',
      content: davResponseContent,
    },
    412: {
      description: 'Precondition Failed',
      content: davResponseContent,
    },
  },
});

// PUT - Create or update event
davRoutes.openapi(davPutRoute, handlePut);

const davDeleteRoute = createRoute({
  method: 'delete',
  path: davWildcardPath,
  tags: ['DAV'],
  summary: 'Delete DAV resource',
  description: 'Delete calendar events via CalDAV.',
  request: {
    headers: davHeadersSchema,
  },
  responses: {
    204: {
      description: 'DAV resource deleted',
      content: davResponseContent,
    },
    403: {
      description: 'Forbidden',
      content: davResponseContent,
    },
    404: {
      description: 'Not Found',
      content: davResponseContent,
    },
    412: {
      description: 'Precondition Failed',
      content: davResponseContent,
    },
  },
});

// DELETE - Remove event
davRoutes.openapi(davDeleteRoute, handleDelete);

const davHeadRoute = createRoute({
  method: 'head',
  path: davWildcardPath,
  tags: ['DAV'],
  summary: 'Check DAV resource',
  description: 'Retrieve DAV resource headers.',
  request: {
    headers: davHeadersSchema,
  },
  responses: {
    200: {
      description: 'DAV resource headers',
      content: davResponseContent,
    },
    403: {
      description: 'Forbidden',
      content: davResponseContent,
    },
    404: {
      description: 'Not Found',
      content: davResponseContent,
    },
  },
});

const davPropfindRoute = createDavRoute({
  method: 'PROPFIND',
  path: davWildcardPath,
  tags: ['DAV'],
  summary: 'DAV property discovery',
  description: 'Discover DAV resources and properties.',
  request: {
    headers: davHeadersSchema,
  },
  responses: {
    207: { description: 'Multi-Status', content: davResponseContent },
    401: { description: 'Unauthorized', content: davResponseContent },
    403: { description: 'Forbidden', content: davResponseContent },
    404: { description: 'Not Found', content: davResponseContent },
  },
});

const davReportRoute = createDavRoute({
  method: 'REPORT',
  path: davWildcardPath,
  tags: ['DAV'],
  summary: 'DAV report',
  description: 'Run CalDAV REPORT queries.',
  request: {
    headers: davHeadersSchema,
  },
  responses: {
    207: { description: 'Multi-Status', content: davResponseContent },
    400: { description: 'Bad Request', content: davResponseContent },
    401: { description: 'Unauthorized', content: davResponseContent },
    403: { description: 'Forbidden', content: davResponseContent },
    404: { description: 'Not Found', content: davResponseContent },
  },
});

const davProppatchRoute = createDavRoute({
  method: 'PROPPATCH',
  path: davWildcardPath,
  tags: ['DAV'],
  summary: 'DAV property update',
  description: 'Update DAV properties.',
  request: {
    headers: davHeadersSchema,
  },
  responses: {
    207: { description: 'Multi-Status', content: davResponseContent },
    401: { description: 'Unauthorized', content: davResponseContent },
    403: { description: 'Forbidden', content: davResponseContent },
    404: { description: 'Not Found', content: davResponseContent },
    405: { description: 'Method Not Allowed', content: davResponseContent },
  },
});

const davMkcalendarRoute = createDavRoute({
  method: 'MKCALENDAR',
  path: davWildcardPath,
  tags: ['DAV'],
  summary: 'Create calendar',
  description: 'Create a calendar collection.',
  request: {
    headers: davHeadersSchema,
  },
  responses: {
    201: { description: 'Created', content: davResponseContent },
    400: { description: 'Bad Request', content: davResponseContent },
    401: { description: 'Unauthorized', content: davResponseContent },
    403: { description: 'Forbidden', content: davResponseContent },
    405: { description: 'Method Not Allowed', content: davResponseContent },
    500: { description: 'Server Error', content: davResponseContent },
  },
});

const davMkcolRoute = createDavRoute({
  method: 'MKCOL',
  path: davWildcardPath,
  tags: ['DAV'],
  summary: 'Create collection',
  description: 'Create a collection (delegates to MKCALENDAR for calendars).',
  request: {
    headers: davHeadersSchema,
  },
  responses: {
    201: { description: 'Created', content: davResponseContent },
    400: { description: 'Bad Request', content: davResponseContent },
    401: { description: 'Unauthorized', content: davResponseContent },
    403: { description: 'Forbidden', content: davResponseContent },
    405: { description: 'Method Not Allowed', content: davResponseContent },
    500: { description: 'Server Error', content: davResponseContent },
  },
});

const davCopyRoute = createDavRoute({
  method: 'COPY',
  path: davWildcardPath,
  tags: ['DAV'],
  summary: 'Copy DAV resource',
  description: 'Copy calendar resources between collections.',
  request: {
    headers: davHeadersSchema,
  },
  responses: {
    201: { description: 'Created', content: davResponseContent },
    204: { description: 'No Content', content: davResponseContent },
    400: { description: 'Bad Request', content: davResponseContent },
    401: { description: 'Unauthorized', content: davResponseContent },
    403: { description: 'Forbidden', content: davResponseContent },
    404: { description: 'Not Found', content: davResponseContent },
    405: { description: 'Method Not Allowed', content: davResponseContent },
    409: { description: 'Conflict', content: davResponseContent },
    412: { description: 'Precondition Failed', content: davResponseContent },
  },
});

const davMoveRoute = createDavRoute({
  method: 'MOVE',
  path: davWildcardPath,
  tags: ['DAV'],
  summary: 'Move DAV resource',
  description: 'Move calendar resources between collections.',
  request: {
    headers: davHeadersSchema,
  },
  responses: {
    201: { description: 'Created', content: davResponseContent },
    204: { description: 'No Content', content: davResponseContent },
    400: { description: 'Bad Request', content: davResponseContent },
    401: { description: 'Unauthorized', content: davResponseContent },
    403: { description: 'Forbidden', content: davResponseContent },
    404: { description: 'Not Found', content: davResponseContent },
    405: { description: 'Method Not Allowed', content: davResponseContent },
    409: { description: 'Conflict', content: davResponseContent },
    412: { description: 'Precondition Failed', content: davResponseContent },
  },
});

// HEAD - Same as GET without body (for ETags)
davRoutes.openapi(davHeadRoute, async (c) => {
  const response = await handleGet(c);
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  });
});

// PROPFIND - Resource and property discovery
davRoutes.openapi(davPropfindRoute, handlePropfind);

// REPORT - Calendar queries and sync-collection
davRoutes.openapi(davReportRoute, handleReport);

// PROPPATCH - Modify calendar properties
davRoutes.openapi(davProppatchRoute, handleProppatch);

// MKCALENDAR - Create new calendar
davRoutes.openapi(davMkcalendarRoute, handleMkcalendar);

// MKCOL - Create collection (used by some clients for calendars)
davRoutes.openapi(davMkcolRoute, handleMkcol);

// COPY - Copy events between calendars
davRoutes.openapi(davCopyRoute, handleCopy);

// MOVE - Move events between calendars
davRoutes.openapi(davMoveRoute, handleMove);

export { davRoutes };
