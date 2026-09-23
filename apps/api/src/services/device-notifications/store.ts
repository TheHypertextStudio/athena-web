/**
 * `@docket/api` — reads and writes of the server copy of a person's synced phone notifications.
 *
 * @remarks
 * Every function takes the caller's hub id, which routes resolve from the session and never from
 * the request, so no query here can reach another person's rows. Uploads live in
 * {@link ./ingest}; the upload rate limit in {@link ./upload-window}; expiry in {@link ./expiry}.
 * Nothing here logs notification content.
 */
import {
  db,
  deviceNotification,
  deviceNotificationDeletion,
  deviceNotificationMessage,
  deviceNotificationRemoval,
  deviceNotificationSource,
  type Database,
} from '@docket/db';
import type {
  DeviceNotificationDeleteOut,
  DeviceNotificationDeleteQuery,
  DeviceNotificationDeletionsOut,
  DeviceNotificationListOut,
  DeviceNotificationListQuery,
  DeviceNotificationOut,
  DeviceNotificationSourceIn,
  DeviceNotificationSourceOut,
} from '@docket/athena/device-notification-contract';
import { and, asc, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';

import { pageResult, seekAfter } from '../../lib/list-cursor';

type SourceRow = typeof deviceNotificationSource.$inferSelect;
type NotificationRow = typeof deviceNotification.$inferSelect;
type MessageRow = typeof deviceNotificationMessage.$inferSelect;
type RemovalRow = typeof deviceNotificationRemoval.$inferSelect;

/** Milliseconds in one retention day. */
export const DAY_MILLISECONDS = 86_400_000;

/** Present a source row on the wire. */
export function presentSource(row: SourceRow): DeviceNotificationSourceOut {
  return {
    deviceId: row.id,
    platform: row.platform,
    label: row.label,
    retentionDays: row.retentionDays,
    syncConsentedAt: row.syncConsentedAt.getTime(),
    lastSeenAt: row.lastSeenAt.getTime(),
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

/**
 * Register a device for the caller, or update its label, retention, and consent time.
 *
 * @remarks
 * A shorter retention applies to uploads from now on; rows already stored keep the expiry they
 * were stored with and the expiry sweep removes them on that schedule.
 */
export async function registerSource(
  hubId: string,
  deviceId: string,
  input: DeviceNotificationSourceIn,
  now = new Date(),
  database: Database = db,
): Promise<DeviceNotificationSourceOut> {
  const values = {
    platform: input.platform,
    label: input.label,
    retentionDays: input.retentionDays,
    syncConsentedAt: new Date(input.syncConsentedAt),
    lastSeenAt: now,
    updatedAt: now,
  };
  const [row] = await database
    .insert(deviceNotificationSource)
    .values({ hubId, id: deviceId, ...values, createdAt: now })
    .onConflictDoUpdate({
      target: [deviceNotificationSource.hubId, deviceNotificationSource.id],
      set: values,
    })
    .returning();
  if (!row) throw new Error('device notification source upsert returned no row');
  return presentSource(row);
}

/** Read the deletion times a phone applies to its own copy. */
export async function readDeletions(
  hubId: string,
  database: Database = db,
): Promise<DeviceNotificationDeletionsOut> {
  const rows = await database
    .select({
      appId: deviceNotificationDeletion.appId,
      deletedBefore: deviceNotificationDeletion.deletedBefore,
    })
    .from(deviceNotificationDeletion)
    .where(eq(deviceNotificationDeletion.hubId, hubId))
    .orderBy(asc(deviceNotificationDeletion.appId));
  const all = rows.find((row) => row.appId === null);
  return {
    deletedBefore: all ? all.deletedBefore.getTime() : null,
    apps: rows.flatMap((row) =>
      row.appId === null ? [] : [{ appId: row.appId, deletedBefore: row.deletedBefore.getTime() }],
    ),
  };
}

/**
 * Delete the caller's synced notifications from every device — all of them, or one app's — that
 * were captured at or before the deletion time, and record that time so late uploads of older
 * entries are refused.
 *
 * @remarks
 * The deletion time is `before` when the phone says when the person asked (a queued delete sent
 * late), clamped to `now`, and `now` otherwise. Entries captured after it survive, so a delete that
 * waited offline never takes what the phone captured in the meantime. Messages and removals go with
 * their notifications through the foreign-key cascade. A scope's recorded time only ever moves
 * forward: a later delete with an earlier `before` keeps the existing time.
 */
export async function deleteNotifications(
  hubId: string,
  scope: DeviceNotificationDeleteQuery,
  now = new Date(),
  database: Database = db,
): Promise<DeviceNotificationDeleteOut> {
  const { appId, before } = scope;
  const deletedBefore = before === undefined ? now : new Date(Math.min(before, now.getTime()));
  return database.transaction(async (tx) => {
    const deleted = await tx
      .delete(deviceNotification)
      .where(
        and(
          eq(deviceNotification.hubId, hubId),
          lte(deviceNotification.capturedAt, deletedBefore),
          appId === undefined ? undefined : eq(deviceNotification.appId, appId),
        ),
      )
      .returning({ id: deviceNotification.id });
    await tx
      .insert(deviceNotificationDeletion)
      .values({ hubId, appId: appId ?? null, deletedBefore, updatedAt: now })
      .onConflictDoUpdate({
        target: [deviceNotificationDeletion.hubId, deviceNotificationDeletion.appId],
        set: {
          deletedBefore: sql`greatest(${deviceNotificationDeletion.deletedBefore}, excluded.deleted_before)`,
          updatedAt: now,
        },
      });
    return { deleted: deleted.length };
  });
}

/** Present one stored notification with its messages and removal. */
export function presentNotification(
  row: NotificationRow,
  messages: readonly MessageRow[],
  removal: RemovalRow | undefined,
): DeviceNotificationOut {
  return {
    id: row.id,
    deviceId: row.sourceId,
    platform: row.platform,
    extractorVersion: row.extractorVersion,
    appId: row.appId,
    appName: row.appName,
    sourceKey: row.sourceKey,
    threadId: row.threadId,
    threadTitle: row.threadTitle,
    kind: row.kind,
    postedAt: row.postedAt.getTime(),
    capturedAt: row.capturedAt.getTime(),
    title: row.title,
    subtitle: row.subtitle,
    body: row.body,
    lines: row.lines,
    redacted: row.redacted,
    scrubbed: row.scrubbed,
    backfilled: row.backfilled,
    contentHash: row.contentHash,
    android:
      row.androidWhenAt === null
        ? null
        : {
            channelId: row.androidChannelId,
            category: row.androidCategory,
            whenAt: row.androidWhenAt.getTime(),
            shortcutId: row.androidShortcutId,
          },
    messages: messages.map((message) => ({
      id: message.id,
      threadId: message.threadId,
      sender: message.sender,
      sentAt: message.sentAt.getTime(),
      text: message.text,
      identity: message.identity,
    })),
    removal: removal
      ? {
          id: removal.id,
          removedAt: removal.removedAt.getTime(),
          reason: removal.reason,
          platformReason: removal.platformReason,
        }
      : null,
    receivedAt: row.receivedAt.getTime(),
    expiresAt: row.expiresAt.getTime(),
  };
}

/** Load the messages and removals of a set of the caller's notifications. */
export async function loadChildren(
  hubId: string,
  notificationIds: readonly string[],
  database: Database = db,
): Promise<{ messages: Map<string, MessageRow[]>; removals: Map<string, RemovalRow> }> {
  const messages = new Map<string, MessageRow[]>();
  const removals = new Map<string, RemovalRow>();
  if (notificationIds.length === 0) return { messages, removals };
  const ids = [...notificationIds];
  const [messageRows, removalRows] = await Promise.all([
    database
      .select()
      .from(deviceNotificationMessage)
      .where(
        and(
          eq(deviceNotificationMessage.hubId, hubId),
          inArray(deviceNotificationMessage.notificationId, ids),
        ),
      )
      .orderBy(asc(deviceNotificationMessage.sentAt), asc(deviceNotificationMessage.id)),
    database
      .select()
      .from(deviceNotificationRemoval)
      .where(
        and(
          eq(deviceNotificationRemoval.hubId, hubId),
          inArray(deviceNotificationRemoval.notificationId, ids),
        ),
      ),
  ]);
  for (const message of messageRows) {
    const list = messages.get(message.notificationId) ?? [];
    list.push(message);
    messages.set(message.notificationId, list);
  }
  for (const removal of removalRows) removals.set(removal.notificationId, removal);
  return { messages, removals };
}

/**
 * List the caller's synced notifications, newest capture first, one keyset page at a time.
 *
 * @remarks
 * Rows past their expiry are left out even before the sweep deletes them.
 */
export async function listNotifications(
  hubId: string,
  query: DeviceNotificationListQuery,
  now = new Date(),
  database: Database = db,
): Promise<DeviceNotificationListOut> {
  const rows = await database
    .select()
    .from(deviceNotification)
    .where(
      and(
        eq(deviceNotification.hubId, hubId),
        gt(deviceNotification.expiresAt, now),
        query.appId === undefined ? undefined : eq(deviceNotification.appId, query.appId),
        seekAfter(deviceNotification.capturedAt, deviceNotification.id, query.cursor),
      ),
    )
    .orderBy(desc(deviceNotification.capturedAt), desc(deviceNotification.id))
    .limit(query.limit + 1);
  const page = pageResult(rows, query.limit, (row) => row.capturedAt);
  const { messages, removals } = await loadChildren(
    hubId,
    page.items.map((row) => row.id),
    database,
  );
  return {
    items: page.items.map((row) =>
      presentNotification(row, messages.get(row.id) ?? [], removals.get(row.id)),
    ),
    nextCursor: page.nextCursor ?? null,
  };
}

/** Whether the caller has registered this device. */
export async function findSource(
  hubId: string,
  deviceId: string,
  database: Database = db,
): Promise<SourceRow | undefined> {
  const [row] = await database
    .select()
    .from(deviceNotificationSource)
    .where(
      and(eq(deviceNotificationSource.hubId, hubId), eq(deviceNotificationSource.id, deviceId)),
    )
    .limit(1);
  return row;
}

/** The caller's deletion times, as a lookup the upload path checks each item against. */
export interface DeletionLookup {
  /** The delete-everything time, if any. */
  readonly all: Date | null;
  /** Each app's deletion time. */
  readonly apps: ReadonlyMap<string, Date>;
}

/** Load the caller's deletion times for the upload path. */
export async function loadDeletionLookup(
  hubId: string,
  database: Database = db,
): Promise<DeletionLookup> {
  const rows = await database
    .select()
    .from(deviceNotificationDeletion)
    .where(eq(deviceNotificationDeletion.hubId, hubId));
  const all = rows.find((row) => row.appId === null)?.deletedBefore ?? null;
  const apps = new Map<string, Date>();
  for (const row of rows) if (row.appId !== null) apps.set(row.appId, row.deletedBefore);
  return { all, apps };
}

/** Whether a deletion made at or after `capturedAt` covers an entry of `appId`. */
export function isDeleted(lookup: DeletionLookup, appId: string, capturedAt: Date): boolean {
  const app = lookup.apps.get(appId);
  return (
    (lookup.all !== null && lookup.all >= capturedAt) || (app !== undefined && app >= capturedAt)
  );
}
