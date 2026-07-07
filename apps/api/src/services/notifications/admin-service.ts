import type { Database } from '@docket/db';
import { notificationInboundEvent, notificationIntent, operatorAuditEvent } from '@docket/db';
import {
  canCreateNotification,
  NotificationAudience,
  type NotificationAudienceEstimateOut,
  type NotificationChannel,
  type NotificationChannelDecision,
  type NotificationInboundEventOut,
  type NotificationIntentOut,
  type NotificationPreviewOut,
  type NotificationSuppressionReason,
} from '@docket/notifications';
import { and, desc, eq } from 'drizzle-orm';
import type { z } from 'zod';

import type { AdminAuditOut } from '../../admin-dto';
import { ConflictError, NotFoundError } from '../../error';
import { expandNotificationAudience } from './audience';
import type { NotificationIntentService } from './intent-service';
import { toNotificationIntentOut } from './intents';
import { resolveNotificationPreferences } from './preferences';

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

  /** Estimate audience size, channel eligibility, suppressions, and approval gates before send. */
  async estimate(
    userId: string,
    id: string,
  ): Promise<z.input<typeof NotificationAudienceEstimateOut>> {
    const intent = await this.intents.get(userId, id);
    const recipients = await expandNotificationAudience(
      this.database,
      NotificationAudience.parse(intent.audience),
    );
    const channelCounts = emptyChannelCounts();
    const suppressions = new Map<
      string,
      z.input<typeof NotificationAudienceEstimateOut>['suppressions'][number]
    >();

    for (const recipient of recipients) {
      const decisions = await resolveNotificationPreferences(this.database, {
        userId: recipient.userId,
        organizationId: recipient.organizationId,
        category: intent.category,
        priority: intent.priority,
        channels: intent.channels,
      });

      for (const decision of decisions) {
        channelCounts[decision.channel][decision.decision] += 1;
        recordSuppression(suppressions, decision);
      }
    }

    const policy = canCreateNotification({
      senderType: intent.senderType,
      category: intent.category,
      audience: intent.audience,
      channels: intent.channels,
    });

    return {
      recipientCount: recipients.length,
      channelCounts,
      suppressions: [...suppressions.values()].sort(compareSuppressions),
      approvalRequired: policy.approval.required,
      approvalReasons: [...policy.approval.reasons],
    };
  }

  /** Render staff-facing previews for every requested channel on one intent. */
  async preview(userId: string, id: string): Promise<z.input<typeof NotificationPreviewOut>> {
    const intent = await this.intents.get(userId, id);
    const text = bodyText(intent.body);
    return {
      subject: intent.subject,
      replyPolicy: intent.replyPolicy,
      ...(intent.channels.includes('web') ? { web: { title: intent.subject, body: text } } : {}),
      ...(intent.channels.includes('email')
        ? {
            email: {
              subject: intent.subject,
              ...(intent.body.text ? { text: intent.body.text } : {}),
              ...(intent.body.html ? { html: intent.body.html } : {}),
            },
          }
        : {}),
      ...(intent.channels.includes('sms')
        ? { sms: { text: `Docket: ${intent.subject}. ${text}` } }
        : {}),
      ...(intent.channels.includes('push') ? { push: { title: intent.subject, body: text } } : {}),
    };
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

type ChannelCounts = z.input<typeof NotificationAudienceEstimateOut>['channelCounts'];
type SuppressionEstimate = z.input<typeof NotificationAudienceEstimateOut>['suppressions'][number];

function emptyChannelCounts(): ChannelCounts {
  return {
    web: { send: 0, delay: 0, suppress: 0 },
    email: { send: 0, delay: 0, suppress: 0 },
    sms: { send: 0, delay: 0, suppress: 0 },
    push: { send: 0, delay: 0, suppress: 0 },
  };
}

function recordSuppression(
  suppressions: Map<string, SuppressionEstimate>,
  decision: NotificationChannelDecision,
): void {
  if (!decision.suppression) return;
  const channel = decision.suppression.channel ?? decision.channel;
  const reason = decision.suppression.reason;
  const key = suppressionKey(channel, reason);
  const current = suppressions.get(key);
  suppressions.set(key, {
    channel,
    reason,
    count: (current?.count ?? 0) + 1,
  });
}

function suppressionKey(
  channel: NotificationChannel,
  reason: NotificationSuppressionReason,
): string {
  return `${channel}:${reason}`;
}

function compareSuppressions(a: SuppressionEstimate, b: SuppressionEstimate): number {
  const channel = (a.channel ?? '').localeCompare(b.channel ?? '');
  if (channel !== 0) return channel;
  return a.reason.localeCompare(b.reason);
}

function bodyText(body: { readonly text?: string; readonly html?: string }): string {
  const text = body.text?.trim();
  if (text !== undefined && text.length > 0) return text;
  return (
    body.html
      ?.replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() ?? ''
  );
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
