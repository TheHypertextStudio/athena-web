import type { Database } from '@docket/db';
import { notificationIntent, staffUser } from '@docket/db';
import {
  canCreateNotification,
  NotificationDeliveryOut,
  NotificationIntentCreate,
  NotificationIntentStatus,
  NotificationRecipientOut,
  type NotificationIntentCreate as NotificationIntentCreateInput,
  type NotificationIntentOut,
} from '@docket/notifications';
import { NotificationOut } from '@docket/types';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { CapabilityError, ConflictError, NotFoundError } from '../../error';
import {
  dispatchNotificationIntent,
  dispatchPersistedNotificationIntent,
  type DispatchNotificationResult,
} from './dispatcher';
import { toNotificationOut } from './inbox';
import {
  getNotificationIntent,
  listNotificationDeliveries,
  listNotificationRecipients,
  toNotificationDeliveryOut,
  toNotificationIntentOut,
  toNotificationRecipientOut,
} from './intents';

/** Public dispatch result returned by staff test-send operations. */
export const NotificationDispatchResultOut = z.object({
  intentId: z.string(),
  status: NotificationIntentStatus,
  idempotent: z.boolean(),
  recipients: z.array(NotificationRecipientOut),
  deliveries: z.array(NotificationDeliveryOut),
  webNotifications: z.array(NotificationOut),
});

/** Database-backed staff notification intent service. */
export class NotificationIntentService {
  constructor(private readonly db: Database) {}

  /** Create a draft or scheduled notification intent. */
  async create(
    callerUserId: string,
    input: NotificationIntentCreateInput,
  ): Promise<z.input<typeof NotificationIntentOut>> {
    await requireStaffUser(this.db, callerUserId);
    enforceIntentPolicy(input);

    if (input.idempotencyKey) {
      const [existing] = await this.db
        .select()
        .from(notificationIntent)
        .where(eq(notificationIntent.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (existing) return toNotificationIntentOut(existing);
    }

    const [intent] = await this.db
      .insert(notificationIntent)
      .values({
        senderType: input.senderType,
        senderId: input.senderId ?? null,
        organizationId: input.organizationId ?? null,
        category: input.category,
        priority: input.priority,
        audience: input.audience,
        channels: [...input.channels],
        subject: input.subject,
        body: input.body,
        replyPolicy: input.replyPolicy,
        status: input.scheduledAt ? 'scheduled' : 'draft',
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
        idempotencyKey: input.idempotencyKey ?? null,
        createdBy: callerUserId,
      })
      .returning();
    if (!intent) throw new Error('Failed to create notification intent');

    return toNotificationIntentOut(intent);
  }

  /** Return one staff-visible intent. */
  async get(callerUserId: string, id: string): Promise<z.input<typeof NotificationIntentOut>> {
    await requireStaffUser(this.db, callerUserId);
    return toNotificationIntentOut(await requireIntent(this.db, id));
  }

  /** Return recipient snapshots for one intent. */
  async listRecipients(
    callerUserId: string,
    id: string,
  ): Promise<{ items: z.input<typeof NotificationRecipientOut>[] }> {
    await requireStaffUser(this.db, callerUserId);
    await requireIntent(this.db, id);
    const rows = await listNotificationRecipients(this.db, id);
    return { items: rows.map(toNotificationRecipientOut) };
  }

  /** Return delivery attempts for one intent. */
  async listDeliveries(
    callerUserId: string,
    id: string,
  ): Promise<{ items: z.input<typeof NotificationDeliveryOut>[] }> {
    await requireStaffUser(this.db, callerUserId);
    await requireIntent(this.db, id);
    const rows = await listNotificationDeliveries(this.db, id);
    return { items: rows.map(toNotificationDeliveryOut) };
  }

  /** Send a draft, queued, or scheduled intent. */
  async send(callerUserId: string, id: string): Promise<z.input<typeof NotificationIntentOut>> {
    await requireStaffUser(this.db, callerUserId);
    const intent = await requireIntent(this.db, id);
    if (!['draft', 'scheduled', 'queued'].includes(intent.status)) {
      throw new ConflictError('Notification intent cannot be sent from its current state');
    }

    const now = new Date();
    const [sending] = await this.db
      .update(notificationIntent)
      .set({ status: 'sending', updatedAt: now })
      .where(eq(notificationIntent.id, intent.id))
      .returning();
    if (!sending) throw new NotFoundError('Notification intent not found');

    await dispatchPersistedNotificationIntent(this.db, sending, { now });
    return toNotificationIntentOut(await requireIntent(this.db, id));
  }

  /** Cancel a not-yet-delivered intent. */
  async cancel(callerUserId: string, id: string): Promise<z.input<typeof NotificationIntentOut>> {
    await requireStaffUser(this.db, callerUserId);
    const intent = await requireIntent(this.db, id);
    if (['sent', 'partially_failed', 'failed'].includes(intent.status)) {
      throw new ConflictError('Delivered notification intents cannot be canceled');
    }
    if (intent.status === 'canceled') return toNotificationIntentOut(intent);

    const [canceled] = await this.db
      .update(notificationIntent)
      .set({ status: 'canceled', updatedAt: new Date() })
      .where(eq(notificationIntent.id, intent.id))
      .returning();
    if (!canceled) throw new NotFoundError('Notification intent not found');
    return toNotificationIntentOut(canceled);
  }

  /** Send a copy of an existing intent to the staff caller. */
  async testSend(
    callerUserId: string,
    id: string,
  ): Promise<z.input<typeof NotificationDispatchResultOut>> {
    await requireStaffUser(this.db, callerUserId);
    const intent = await requireIntent(this.db, id);
    const testIntent = NotificationIntentCreate.parse({
      senderType: intent.senderType,
      ...(intent.senderId ? { senderId: intent.senderId } : {}),
      organizationId: intent.organizationId,
      category: intent.category,
      priority: intent.priority,
      audience: { type: 'user', userId: callerUserId },
      channels: intent.channels,
      subject: `[Test] ${intent.subject}`,
      body: intent.body,
      replyPolicy: intent.replyPolicy,
    });
    return toDispatchResultOut(
      await dispatchNotificationIntent(this.db, { ...testIntent, createdBy: callerUserId }),
    );
  }
}

async function requireStaffUser(db: Database, userId: string): Promise<void> {
  const [staff] = await db
    .select({ id: staffUser.id })
    .from(staffUser)
    .where(eq(staffUser.userId, userId))
    .limit(1);
  if (!staff) throw new CapabilityError('Staff access required');
}

async function requireIntent(db: Database, id: string) {
  const intent = await getNotificationIntent(db, id);
  if (!intent) throw new NotFoundError('Notification intent not found');
  return intent;
}

function enforceIntentPolicy(input: NotificationIntentCreateInput): void {
  const policy = canCreateNotification(input);
  if (!policy.allowed) {
    throw new CapabilityError(`Notification intent rejected: ${policy.denialReasons.join(', ')}`);
  }
}

function toDispatchResultOut(
  result: DispatchNotificationResult,
): z.input<typeof NotificationDispatchResultOut> {
  return {
    intentId: result.intentId,
    status: result.status,
    idempotent: result.idempotent,
    recipients: result.recipients.map(toNotificationRecipientOut),
    deliveries: result.deliveries.map(toNotificationDeliveryOut),
    webNotifications: result.webNotifications.map(toNotificationOut),
  };
}
