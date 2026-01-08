/**
 * Webhook service for outbound event delivery.
 *
 * @packageDocumentation
 */

import * as crypto from 'node:crypto';
import { db } from '../../db/index.js';
import { webhookEndpoints, webhookDeliveries, auditLogs } from '../../db/schema/index.js';
import { eq, and, lte, inArray, sql } from 'drizzle-orm';

/**
 * Webhook event type.
 */
export type WebhookEventType =
  | 'task.created'
  | 'task.updated'
  | 'task.deleted'
  | 'task.completed'
  | 'project.created'
  | 'project.updated'
  | 'project.deleted'
  | 'event.created'
  | 'event.updated'
  | 'event.deleted'
  | 'comment.created'
  | 'timer.started'
  | 'timer.stopped';

/**
 * Webhook service for managing endpoints and deliveries.
 */
export class WebhookService {
  /**
   * Create a webhook endpoint.
   */
  async createEndpoint(
    userId: string,
    url: string,
    events: WebhookEventType[],
    description?: string,
  ): Promise<{ id: string; secret: string }> {
    const id = crypto.randomUUID();
    const secret = crypto.randomBytes(32).toString('hex');
    const now = new Date();

    await db.insert(webhookEndpoints).values({
      id,
      userId,
      url,
      secret,
      description: description ?? null,
      events,
      isActive: true,
      failureCount: 0,
      createdAt: now,
      updatedAt: now,
    });

    return { id, secret };
  }

  /**
   * Get user's webhook endpoints.
   */
  async getEndpoints(userId: string) {
    return db.query.webhookEndpoints.findMany({
      where: eq(webhookEndpoints.userId, userId),
      columns: {
        id: true,
        url: true,
        description: true,
        events: true,
        isActive: true,
        lastDeliveredAt: true,
        failureCount: true,
        createdAt: true,
      },
    });
  }

  /**
   * Update a webhook endpoint.
   */
  async updateEndpoint(
    id: string,
    userId: string,
    updates: {
      url?: string;
      events?: WebhookEventType[];
      description?: string;
      isActive?: boolean;
    },
  ): Promise<boolean> {
    const endpoint = await db.query.webhookEndpoints.findFirst({
      where: and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.userId, userId)),
    });

    if (!endpoint) return false;

    await db
      .update(webhookEndpoints)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(webhookEndpoints.id, id));

    return true;
  }

  /**
   * Delete a webhook endpoint.
   */
  async deleteEndpoint(id: string, userId: string): Promise<boolean> {
    const endpoint = await db.query.webhookEndpoints.findFirst({
      where: and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.userId, userId)),
    });

    if (!endpoint) return false;

    await db.delete(webhookEndpoints).where(eq(webhookEndpoints.id, id));
    return true;
  }

  /**
   * Regenerate webhook secret.
   */
  async regenerateSecret(id: string, userId: string): Promise<string | null> {
    const endpoint = await db.query.webhookEndpoints.findFirst({
      where: and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.userId, userId)),
    });

    if (!endpoint) return null;

    const newSecret = crypto.randomBytes(32).toString('hex');

    await db
      .update(webhookEndpoints)
      .set({ secret: newSecret, updatedAt: new Date() })
      .where(eq(webhookEndpoints.id, id));

    return newSecret;
  }

  /**
   * Emit a webhook event.
   */
  async emit(
    userId: string,
    eventType: WebhookEventType,
    payload: Record<string, unknown>,
  ): Promise<number> {
    // Find all active endpoints subscribed to this event
    const endpoints = await db.query.webhookEndpoints.findMany({
      where: and(eq(webhookEndpoints.userId, userId), eq(webhookEndpoints.isActive, true)),
    });

    // Filter by event subscription
    const matchingEndpoints = endpoints.filter((ep) => ep.events.includes(eventType));

    if (matchingEndpoints.length === 0) return 0;

    const now = new Date();

    // Create delivery records
    for (const endpoint of matchingEndpoints) {
      await db.insert(webhookDeliveries).values({
        id: crypto.randomUUID(),
        endpointId: endpoint.id,
        userId,
        eventType,
        payload,
        status: 'pending',
        attempts: 0,
        maxAttempts: 5,
        scheduledFor: now,
        createdAt: now,
      });
    }

    return matchingEndpoints.length;
  }

  /**
   * Process pending webhook deliveries.
   * Should be called by a background worker.
   */
  async processPendingDeliveries(batchSize = 50): Promise<number> {
    const now = new Date();

    // Get pending deliveries
    const pending = await db.query.webhookDeliveries.findMany({
      where: and(
        inArray(webhookDeliveries.status, ['pending', 'retrying']),
        lte(webhookDeliveries.scheduledFor, now),
      ),
      with: {
        endpoint: true,
      },
      limit: batchSize,
    });

    let processed = 0;

    for (const delivery of pending) {
      const { endpoint } = delivery;

      try {
        // Mark as sending
        await db
          .update(webhookDeliveries)
          .set({ status: 'sending' })
          .where(eq(webhookDeliveries.id, delivery.id));

        // Build payload
        const body = JSON.stringify({
          id: delivery.id,
          type: delivery.eventType,
          timestamp: new Date().toISOString(),
          data: delivery.payload,
        });

        // Calculate signature
        const signature = this.signPayload(body, endpoint.secret);

        // Send webhook
        const response = await fetch(endpoint.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': signature,
            'X-Webhook-Event': delivery.eventType,
            'X-Webhook-Delivery-Id': delivery.id,
          },
          body,
          signal: AbortSignal.timeout(10000), // 10s timeout
        });

        if (response.ok) {
          // Success
          await db
            .update(webhookDeliveries)
            .set({
              status: 'delivered',
              responseStatus: response.status,
              deliveredAt: new Date(),
              attempts: delivery.attempts + 1,
            })
            .where(eq(webhookDeliveries.id, delivery.id));

          // Update endpoint
          await db
            .update(webhookEndpoints)
            .set({
              lastDeliveredAt: new Date(),
              failureCount: 0,
            })
            .where(eq(webhookEndpoints.id, delivery.endpointId));
        } else {
          // Failed
          await this.handleDeliveryFailure(delivery, response.status, await response.text());
        }

        processed++;
      } catch (error) {
        await this.handleDeliveryFailure(
          delivery,
          0,
          error instanceof Error ? error.message : 'Unknown error',
        );
        processed++;
      }
    }

    return processed;
  }

  /**
   * Get delivery history for an endpoint.
   */
  async getDeliveries(endpointId: string, userId: string, limit = 50) {
    // Verify ownership
    const endpoint = await db.query.webhookEndpoints.findFirst({
      where: and(eq(webhookEndpoints.id, endpointId), eq(webhookEndpoints.userId, userId)),
    });

    if (!endpoint) return [];

    return db.query.webhookDeliveries.findMany({
      where: eq(webhookDeliveries.endpointId, endpointId),
      orderBy: (d, { desc }) => [desc(d.createdAt)],
      limit,
      columns: {
        id: true,
        eventType: true,
        status: true,
        attempts: true,
        responseStatus: true,
        errorMessage: true,
        deliveredAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * Retry a failed delivery.
   */
  async retryDelivery(deliveryId: string, userId: string): Promise<boolean> {
    const delivery = await db.query.webhookDeliveries.findFirst({
      where: and(
        eq(webhookDeliveries.id, deliveryId),
        eq(webhookDeliveries.userId, userId),
        eq(webhookDeliveries.status, 'failed'),
      ),
    });

    if (!delivery) return false;

    await db
      .update(webhookDeliveries)
      .set({
        status: 'pending',
        scheduledFor: new Date(),
        attempts: 0,
        errorMessage: null,
      })
      .where(eq(webhookDeliveries.id, deliveryId));

    return true;
  }

  /**
   * Create an audit log entry.
   */
  async audit(
    userId: string | null,
    action: 'create' | 'update' | 'delete',
    entityType: string,
    entityId: string,
    options: {
      oldValue?: Record<string, unknown>;
      newValue?: Record<string, unknown>;
      changedFields?: string[];
      ipAddress?: string;
      userAgent?: string;
      requestId?: string;
      sessionId?: string;
    } = {},
  ): Promise<void> {
    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      userId,
      action,
      entityType,
      entityId,
      oldValue: options.oldValue ?? null,
      newValue: options.newValue ?? null,
      changedFields: options.changedFields ?? null,
      ipAddress: options.ipAddress ?? null,
      userAgent: options.userAgent ?? null,
      requestId: options.requestId ?? null,
      sessionId: options.sessionId ?? null,
      createdAt: new Date(),
    });
  }

  /**
   * Get audit logs.
   */
  async getAuditLogs(
    options: {
      userId?: string;
      entityType?: string;
      entityId?: string;
      action?: string;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    return db.query.auditLogs.findMany({
      where: and(
        options.userId ? eq(auditLogs.userId, options.userId) : undefined,
        options.entityType ? eq(auditLogs.entityType, options.entityType) : undefined,
        options.entityId ? eq(auditLogs.entityId, options.entityId) : undefined,
        options.action ? eq(auditLogs.action, options.action) : undefined,
      ),
      orderBy: (a, { desc }) => [desc(a.createdAt)],
      limit,
      offset,
      with: {
        user: {
          columns: { id: true, name: true, email: true },
        },
      },
    });
  }

  private signPayload(payload: string, secret: string): string {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    return `sha256=${hmac.digest('hex')}`;
  }

  private async handleDeliveryFailure(
    delivery: { id: string; endpointId: string; attempts: number; maxAttempts: number },
    responseStatus: number,
    errorMessage: string,
  ): Promise<void> {
    const newAttempts = delivery.attempts + 1;
    const shouldRetry = newAttempts < delivery.maxAttempts;

    // Exponential backoff: 1min, 5min, 15min, 1hr, 4hr
    const backoffMinutes = [1, 5, 15, 60, 240][Math.min(newAttempts - 1, 4)] ?? 240;
    const nextSchedule = new Date(Date.now() + backoffMinutes * 60 * 1000);

    await db
      .update(webhookDeliveries)
      .set({
        status: shouldRetry ? 'retrying' : 'failed',
        attempts: newAttempts,
        responseStatus: responseStatus === 0 ? null : responseStatus,
        errorMessage,
        scheduledFor: shouldRetry ? nextSchedule : undefined,
      })
      .where(eq(webhookDeliveries.id, delivery.id));

    // Update endpoint failure count
    if (!shouldRetry) {
      await db
        .update(webhookEndpoints)
        .set({
          failureCount: sql`${webhookEndpoints.failureCount} + 1`,
        })
        .where(eq(webhookEndpoints.id, delivery.endpointId));
    }
  }
}

// Singleton instance
let webhookServiceInstance: WebhookService | null = null;

/**
 * Get the shared webhook service instance.
 */
export function getWebhookService(): WebhookService {
  webhookServiceInstance ??= new WebhookService();
  return webhookServiceInstance;
}
