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

const davRoutes = new Hono();

// OPTIONS - Advertise DAV capabilities (NO AUTH REQUIRED)
// This must be defined BEFORE auth middleware so clients can discover the server
davRoutes.options('*', (c) => {
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

// REPORT - Calendar queries and sync-collection
davRoutes.on('REPORT', '*', handleReport);

// PROPPATCH - Modify calendar properties
davRoutes.on('PROPPATCH', '*', handleProppatch);

// MKCALENDAR - Create new calendar
davRoutes.on('MKCALENDAR', '*', handleMkcalendar);

// MKCOL - Create collection (used by some clients for calendars)
davRoutes.on('MKCOL', '*', handleMkcol);

// COPY - Copy events between calendars
davRoutes.on('COPY', '*', handleCopy);

// MOVE - Move events between calendars
davRoutes.on('MOVE', '*', handleMove);

export { davRoutes };
