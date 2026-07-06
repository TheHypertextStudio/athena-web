import type { Database, NotificationDestination } from '@docket/db';
import {
  notification,
  notificationDelivery,
  notificationIntent,
  notificationRecipient,
} from '@docket/db';
import {
  canCreateNotification,
  NotificationAudience,
  NotificationIntentCreate,
  type NotificationChannelDecision,
  type NotificationDestinationType,
  type NotificationIntentCreate as NotificationIntentCreateInput,
} from '@docket/notifications';
import { eq } from 'drizzle-orm';

import { expandNotificationAudience } from './audience';
import { deliverEmailNotification } from './adapters/email';
import { deliverWebNotification } from './adapters/web';
import { resolveNotificationPreferences, type NotificationPreferenceMode } from './preferences';

type NotificationIntentRow = typeof notificationIntent.$inferSelect;
type NotificationRecipientRow = typeof notificationRecipient.$inferSelect;
type NotificationDeliveryRow = typeof notificationDelivery.$inferSelect;
type NotificationRow = typeof notification.$inferSelect;

/** Input for dispatching and immediately attempting a notification intent. */
export interface DispatchNotificationIntentInput extends NotificationIntentCreateInput {
  /** Principal id or stable system name that created the intent. */
  readonly createdBy: string;
  /** Instant used for persistence and preference decisions. */
  readonly now?: Date;
  /** Optional authenticated deep link for the web inbox projection. */
  readonly webUrl?: string;
  /** Whether to apply user-managed category/channel toggles while resolving channels. */
  readonly preferenceMode?: NotificationPreferenceMode;
}

/** Result of dispatching a notification intent through the currently implemented adapters. */
export interface DispatchNotificationResult {
  /** Durable notification intent id. */
  readonly intentId: string;
  /** Final intent status after immediate adapter attempts. */
  readonly status: NotificationIntentRow['status'];
  /** True when an idempotency key matched an already-dispatched intent. */
  readonly idempotent: boolean;
  /** Recipient snapshot rows created or loaded for the intent. */
  readonly recipients: readonly NotificationRecipientRow[];
  /** Per-channel delivery rows created or loaded for the intent. */
  readonly deliveries: readonly NotificationDeliveryRow[];
  /** Web inbox projection rows created or loaded for the intent. */
  readonly webNotifications: readonly NotificationRow[];
}

/** Options for dispatching an already persisted notification intent. */
export interface DispatchPersistedNotificationIntentOptions {
  /** Instant used for persistence and preference decisions. */
  readonly now?: Date;
  /** Optional authenticated deep link for the web inbox projection. */
  readonly webUrl?: string;
  /** True when returning a previously dispatched idempotent result. */
  readonly idempotent?: boolean;
  /** Whether to apply user-managed category/channel toggles while resolving channels. */
  readonly preferenceMode?: NotificationPreferenceMode;
}

/** Creates a durable notification intent, snapshots recipients, and attempts channel delivery. */
export async function dispatchNotificationIntent(
  db: Database,
  input: DispatchNotificationIntentInput,
): Promise<DispatchNotificationResult> {
  const parsed = NotificationIntentCreate.parse(input);
  const now = input.now ?? new Date();

  if (parsed.idempotencyKey) {
    const [existing] = await db
      .select()
      .from(notificationIntent)
      .where(eq(notificationIntent.idempotencyKey, parsed.idempotencyKey))
      .limit(1);
    if (existing) return loadDispatchResult(db, existing, true);
  }

  const policy = canCreateNotification(parsed);
  if (!policy.allowed) {
    throw new Error(`Notification intent rejected: ${policy.denialReasons.join(', ')}`);
  }

  const [intent] = await db
    .insert(notificationIntent)
    .values({
      senderType: parsed.senderType,
      senderId: parsed.senderId ?? null,
      organizationId: parsed.organizationId ?? null,
      category: parsed.category,
      priority: parsed.priority,
      audience: parsed.audience,
      channels: [...parsed.channels],
      subject: parsed.subject,
      body: parsed.body,
      replyPolicy: parsed.replyPolicy,
      status: 'sending',
      scheduledAt: parsed.scheduledAt ? new Date(parsed.scheduledAt) : null,
      idempotencyKey: parsed.idempotencyKey,
      createdBy: input.createdBy,
    })
    .returning();
  if (!intent) throw new Error('Failed to create notification intent');

  return dispatchPersistedNotificationIntent(db, intent, {
    now,
    ...(input.webUrl ? { webUrl: input.webUrl } : {}),
    ...(input.preferenceMode ? { preferenceMode: input.preferenceMode } : {}),
  });
}

/** Snapshots recipients and attempts channel delivery for an existing intent row. */
export async function dispatchPersistedNotificationIntent(
  db: Database,
  intent: NotificationIntentRow,
  options: DispatchPersistedNotificationIntentOptions = {},
): Promise<DispatchNotificationResult> {
  const now = options.now ?? new Date();

  const existingRecipients = await db
    .select({ id: notificationRecipient.id })
    .from(notificationRecipient)
    .where(eq(notificationRecipient.notificationId, intent.id))
    .limit(1);
  if (existingRecipients.length > 0) {
    return loadDispatchResult(db, intent, options.idempotent ?? false);
  }

  const recipientInputs = await expandNotificationAudience(
    db,
    NotificationAudience.parse(intent.audience),
  );
  const recipients: NotificationRecipientRow[] = [];
  const deliveries: NotificationDeliveryRow[] = [];
  const webNotifications: NotificationRow[] = [];

  for (const recipientInput of recipientInputs) {
    const [recipient] = await db
      .insert(notificationRecipient)
      .values({
        notificationId: intent.id,
        userId: recipientInput.userId,
        organizationId: recipientInput.organizationId,
        reason: recipientInput.reason,
        suppressions: [],
      })
      .returning();
    if (!recipient) throw new Error('Failed to create notification recipient');
    recipients.push(recipient);

    const decisions = await resolveNotificationPreferences(
      db,
      {
        userId: recipient.userId,
        organizationId: recipient.organizationId,
        category: intent.category,
        priority: intent.priority,
        channels: intent.channels,
        now,
      },
      options.preferenceMode ?? 'respect_user_preferences',
    );
    const suppressions = decisions.flatMap((decision) =>
      decision.suppression ? [decision.suppression] : [],
    );
    if (suppressions.length > 0) {
      const [updated] = await db
        .update(notificationRecipient)
        .set({ suppressions })
        .where(eq(notificationRecipient.id, recipient.id))
        .returning();
      if (updated) recipients[recipients.length - 1] = updated;
    }

    for (const decision of decisions) {
      let delivery = await createDelivery(db, {
        intent,
        recipientId: recipient.id,
        decision,
        now,
      });
      deliveries.push(delivery);

      if (decision.channel === 'web' && decision.decision === 'send') {
        webNotifications.push(
          await deliverWebNotification(db, {
            intentId: intent.id,
            deliveryId: delivery.id,
            userId: recipient.userId,
            organizationId: recipient.organizationId,
            category: intent.category,
            subject: intent.subject,
            body: intent.body,
            ...(options.webUrl ? { url: options.webUrl } : {}),
          }),
        );
      }

      if (decision.channel === 'email' && decision.decision === 'send') {
        delivery = await deliverEmailNotification(db, {
          deliveryId: delivery.id,
          subject: intent.subject,
          body: intent.body,
          now,
        });
        deliveries[deliveries.length - 1] = delivery;
      }
    }
  }

  const [updatedIntent] = await db
    .update(notificationIntent)
    .set({ status: finalStatusFor(deliveries), updatedAt: now })
    .where(eq(notificationIntent.id, intent.id))
    .returning();

  return {
    intentId: intent.id,
    status: updatedIntent?.status ?? finalStatusFor(deliveries),
    idempotent: options.idempotent ?? false,
    recipients,
    deliveries,
    webNotifications,
  };
}

async function createDelivery(
  db: Database,
  {
    intent,
    recipientId,
    decision,
    now,
  }: {
    readonly intent: NotificationIntentRow;
    readonly recipientId: string;
    readonly decision: NotificationChannelDecision;
    readonly now: Date;
  },
): Promise<NotificationDeliveryRow> {
  const [delivery] = await db
    .insert(notificationDelivery)
    .values({
      notificationId: intent.id,
      recipientId,
      channel: decision.channel,
      destinationType: destinationTypeForDecision(decision),
      destination: destinationForDecision(decision),
      status: statusForDecision(decision),
      sentAt: decision.decision === 'send' && decision.channel === 'web' ? now : null,
    })
    .returning();
  if (!delivery) throw new Error('Failed to create notification delivery');
  return delivery;
}

function destinationTypeForDecision(
  decision: NotificationChannelDecision,
): NotificationDestinationType {
  if (decision.destination) return decision.destination.type;
  if (decision.channel === 'email') return 'email';
  if (decision.channel === 'sms') return 'phone';
  if (decision.channel === 'push') return 'push_token';
  return 'in_app';
}

function destinationForDecision(decision: NotificationChannelDecision): NotificationDestination {
  if (!decision.destination) return {};
  return {
    type: decision.destination.type,
    ...(decision.destination.valueMasked ? { valueMasked: decision.destination.valueMasked } : {}),
    ...(decision.destination.contactPointId
      ? { contactPointId: decision.destination.contactPointId }
      : {}),
  };
}

function statusForDecision(
  decision: NotificationChannelDecision,
): NotificationDeliveryRow['status'] {
  if (decision.decision === 'suppress') return 'suppressed';
  if (decision.decision === 'delay') return 'queued';
  if (decision.channel === 'web') return 'sent';
  return 'queued';
}

function finalStatusFor(
  deliveries: readonly NotificationDeliveryRow[],
): NotificationIntentRow['status'] {
  if (deliveries.length === 0) return 'sent';
  const failed = deliveries.filter((delivery) => delivery.status === 'failed').length;
  if (failed === deliveries.length) return 'failed';
  if (failed > 0) return 'partially_failed';
  return 'sent';
}

async function loadDispatchResult(
  db: Database,
  intent: NotificationIntentRow,
  idempotent: boolean,
): Promise<DispatchNotificationResult> {
  const [recipients, deliveries, webNotifications] = await Promise.all([
    db
      .select()
      .from(notificationRecipient)
      .where(eq(notificationRecipient.notificationId, intent.id)),
    db
      .select()
      .from(notificationDelivery)
      .where(eq(notificationDelivery.notificationId, intent.id)),
    db.select().from(notification).where(eq(notification.intentId, intent.id)),
  ]);

  return {
    intentId: intent.id,
    status: intent.status,
    idempotent,
    recipients,
    deliveries,
    webNotifications,
  };
}
