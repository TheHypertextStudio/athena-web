import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getDb, one, seedGoogleAccount, seedUserWithHub } from '../support/routes-harness';

import type {
  CalendarProviderAdapter,
  CalendarProviderSyncModule,
  CalendarWatchResult,
} from '../../src/routes/calendar-sync-engine';
import { registerOrRenewWatches } from '../../src/routes/calendar-sync-engine';

/**
 * `sweepCalendarSync` calls the production `createDefaultCalendarSyncModules()` with no
 * injection point (same as every other calendar route), so the sweep-level tests swap that
 * assembly for a fake module. `registerOrRenewWatches` itself takes an `adapters` map
 * directly and needs no mocking. `vi.hoisted` is required because `vi.mock` factories are
 * hoisted above the imports below.
 */
const state = vi.hoisted(() => ({
  module: null as CalendarProviderSyncModule | null,
}));

vi.mock('../../src/routes/calendar-sync-modules', () => ({
  createDefaultCalendarSyncModules: () => (state.module ? { google: state.module } : {}),
}));

const NOW = new Date('2026-07-02T12:00:00.000Z');

beforeEach(() => {
  state.module = null;
});

/** Seed a `calendar_connection` row, returning its id. */
async function seedConnection(
  schema: Awaited<ReturnType<typeof getDb>>,
  input: { userId: string; externalAccountId: string },
): Promise<string> {
  await seedGoogleAccount(schema.db, schema, input.userId, input.externalAccountId);
  const connection = one(
    await schema.db
      .insert(schema.calendarConnection)
      .values({
        userId: input.userId,
        provider: 'google',
        externalAccountId: input.externalAccountId,
        status: 'connected',
      })
      .returning({ id: schema.calendarConnection.id }),
  );
  return connection.id;
}

/** Seed a selected `calendar_layer` row under an existing connection, returning its id. */
async function seedLayer(
  schema: Awaited<ReturnType<typeof getDb>>,
  input: {
    userId: string;
    connectionId: string;
    externalLayerId: string;
    watchExpiresAt?: Date | null;
    watchRegisteredAt?: Date | null;
  },
): Promise<string> {
  const layer = one(
    await schema.db
      .insert(schema.calendarLayer)
      .values({
        userId: input.userId,
        connectionId: input.connectionId,
        provider: 'google',
        sourceKind: 'provider_calendar',
        externalLayerId: input.externalLayerId,
        title: 'Layer',
        selected: true,
        watchExpiresAt: input.watchExpiresAt ?? null,
        watchRegisteredAt: input.watchRegisteredAt ?? null,
      })
      .returning({ id: schema.calendarLayer.id }),
  );
  return layer.id;
}

/** Seed one `calendar_connection` + one selected `calendar_layer` on it, in a single call. */
async function seedConnectionAndLayer(
  schema: Awaited<ReturnType<typeof getDb>>,
  input: { userId: string; externalAccountId: string; externalLayerId: string },
): Promise<{ connectionId: string; layerId: string }> {
  const connectionId = await seedConnection(schema, input);
  const layerId = await seedLayer(schema, { ...input, connectionId });
  return { connectionId, layerId };
}

describe('registerOrRenewWatches', () => {
  it('registers a layer with no watch, renews one expiring soon, and leaves a fresh one untouched', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'WatchUser');
    const connectionId = await seedConnection(schema, { userId, externalAccountId: 'acct-watch' });
    const noWatchId = await seedLayer(schema, {
      userId,
      connectionId,
      externalLayerId: 'cal-no-watch',
    });
    const expiringId = await seedLayer(schema, {
      userId,
      connectionId,
      externalLayerId: 'cal-expiring',
      watchRegisteredAt: new Date(NOW.getTime() - 6 * 24 * 60 * 60 * 1000),
      watchExpiresAt: new Date(NOW.getTime() + 10 * 60 * 1000), // expires in 10 min (< 30 min window)
    });
    const freshId = await seedLayer(schema, {
      userId,
      connectionId,
      externalLayerId: 'cal-fresh',
      watchRegisteredAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      watchExpiresAt: new Date(NOW.getTime() + 2 * 60 * 60 * 1000), // expires in 2h (well outside window)
    });

    const startWatchCalls: { externalLayerId: string }[] = [];
    const adapter: CalendarProviderAdapter = {
      provider: 'google',
      listLayers: async () => [],
      pullChanges: async () => {
        throw new Error('not exercised by watch-registration tests');
      },
      pushItem: () => {
        throw new Error('not exercised');
      },
      deleteItem: () => {
        throw new Error('not exercised');
      },
      startWatch: async (input) => {
        startWatchCalls.push({ externalLayerId: input.externalLayerId });
        const result: CalendarWatchResult = {
          channelId: `chan-${input.externalLayerId}`,
          resourceId: `res-${input.externalLayerId}`,
          token: `tok-${input.externalLayerId}`,
          expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
        };
        return result;
      },
    };
    const module: CalendarProviderSyncModule = {
      adapter,
      discoverConnections: async () => [
        {
          externalAccountId: 'acct-watch',
          accountEmail: null,
          accountName: null,
          accountPictureUrl: null,
          raw: null,
        },
      ],
      resolveCredentials: async () => ({ accessToken: 'fake-token' }),
      captureScopeState: () => ({
        grantedScopes: [],
        calendarRead: true,
        calendarWrite: true,
        capturedAt: NOW.toISOString(),
      }),
    };

    const tally = await registerOrRenewWatches(schema.db, {
      userId,
      now: NOW,
      adapters: { google: module },
      callbackUrlFor: () => 'https://api.docket.test/webhooks/calendar/google',
    });

    expect(tally.registered).toBe(2);
    expect(startWatchCalls.map((c) => c.externalLayerId).sort()).toEqual([
      'cal-expiring',
      'cal-no-watch',
    ]);

    const noWatchRow = one(
      await schema.db
        .select()
        .from(schema.calendarLayer)
        .where(eq(schema.calendarLayer.id, noWatchId)),
    );
    expect(noWatchRow.watchChannelId).toBe('chan-cal-no-watch');
    expect(noWatchRow.watchToken).toBe('tok-cal-no-watch');
    expect(noWatchRow.watchResourceId).toBe('res-cal-no-watch');
    expect(noWatchRow.watchRegisteredAt).toEqual(NOW);
    expect(noWatchRow.watchExpiresAt).not.toBeNull();

    const expiringRow = one(
      await schema.db
        .select()
        .from(schema.calendarLayer)
        .where(eq(schema.calendarLayer.id, expiringId)),
    );
    expect(expiringRow.watchChannelId).toBe('chan-cal-expiring');
    expect(expiringRow.watchRegisteredAt).toEqual(NOW);

    // Untouched: still whatever was seeded, never overwritten by a startWatch call.
    const freshRow = one(
      await schema.db
        .select()
        .from(schema.calendarLayer)
        .where(eq(schema.calendarLayer.id, freshId)),
    );
    expect(freshRow.watchChannelId).toBeNull();
  });

  it('no-ops entirely (zero adapter calls) when callbackUrlFor returns an empty URL', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'NoCallbackUser');
    await seedConnectionAndLayer(schema, {
      userId,
      externalAccountId: 'acct-no-callback',
      externalLayerId: 'cal-no-callback',
    });

    let discoverCalls = 0;
    const adapter: CalendarProviderAdapter = {
      provider: 'google',
      listLayers: async () => [],
      pullChanges: async () => {
        throw new Error('not exercised');
      },
      pushItem: () => {
        throw new Error('not exercised');
      },
      deleteItem: () => {
        throw new Error('not exercised');
      },
      startWatch: async () => {
        throw new Error('should not be called — the callback URL is unconfigured');
      },
    };
    const module: CalendarProviderSyncModule = {
      adapter,
      discoverConnections: async () => {
        discoverCalls += 1;
        return [];
      },
      resolveCredentials: async () => ({ accessToken: 'fake-token' }),
      captureScopeState: () => ({
        grantedScopes: [],
        calendarRead: true,
        calendarWrite: true,
        capturedAt: NOW.toISOString(),
      }),
    };

    const tally = await registerOrRenewWatches(schema.db, {
      userId,
      now: NOW,
      adapters: { google: module },
      callbackUrlFor: () => null,
    });

    expect(tally.registered).toBe(0);
    expect(discoverCalls).toBe(0);
  });

  it('tallies a startWatch failure as an error and keeps registering the remaining due layers', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'WatchFailureUser');
    const connectionId = await seedConnection(schema, {
      userId,
      externalAccountId: 'acct-watch-failure',
    });
    const failingId = await seedLayer(schema, {
      userId,
      connectionId,
      externalLayerId: 'cal-fails',
    });
    const okId = await seedLayer(schema, {
      userId,
      connectionId,
      externalLayerId: 'cal-ok',
    });

    const startWatchCalls: string[] = [];
    const adapter: CalendarProviderAdapter = {
      provider: 'google',
      listLayers: async () => [],
      pullChanges: async () => {
        throw new Error('not exercised by watch-registration tests');
      },
      pushItem: () => {
        throw new Error('not exercised');
      },
      deleteItem: () => {
        throw new Error('not exercised');
      },
      startWatch: async (input) => {
        startWatchCalls.push(input.externalLayerId);
        if (input.externalLayerId === 'cal-fails') {
          throw new Error('Google watch response missing resourceId/expiration');
        }
        const result: CalendarWatchResult = {
          channelId: `chan-${input.externalLayerId}`,
          resourceId: `res-${input.externalLayerId}`,
          token: `tok-${input.externalLayerId}`,
          expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
        };
        return result;
      },
    };
    const module: CalendarProviderSyncModule = {
      adapter,
      discoverConnections: async () => [
        {
          externalAccountId: 'acct-watch-failure',
          accountEmail: null,
          accountName: null,
          accountPictureUrl: null,
          raw: null,
        },
      ],
      resolveCredentials: async () => ({ accessToken: 'fake-token' }),
      captureScopeState: () => ({
        grantedScopes: [],
        calendarRead: true,
        calendarWrite: true,
        capturedAt: NOW.toISOString(),
      }),
    };

    const tally = await registerOrRenewWatches(schema.db, {
      userId,
      now: NOW,
      adapters: { google: module },
      callbackUrlFor: () => 'https://api.docket.test/webhooks/calendar/google',
    });

    // Both layers were attempted — the failing one did not stop the loop from reaching
    // the next layer.
    expect(startWatchCalls.sort()).toEqual(['cal-fails', 'cal-ok']);
    // Only the successful one counted toward `registered`; the failure is tallied, not thrown.
    expect(tally.registered).toBe(1);
    expect(tally.errors).toEqual([
      'cal-fails: Google watch response missing resourceId/expiration',
    ]);

    const failingRow = one(
      await schema.db
        .select()
        .from(schema.calendarLayer)
        .where(eq(schema.calendarLayer.id, failingId)),
    );
    expect(failingRow.watchChannelId).toBeNull(); // never persisted — startWatch threw first

    const okRow = one(
      await schema.db.select().from(schema.calendarLayer).where(eq(schema.calendarLayer.id, okId)),
    );
    expect(okRow.watchChannelId).toBe('chan-cal-ok');
  });
});

/**
 * Seed a `calendar_connection` plus a matching `calendar_list`/`calendar_layer` pair
 * SHARING an id (mirroring the Task 1 backfill `upsertProviderLayer` relies on) so a full
 * `syncCalendarConnections` pass — which discovers layers via `listLayers` and reuses the
 * `calendar_list` row's id for its `calendar_layer` upsert — updates this SAME layer row
 * rather than inserting a fresh one out from under a pre-set lease.
 */
async function seedFullSyncFixture(
  schema: Awaited<ReturnType<typeof getDb>>,
  input: { userId: string; externalAccountId: string; externalLayerId: string },
): Promise<{ connectionId: string; layerId: string }> {
  const connectionId = await seedConnection(schema, input);
  const list = one(
    await schema.db
      .insert(schema.calendarList)
      .values({
        userId: input.userId,
        connectionId,
        externalCalendarId: input.externalLayerId,
        title: 'Layer',
      })
      .returning({ id: schema.calendarList.id }),
  );
  await schema.db.insert(schema.calendarLayer).values({
    id: list.id,
    userId: input.userId,
    connectionId,
    provider: 'google',
    sourceKind: 'provider_calendar',
    externalLayerId: input.externalLayerId,
    title: 'Layer',
    selected: true,
  });
  return { connectionId, layerId: list.id };
}

describe('sweepCalendarSync', () => {
  it('syncs every connected user; a layer with a lease held elsewhere is skipped, the sweep still completes for other users', async () => {
    const schema = await getDb();
    const userA = await seedUserWithHub(schema.db, schema, 'SweepUserA');
    const userB = await seedUserWithHub(schema.db, schema, 'SweepUserB');
    const { layerId: layerA } = await seedFullSyncFixture(schema, {
      userId: userA,
      externalAccountId: 'acct-sweep-a',
      externalLayerId: 'cal-sweep-a',
    });
    const { layerId: layerB } = await seedFullSyncFixture(schema, {
      userId: userB,
      externalAccountId: 'acct-sweep-b',
      externalLayerId: 'cal-sweep-b',
    });

    // Simulate a concurrent manual "Sync Now" already holding user A's layer lease.
    await schema.db
      .update(schema.calendarLayer)
      .set({ syncLeaseExpiresAt: new Date(NOW.getTime() + 5 * 60 * 1000) })
      .where(eq(schema.calendarLayer.id, layerA));

    // Layer id per external account, so `listLayers` (which only receives credentials, not
    // the connection) can report the right single calendar for whichever account
    // `resolveCredentials` is currently resolving — the fake credential IS the account id.
    const layerIdByAccount: Record<string, string> = {
      'acct-sweep-a': 'cal-sweep-a',
      'acct-sweep-b': 'cal-sweep-b',
    };

    const pullCallsByLayer: string[] = [];
    const adapter: CalendarProviderAdapter = {
      provider: 'google',
      async listLayers({ credentials }) {
        const externalLayerId = layerIdByAccount[credentials.accessToken];
        if (externalLayerId === undefined) return [];
        return [
          {
            externalLayerId,
            title: 'Layer',
            description: null,
            timezone: null,
            color: null,
            accessRole: 'owner',
            primary: true,
            editableCore: true,
          },
        ];
      },
      async pullChanges({ externalLayerId }) {
        pullCallsByLayer.push(externalLayerId);
        return {
          items: [],
          nextCursor: `tok-${externalLayerId}`,
          cursorInvalid: false,
          full: true,
        };
      },
      pushItem: () => {
        throw new Error('not exercised by the sweep test');
      },
      deleteItem: () => {
        throw new Error('not exercised by the sweep test');
      },
    };
    const module: CalendarProviderSyncModule = {
      adapter,
      discoverConnections: async ({ db, userId }) => {
        const rows = await db
          .select({ externalAccountId: schema.calendarConnection.externalAccountId })
          .from(schema.calendarConnection)
          .where(
            and(
              eq(schema.calendarConnection.userId, userId),
              eq(schema.calendarConnection.provider, 'google'),
            ),
          );
        return rows.map((r) => ({
          externalAccountId: r.externalAccountId,
          accountEmail: null,
          accountName: null,
          accountPictureUrl: null,
          raw: null,
        }));
      },
      // The fake credential IS the account id — see `listLayers`'s remark above.
      resolveCredentials: async (connection) => ({ accessToken: connection.externalAccountId }),
      captureScopeState: () => ({
        grantedScopes: [],
        calendarRead: true,
        calendarWrite: true,
        capturedAt: NOW.toISOString(),
      }),
    };
    state.module = module;

    const { sweepCalendarSync } = await import('../../src/routes/calendar-sync-sweep');
    const tally = await sweepCalendarSync(NOW);

    // At least our two users are processed — this file's earlier tests may have left other
    // (harmless, zero-layer) connected users in the shared PGlite instance, so this is
    // intentionally `>=` rather than an exact count.
    expect(tally.usersProcessed).toBeGreaterThanOrEqual(2);
    expect(tally.errors).toEqual([]);
    // User A's layer was leased elsewhere: skipped silently, never pulled.
    expect(pullCallsByLayer).not.toContain('cal-sweep-a');
    // User B's layer synced normally.
    expect(pullCallsByLayer).toContain('cal-sweep-b');

    const layerARow = one(
      await schema.db
        .select()
        .from(schema.calendarLayer)
        .where(eq(schema.calendarLayer.id, layerA)),
    );
    expect(layerARow.syncToken).toBeNull(); // never synced this pass
    const layerBRow = one(
      await schema.db
        .select()
        .from(schema.calendarLayer)
        .where(eq(schema.calendarLayer.id, layerB)),
    );
    expect(layerBRow.syncToken).toBe('tok-cal-sweep-b');
  });

  it('leaves watchesRegistered at zero when GOOGLE_CALENDAR_WEBHOOK_URL is unset (the default test env)', async () => {
    const { callbackUrlFor } = await import('../../src/routes/calendar-sync-sweep');
    expect(callbackUrlFor('google')).toBeNull();
  });

  it('a thrown failure for one user (defense-in-depth per-user try/catch) does not abort the sweep for a later user', async () => {
    const schema = await getDb();
    const userA = await seedUserWithHub(schema.db, schema, 'SweepThrowUserA');
    const userB = await seedUserWithHub(schema.db, schema, 'SweepThrowUserB');
    await seedFullSyncFixture(schema, {
      userId: userA,
      externalAccountId: 'acct-throw-a',
      externalLayerId: 'cal-throw-a',
    });
    const { layerId: layerB } = await seedFullSyncFixture(schema, {
      userId: userB,
      externalAccountId: 'acct-throw-b',
      externalLayerId: 'cal-throw-b',
    });

    const pullCallsByLayer: string[] = [];
    const adapter: CalendarProviderAdapter = {
      provider: 'google',
      async listLayers({ credentials }) {
        const externalLayerId =
          credentials.accessToken === 'acct-throw-a' ? 'cal-throw-a' : 'cal-throw-b';
        return [
          {
            externalLayerId,
            title: 'Layer',
            description: null,
            timezone: null,
            color: null,
            accessRole: 'owner',
            primary: true,
            editableCore: true,
          },
        ];
      },
      async pullChanges({ externalLayerId }) {
        pullCallsByLayer.push(externalLayerId);
        return {
          items: [],
          nextCursor: `tok-${externalLayerId}`,
          cursorInvalid: false,
          full: true,
        };
      },
      pushItem: () => {
        throw new Error('not exercised by this test');
      },
      deleteItem: () => {
        throw new Error('not exercised by this test');
      },
    };
    const module: CalendarProviderSyncModule = {
      adapter,
      async discoverConnections({ db, userId }) {
        // Simulate an unexpected (non-credential, non-item-level) throw for user A only —
        // this is the kind of failure none of `syncCalendarConnections`'s internal per-item
        // guards catch (it happens before the per-connection `try`), so it is exactly what
        // the sweep's per-user `try`/`catch` backstop exists for.
        if (userId === userA) throw new Error('unexpected discovery failure for user A');
        const rows = await db
          .select({ externalAccountId: schema.calendarConnection.externalAccountId })
          .from(schema.calendarConnection)
          .where(
            and(
              eq(schema.calendarConnection.userId, userId),
              eq(schema.calendarConnection.provider, 'google'),
            ),
          );
        return rows.map((r) => ({
          externalAccountId: r.externalAccountId,
          accountEmail: null,
          accountName: null,
          accountPictureUrl: null,
          raw: null,
        }));
      },
      resolveCredentials: async (connection) => ({ accessToken: connection.externalAccountId }),
      captureScopeState: () => ({
        grantedScopes: [],
        calendarRead: true,
        calendarWrite: true,
        capturedAt: NOW.toISOString(),
      }),
    };
    state.module = module;

    const { sweepCalendarSync } = await import('../../src/routes/calendar-sync-sweep');
    const tally = await sweepCalendarSync(NOW);

    // User A's failure is tallied as an error, not thrown out of the sweep.
    expect(tally.errors.some((e) => e.includes('unexpected discovery failure for user A'))).toBe(
      true,
    );
    // User B — later in iteration order — was still fully processed despite user A's throw.
    expect(pullCallsByLayer).toContain('cal-throw-b');
    const layerBRow = one(
      await schema.db
        .select()
        .from(schema.calendarLayer)
        .where(eq(schema.calendarLayer.id, layerB)),
    );
    expect(layerBRow.syncToken).toBe('tok-cal-throw-b');
  });
});
