import type { Database } from '@docket/db';
import { notificationInboundEvent, notificationIntent, operatorAuditEvent } from '@docket/db';
import type { NotificationInboundEventOut, NotificationIntentOut } from '@docket/notifications';
import { and, desc, eq } from 'drizzle-orm';
import type { z } from 'zod';

import type { AdminAuditOut } from '../../admin-dto';
import { ConflictError, NotFoundError } from '../../error';
import type { NotificationIntentService } from './intent-service';
import { toNotificationIntentOut } from './intents';

/** Staff-facing notification monitoring and approval service. */
export class AdminNotificationService {
  constructor(
    private readonly database: Database,
    private readonly intents: NotificationIntentService,
  ) {}

  /** List staff-visible notification intents newest first. */
  async list(
    limit: number,
    offset: number,
  ): Promise<{ items: z.input<typeof NotificationIntentOut>[] }> {
    const rows = await this.database
      .select()
      .from(notificationIntent)
      .orderBy(desc(notificationIntent.createdAt))
      .limit(limit)
      .offset(offset);
    return { items: rows.map(toNotificationIntentOut) };
  }

  /** Return one staff-visible notification intent. */
  async get(userId: string, id: string): Promise<z.input<typeof NotificationIntentOut>> {
    return this.intents.get(userId, id);
  }

  /** Approve a draft or scheduled notification by moving it into the queued state. */
  async approve(staffUserId: string, id: string): Promise<z.input<typeof NotificationIntentOut>> {
    const [existing] = await this.database
      .select()
      .from(notificationIntent)
      .where(eq(notificationIntent.id, id))
      .limit(1);
    if (!existing) throw new NotFoundError('Notification intent not found');
    if (!['draft', 'scheduled'].includes(existing.status)) {
      throw new ConflictError('Notification intent cannot be approved from its current state');
    }

    const [updated] = await this.database
      .update(notificationIntent)
      .set({ status: 'queued', updatedAt: new Date() })
      .where(eq(notificationIntent.id, id))
      .returning();
    if (!updated) throw new NotFoundError('Notification intent not found');

    await this.recordAudit(staffUserId, 'notification.approved', id, {
      previousStatus: existing.status,
      status: updated.status,
    });

    return toNotificationIntentOut(updated);
  }

  /** Reject a not-yet-delivered notification intent. */
  async reject(
    userId: string,
    staffUserId: string,
    id: string,
  ): Promise<z.input<typeof NotificationIntentOut>> {
    const rejected = await this.intents.cancel(userId, id);
    await this.recordAudit(staffUserId, 'notification.rejected', id, {
      status: rejected.status,
    });
    return rejected;
  }

  /** List operator audit events for one notification intent. */
  async listAudit(userId: string, id: string): Promise<{ items: z.input<typeof AdminAuditOut>[] }> {
    await this.intents.get(userId, id);
    const rows = await this.database
      .select()
      .from(operatorAuditEvent)
      .where(
        and(
          eq(operatorAuditEvent.subjectType, 'notification'),
          eq(operatorAuditEvent.subjectId, id),
        ),
      )
      .orderBy(desc(operatorAuditEvent.createdAt));
    return { items: rows.map(toAdminAuditOut) };
  }

  /** List normalized provider callbacks and replies for one notification intent. */
  async listInboundEvents(
    userId: string,
    id: string,
  ): Promise<{ items: z.input<typeof NotificationInboundEventOut>[] }> {
    await this.intents.get(userId, id);
    const rows = await this.database
      .select()
      .from(notificationInboundEvent)
      .where(eq(notificationInboundEvent.notificationId, id))
      .orderBy(desc(notificationInboundEvent.receivedAt));
    return {
      items: rows.map((row) => ({
        id: row.id,
        notificationId: row.notificationId,
        deliveryId: row.deliveryId,
        channel: row.channel,
        kind: row.kind,
        from: row.from,
        payload: row.payload,
        receivedAt: row.receivedAt.toISOString(),
      })),
    };
  }

  private async recordAudit(
    staffUserId: string,
    type: string,
    subjectId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.database.insert(operatorAuditEvent).values({
      staffUserId,
      type,
      subjectType: 'notification',
      subjectId,
      metadata,
    });
  }
}

function toAdminAuditOut(
  row: typeof operatorAuditEvent.$inferSelect,
): z.input<typeof AdminAuditOut> {
  return {
    id: row.id,
    staffUserId: row.staffUserId,
    type: row.type,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  };
}
