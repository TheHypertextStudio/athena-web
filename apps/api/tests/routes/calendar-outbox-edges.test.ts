import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type { CalendarItemConflict } from '@docket/planning/calendar-contract';

import {
  attemptCalendarItemWrite,
  countCalendarWriteState,
  drainDueCalendarItemWrites,
  retryCalendarItemWrite,
} from '../../src/calendar/calendar-outbox';
import { ConflictError, NotFoundError } from '../../src/error';
import type {
  CalendarDeleteResult,
  CalendarProviderAdapter,
  CalendarProviderSyncModule,
  CalendarPushResult,
  DiscoveredCalendarConnection,
} from '../../src/routes/calendar-sync-engine';
import { getDb, one, seedUserWithHub } from '../support/routes-harness';

/**
 * Direct unit tests for `calendar-outbox.ts`'s executor/drain/retry functions, using a fake
 * `CalendarProviderSyncModule` (the module's own documented seam) instead of the real Google
 * adapter — the credential-resolution and "no sync module" failure modes this file targets
 * can't be reached through the real route (calendar-write-back.test.ts covers the
 * pushItem/deleteItem outcome switch via the real Google adapter already).
 */
let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

const NOW = new Date('2026-07-02T12:00:00.000Z');

/** A fake, fully-overridable `CalendarProviderSyncModule` under the `'google'` provider slot. */
function fakeSyncModule(overrides: {
  discoverConnections?: CalendarProviderSyncModule['discoverConnections'];
  resolveCredentials?: CalendarProviderSyncModule['resolveCredentials'];
  pushItem?: CalendarProviderAdapter['pushItem'];
  deleteItem?: CalendarProviderAdapter['deleteItem'];
  createItem?: CalendarProviderAdapter['createItem'];
  externalAccountId?: string;
}): CalendarProviderSyncModule {
  const accountId = overrides.externalAccountId ?? 'acct-1';
  const adapter: CalendarProviderAdapter = {
    provider: 'google',
    listLayers: async () => [],
    pullChanges: async () => ({ items: [], nextCursor: null, cursorInvalid: false, full: true }),
    pushItem:
      overrides.pushItem ??
      (async () => ({ outcome: 'permanent', message: 'pushItem not configured for this test' })),
    deleteItem:
      overrides.deleteItem ??
      (async () => ({ outcome: 'permanent', message: 'deleteItem not configured for this test' })),
    ...(overrides.createItem !== undefined ? { createItem: overrides.createItem } : {}),
  };
  return {
    adapter,
    discoverConnections:
      overrides.discoverConnections ??
      (async () => [
        {
          externalAccountId: accountId,
          accountEmail: null,
          accountName: null,
          accountPictureUrl: null,
          raw: null,
        } satisfies DiscoveredCalendarConnection,
      ]),
    resolveCredentials: overrides.resolveCredentials ?? (async () => ({ accessToken: 'tok' })),
    captureScopeState: () => ({
      grantedScopes: [],
      calendarRead: true,
      calendarWrite: true,
      capturedAt: NOW.toISOString(),
    }),
  };
}

/** Seed a linked Google `account` + `calendar_connection` + a `provider_event` calendar item. */
async function seedProviderEventItem(
  userId: string,
  overrides: {
    externalAccountId?: string;
    syncState?: string;
    conflict?: CalendarItemConflict | null;
  } = {},
): Promise<{ connectionId: string; itemId: string }> {
  const externalAccountId = overrides.externalAccountId ?? 'acct-1';
  await db
    .insert(schema.account)
    .values({ userId, providerId: 'google', accountId: externalAccountId });
  const connection = one(
    await db
      .insert(schema.calendarConnection)
      .values({
        userId,
        provider: 'google',
        externalAccountId,
        status: 'connected',
        scopeState: {
          grantedScopes: ['calendar'],
          calendarRead: true,
          calendarWrite: true,
          capturedAt: NOW.toISOString(),
        },
      })
      .returning({ id: schema.calendarConnection.id }),
  );
  const list = one(
    await db
      .insert(schema.calendarList)
      .values({
        userId,
        connectionId: connection.id,
        externalCalendarId: 'cal-1',
        title: 'Primary',
      })
      .returning({ id: schema.calendarList.id }),
  );
  await db.insert(schema.calendarLayer).values({
    id: list.id,
    userId,
    connectionId: connection.id,
    provider: 'google',
    sourceKind: 'provider_calendar',
    externalLayerId: 'cal-1',
    title: 'Primary',
    selected: true,
    visibleByDefault: true,
    editableCore: true,
  });
  const event = one(
    await db
      .insert(schema.calendarEvent)
      .values({
        userId,
        connectionId: connection.id,
        calendarId: list.id,
        externalCalendarId: 'cal-1',
        externalEventId: 'evt-1',
        title: 'Fixture event',
        status: 'confirmed',
        startsAt: new Date('2026-07-01T10:00:00.000Z'),
        endsAt: new Date('2026-07-01T11:00:00.000Z'),
      })
      .returning({ id: schema.calendarEvent.id }),
  );
  await db.insert(schema.calendarItem).values({
    id: event.id,
    userId,
    layerId: list.id,
    connectionId: connection.id,
    kind: 'provider_event',
    provider: 'google',
    externalCalendarId: 'cal-1',
    externalEventId: 'evt-1',
    title: 'Fixture event',
    status: 'confirmed',
    startsAt: new Date('2026-07-01T10:00:00.000Z'),
    endsAt: new Date('2026-07-01T11:00:00.000Z'),
    syncState: overrides.syncState ?? 'push_pending',
    conflict: overrides.conflict ?? null,
  });
  return { connectionId: connection.id, itemId: event.id };
}

/** Insert a `calendar_item_write` row for a seeded item. */
async function seedWrite(
  userId: string,
  itemId: string,
  connectionId: string,
  overrides: Partial<typeof schema.calendarItemWrite.$inferInsert> = {},
): Promise<string> {
  const row = one(
    await db
      .insert(schema.calendarItemWrite)
      .values({
        userId,
        calendarItemId: itemId,
        connectionId,
        provider: 'google',
        operation: 'update',
        patch: { title: 'New title' },
        status: 'pending',
        attempts: 0,
        ...overrides,
      })
      .returning({ id: schema.calendarItemWrite.id }),
  );
  return row.id;
}

async function loadWrite(writeId: string) {
  return one(
    await db
      .select()
      .from(schema.calendarItemWrite)
      .where(eq(schema.calendarItemWrite.id, writeId)),
  );
}

async function loadItem(itemId: string) {
  return one(await db.select().from(schema.calendarItem).where(eq(schema.calendarItem.id, itemId)));
}

async function loadConnection(connectionId: string) {
  return one(
    await db
      .select()
      .from(schema.calendarConnection)
      .where(eq(schema.calendarConnection.id, connectionId)),
  );
}

describe('attemptCalendarItemWrite', () => {
  it('returns null when the write is not pending (already claimed by a concurrent attempt)', async () => {
    const userId = await seedUserWithHub(db, schema, 'ClaimRace');
    const { connectionId, itemId } = await seedProviderEventItem(userId);
    const writeId = await seedWrite(userId, itemId, connectionId, { status: 'applying' });

    const outcome = await attemptCalendarItemWrite(
      db,
      writeId,
      { google: fakeSyncModule({}) },
      NOW,
    );
    expect(outcome).toBeNull();
  });

  it('fails when the calendar item (or its connection) no longer exists', async () => {
    const userId = await seedUserWithHub(db, schema, 'Vanished');
    const { connectionId, itemId } = await seedProviderEventItem(userId);
    const writeId = await seedWrite(userId, itemId, connectionId);
    // Simulate the genuine race this branch defends against (a concurrent delete of the item
    // between this function's claim and its lookup): the write's `calendarItemId`/`connectionId`
    // FKs both cascade on delete, so a normal delete would also cascade-delete the write row
    // itself, making the claim step return `null` instead of exercising this branch. Disabling
    // replication-role triggers for one statement lets the item vanish while leaving the
    // already-claimable write row dangling — exactly the on-disk state a real race would leave.
    await db.execute(sql`SET session_replication_role = replica`);
    await db.delete(schema.calendarItem).where(eq(schema.calendarItem.id, itemId));
    await db.execute(sql`SET session_replication_role = default`);

    const outcome = await attemptCalendarItemWrite(
      db,
      writeId,
      { google: fakeSyncModule({}) },
      NOW,
    );
    expect(outcome).toBe('failed');
    const write = await loadWrite(writeId);
    expect(write.status).toBe('failed');
    expect(write.lastError).toBe('Calendar item or connection no longer exists');
  });

  it('permanently fails when no sync module is registered for the write provider', async () => {
    const userId = await seedUserWithHub(db, schema, 'NoModule');
    const { connectionId, itemId } = await seedProviderEventItem(userId);
    const writeId = await seedWrite(userId, itemId, connectionId);

    const outcome = await attemptCalendarItemWrite(db, writeId, {}, NOW);
    expect(outcome).toBe('failed');
    const write = await loadWrite(writeId);
    expect(write.status).toBe('failed');
    expect(write.lastError).toBe("No sync module registered for provider 'google'");
    const item = await loadItem(itemId);
    expect(item.syncState).toBe('provider_error');
  });

  it('retries (never marks reauth_required) when discoverConnections finds no matching account', async () => {
    const userId = await seedUserWithHub(db, schema, 'NoMatch');
    const { connectionId, itemId } = await seedProviderEventItem(userId, {
      externalAccountId: 'acct-real',
    });
    const writeId = await seedWrite(userId, itemId, connectionId);
    const syncModules = {
      google: fakeSyncModule({
        discoverConnections: async () => [], // the linked account is gone
      }),
    };

    const outcome = await attemptCalendarItemWrite(db, writeId, syncModules, NOW);
    expect(outcome).toBe('retried');
    const write = await loadWrite(writeId);
    expect(write.status).toBe('pending');
    expect(write.attempts).toBe(1);
    expect(write.lastError).toBe('Linked account no longer found');
    // A reauth-classified credential failure marks the connection reauth_required.
    const connection = await loadConnection(connectionId);
    expect(connection.status).toBe('reauth_required');
  });

  it('retries on a generic resolveCredentials failure WITHOUT touching the connection status', async () => {
    const userId = await seedUserWithHub(db, schema, 'GenericCredFail');
    const { connectionId, itemId } = await seedProviderEventItem(userId);
    const writeId = await seedWrite(userId, itemId, connectionId);
    const syncModules = {
      google: fakeSyncModule({
        resolveCredentials: async () => {
          throw new Error('token service unreachable');
        },
      }),
    };

    const outcome = await attemptCalendarItemWrite(db, writeId, syncModules, NOW);
    expect(outcome).toBe('retried');
    const write = await loadWrite(writeId);
    expect(write.lastError).toBe('token service unreachable');
    const connection = await loadConnection(connectionId);
    expect(connection.status).toBe('connected'); // untouched — not a reauth-classified failure
  });

  it('falls back to a generic message when resolveCredentials throws a non-Error value', async () => {
    const userId = await seedUserWithHub(db, schema, 'ThrowsString');
    const { connectionId, itemId } = await seedProviderEventItem(userId);
    const writeId = await seedWrite(userId, itemId, connectionId);
    const syncModules = {
      google: fakeSyncModule({
        resolveCredentials: () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberately non-Error
          throw 'nope';
        },
      }),
    };

    const outcome = await attemptCalendarItemWrite(db, writeId, syncModules, NOW);
    expect(outcome).toBe('retried');
    const write = await loadWrite(writeId);
    expect(write.lastError).toBe('Failed to resolve provider credentials');
  });

  it('permanently fails a create write when the adapter has no createItem support', async () => {
    const userId = await seedUserWithHub(db, schema, 'NoCreate');
    const { connectionId, itemId } = await seedProviderEventItem(userId);
    const writeId = await seedWrite(userId, itemId, connectionId, { operation: 'create' });

    const outcome = await attemptCalendarItemWrite(
      db,
      writeId,
      { google: fakeSyncModule({}) },
      NOW,
    );
    expect(outcome).toBe('failed');
    const write = await loadWrite(writeId);
    expect(write.lastError).toBe("Provider 'google' does not support event creation");
  });

  it('applies a create write through a real createItem implementation', async () => {
    const userId = await seedUserWithHub(db, schema, 'CreateOk');
    const { connectionId, itemId } = await seedProviderEventItem(userId);
    const writeId = await seedWrite(userId, itemId, connectionId, { operation: 'create' });
    const pushResult: CalendarPushResult = {
      outcome: 'applied',
      item: {
        externalEventId: 'evt-1',
        recurringEventId: null,
        status: 'confirmed',
        title: 'Created',
        description: null,
        location: null,
        htmlLink: null,
        startsAt: new Date('2026-07-01T10:00:00.000Z'),
        endsAt: new Date('2026-07-01T11:00:00.000Z'),
        allDayStartDate: null,
        allDayEndDate: null,
        organizer: null,
        attendees: [],
        updatedExternalAt: new Date('2026-07-01T09:00:00.000Z'),
        externalEtag: 'etag-created',
        permissions: { canEditCore: true, canDelete: true, readOnlyReason: null },
        cancelled: false,
        raw: {},
      },
    };
    const syncModules = { google: fakeSyncModule({ createItem: async () => pushResult }) };

    const outcome = await attemptCalendarItemWrite(db, writeId, syncModules, NOW);
    expect(outcome).toBe('applied');
    const item = await loadItem(itemId);
    // persistApplied stamps provider-assigned metadata/etag, not content fields (those were
    // already applied locally before the push) — the local title is left untouched.
    expect(item.title).toBe('Fixture event');
    expect(item.externalEtag).toBe('etag-created');
    expect(item.syncState).toBe('clean');
  });

  it('permanently fails on a permanent delete outcome, marking the item provider_error', async () => {
    const userId = await seedUserWithHub(db, schema, 'DeletePermanent');
    const { connectionId, itemId } = await seedProviderEventItem(userId);
    const writeId = await seedWrite(userId, itemId, connectionId, { operation: 'delete' });
    const deleteResult: CalendarDeleteResult = { outcome: 'permanent', message: 'Event not found' };
    const syncModules = { google: fakeSyncModule({ deleteItem: async () => deleteResult }) };

    const outcome = await attemptCalendarItemWrite(db, writeId, syncModules, NOW);
    expect(outcome).toBe('failed');
    const write = await loadWrite(writeId);
    expect(write.lastError).toBe('Event not found');
    const item = await loadItem(itemId);
    expect(item.syncState).toBe('provider_error');
  });

  it('applies a delete outcome, archiving the item with no snapshot to stamp', async () => {
    const userId = await seedUserWithHub(db, schema, 'DeleteApplied');
    const { connectionId, itemId } = await seedProviderEventItem(userId);
    const writeId = await seedWrite(userId, itemId, connectionId, { operation: 'delete' });
    const syncModules = {
      google: fakeSyncModule({ deleteItem: async () => ({ outcome: 'applied' }) }),
    };

    const outcome = await attemptCalendarItemWrite(db, writeId, syncModules, NOW);
    expect(outcome).toBe('applied');
    const item = await loadItem(itemId);
    expect(item.archivedAt).not.toBeNull();
    expect(item.syncState).toBe('clean');
  });

  it('exhausts MAX_WRITE_ATTEMPTS via the reauth path, marking the write failed and the connection reauth_required', async () => {
    const userId = await seedUserWithHub(db, schema, 'ExhaustReauth');
    const { connectionId, itemId } = await seedProviderEventItem(userId);
    const writeId = await seedWrite(userId, itemId, connectionId, { attempts: 7 });
    const syncModules = {
      google: fakeSyncModule({
        pushItem: async () => ({ outcome: 'reauth', message: 'token expired' }),
      }),
    };

    const outcome = await attemptCalendarItemWrite(db, writeId, syncModules, NOW);
    expect(outcome).toBe('failed');
    const write = await loadWrite(writeId);
    expect(write.status).toBe('failed');
    expect(write.attempts).toBe(8);
    expect(write.lastError).toBe('token expired');
    const connection = await loadConnection(connectionId);
    expect(connection.status).toBe('reauth_required');
  });

  it('records an all-day conflict snapshot with null start/end timestamps (not left undefined)', async () => {
    const userId = await seedUserWithHub(db, schema, 'ConflictAllDay');
    const { connectionId, itemId } = await seedProviderEventItem(userId);
    const writeId = await seedWrite(userId, itemId, connectionId);
    const syncModules = {
      google: fakeSyncModule({
        pushItem: async () => ({
          outcome: 'conflict' as const,
          current: {
            externalEventId: 'evt-1',
            recurringEventId: null,
            status: 'confirmed',
            title: 'All-day now',
            description: null,
            location: null,
            htmlLink: null,
            startsAt: null,
            endsAt: null,
            allDayStartDate: '2026-07-01',
            allDayEndDate: '2026-07-02',
            organizer: null,
            attendees: [],
            updatedExternalAt: new Date('2026-07-01T00:00:00.000Z'),
            externalEtag: 'etag-allday',
            permissions: { canEditCore: true, canDelete: true, readOnlyReason: null },
            cancelled: false,
            raw: {},
          },
        }),
      }),
    };

    const outcome = await attemptCalendarItemWrite(db, writeId, syncModules, NOW);
    expect(outcome).toBe('conflict');
    const item = await loadItem(itemId);
    expect(item.conflict?.providerSnapshot).toMatchObject({
      startsAt: null,
      endsAt: null,
      allDayStartDate: '2026-07-01',
      allDayEndDate: '2026-07-02',
    });
  });
});

describe('drainDueCalendarItemWrites', () => {
  it('tallies a retried outcome across due writes', async () => {
    const userId = await seedUserWithHub(db, schema, 'DrainRetried');
    const { itemId, connectionId } = await seedProviderEventItem(userId);
    await seedWrite(userId, itemId, connectionId);

    const tally = await drainDueCalendarItemWrites(db, {
      userId,
      now: NOW,
      syncModules: {
        google: fakeSyncModule({
          pushItem: async () => ({ outcome: 'retryable', message: 'try later' }),
        }),
      },
    });

    expect(tally).toEqual({ applied: 0, conflicts: 0, failed: 0, retried: 1 });
  });

  it('tallies a conflict outcome (not just applied/retried) across due writes', async () => {
    const userId = await seedUserWithHub(db, schema, 'DrainConflict');
    const { itemId, connectionId } = await seedProviderEventItem(userId);
    await seedWrite(userId, itemId, connectionId);

    const tally = await drainDueCalendarItemWrites(db, {
      userId,
      now: NOW,
      syncModules: {
        google: fakeSyncModule({ pushItem: async () => ({ outcome: 'conflict', current: null }) }),
      },
    });

    expect(tally).toEqual({ applied: 0, conflicts: 1, failed: 0, retried: 0 });
  });

  it('tallies a failed (permanent) outcome across due writes', async () => {
    const userId = await seedUserWithHub(db, schema, 'DrainFailed');
    const { itemId, connectionId } = await seedProviderEventItem(userId);
    await seedWrite(userId, itemId, connectionId);

    const tally = await drainDueCalendarItemWrites(db, {
      userId,
      now: NOW,
      syncModules: {
        google: fakeSyncModule({
          pushItem: async () => ({ outcome: 'permanent', message: 'nope' }),
        }),
      },
    });

    expect(tally).toEqual({ applied: 0, conflicts: 0, failed: 1, retried: 0 });
  });

  it('respects the limit option, leaving the rest pending', async () => {
    const userId = await seedUserWithHub(db, schema, 'DrainLimit');
    const a = await seedProviderEventItem(userId, { externalAccountId: 'acct-a' });
    const b = await seedProviderEventItem(userId, { externalAccountId: 'acct-b' });
    await seedWrite(userId, a.itemId, a.connectionId, { operation: 'delete' });
    await seedWrite(userId, b.itemId, b.connectionId, { operation: 'delete' });

    const tally = await drainDueCalendarItemWrites(db, {
      userId,
      now: NOW,
      limit: 1,
      syncModules: {
        google: fakeSyncModule({
          deleteItem: async () => ({ outcome: 'applied' }),
          // Both fixtures' connections must resolve so a drained write actually applies
          // (rather than retrying on an unmatched account), so the limit is what caps it at 1.
          discoverConnections: async () => [
            {
              externalAccountId: 'acct-a',
              accountEmail: null,
              accountName: null,
              accountPictureUrl: null,
              raw: null,
            },
            {
              externalAccountId: 'acct-b',
              accountEmail: null,
              accountName: null,
              accountPictureUrl: null,
              raw: null,
            },
          ],
        }),
      },
    });

    expect(tally.applied + tally.conflicts + tally.failed + tally.retried).toBe(1);
    const state = await countCalendarWriteState(db, userId);
    expect(state.writesPending).toBe(1); // the second write is untouched by the limit
  });
});

describe('countCalendarWriteState', () => {
  it('counts pending writes and conflicted items scoped to the user', async () => {
    const userId = await seedUserWithHub(db, schema, 'CountState');
    const other = await seedUserWithHub(db, schema, 'CountStateOther');
    const mine = await seedProviderEventItem(userId, {
      externalAccountId: 'acct-mine',
      syncState: 'conflict',
    });
    await seedWrite(userId, mine.itemId, mine.connectionId);
    const theirs = await seedProviderEventItem(other, { externalAccountId: 'acct-theirs' });
    await seedWrite(other, theirs.itemId, theirs.connectionId);

    const state = await countCalendarWriteState(db, userId);
    expect(state.writesPending).toBe(1);
    expect(state.conflicts).toBe(1);
  });
});

describe('retryCalendarItemWrite', () => {
  it('throws NotFoundError for an item that does not belong to the caller', async () => {
    const userId = await seedUserWithHub(db, schema, 'RetryMissing');
    await expect(
      retryCalendarItemWrite(db, { userId, itemId: 'nonexistent', syncModules: {} }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws ConflictError when the item has no retryable state', async () => {
    const userId = await seedUserWithHub(db, schema, 'RetryNotRetryable');
    const { itemId } = await seedProviderEventItem(userId, { syncState: 'clean' });
    await expect(
      retryCalendarItemWrite(db, { userId, itemId, syncModules: {} }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('throws NotFoundError when no conflict/failed write exists for a retryable item', async () => {
    const userId = await seedUserWithHub(db, schema, 'RetryNoWrite');
    const { itemId } = await seedProviderEventItem(userId, { syncState: 'provider_error' });
    await expect(
      retryCalendarItemWrite(db, { userId, itemId, syncModules: {} }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('marks the write permanently failed and throws when there is no provider snapshot to re-anchor to', async () => {
    const userId = await seedUserWithHub(db, schema, 'RetryNoSnapshot');
    const { itemId, connectionId } = await seedProviderEventItem(userId, {
      syncState: 'provider_error',
    });
    const writeId = await seedWrite(userId, itemId, connectionId, { status: 'failed' });

    await expect(
      retryCalendarItemWrite(db, { userId, itemId, syncModules: {} }),
    ).rejects.toBeInstanceOf(ConflictError);
    const write = await loadWrite(writeId);
    expect(write.status).toBe('failed');
    expect(write.lastError).toContain('Cannot retry without a provider snapshot');
  });

  it('re-anchors to the conflict snapshot etag and reattempts in the foreground', async () => {
    const userId = await seedUserWithHub(db, schema, 'RetryReanchors');
    const conflict: CalendarItemConflict = {
      localPatch: { title: 'Local edit' },
      providerSnapshot: {
        available: true,
        externalEtag: 'fresh-etag',
        updatedExternalAt: '2026-07-05T00:00:00.000Z',
      },
      detectedAt: '2026-07-04T00:00:00.000Z',
    };
    const { itemId, connectionId } = await seedProviderEventItem(userId, {
      syncState: 'conflict',
      conflict,
    });
    const writeId = await seedWrite(userId, itemId, connectionId, { status: 'conflict' });
    const syncModules = {
      google: fakeSyncModule({
        pushItem: async () => ({
          outcome: 'applied' as const,
          item: {
            externalEventId: 'evt-1',
            recurringEventId: null,
            status: 'confirmed',
            title: 'Fixture event',
            description: null,
            location: null,
            htmlLink: null,
            startsAt: new Date('2026-07-01T10:00:00.000Z'),
            endsAt: new Date('2026-07-01T11:00:00.000Z'),
            allDayStartDate: null,
            allDayEndDate: null,
            organizer: null,
            attendees: [],
            updatedExternalAt: new Date('2026-07-05T00:00:00.000Z'),
            externalEtag: 'fresh-etag',
            permissions: { canEditCore: true, canDelete: true, readOnlyReason: null },
            cancelled: false,
            raw: {},
          },
        }),
      }),
    };

    await retryCalendarItemWrite(db, { userId, itemId, syncModules });

    const write = await loadWrite(writeId);
    expect(write.baseExternalEtag).toBe('fresh-etag');
    expect(write.baseUpdatedExternalAt?.toISOString()).toBe('2026-07-05T00:00:00.000Z');
  });

  it('re-anchors with a null baseUpdatedExternalAt when the snapshot carries no updatedExternalAt', async () => {
    const userId = await seedUserWithHub(db, schema, 'RetryNoUpdatedAt');
    const conflict: CalendarItemConflict = {
      localPatch: { title: 'Local edit' },
      providerSnapshot: { available: true, externalEtag: 'fresh-etag-2' },
      detectedAt: '2026-07-04T00:00:00.000Z',
    };
    const { itemId, connectionId } = await seedProviderEventItem(userId, {
      syncState: 'conflict',
      conflict,
    });
    const writeId = await seedWrite(userId, itemId, connectionId, { status: 'conflict' });
    const syncModules = {
      google: fakeSyncModule({ deleteItem: async () => ({ outcome: 'applied' as const }) }),
    };
    // Use the delete dispatch so the reattempt doesn't need a full push snapshot.
    await db
      .update(schema.calendarItemWrite)
      .set({ operation: 'delete' })
      .where(eq(schema.calendarItemWrite.id, writeId));

    await retryCalendarItemWrite(db, { userId, itemId, syncModules });

    const write = await loadWrite(writeId);
    expect(write.baseExternalEtag).toBe('fresh-etag-2');
    expect(write.baseUpdatedExternalAt).toBeNull();
  });
});
