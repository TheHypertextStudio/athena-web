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
import {
  requireDavAuth,
  handlePropfind,
  handleGet,
  handlePut,
  handleDelete,
} from '../services/caldav-server/index.js';

const davRoutes = new Hono();

// Apply CalDAV authentication to all routes
davRoutes.use('*', requireDavAuth('caldav'));

// OPTIONS - Advertise DAV capabilities (required for client discovery)
davRoutes.options('*', (c) => {
  return c.text('', 200, {
    DAV: '1, 2, 3, calendar-access',
    Allow: 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, MKCALENDAR',
    'Access-Control-Allow-Methods':
      'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, MKCALENDAR',
    'Access-Control-Allow-Headers':
      'Authorization, Content-Type, Depth, If-Match, If-None-Match, Prefer',
  });
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
