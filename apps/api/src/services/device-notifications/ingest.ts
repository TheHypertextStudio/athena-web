/**
 * `@docket/api` — storing one upload batch from a person's phone.
 *
 * @remarks
 * A batch is answered item by item, in request order, so the phone can settle each queued row on
 * its own. The whole batch runs in one transaction: the uploader's expired rows are deleted first,
 * then notifications are classified and inserted, then removals — so a removal can refer to a
 * notification uploaded earlier in the same batch.
 *
 * Classification order for a notification: `invalid` (fails {@link DeviceNotificationIn}),
 * `duplicate` (its id appeared earlier in this batch), `expired` (captured longer ago than the
 * device's retention), `deleted` (a delete of everything or of its app happened at or after its
 * capture), then an insert-or-ignore that answers `stored` or `duplicate`. Messages are stored only
 * with a notification stored now, insert-or-ignore on the person's message identity.
 *
 * Nothing here logs item content.
 */
import {
  deviceNotification,
  deviceNotificationMessage,
  deviceNotificationRemoval,
  deviceNotificationSource,
  db,
  type Database,
} from '@docket/db';
import {
  DeviceNotificationIn,
  DeviceNotificationRemovalIn,
  type DeviceNotificationBatchIn,
  type DeviceNotificationBatchOut,
  type DeviceNotificationItemResult,
} from '@docket/athena/device-notification-contract';
import { and, eq, inArray } from 'drizzle-orm';

import { NotFoundError } from '../../error';
import { purgeExpiredForHub } from './expiry';
import {
  DAY_MILLISECONDS,
  findSource,
  isDeleted,
  loadDeletionLookup,
  type DeletionLookup,
} from './store';

/** Rows per insert statement, well under Postgres's bind-parameter ceiling. */
const INSERT_CHUNK = 500;

type BatchItem = DeviceNotificationBatchIn['notifications'][number];
type NotificationInsert = typeof deviceNotification.$inferInsert;
type MessageInsert = typeof deviceNotificationMessage.$inferInsert;

/** What the classification pass needs to know about the caller and the moment. */
interface IngestContext {
  readonly database: Database;
  readonly hubId: string;
  readonly sourceId: string;
  readonly retentionMilliseconds: number;
  readonly deletions: DeletionLookup;
  readonly now: Date;
}

/** A notification that survived classification and will be inserted. */
interface Candidate {
  readonly index: number;
  readonly row: NotificationInsert;
  readonly messages: readonly MessageInsert[];
}

/** Split rows into insert-sized chunks. */
function chunks<T>(rows: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
    out.push(rows.slice(start, start + INSERT_CHUNK));
  }
  return out;
}

/** Map a validated notification to its row and its messages' rows. */
function toRows(
  context: IngestContext,
  input: DeviceNotificationIn,
): { row: NotificationInsert; messages: MessageInsert[] } {
  const capturedAt = new Date(input.capturedAt);
  const { hubId } = context;
  return {
    row: {
      hubId,
      id: input.id,
      sourceId: context.sourceId,
      platform: input.platform,
      extractorVersion: input.extractorVersion,
      appId: input.appId,
      appName: input.appName,
      sourceKey: input.sourceKey,
      threadId: input.threadId,
      threadTitle: input.threadTitle,
      kind: input.kind,
      postedAt: new Date(input.postedAt),
      capturedAt,
      title: input.title,
      subtitle: input.subtitle,
      body: input.body,
      lines: input.lines,
      redacted: input.redacted,
      scrubbed: input.scrubbed,
      backfilled: input.backfilled,
      contentHash: input.contentHash,
      androidChannelId: input.android?.channelId ?? null,
      androidCategory: input.android?.category ?? null,
      androidWhenAt: input.android ? new Date(input.android.whenAt) : null,
      androidShortcutId: input.android?.shortcutId ?? null,
      receivedAt: context.now,
      expiresAt: new Date(capturedAt.getTime() + context.retentionMilliseconds),
    },
    messages: input.messages.map((message) => ({
      hubId,
      id: message.id,
      notificationId: input.id,
      threadId: message.threadId,
      sender: message.sender,
      sentAt: new Date(message.sentAt),
      text: message.text,
      identity: message.identity,
    })),
  };
}

/** Classify one notification before any insert, or return the candidate to insert. */
function classify(
  context: IngestContext,
  item: BatchItem,
  index: number,
  seen: Set<string>,
): DeviceNotificationItemResult['status'] | Candidate {
  const parsed = DeviceNotificationIn.safeParse(item);
  if (!parsed.success) return 'invalid';
  const input = parsed.data;
  if (seen.has(input.id)) return 'duplicate';
  seen.add(input.id);
  const capturedAt = new Date(input.capturedAt);
  if (capturedAt.getTime() + context.retentionMilliseconds <= context.now.getTime()) {
    return 'expired';
  }
  if (isDeleted(context.deletions, input.appId, capturedAt)) return 'deleted';
  return { index, ...toRows(context, input) };
}

/** Classify, insert, and answer every notification in the batch. */
async function storeNotifications(
  context: IngestContext,
  items: readonly BatchItem[],
): Promise<DeviceNotificationItemResult[]> {
  const results: DeviceNotificationItemResult[] = items.map((item) => ({
    id: item.id,
    status: 'invalid',
  }));
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  items.forEach((item, index) => {
    const outcome = classify(context, item, index, seen);
    if (typeof outcome === 'string') results[index] = { id: item.id, status: outcome };
    else candidates.push(outcome);
  });
  if (candidates.length === 0) return results;
  const inserted = await context.database
    .insert(deviceNotification)
    .values(candidates.map((candidate) => candidate.row))
    .onConflictDoNothing()
    .returning({ id: deviceNotification.id });
  const stored = new Set(inserted.map((row) => row.id));
  const messages: MessageInsert[] = [];
  for (const candidate of candidates) {
    const isStored = stored.has(candidate.row.id);
    results[candidate.index] = { id: candidate.row.id, status: isStored ? 'stored' : 'duplicate' };
    if (isStored) messages.push(...candidate.messages);
  }
  for (const chunk of chunks(messages)) {
    await context.database.insert(deviceNotificationMessage).values(chunk).onConflictDoNothing();
  }
  return results;
}

/** Validate, insert, and answer every removal in the batch. */
async function storeRemovals(
  database: Database,
  hubId: string,
  items: DeviceNotificationBatchIn['removals'],
): Promise<DeviceNotificationItemResult[]> {
  const results: DeviceNotificationItemResult[] = items.map((item) => ({
    id: item.id,
    status: 'invalid',
  }));
  const seenIds = new Set<string>();
  const seenNotifications = new Set<string>();
  const valid: { index: number; input: DeviceNotificationRemovalIn }[] = [];
  items.forEach((item, index) => {
    const parsed = DeviceNotificationRemovalIn.safeParse(item);
    if (!parsed.success) return;
    const input = parsed.data;
    if (seenIds.has(input.id) || seenNotifications.has(input.notificationId)) {
      results[index] = { id: input.id, status: 'duplicate' };
      return;
    }
    seenIds.add(input.id);
    seenNotifications.add(input.notificationId);
    valid.push({ index, input });
  });
  if (valid.length === 0) return results;
  const held = await database
    .select({ id: deviceNotification.id })
    .from(deviceNotification)
    .where(
      and(
        eq(deviceNotification.hubId, hubId),
        inArray(
          deviceNotification.id,
          valid.map(({ input }) => input.notificationId),
        ),
      ),
    );
  const heldIds = new Set(held.map((row) => row.id));
  const insertable = valid.filter(({ index, input }) => {
    if (heldIds.has(input.notificationId)) return true;
    results[index] = { id: input.id, status: 'orphaned' };
    return false;
  });
  if (insertable.length === 0) return results;
  const inserted = await database
    .insert(deviceNotificationRemoval)
    .values(
      insertable.map(({ input }) => ({
        hubId,
        id: input.id,
        notificationId: input.notificationId,
        removedAt: new Date(input.removedAt),
        reason: input.reason,
        platformReason: input.platformReason,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: deviceNotificationRemoval.id });
  const stored = new Set(inserted.map((row) => row.id));
  for (const { index, input } of insertable) {
    results[index] = { id: input.id, status: stored.has(input.id) ? 'stored' : 'duplicate' };
  }
  return results;
}

/**
 * Store one upload batch for the caller and answer every item.
 *
 * @throws {NotFoundError} 404 when the batch names a device the caller has not registered.
 */
export async function ingestBatch(
  hubId: string,
  batch: DeviceNotificationBatchIn,
  now = new Date(),
  database: Database = db,
): Promise<DeviceNotificationBatchOut> {
  return database.transaction(async (tx) => {
    const source = await findSource(hubId, batch.deviceId, tx);
    if (!source) throw new NotFoundError('Device is not registered');
    await tx
      .update(deviceNotificationSource)
      .set({ lastSeenAt: now, updatedAt: source.updatedAt })
      .where(
        and(eq(deviceNotificationSource.hubId, hubId), eq(deviceNotificationSource.id, source.id)),
      );
    await purgeExpiredForHub(tx, hubId, now);
    const context: IngestContext = {
      database: tx,
      hubId,
      sourceId: source.id,
      retentionMilliseconds: source.retentionDays * DAY_MILLISECONDS,
      deletions: await loadDeletionLookup(hubId, tx),
      now,
    };
    const notifications = await storeNotifications(context, batch.notifications);
    const removals = await storeRemovals(tx, hubId, batch.removals);
    return { notifications, removals };
  });
}
