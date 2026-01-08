/**
 * In-app notification provider.
 *
 * Stores notifications in the database for retrieval by the client.
 *
 * @packageDocumentation
 */

import type { NotificationProvider, NotificationContent, NotificationResult } from '../types.js';
import { db } from '../../../db/index.js';
import { notifications } from '../../../db/schema/index.js';

/**
 * In-app provider for storing notifications in the database.
 */
export class InAppProvider implements NotificationProvider {
  readonly channel = 'in_app' as const;

  async send(
    userId: string,
    content: NotificationContent,
    options?: { priority?: string },
  ): Promise<NotificationResult> {
    try {
      const id = crypto.randomUUID();
      const now = new Date();

      await db.insert(notifications).values({
        id,
        userId,
        channel: 'in_app',
        status: 'delivered', // In-app notifications are immediately "delivered"
        priority:
          (options?.priority as 'low' | 'normal' | 'high' | 'urgent' | undefined) ?? 'normal',
        title: content.title,
        body: content.body,
        data: content.data ?? null,
        actionUrl: content.actionUrl ?? null,
        entityType: content.entityType ?? null,
        entityId: content.entityId ?? null,
        deliveredAt: now,
        createdAt: now,
      });

      return {
        channel: 'in_app',
        success: true,
        notificationId: id,
      };
    } catch (error) {
      return {
        channel: 'in_app',
        success: false,
        error: error instanceof Error ? error.message : 'Failed to store notification',
      };
    }
  }

  isConfigured(): boolean {
    // In-app notifications are always available
    return true;
  }
}
