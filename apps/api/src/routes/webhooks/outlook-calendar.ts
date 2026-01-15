/**
 * Microsoft Outlook/Graph calendar webhook receiver.
 *
 * Receives push notifications from Microsoft Graph API to enable
 * real-time sync of calendar events.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { db } from '../../db/index.js';
import { linkedIntegrations } from '../../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { getCalendarSyncService } from '../../services/calendar-sync/index.js';

const outlookCalendarWebhookRoutes = new Hono();

/**
 * Outlook notification payload structure.
 */
interface OutlookNotificationPayload {
  value: OutlookNotification[];
}

/**
 * Individual Outlook notification.
 */
interface OutlookNotification {
  subscriptionId: string;
  subscriptionExpirationDateTime: string;
  changeType: 'created' | 'updated' | 'deleted';
  resource: string;
  resourceData?: {
    '@odata.type': string;
    '@odata.id': string;
    '@odata.etag': string;
    id: string;
  };
  clientState?: string;
  tenantId: string;
}

/**
 * Microsoft Outlook/Graph webhook receiver.
 *
 * Microsoft sends two types of requests:
 * 1. Validation: POST with validationToken query param - must echo it back
 * 2. Notification: POST with JSON body containing change notifications
 *
 * POST /webhooks/outlook-calendar
 */
outlookCalendarWebhookRoutes.post('/', async (c) => {
  // Handle subscription validation
  const validationToken = c.req.query('validationToken');
  if (validationToken) {
    // Echo validation token back in plain text
    return c.text(validationToken, 200, {
      'Content-Type': 'text/plain',
    });
  }

  // Handle change notification
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    console.warn('Outlook Calendar webhook: Invalid JSON body');
    return c.text('Invalid request body', 400);
  }

  // Validate payload structure
  const payload = body as Partial<OutlookNotificationPayload>;
  if (!payload.value || !Array.isArray(payload.value)) {
    console.warn('Outlook Calendar webhook: Missing notification value array');
    return c.text('Invalid request body', 400);
  }

  // Process each notification
  for (const notification of payload.value) {
    // Extract connection info from clientState (format: userId:connectionId)
    const clientState = notification.clientState;
    if (!clientState) {
      console.warn('Outlook Calendar webhook: Missing clientState');
      continue;
    }

    const [userId, connectionId] = clientState.split(':');
    if (!userId || !connectionId) {
      console.warn('Outlook Calendar webhook: Invalid clientState format');
      continue;
    }

    // Verify the connection exists
    const connection = await db.query.linkedIntegrations.findFirst({
      where: and(
        eq(linkedIntegrations.id, connectionId),
        eq(linkedIntegrations.userId, userId),
        eq(linkedIntegrations.provider, 'outlook_calendar'),
      ),
    });

    if (!connection) {
      console.warn(
        `Outlook Calendar webhook: Connection ${connectionId} not found for user ${userId}`,
      );
      continue;
    }

    // Handle notification based on change type
    const changeType = notification.changeType;
    console.log(
      `Outlook Calendar webhook: ${changeType} notification for connection ${connectionId}, resource ${notification.resource}`,
    );

    // Trigger incremental sync (fire-and-forget)
    // All change types (created, updated, deleted) trigger a sync
    getCalendarSyncService()
      .sync(connectionId, userId)
      .catch((err: unknown) => {
        console.error('Outlook Calendar webhook sync failed:', err);
      });
  }

  // Microsoft requires 202 Accepted for webhook notifications
  return c.text('Accepted', 202);
});

export { outlookCalendarWebhookRoutes };
