/**
 * Google Calendar webhook helpers.
 *
 * @packageDocumentation
 */

import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { linkedIntegrations } from '../../../db/schema/index.js';
import { getCalendarSyncService } from '../../../services/calendar-sync/index.js';
import type { GoogleCalendarHeaders } from './schemas.js';

interface WebhookResult {
  status: 200 | 400;
  body: string;
}

export async function processGoogleCalendarWebhook(
  headers: GoogleCalendarHeaders,
): Promise<WebhookResult> {
  const channelId = headers['x-goog-channel-id'];
  const channelToken = headers['x-goog-channel-token'];
  const resourceState = headers['x-goog-resource-state'];
  const resourceId = headers['x-goog-resource-id'];

  // Parse channel token (format: userId:connectionId)
  const [userId, connectionId] = channelToken.split(':');
  if (!userId || !connectionId) {
    console.warn('Google Calendar webhook: Invalid channel token format');
    return { status: 400, body: 'Invalid channel token' };
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
    return { status: 200, body: 'OK' };
  }

  // Handle based on resource state
  if (resourceState === 'sync') {
    // Initial sync confirmation - no action needed
    console.log(`Google Calendar webhook: Sync confirmation for channel ${channelId}`);
    return { status: 200, body: 'OK' };
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
  return { status: 200, body: 'OK' };
}
