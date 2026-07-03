/**
 * `@docket/api` — the provider write outbox.
 *
 * @remarks
 * The outbound half of the layered-calendar sync story: `calendar-write.ts` enqueues a
 * `calendar_item_write` row for every `provider_event` PATCH/DELETE, then calls
 * {@link attemptCalendarItemWrite} once in the foreground so most edits round-trip to the
 * provider before the HTTP response returns. {@link drainDueCalendarItemWrites} re-runs
 * the same executor over every write that is due for a backoff retry — called from
 * `POST /me/calendar/sync` today; cron wiring is a later phase. Provider dispatch goes
 * through the same {@link CalendarProviderSyncModule} map the pull engine uses
 * (`calendar-sync-modules.ts`), so this module stays exactly as provider-free as
 * `calendar-sync-engine.ts` — it only ever calls `pushItem`/`deleteItem` through the
 * adapter contract those modules implement.
 */
import { calendarConnection, calendarItem, calendarItemWrite, type Database } from '@docket/db';
import { CalendarProvider, type CalendarItemConflict } from '@docket/types';
import { and, asc, desc, eq, inArray, isNull, lte, or } from 'drizzle-orm';

import { ConflictError, NotFoundError } from '../error';
import {
  archiveProviderItem,
  CalendarReauthRequiredError,
  type CalendarDeleteResult,
  type CalendarProviderCredentials,
  type CalendarProviderSyncModule,
  type CalendarPushResult,
  type ProviderItemSnapshot,
} from '../routes/calendar-sync-engine';

/**
 * {@link CalendarPushResult} and {@link CalendarDeleteResult} agree on every outcome
 * except `applied` (delete carries no snapshot). Normalizing both to this shape right
 * after dispatch lets the switch below handle both operations with one set of cases
 * instead of duplicating the five-outcome switch per operation.
 */
type NormalizedWriteResult =
  | { readonly outcome: 'applied'; readonly item: ProviderItemSnapshot | null }
  | { readonly outcome: 'conflict'; readonly current: ProviderItemSnapshot | null }
  | { readonly outcome: 'retryable'; readonly message: string }
  | { readonly outcome: 'permanent'; readonly message: string }
  | { readonly outcome: 'reauth'; readonly message: string };

function normalizePushResult(result: CalendarPushResult): NormalizedWriteResult {
  return result;
}

function normalizeDeleteResult(result: CalendarDeleteResult): NormalizedWriteResult {
  return result.outcome === 'applied' ? { outcome: 'applied', item: null } : result;
}

type CalendarItemWriteRow = typeof calendarItemWrite.$inferSelect;
type CalendarItemRow = typeof calendarItem.$inferSelect;

/** Base backoff for a write's 1st retry (doubles per subsequent attempt). */
export const BASE_BACKOFF_MS = 60_000;
/** Backoff never grows past this, however many attempts have accumulated. */
export const CAP_BACKOFF_MS = 3_600_000;
/** A write that has failed this many times converts from `'pending'` to `'failed'`. */
export const MAX_WRITE_ATTEMPTS = 8;

/** Exponential backoff (base 60s, doubling, capped at 1h) for the `attempts`-th failure. */
function computeBackoffMs(attempts: number): number {
  const backoff = BASE_BACKOFF_MS * 2 ** (attempts - 1);
  return Math.min(backoff, CAP_BACKOFF_MS);
}

/** Flatten a provider snapshot into the plain-object shape `CalendarItemConflict` stores. */
function providerSnapshotToRecord(snapshot: ProviderItemSnapshot | null): Record<string, unknown> {
  if (snapshot === null) return { available: false };
  return {
    available: true,
    externalEtag: snapshot.externalEtag,
    updatedExternalAt: snapshot.updatedExternalAt?.toISOString() ?? null,
    title: snapshot.title,
    description: snapshot.description,
    location: snapshot.location,
    startsAt: snapshot.startsAt?.toISOString() ?? null,
    endsAt: snapshot.endsAt?.toISOString() ?? null,
    allDayStartDate: snapshot.allDayStartDate,
    allDayEndDate: snapshot.allDayEndDate,
  };
}

/** Persist an `applied` outcome: stamp the item from the fresh snapshot, close the write. */
async function persistApplied(
  db: Database,
  write: CalendarItemWriteRow,
  item: CalendarItemRow,
  snapshot: ProviderItemSnapshot | null,
  now: Date,
): Promise<void> {
  if (write.operation === 'delete') {
    await archiveProviderItem(db, item.id, now);
    await db
      .update(calendarItem)
      .set({ syncState: 'clean', conflict: null, lastPushedAt: now })
      .where(eq(calendarItem.id, item.id));
  } else {
    /* v8 ignore next -- @preserve defensive: an 'update' operation always yields a snapshot */
    if (snapshot === null) throw new Error('applied update outcome missing its snapshot');
    await db
      .update(calendarItem)
      .set({
        externalEtag: snapshot.externalEtag,
        updatedExternalAt: snapshot.updatedExternalAt,
        lastPushedAt: now,
        syncState: 'clean',
        conflict: null,
      })
      .where(eq(calendarItem.id, item.id));
  }
  await db
    .update(calendarItemWrite)
    .set({ status: 'applied', lastError: null })
    .where(eq(calendarItemWrite.id, write.id));
}

/**
 * Persist a `conflict` outcome: the item's LOCAL field values are left untouched (only
 * `syncState`/`conflict` change), preserving the user's pending edit for manual
 * resolution or {@link retryCalendarItemWrite} rather than silently discarding it.
 */
async function persistConflict(
  db: Database,
  write: CalendarItemWriteRow,
  item: CalendarItemRow,
  current: ProviderItemSnapshot | null,
  now: Date,
): Promise<void> {
  const conflict: CalendarItemConflict = {
    localPatch: { ...write.patch },
    providerSnapshot: providerSnapshotToRecord(current),
    detectedAt: now.toISOString(),
  };
  await db
    .update(calendarItem)
    .set({ syncState: 'conflict', conflict })
    .where(eq(calendarItem.id, item.id));
  await db
    .update(calendarItemWrite)
    .set({ status: 'conflict' })
    .where(eq(calendarItemWrite.id, write.id));
}

/**
 * Persist a `permanent` outcome: the write can never succeed unmodified, so it is closed
 * out as `'failed'` immediately (no backoff, no further attempts).
 *
 * @param attempts - Overrides the persisted `attempts` count. A direct `'permanent'`
 *   outcome leaves it as-is (omit); an exhausted `'retryable'`/`'reauth'` run
 *   ({@link persistRetryableOrReauth}) passes the just-incremented count so the row
 *   accurately reflects how many attempts actually ran, not one fewer.
 */
async function persistPermanentFailure(
  db: Database,
  write: CalendarItemWriteRow,
  item: CalendarItemRow,
  message: string,
  attempts?: number,
): Promise<void> {
  await db
    .update(calendarItemWrite)
    .set({ status: 'failed', lastError: message, ...(attempts !== undefined ? { attempts } : {}) })
    .where(eq(calendarItemWrite.id, write.id));
  await db
    .update(calendarItem)
    .set({ syncState: 'provider_error' })
    .where(eq(calendarItem.id, item.id));
}

/**
 * Persist a `retryable` (transient) or `reauth` (invalid credential) outcome: both back
 * off identically — attempts increment, `nextAttemptAt` moves out exponentially, and
 * exhausting {@link MAX_WRITE_ATTEMPTS} converts the write to `'failed'` — except
 * `reauth` ALSO marks the connection `reauth_required` so the next successful re-auth
 * (Task 5's credential-resolution flow) naturally lets the next drain succeed.
 */
async function persistRetryableOrReauth(
  db: Database,
  write: CalendarItemWriteRow,
  item: CalendarItemRow,
  message: string,
  now: Date,
  reauthConnectionId: string | null,
): Promise<'retried' | 'failed'> {
  const attempts = write.attempts + 1;
  if (reauthConnectionId !== null) {
    await db
      .update(calendarConnection)
      .set({ status: 'reauth_required', lastError: message })
      .where(eq(calendarConnection.id, reauthConnectionId));
  }
  if (attempts >= MAX_WRITE_ATTEMPTS) {
    await persistPermanentFailure(db, write, item, message, attempts);
    return 'failed';
  }
  await db
    .update(calendarItemWrite)
    .set({
      status: 'pending',
      attempts,
      nextAttemptAt: new Date(now.getTime() + computeBackoffMs(attempts)),
      lastError: message,
    })
    .where(eq(calendarItemWrite.id, write.id));
  await db
    .update(calendarItem)
    .set({ syncState: 'push_pending' })
    .where(eq(calendarItem.id, item.id));
  return 'retried';
}

/**
 * Attempt one outbox write in the foreground: claim it, resolve credentials, dispatch to
 * the provider adapter, and persist exactly one of the five outcomes.
 *
 * @remarks
 * The claim (`UPDATE ... WHERE status = 'pending' RETURNING`) is atomic — a write already
 * claimed (by a concurrent foreground attempt or a racing drain) is simply skipped
 * (`null`), never double-applied. Credentials are resolved by re-running the provider
 * module's `discoverConnections` and matching on `externalAccountId` (the same
 * discover-then-resolve seam `calendar-sync-engine.ts` uses per connection) rather than
 * reconstructing a provider-specific `raw` payload here, which would leak adapter
 * internals into this provider-neutral module.
 *
 * @param db - The database client.
 * @param writeId - The `calendar_item_write` row to attempt.
 * @param syncModules - The provider → sync-module map (`createDefaultCalendarSyncModules()` in production).
 * @param now - Reference time, for deterministic tests.
 * @returns `'applied'` | `'conflict'` | `'retried'` (backed off, still pending) |
 *   `'failed'` (permanent, or retries exhausted) | `null` (not claimed — nothing to do).
 */
export async function attemptCalendarItemWrite(
  db: Database,
  writeId: string,
  syncModules: Partial<Record<CalendarProvider, CalendarProviderSyncModule>>,
  now: Date = new Date(),
): Promise<'applied' | 'conflict' | 'retried' | 'failed' | null> {
  const claimed = await db
    .update(calendarItemWrite)
    .set({ status: 'applying' })
    .where(and(eq(calendarItemWrite.id, writeId), eq(calendarItemWrite.status, 'pending')))
    .returning();
  const write = claimed[0];
  if (write === undefined) return null;

  const rows = await db
    .select({ item: calendarItem, connection: calendarConnection })
    .from(calendarItem)
    .innerJoin(calendarConnection, eq(calendarConnection.id, calendarItem.connectionId))
    .where(eq(calendarItem.id, write.calendarItemId))
    .limit(1);
  const row = rows[0];
  if (row === undefined) {
    // Defensive: the item (or its connection) vanished between enqueue and attempt.
    await db
      .update(calendarItemWrite)
      .set({ status: 'failed', lastError: 'Calendar item or connection no longer exists' })
      .where(eq(calendarItemWrite.id, write.id));
    return 'failed';
  }
  const { item, connection } = row;

  const provider = CalendarProvider.parse(write.provider);
  const syncModule = syncModules[provider];
  if (syncModule === undefined) {
    await persistPermanentFailure(
      db,
      write,
      item,
      `No sync module registered for provider '${provider}'`,
    );
    return 'failed';
  }

  let credentials: CalendarProviderCredentials;
  try {
    const discovered = await syncModule.discoverConnections({ db, userId: item.userId });
    const match = discovered.find((d) => d.externalAccountId === connection.externalAccountId);
    if (match === undefined) {
      throw new CalendarReauthRequiredError('Linked account no longer found');
    }
    credentials = await syncModule.resolveCredentials(match);
  } catch (err) {
    if (err instanceof CalendarReauthRequiredError) {
      const outcome = await persistRetryableOrReauth(
        db,
        write,
        item,
        err.message,
        now,
        connection.id,
      );
      return outcome;
    }
    const message = err instanceof Error ? err.message : 'Failed to resolve provider credentials';
    return await persistRetryableOrReauth(db, write, item, message, now, null);
  }

  /* v8 ignore next -- @preserve defensive: provider_event items always carry both external ids */
  if (item.externalCalendarId === null || item.externalEventId === null) {
    await persistPermanentFailure(
      db,
      write,
      item,
      'Calendar item is missing its provider identifiers',
    );
    return 'failed';
  }

  const result: NormalizedWriteResult =
    write.operation === 'delete'
      ? normalizeDeleteResult(
          await syncModule.adapter.deleteItem({
            credentials,
            externalLayerId: item.externalCalendarId,
            externalEventId: item.externalEventId,
            baseEtag: write.baseExternalEtag,
          }),
        )
      : normalizePushResult(
          await syncModule.adapter.pushItem({
            credentials,
            externalLayerId: item.externalCalendarId,
            externalEventId: item.externalEventId,
            patch: write.patch,
            baseEtag: write.baseExternalEtag,
          }),
        );

  switch (result.outcome) {
    case 'applied':
      await persistApplied(db, write, item, result.item, now);
      return 'applied';
    case 'conflict':
      await persistConflict(db, write, item, result.current, now);
      return 'conflict';
    case 'retryable':
      return await persistRetryableOrReauth(db, write, item, result.message, now, null);
    case 'permanent':
      await persistPermanentFailure(db, write, item, result.message);
      return 'failed';
    case 'reauth':
      return await persistRetryableOrReauth(db, write, item, result.message, now, connection.id);
  }
}

/** Tally of one {@link drainDueCalendarItemWrites} pass. */
export interface CalendarWriteDrainTally {
  readonly applied: number;
  readonly conflicts: number;
  readonly failed: number;
  readonly retried: number;
}

/**
 * Drain every outbox write that is due for a (re)attempt: `status = 'pending'` and
 * (`nextAttemptAt IS NULL` — never attempted — or its backoff has elapsed), oldest
 * first, up to `limit`.
 *
 * @remarks
 * Called from `POST /me/calendar/sync` after the inbound pull so a user-initiated "Sync
 * Now" also flushes backed-off writes; periodic cron draining is a later phase.
 */
export async function drainDueCalendarItemWrites(
  db: Database,
  opts: {
    readonly now: Date;
    readonly syncModules: Partial<Record<CalendarProvider, CalendarProviderSyncModule>>;
    readonly limit?: number;
  },
): Promise<CalendarWriteDrainTally> {
  const limit = opts.limit ?? 20;
  const dueRows = await db
    .select({ id: calendarItemWrite.id })
    .from(calendarItemWrite)
    .where(
      and(
        eq(calendarItemWrite.status, 'pending'),
        or(isNull(calendarItemWrite.nextAttemptAt), lte(calendarItemWrite.nextAttemptAt, opts.now)),
      ),
    )
    .orderBy(asc(calendarItemWrite.createdAt))
    .limit(limit);

  const tally = { applied: 0, conflicts: 0, failed: 0, retried: 0 };
  for (const row of dueRows) {
    const outcome = await attemptCalendarItemWrite(db, row.id, opts.syncModules, opts.now);
    if (outcome === 'applied') tally.applied += 1;
    else if (outcome === 'conflict') tally.conflicts += 1;
    else if (outcome === 'failed') tally.failed += 1;
    else if (outcome === 'retried') tally.retried += 1;
    // `null` means a concurrent run already claimed it — nothing to tally.
  }
  return tally;
}

/**
 * Count a user's currently pending outbox writes and conflicted calendar items — the
 * live state `POST /me/calendar/sync` reports alongside this run's `writesApplied`.
 */
export async function countCalendarWriteState(
  db: Database,
  userId: string,
): Promise<{ writesPending: number; conflicts: number }> {
  const pendingRows = await db
    .select({ id: calendarItemWrite.id })
    .from(calendarItemWrite)
    .where(and(eq(calendarItemWrite.userId, userId), eq(calendarItemWrite.status, 'pending')));
  const conflictRows = await db
    .select({ id: calendarItem.id })
    .from(calendarItem)
    .where(and(eq(calendarItem.userId, userId), eq(calendarItem.syncState, 'conflict')));
  return { writesPending: pendingRows.length, conflicts: conflictRows.length };
}

/**
 * Retry a `conflict`/`provider_error` item's pending write "with local changes" — i.e.
 * keep the local patch and re-anchor it against the provider's latest known state,
 * rather than discarding the user's edit.
 *
 * @remarks
 * Binding decision (this task): the ONLY anchor available after a conflict is whatever
 * the conflict snapshot captured, because re-anchoring to the item's OWN
 * `externalEtag`/`updatedExternalAt` would just replay the same stale anchor that
 * conflicted, and the adapter contract deliberately gained no `fetchItem` method to fetch
 * a fresh one out-of-band. So: when `item.conflict.providerSnapshot.externalEtag` is
 * present, re-anchor the write to it, clear the conflict, and reattempt in the
 * foreground. When absent (a plain `'failed'` write with no conflict snapshot at all, or
 * a conflict whose follow-up GET itself failed), the write is marked permanently failed
 * with a clear `lastError` — surfaced to the user as "open in provider" rather than
 * silently retried against an anchor we don't have.
 *
 * @throws {NotFoundError} When the item is not owned by `userId`, or no retryable write exists for it.
 * @throws {ConflictError} When the item has no retryable write, or no provider snapshot to re-anchor to.
 */
export async function retryCalendarItemWrite(
  db: Database,
  input: {
    userId: string;
    itemId: string;
    syncModules: Partial<Record<CalendarProvider, CalendarProviderSyncModule>>;
  },
): Promise<void> {
  const { userId, itemId, syncModules } = input;

  const itemRows = await db
    .select()
    .from(calendarItem)
    .where(
      and(
        eq(calendarItem.id, itemId),
        eq(calendarItem.userId, userId),
        isNull(calendarItem.archivedAt),
      ),
    )
    .limit(1);
  const item = itemRows[0];
  if (item === undefined) throw new NotFoundError('Calendar item not found');
  if (item.syncState !== 'conflict' && item.syncState !== 'provider_error') {
    throw new ConflictError('This item has no retryable write');
  }

  const writeRows = await db
    .select()
    .from(calendarItemWrite)
    .where(
      and(
        eq(calendarItemWrite.calendarItemId, item.id),
        inArray(calendarItemWrite.status, ['conflict', 'failed']),
      ),
    )
    .orderBy(desc(calendarItemWrite.createdAt))
    .limit(1);
  const write = writeRows[0];
  if (write === undefined) throw new NotFoundError('No retryable write found for this item');

  const snapshot = item.conflict?.providerSnapshot;
  const etag = typeof snapshot?.['externalEtag'] === 'string' ? snapshot['externalEtag'] : null;
  if (etag === null) {
    const lastError = 'Cannot retry without a provider snapshot — open the event in the provider';
    await db
      .update(calendarItemWrite)
      .set({ status: 'failed', lastError })
      .where(eq(calendarItemWrite.id, write.id));
    throw new ConflictError(lastError);
  }

  const updatedAtRaw = snapshot?.['updatedExternalAt'];
  const baseUpdatedExternalAt = typeof updatedAtRaw === 'string' ? new Date(updatedAtRaw) : null;

  await db
    .update(calendarItemWrite)
    .set({
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
      baseExternalEtag: etag,
      baseUpdatedExternalAt,
    })
    .where(eq(calendarItemWrite.id, write.id));
  await db
    .update(calendarItem)
    .set({ conflict: null, syncState: 'push_pending' })
    .where(eq(calendarItem.id, item.id));

  await attemptCalendarItemWrite(db, write.id, syncModules);
}
