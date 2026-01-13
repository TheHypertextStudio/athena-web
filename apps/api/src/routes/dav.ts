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

import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import {
  requireDavAuth,
  authenticateDav,
  handlePropfind,
  handleGet,
  handlePut,
  handleDelete,
} from '../services/caldav-server/index.js';

const davRoutes = new Hono();

// OPTIONS - Advertise DAV capabilities (NO AUTH REQUIRED)
// This must be defined BEFORE auth middleware so clients can discover the server
davRoutes.options('*', (c) => {
  return c.text('', 200, {
    DAV: '1, 2, 3, calendar-access',
    Allow: 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, MKCALENDAR',
    'Access-Control-Allow-Methods':
      'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, MKCALENDAR',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, Depth, If-Match, If-None-Match, Prefer',
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

// PROPFIND - Resource and property discovery
davRoutes.on('PROPFIND', '*', handlePropfind);

// GET - Retrieve event as .ics
davRoutes.get('*', handleGet);

// PUT - Create or update event
davRoutes.put('*', handlePut);

// DELETE - Remove event
davRoutes.delete('*', handleDelete);

// HEAD - Same as GET without body (for ETags)
davRoutes.on('HEAD', '*', (c) => {
  return handleGet(c).then((response) => {
    // Return headers only
    return c.body(null, response.status as 200, Object.fromEntries(response.headers.entries()));
  });
});

// REPORT - Calendar queries and sync-collection (TODO: implement)
davRoutes.on('REPORT', '*', (c) => {
  // For now, return not implemented
  // Full implementation will handle:
  // - calendar-query (time-range filtering)
  // - calendar-multiget (batch fetch)
  // - sync-collection (incremental sync)
  return c.text('Not Implemented', 501);
});

// PROPPATCH - Modify properties (TODO: implement)
davRoutes.on('PROPPATCH', '*', (c) => {
  return c.text('Not Implemented', 501);
});

// MKCALENDAR - Create new calendar (TODO: implement)
davRoutes.on('MKCALENDAR', '*', (c) => {
  return c.text('Not Implemented', 501);
});

// MKCOL - Create collection (used by some clients for calendars)
davRoutes.on('MKCOL', '*', (c) => {
  return c.text('Not Implemented', 501);
});

export { davRoutes };
