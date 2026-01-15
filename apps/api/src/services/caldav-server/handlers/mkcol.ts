/**
 * MKCOL handler for CalDAV server.
 *
 * MKCOL is the generic WebDAV method for creating collections.
 * Some CalDAV clients use MKCOL instead of MKCALENDAR to create calendars.
 *
 * This handler delegates to MKCALENDAR for calendar collection paths,
 * providing compatibility with clients that prefer the generic WebDAV method.
 *
 * @packageDocumentation
 */

import type { Context } from 'hono';
import { handleMkcalendar } from './mkcalendar.js';
import type { DavAuthResult } from '../auth.js';

/**
 * Handle MKCOL requests.
 *
 * For calendar collection paths (/calendars/{userId}/{calendarId}/),
 * delegates to MKCALENDAR handler. Other paths return 403 Forbidden
 * since we only support calendar collections.
 */
export async function handleMkcol(c: Context): Promise<Response> {
  const auth = c.get('davAuth') as DavAuthResult | undefined;
  const path = c.req.path.replace(/^\/dav/, '');

  // MKCOL requires authentication
  if (!auth) {
    return c.text('Unauthorized', 401, {
      'WWW-Authenticate': 'Basic realm="Athena"',
    });
  }

  // Check if this is a calendar collection path
  const calendarMatch = /^\/calendars\/([^/]+)\/([^/]+)\/?$/.exec(path);

  if (calendarMatch) {
    // Delegate to MKCALENDAR handler for calendar paths
    return handleMkcalendar(c);
  }

  // We only support creating calendar collections
  // Other collection types (e.g., address books) are not supported
  return c.text('Forbidden - Only calendar collections are supported', 403);
}
