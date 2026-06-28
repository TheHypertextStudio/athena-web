/**
 * Outlook Calendar webhook helpers.
 *
 * @packageDocumentation
 */

import { and, eq } from 'drizzle-orm';
import { db } from '../../../db/index.js';
import { linkedIntegrations } from '../../../db/schema/index.js';
import { getCalendarSyncService } from '../../../services/calendar-sync/index.js';
import type { OutlookNotificationPayload } from './schemas.js';

export async function processOutlookNotifications(payload: OutlookNotificationPayload): Promise<void> {
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
}
