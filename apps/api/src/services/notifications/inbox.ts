import type { Database, notification } from '@docket/db';
import { notification as notificationTable } from '@docket/db';
import type { NotificationOut } from '@docket/types';
import { and, desc, eq, isNull, type SQL } from 'drizzle-orm';
import type { z } from 'zod';

type NotificationRow = typeof notification.$inferSelect;

/** Optional narrowing filters for a signed-in user's notification inbox. */
export interface NotificationInboxFilters {
  readonly organizationId?: string;
  readonly type?: NotificationRow['type'];
  readonly unreadOnly?: boolean;
}

/** Application-facing notification inbox operations. */
export interface NotificationInboxUseCases {
  /** Return caller-owned notifications, newest first. */
  readonly list: (
    userId: string,
    filters: NotificationInboxFilters,
  ) => Promise<{ items: z.input<typeof NotificationOut>[] }>;
  /** Return unread and approval counts for the caller. */
  readonly count: (userId: string) => Promise<{ unread: number; pendingApprovals: number }>;
  /** Return one caller-owned notification, or null when missing/hidden. */
  readonly get: (userId: string, id: string) => Promise<z.input<typeof NotificationOut> | null>;
  /** Mark caller-owned unread notifications read. */
  readonly readAll: (
    userId: string,
    filters: Pick<NotificationInboxFilters, 'organizationId' | 'type'>,
  ) => Promise<{ updated: number }>;
  /** Mark one caller-owned notification read. */
  readonly markRead: (
    userId: string,
    id: string,
  ) => Promise<z.input<typeof NotificationOut> | null>;
  /** Apply one inline caller-owned notification action. */
  readonly act: (
    userId: string,
    id: string,
    action: string,
  ) => Promise<z.input<typeof NotificationOut> | null>;
}

/** Build database-backed notification inbox use cases. */
export function createNotificationInboxUseCases(db: Database): NotificationInboxUseCases {
  return {
    async list(userId, filters) {
      const rows = await listInboxNotifications(db, userId, filters);
      return { items: rows.map(toNotificationOut) };
    },
    count(userId) {
      return countInboxNotifications(db, userId);
    },
    async get(userId, id) {
      const row = await getInboxNotification(db, userId, id);
      return row ? toNotificationOut(row) : null;
    },
    async readAll(userId, filters) {
      return { updated: await markInboxNotificationsRead(db, userId, filters) };
    },
    async markRead(userId, id) {
      const row = await markInboxNotificationRead(db, userId, id);
      return row ? toNotificationOut(row) : null;
    },
    async act(userId, id) {
      const row = await actOnInboxNotification(db, userId, id);
      return row ? toNotificationOut(row) : null;
    },
  };
}

/** Serialize one inbox row into the public notification DTO shape. */
export function toNotificationOut(n: NotificationRow): z.input<typeof NotificationOut> {
  return {
    id: n.id,
    userId: n.userId,
    organizationId: n.organizationId,
    type: n.type,
    body: n.body,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
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
