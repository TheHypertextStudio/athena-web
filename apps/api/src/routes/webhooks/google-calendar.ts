/**
 * Google Calendar webhook receiver.
 *
 * Receives push notifications from Google Calendar API to enable
 * real-time sync of calendar events.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { db } from '../../db/index.js';
import { linkedIntegrations } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { getCalendarSyncService } from '../../services/calendar-sync/index.js';

const googleCalendarWebhookRoutes = new Hono();

/**
 * Google Calendar push notification receiver.
 *
 * Google sends notifications with these headers:
 * - X-Goog-Channel-ID: The channel ID we provided when creating the watch
 * - X-Goog-Channel-Token: The token we provided (contains userId and connectionId)
 * - X-Goog-Resource-ID: Google's resource identifier
 * - X-Goog-Resource-State: 'sync' (initial), 'exists' (changes), 'not_exists' (deleted)
 *
 * POST /webhooks/google-calendar
 */
googleCalendarWebhookRoutes.post('/', async (c) => {
  const channelId = c.req.header('X-Goog-Channel-ID');
  const channelToken = c.req.header('X-Goog-Channel-Token');
  const resourceState = c.req.header('X-Goog-Resource-State');
  const resourceId = c.req.header('X-Goog-Resource-ID');

  // Validate required headers
  if (!channelId || !channelToken) {
    console.warn('Google Calendar webhook: Missing required headers');
    return c.text('Missing required headers', 400);
  }

  // Parse channel token (format: userId:connectionId)
  const [userId, connectionId] = channelToken.split(':');
  if (!userId || !connectionId) {
    console.warn('Google Calendar webhook: Invalid channel token format');
    return c.text('Invalid channel token', 400);
  }

  // Verify the connection exists and belongs to the user
  const connection = await db.query.linkedIntegrations.findFirst({
    where: and(
      eq(linkedIntegrations.id, connectionId),
      eq(linkedIntegrations.userId, userId),
      eq(linkedIntegrations.provider, 'google_calendar'),
    ),
  });

  if (!connection) {
    console.warn(
      `Google Calendar webhook: Connection ${connectionId} not found for user ${userId}`,
    );
    // Return 200 to stop Google from retrying
    return c.text('OK', 200);
  }

  // Handle based on resource state
  if (resourceState === 'sync') {
    // Initial sync confirmation - no action needed
    console.log(`Google Calendar webhook: Sync confirmation for channel ${channelId}`);
    return c.text('OK', 200);
  }

  if (resourceState === 'exists' || resourceState === 'not_exists') {
    // Changes detected - trigger incremental sync
    console.log(
      `Google Calendar webhook: ${resourceState} notification for connection ${connectionId}, resource ${resourceId ?? 'unknown'}`,
    );

    // Fire-and-forget sync - don't block the webhook response
    getCalendarSyncService()
      .sync(connectionId, userId)
      .catch((err: unknown) => {
        console.error('Google Calendar webhook sync failed:', err);
      });
  }

  // Always return 200 to acknowledge receipt
  return c.text('OK', 200);
});

export { googleCalendarWebhookRoutes };
