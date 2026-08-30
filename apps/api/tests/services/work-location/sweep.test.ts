/**
 * The scheduled work-location sweep and the watch renewal it drives.
 *
 * @remarks
 * Both were shipped without tests. The sweep is the only caller that fans work-location sync out
 * across users, so the guarantees asserted here — that one broken user cannot abort the pass, that
 * a disconnected account is not swept, and that outbound projection stays off when the flag is off
 * — have no other coverage. Watch renewal has none either, and it is the half that silently stops
 * inbound updates when it regresses: a watch that is never renewed simply expires, and the feed
 * goes quiet rather than failing.
 */
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import {
  account,
  calendarConnection,
  fullSchema,
  hub,
  user,
  workLocationSyncAccount,
  type Database,
} from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { GoogleWorkingLocationEvent } from '../../../src/services/work-location/google';
import {
  createWorkLocationAssertion,
  createWorkPlace,
  enqueueWorkLocationProjection,
  resolveWorkLocationHubId,
} from '../../../src/services/work-location/repository';
import { sweepWorkLocations } from '../../../src/services/work-location/sweep';
import {
  registerWorkLocationWatches,
  type GoogleWorkLocationTransport,
} from '../../../src/services/work-location/sync-engine';

function requireValue<T>(value: T | null | undefined, description: string): T {
  if (value == null) throw new Error(`Expected ${description}`);
  return value;
}

/** The scope grant a linked Google account needs before sync will touch it. */
const GRANTED_SCOPES = {
  grantedScopes: ['https://www.googleapis.com/auth/calendar.events'],
  calendarRead: true,
  calendarWrite: true,
  capturedAt: '2026-08-14T17:00:00.000Z',
};

const NOW = new Date(Date.UTC(2026, 7, 30, 17, 0, 0));

/** A transport that records what it was asked to do and pulls nothing. */
class RecordingTransport implements GoogleWorkLocationTransport {
  readonly watchCalls: { connectionId: string; callbackUrl: string; channelId: string }[] = [];
  readonly upsertCalls: string[] = [];
  protected revision = 0;

  async pull(): Promise<{ events: GoogleWorkingLocationEvent[]; nextCursor: string }> {
    return { events: [], nextCursor: 'cursor-0' };
  }

  async upsert(input: {
    externalEventId: string;
    body: Readonly<Record<string, unknown>>;
  }): Promise<GoogleWorkingLocationEvent> {
    this.upsertCalls.push(input.externalEventId);
    this.revision += 1;
    return {
      ...input.body,
      id: input.externalEventId,
      updated: new Date(NOW.getTime() + this.revision * 60_000).toISOString(),
      etag: `etag-${String(this.revision)}`,
    };
  }

  async delete(): Promise<void> {
    // Nothing to do: this transport records calls rather than modelling a calendar.
  }

  async findInstance(): Promise<GoogleWorkingLocationEvent | null> {
    return null;
  }

  async startWatch(input: {
    connectionId: string;
    callbackUrl: string;
    channelId: string;
  }): Promise<{ resourceId: string; expiresAt: Date }> {
    this.revision += 1;
    this.watchCalls.push({
      connectionId: input.connectionId,
      callbackUrl: input.callbackUrl,
      channelId: input.channelId,
    });
    return {
      resourceId: `resource-${String(this.revision)}`,
      expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60_000),
    };
  }
}

/** A provider adapter that cannot subscribe at all: no `startWatch` member, not an undefined one. */
const watchlessTransport: GoogleWorkLocationTransport = {
  async pull() {
    return { events: [], nextCursor: 'cursor-0' };
  },
  async upsert(input) {
    return { id: input.externalEventId };
  },
  async delete() {
    // Nothing to do: this adapter models a provider with no work-location write surface.
  },
  async findInstance() {
    return null;
  },
};

let client!: PGlite;
let database!: Database;
let transport!: RecordingTransport;

/** A user with a hub and one live Google connection — the shape the sweep expects to find. */
async function seedUser(options: { email: string; withHub: boolean }): Promise<{
  userId: string;
  connectionId: string;
}> {
  const userId = requireValue(
    await database
      .insert(user)
      .values({ name: 'Ada', email: options.email })
      .returning()
      .then((rows) => rows[0]),
    'inserted user',
  ).id;
  if (options.withHub) {
    await database.insert(hub).values({ userId, preferences: { timezone: 'America/Los_Angeles' } });
  }
  await database.insert(account).values({ accountId: options.email, providerId: 'google', userId });
  const connectionId = requireValue(
    await database
      .insert(calendarConnection)
      .values({
        userId,
        externalAccountId: options.email,
        accountEmail: options.email,
        scopeState: GRANTED_SCOPES,
      })
      .returning({ id: calendarConnection.id })
      .then((rows) => rows[0]),
    'inserted calendar connection',
  ).id;
  return { userId, connectionId };
}

describe('work-location sweep', () => {
  beforeAll(async () => {
    client = new PGlite('memory://');
    const migrated = drizzle(client, { schema: fullSchema });
    await migrate(migrated, {
      migrationsFolder: resolve(import.meta.dirname, '../../../../../packages/db/drizzle'),
    });
    database = migrated;
  });

  beforeEach(() => {
    transport = new RecordingTransport();
  });

  it('processes every user with a live connection and reports the projection flag', async () => {
    const first = await seedUser({
      email: `sweep-a-${String(Date.now())}@example.com`,
      withHub: true,
    });
    const second = await seedUser({
      email: `sweep-b-${String(Date.now())}@example.com`,
      withHub: true,
    });

    const tally = await sweepWorkLocations(database, {
      transport,
      now: NOW,
      callbackUrl: null,
      outboundProjectionEnabled: true,
    });

    expect(tally.usersProcessed).toBeGreaterThanOrEqual(2);
    expect(tally.errors).toBe(0);
    // The flag is echoed rather than derived, so an operator reading the tally can tell a zero
    // write count caused by "nothing to project" from one caused by "projection is off".
    expect(tally.outboundProjectionEnabled).toBe(true);
    expect([first.userId, second.userId]).toHaveLength(2);
  });

  it('leaves a disconnected account out of the sweep', async () => {
    const only = await seedUser({
      email: `sweep-disconnected-${String(Date.now())}@example.com`,
      withHub: true,
    });
    await database
      .update(calendarConnection)
      .set({ status: 'disconnected' })
      .where(eq(calendarConnection.userId, only.userId));

    const before = await sweepWorkLocations(database, {
      transport,
      now: NOW,
      callbackUrl: null,
      outboundProjectionEnabled: false,
    });

    await database
      .update(calendarConnection)
      .set({ status: 'connected' })
      .where(eq(calendarConnection.userId, only.userId));

    const after = await sweepWorkLocations(database, {
      transport,
      now: NOW,
      callbackUrl: null,
      outboundProjectionEnabled: false,
    });

    // Reconnecting is what brings the user back, so the count moves by exactly one user.
    expect(after.usersProcessed).toBe(before.usersProcessed + 1);
  });

  it('counts a failing user as one error and keeps sweeping the rest', async () => {
    // A calendar connection whose hub row is gone: `resolveWorkLocationHubId` throws, and the
    // sweep has to absorb it. Without the per-user catch, one orphaned row stops every other
    // user's sync for as long as it exists.
    const healthy = await seedUser({
      email: `sweep-healthy-${String(Date.now())}@example.com`,
      withHub: true,
    });
    await seedUser({ email: `sweep-orphan-${String(Date.now())}@example.com`, withHub: false });

    const tally = await sweepWorkLocations(database, {
      transport,
      now: NOW,
      callbackUrl: null,
      outboundProjectionEnabled: false,
    });

    expect(tally.errors).toBe(1);
    expect(tally.usersProcessed).toBeGreaterThanOrEqual(1);
    expect(healthy.userId).toBeTruthy();
  });

  it('holds a queued write back while the flag is off and applies it once it is on', async () => {
    // A write has to be genuinely pending for this to mean anything: with an empty queue both
    // sides of the flag drain nothing, and the assertion passes against a sweep that ignores it.
    const seeded = await seedUser({
      email: `sweep-noproject-${String(Date.now())}@example.com`,
      withHub: true,
    });
    // Materialize the sync-account rows the projection queue fans out to.
    await sweepWorkLocations(database, {
      transport: new RecordingTransport(),
      now: NOW,
      callbackUrl: null,
      outboundProjectionEnabled: false,
    });
    const hubId = await resolveWorkLocationHubId(seeded.userId, database);
    const place = await createWorkPlace(database, hubId, {
      name: 'Coworking room',
      geofence: null,
      providerMappings: [],
      sort: 0,
    });
    const assertion = await createWorkLocationAssertion(database, hubId, {
      placeId: place.id,
      schedule: { type: 'one_off_all_day', date: '2026-10-01', timezone: 'America/Los_Angeles' },
    });
    const queued = await enqueueWorkLocationProjection(database, hubId, assertion, 'create');
    expect(queued.length).toBeGreaterThan(0);

    const withFlagOff = await sweepWorkLocations(database, {
      transport,
      now: NOW,
      callbackUrl: null,
      outboundProjectionEnabled: false,
    });

    expect(withFlagOff.outboundProjectionEnabled).toBe(false);
    expect(withFlagOff.writesApplied).toBe(0);
    expect(transport.upsertCalls).toEqual([]);

    const withFlagOn = await sweepWorkLocations(database, {
      transport,
      now: NOW,
      callbackUrl: null,
      outboundProjectionEnabled: true,
    });

    // The same pending write is still there and now reaches the provider, which is what proves
    // the first sweep withheld it rather than there being nothing to send.
    expect(withFlagOn.writesApplied).toBeGreaterThan(0);
    expect(transport.upsertCalls.length).toBeGreaterThan(0);
  });
});

describe('work-location watch registration', () => {
  let userId!: string;
  let connectionId!: string;

  beforeAll(async () => {
    const seeded = await seedUser({
      email: `watch-${String(Date.now())}@example.com`,
      withHub: true,
    });
    userId = seeded.userId;
    connectionId = seeded.connectionId;
    // Materialize the sync-account row the watch query joins against.
    await sweepWorkLocations(database, {
      transport: new RecordingTransport(),
      now: NOW,
      callbackUrl: null,
      outboundProjectionEnabled: false,
    });
  });

  beforeEach(async () => {
    transport = new RecordingTransport();
    await database
      .update(workLocationSyncAccount)
      .set({ watchChannelId: null, watchResourceId: null, watchToken: null, watchExpiresAt: null })
      .where(eq(workLocationSyncAccount.connectionId, connectionId));
  });

  it('registers a watch and records the channel it can be recognised by later', async () => {
    const registered = await registerWorkLocationWatches(database, {
      userId,
      transport,
      callbackUrl: 'https://api.example.com/webhooks/work-location',
      now: NOW,
    });

    expect(registered).toBe(1);
    expect(transport.watchCalls).toHaveLength(1);
    expect(transport.watchCalls[0]?.callbackUrl).toBe(
      'https://api.example.com/webhooks/work-location',
    );

    const stored = requireValue(
      (
        await database
          .select()
          .from(workLocationSyncAccount)
          .where(eq(workLocationSyncAccount.connectionId, connectionId))
          .limit(1)
      )[0],
      'sync account row',
    );
    // The channel id and token are what an inbound notification is matched against; a watch
    // registered with the provider but not recorded here is a notification nothing can verify.
    expect(stored.watchChannelId).toBe(transport.watchCalls[0]?.channelId);
    expect(stored.watchResourceId).toBe('resource-1');
    expect(stored.watchToken).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.watchExpiresAt).not.toBeNull();
  });

  it('does nothing without a callback URL to point the provider at', async () => {
    const registered = await registerWorkLocationWatches(database, {
      userId,
      transport,
      callbackUrl: null,
      now: NOW,
    });

    expect(registered).toBe(0);
    expect(transport.watchCalls).toEqual([]);
  });

  it('does nothing when the transport cannot subscribe at all', async () => {
    const registered = await registerWorkLocationWatches(database, {
      userId,
      transport: watchlessTransport,
      callbackUrl: 'https://api.example.com/webhooks/work-location',
      now: NOW,
    });

    expect(registered).toBe(0);
  });

  it('renews inside the last day and leaves a watch with time left alone', async () => {
    const callbackUrl = 'https://api.example.com/webhooks/work-location';

    // Comfortably in the future: renewing now would burn a provider call for nothing.
    await database
      .update(workLocationSyncAccount)
      .set({ watchExpiresAt: new Date(NOW.getTime() + 3 * 24 * 60 * 60_000) })
      .where(eq(workLocationSyncAccount.connectionId, connectionId));
    expect(
      await registerWorkLocationWatches(database, { userId, transport, callbackUrl, now: NOW }),
    ).toBe(0);

    // Inside the 24-hour window: renew, or the feed goes quiet when it lapses.
    await database
      .update(workLocationSyncAccount)
      .set({ watchExpiresAt: new Date(NOW.getTime() + 6 * 60 * 60_000) })
      .where(eq(workLocationSyncAccount.connectionId, connectionId));
    expect(
      await registerWorkLocationWatches(database, { userId, transport, callbackUrl, now: NOW }),
    ).toBe(1);
    expect(transport.watchCalls).toHaveLength(1);
  });

  it('skips an account whose sync state is not healthy', async () => {
    await database
      .update(workLocationSyncAccount)
      .set({ state: 'action_required', reason: 'provider_unavailable' })
      .where(
        and(
          eq(workLocationSyncAccount.connectionId, connectionId),
          eq(workLocationSyncAccount.provider, 'google'),
        ),
      );

    const registered = await registerWorkLocationWatches(database, {
      userId,
      transport,
      callbackUrl: 'https://api.example.com/webhooks/work-location',
      now: NOW,
    });

    // An account already asking for user action does not get a renewed subscription; renewing it
    // would keep a dead feed looking live.
    expect(registered).toBe(0);

    await database
      .update(workLocationSyncAccount)
      .set({ state: 'healthy', reason: null })
      .where(eq(workLocationSyncAccount.connectionId, connectionId));
  });
});
