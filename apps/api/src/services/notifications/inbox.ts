import type { Database, notification, notificationDelivery } from '@docket/db';
import {
  notification as notificationTable,
  notificationDelivery as notificationDeliveryTable,
} from '@docket/db';
import type { NotificationDeliveryHint } from '@docket/notifications';
import type { NotificationOut } from '@docket/types';
import { and, desc, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import type { z } from 'zod';

type NotificationRow = typeof notification.$inferSelect;
type NotificationDeliveryRow = typeof notificationDelivery.$inferSelect;

/** Optional narrowing filters for a signed-in user's notification inbox. */
export interface NotificationInboxFilters {
  readonly organizationId?: string;
  readonly type?: NotificationRow['type'];
  readonly unreadOnly?: boolean;
}

/** Database-backed notification inbox service. */
export class NotificationInboxService {
  constructor(private readonly db: Database) {}

  /** Return caller-owned notifications, newest first. */
  async list(
    userId: string,
    filters: NotificationInboxFilters,
  ): Promise<{ items: z.input<typeof NotificationOut>[] }> {
    const rows = await listInboxNotifications(this.db, userId, filters);
    return { items: await serializeInboxNotifications(this.db, rows) };
  }

  /** Return unread and approval counts for the caller. */
  count(userId: string): Promise<{ unread: number; pendingApprovals: number }> {
    return countInboxNotifications(this.db, userId);
  }

  /** Return one caller-owned notification, or null when missing/hidden. */
  async get(userId: string, id: string): Promise<z.input<typeof NotificationOut> | null> {
    const row = await getInboxNotification(this.db, userId, id);
    return row ? ((await serializeInboxNotifications(this.db, [row]))[0] ?? null) : null;
  }

  /** Mark caller-owned unread notifications read. */
  async readAll(
    userId: string,
    filters: Pick<NotificationInboxFilters, 'organizationId' | 'type'>,
  ): Promise<{ updated: number }> {
    return { updated: await markInboxNotificationsRead(this.db, userId, filters) };
  }

  /** Mark one caller-owned notification read. */
  async markRead(userId: string, id: string): Promise<z.input<typeof NotificationOut> | null> {
    const row = await markInboxNotificationRead(this.db, userId, id);
    return row ? ((await serializeInboxNotifications(this.db, [row]))[0] ?? null) : null;
  }

  /** Apply one inline caller-owned notification action. */
  async act(userId: string, id: string): Promise<z.input<typeof NotificationOut> | null> {
    const row = await actOnInboxNotification(this.db, userId, id);
    return row ? ((await serializeInboxNotifications(this.db, [row]))[0] ?? null) : null;
  }
}

/** Serialize one inbox row into the public notification DTO shape. */
export function toNotificationOut(n: NotificationRow): z.input<typeof NotificationOut> {
  return toNotificationOutWithDeliveryChannels(n, []);
}

function toNotificationOutWithDeliveryChannels(
  n: NotificationRow,
  deliveryChannels: readonly NotificationDeliveryHint[],
): z.input<typeof NotificationOut> {
  return {
    id: n.id,
    userId: n.userId,
    organizationId: n.organizationId,
    type: n.type,
    body: deliveryChannels.length > 0 ? { ...n.body, deliveryChannels } : n.body,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

/** Serialize inbox rows with compact sibling-delivery hints when backed by an intent graph. */
async function serializeInboxNotifications(
  db: Database,
  rows: readonly NotificationRow[],
): Promise<z.input<typeof NotificationOut>[]> {
  const hints = await deliveryHintsByNotificationId(db, rows);
  return rows.map((row) => toNotificationOutWithDeliveryChannels(row, hints.get(row.id) ?? []));
}

async function deliveryHintsByNotificationId(
  db: Database,
  rows: readonly NotificationRow[],
): Promise<ReadonlyMap<string, readonly NotificationDeliveryHint[]>> {
  const deliveryIds = rows
    .map((row) => row.deliveryId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (deliveryIds.length === 0) return new Map();

  const webDeliveries = await db
    .select()
    .from(notificationDeliveryTable)
    .where(inArray(notificationDeliveryTable.id, deliveryIds));
  const webDeliveryById = new Map(webDeliveries.map((delivery) => [delivery.id, delivery]));
  const recipientIds = [...new Set(webDeliveries.map((delivery) => delivery.recipientId))];
  if (recipientIds.length === 0) return new Map();

  const siblingDeliveries = await db
    .select()
    .from(notificationDeliveryTable)
    .where(inArray(notificationDeliveryTable.recipientId, recipientIds));
  const byRecipient = new Map<string, NotificationDeliveryRow[]>();
  for (const delivery of siblingDeliveries) {
    const current = byRecipient.get(delivery.recipientId) ?? [];
    current.push(delivery);
    byRecipient.set(delivery.recipientId, current);
  }

  return new Map(
    rows.flatMap((row) => {
      const webDelivery = row.deliveryId ? webDeliveryById.get(row.deliveryId) : undefined;
      if (!webDelivery) return [];
      const deliveryChannels = (byRecipient.get(webDelivery.recipientId) ?? [])
        .map(toDeliveryHint)
        .sort(compareDeliveryHints);
      return deliveryChannels.length > 0 ? [[row.id, deliveryChannels] as const] : [];
    }),
  );
}

function toDeliveryHint(delivery: NotificationDeliveryRow): NotificationDeliveryHint {
  const masked = delivery.destination.valueMasked;
  return {
    channel: delivery.channel,
    status: delivery.status,
    ...(typeof masked === 'string' && masked.length > 0 ? { valueMasked: masked } : {}),
  };
}

const deliveryChannelOrder = new Map([
  ['web', 0],
  ['email', 1],
  ['sms', 2],
  ['push', 3],
]);

function compareDeliveryHints(a: NotificationDeliveryHint, b: NotificationDeliveryHint): number {
  return (deliveryChannelOrder.get(a.channel) ?? 99) - (deliveryChannelOrder.get(b.channel) ?? 99);
}

/** Return the caller-owned inbox rows, newest first. */
export async function listInboxNotifications(
  db: Database,
  userId: string,
  filters: NotificationInboxFilters = {},
): Promise<NotificationRow[]> {
  return db
    .select()
    .from(notificationTable)
    .where(inboxWhere(userId, filters))
    .orderBy(desc(notificationTable.createdAt));
}

/** Return one caller-owned notification, or null when missing/hidden by ownership. */
export async function getInboxNotification(
  db: Database,
  userId: string,
  id: string,
): Promise<NotificationRow | null> {
  const [row] = await db
    .select()
    .from(notificationTable)
    .where(and(eq(notificationTable.id, id), eq(notificationTable.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Return unread and approval counts for the caller's notification inbox. */
export async function countInboxNotifications(
  db: Database,
  userId: string,
): Promise<{ unread: number; pendingApprovals: number }> {
  const rows = await db
    .select({ type: notificationTable.type })
    .from(notificationTable)
    .where(inboxWhere(userId, { unreadOnly: true }));
  return {
    unread: rows.length,
    pendingApprovals: rows.filter((r) => r.type === 'approval_request').length,
  };
}

/** Mark unread caller-owned notifications read and return the transition count. */
export async function markInboxNotificationsRead(
  db: Database,
  userId: string,
  filters: Pick<NotificationInboxFilters, 'organizationId' | 'type'> = {},
): Promise<number> {
  const updated = await db
    .update(notificationTable)
    .set({ readAt: new Date() })
    .where(inboxWhere(userId, { ...filters, unreadOnly: true }))
    .returning({ id: notificationTable.id });
  return updated.length;
}

/** Mark one caller-owned notification read, returning null when missing/hidden. */
export async function markInboxNotificationRead(
  db: Database,
  userId: string,
  id: string,
): Promise<NotificationRow | null> {
  const updated = await db
    .update(notificationTable)
    .set({ readAt: new Date() })
    .where(and(eq(notificationTable.id, id), eq(notificationTable.userId, userId)))
    .returning();
  return updated[0] ?? null;
}

/** Apply an inline inbox action; the persisted model records this as read. */
export async function actOnInboxNotification(
  db: Database,
  userId: string,
  id: string,
): Promise<NotificationRow | null> {
  return markInboxNotificationRead(db, userId, id);
}

function inboxWhere(userId: string, filters: NotificationInboxFilters = {}): SQL | undefined {
  const conditions: (SQL | undefined)[] = [eq(notificationTable.userId, userId)];
  if (filters.organizationId !== undefined) {
    conditions.push(eq(notificationTable.organizationId, filters.organizationId));
  }
  if (filters.type !== undefined) conditions.push(eq(notificationTable.type, filters.type));
  if (filters.unreadOnly) conditions.push(isNull(notificationTable.readAt));
  return and(...conditions);
}
