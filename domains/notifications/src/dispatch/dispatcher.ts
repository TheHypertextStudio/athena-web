import type {
  Database,
  NotificationContent as NotificationContentRecord,
  NotificationDestination,
} from '@docket/db';
import {
  notification,
  notificationDelivery,
  notificationIntent,
  notificationRecipient,
} from '@docket/db';
import { eq } from 'drizzle-orm';

import { canCreateNotification } from '../policy';
import type { NotificationChannelDecision } from '../preferences';
import {
  NotificationAudience,
  NotificationIntentCreate,
  type NotificationDestinationType,
  type NotificationIntentCreate as NotificationIntentCreateInput,
} from '../schemas';
import { expandNotificationAudience } from './audience';
import { deliverEmailNotification } from './adapters/email';
import { deliverPushNotification } from './adapters/push';
import { deliverSmsNotification } from './adapters/sms';
import { deliverWebNotification } from './adapters/web';
import { resolveNotificationPreferences, type NotificationPreferenceMode } from './preferences';

type NotificationIntentRow = typeof notificationIntent.$inferSelect;
type NotificationRecipientRow = typeof notificationRecipient.$inferSelect;
type NotificationDeliveryRow = typeof notificationDelivery.$inferSelect;
type NotificationRow = typeof notification.$inferSelect;
type NotificationRecipientInput = Awaited<ReturnType<typeof expandNotificationAudience>>[number];

/** Input for dispatching and immediately attempting a notification intent. */
export interface DispatchNotificationIntentInput extends NotificationIntentCreateInput {
  /** Principal id or stable system name that created the intent. */
  readonly createdBy: string;
  /** Instant used for persistence and preference decisions. */
  readonly now?: Date | undefined;
  /** Optional authenticated deep link for the web inbox projection. */
  readonly webUrl?: string | undefined;
  /** Whether to apply user-managed category/channel toggles while resolving channels. */
  readonly preferenceMode?: NotificationPreferenceMode | undefined;
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
  readonly now?: Date | undefined;
  /** Optional authenticated deep link for the web inbox projection. */
  readonly webUrl?: string | undefined;
  /** True when returning a previously dispatched idempotent result. */
  readonly idempotent?: boolean | undefined;
  /** Whether to apply user-managed category/channel toggles while resolving channels. */
  readonly preferenceMode?: NotificationPreferenceMode | undefined;
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
      body: parsed.body as NotificationContentRecord,
      replyPolicy: parsed.replyPolicy,
      status: 'sending',
      scheduledAt: parsed.scheduledAt ? new Date(parsed.scheduledAt) : null,
      idempotencyKey: parsed.idempotencyKey,
      createdBy: input.createdBy,
    })
    .returning();
  /* v8 ignore next -- @preserve defensive: insert always returns the inserted row */
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
    const dispatched = await dispatchRecipient({ db, intent, recipientInput, now, options });
    recipients.push(dispatched.recipient);
    deliveries.push(...dispatched.deliveries);
    webNotifications.push(...dispatched.webNotifications);
  }

  const [updatedIntent] = await db
    .update(notificationIntent)
    .set({ status: finalStatusFor(deliveries), updatedAt: now })
    .where(eq(notificationIntent.id, intent.id))
    .returning();

  return {
    intentId: intent.id,
    // unreachable: @preserve defensive: update-by-id always returns the updated row, so the
    // fallback recomputation never actually runs.
    /* v8 ignore next */
    status: updatedIntent?.status ?? finalStatusFor(deliveries),
    idempotent: options.idempotent ?? false,
    recipients,
    deliveries,
    webNotifications,
  };
}

interface RecipientDispatchContext {
  readonly db: Database;
  readonly intent: NotificationIntentRow;
  readonly recipientInput: NotificationRecipientInput;
  readonly now: Date;
  readonly options: DispatchPersistedNotificationIntentOptions;
}

interface RecipientDispatchResult {
  readonly recipient: NotificationRecipientRow;
  readonly deliveries: readonly NotificationDeliveryRow[];
  readonly webNotifications: readonly NotificationRow[];
}

async function createRecipient(
  db: Database,
  intent: NotificationIntentRow,
  input: NotificationRecipientInput,
): Promise<NotificationRecipientRow> {
  const [recipient] = await db
    .insert(notificationRecipient)
    .values({
      notificationId: intent.id,
      userId: input.userId,
      organizationId: input.organizationId,
      reason: input.reason,
      suppressions: [],
    })
    .returning();
  /* v8 ignore next -- @preserve defensive: insert always returns the inserted row */
  if (!recipient) throw new Error('Failed to create notification recipient');
  return recipient;
}

async function storeRecipientSuppressions(
  db: Database,
  recipient: NotificationRecipientRow,
  decisions: readonly NotificationChannelDecision[],
): Promise<NotificationRecipientRow> {
  const suppressions = decisions.flatMap((decision) =>
    decision.suppression ? [decision.suppression] : [],
  );
  if (suppressions.length === 0) return recipient;
  const [updated] = await db
    .update(notificationRecipient)
    .set({ suppressions })
    .where(eq(notificationRecipient.id, recipient.id))
    .returning();
  /* v8 ignore next -- @preserve defensive: update-by-id always returns the updated row */
  return updated ?? recipient;
}

interface ChannelDeliveryContext {
  readonly db: Database;
  readonly intent: NotificationIntentRow;
  readonly recipient: NotificationRecipientRow;
  readonly decision: NotificationChannelDecision;
  readonly now: Date;
  readonly webUrl?: string | undefined;
}

interface ChannelDeliveryResult {
  readonly delivery: NotificationDeliveryRow;
  readonly webNotification?: NotificationRow | undefined;
}

async function deliverChannel(context: ChannelDeliveryContext): Promise<ChannelDeliveryResult> {
  const { db, intent, recipient, decision, now, webUrl } = context;
  const delivery = await createDelivery(db, {
    intent,
    recipientId: recipient.id,
    decision,
    now,
  });
  if (decision.decision !== 'send') return { delivery };
  if (decision.channel === 'web') {
    const webNotification = await deliverWebNotification(db, {
      intentId: intent.id,
      deliveryId: delivery.id,
      userId: recipient.userId,
      organizationId: recipient.organizationId,
      category: intent.category,
      subject: intent.subject,
      body: intent.body,
      ...(webUrl ? { url: webUrl } : {}),
    });
    return { delivery, webNotification };
  }
  const adapterInput = {
    deliveryId: delivery.id,
    subject: intent.subject,
    body: intent.body,
    now,
  };
  if (decision.channel === 'email') {
    return { delivery: await deliverEmailNotification(db, adapterInput) };
  }
  if (decision.channel === 'sms') {
    return { delivery: await deliverSmsNotification(db, adapterInput) };
  }
  return {
    delivery: await deliverPushNotification(db, {
      notificationId: intent.id,
      ...adapterInput,
    }),
  };
}

async function dispatchRecipient(
  context: RecipientDispatchContext,
): Promise<RecipientDispatchResult> {
  const { db, intent, recipientInput, now, options } = context;
  let recipient = await createRecipient(db, intent, recipientInput);
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
  recipient = await storeRecipientSuppressions(db, recipient, decisions);
  const deliveries: NotificationDeliveryRow[] = [];
  const webNotifications: NotificationRow[] = [];
  for (const decision of decisions) {
    const result = await deliverChannel({
      db,
      intent,
      recipient,
      decision,
      now,
      ...(options.webUrl ? { webUrl: options.webUrl } : {}),
    });
    deliveries.push(result.delivery);
    if (result.webNotification) webNotifications.push(result.webNotification);
  }
  return { recipient, deliveries, webNotifications };
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
  /* v8 ignore next -- @preserve defensive: insert always returns the inserted row */
  if (!delivery) throw new Error('Failed to create notification delivery');
  return delivery;
}

function destinationTypeForDecision(
  decision: NotificationChannelDecision,
): NotificationDestinationType {
  if (decision.destination) return decision.destination.type;
  if (decision.channel === 'email') return 'email';
  if (decision.channel === 'sms') return 'phone';
  // Only `push` remains here: a null destination is only ever produced for email/sms/push
  // (handled above) — `web` always resolves a non-null `{ type: 'in_app' }` destination in
  // preferences.ts, so it never reaches this fallback.
  return 'push_token';
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
