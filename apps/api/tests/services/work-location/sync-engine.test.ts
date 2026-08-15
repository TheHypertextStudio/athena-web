import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import {
  account,
  calendarConnection,
  fullSchema,
  hub,
  user,
  workLocationAssertion,
  workLocationSyncAccount,
  type Database,
} from '@docket/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  clearWorkLocationOccurrence,
  createWorkLocationAssertion,
  createWorkPlace,
  enqueueWorkLocationProjection,
  listWorkLocationAssertions,
  setWorkLocationOccurrence,
} from '../../../src/services/work-location/repository';
import {
  drainWorkLocationWrites,
  registerWorkLocationWatches,
  syncUserWorkLocations,
  type GoogleWorkLocationTransport,
} from '../../../src/services/work-location/sync-engine';
import type { GoogleWorkingLocationEvent } from '../../../src/services/work-location/google';
import { GoogleWorkLocationApiError } from '../../../src/services/work-location/google-transport';

function requireValue<T>(value: T | null | undefined, description: string): T {
  if (value == null) throw new Error(`Expected ${description}`);
  return value;
}

class FakeGoogleWorkLocationTransport implements GoogleWorkLocationTransport {
  readonly events = new Map<string, Map<string, GoogleWorkingLocationEvent>>();
  failUpserts = 0;
  private revision = 0;

  seed(connectionId: string, event: GoogleWorkingLocationEvent): void {
    this.account(connectionId).set(requireValue(event.id, 'seed event id'), event);
  }

  edit(connectionId: string, eventId: string, patch: Partial<GoogleWorkingLocationEvent>): void {
    const existing = requireValue(this.account(connectionId).get(eventId), 'event to edit');
    this.revision += 1;
    this.account(connectionId).set(eventId, {
      ...existing,
      ...patch,
      id: eventId,
      updated: new Date(Date.UTC(2026, 7, 14, 19, this.revision)).toISOString(),
      etag: `etag-${String(this.revision)}`,
    });
  }

  async pull(input: { connectionId: string }): Promise<{
    events: GoogleWorkingLocationEvent[];
    nextCursor: string;
  }> {
    return {
      events: [...this.account(input.connectionId).values()],
      nextCursor: `cursor-${String(this.revision)}`,
    };
  }

  async upsert(input: {
    connectionId: string;
    externalEventId: string;
    body: Readonly<Record<string, unknown>>;
  }): Promise<GoogleWorkingLocationEvent> {
    if (this.failUpserts > 0) {
      this.failUpserts -= 1;
      throw new GoogleWorkLocationApiError(503);
    }
    this.revision += 1;
    const event = {
      ...this.account(input.connectionId).get(input.externalEventId),
      ...input.body,
      id: input.externalEventId,
      updated: new Date(Date.UTC(2026, 7, 14, 18, this.revision)).toISOString(),
      etag: `etag-${String(this.revision)}`,
    } as GoogleWorkingLocationEvent;
    this.account(input.connectionId).set(input.externalEventId, event);
    return event;
  }

  async delete(input: { connectionId: string; externalEventId: string }): Promise<void> {
    const existing = this.account(input.connectionId).get(input.externalEventId);
    this.revision += 1;
    this.account(input.connectionId).set(input.externalEventId, {
      id: input.externalEventId,
      ...(existing?.recurringEventId === undefined
        ? {}
        : { recurringEventId: existing.recurringEventId }),
      ...(existing?.originalStartTime === undefined
        ? {}
        : { originalStartTime: existing.originalStartTime }),
      status: 'cancelled',
      updated: new Date(Date.UTC(2026, 7, 14, 20, this.revision)).toISOString(),
      etag: `etag-${String(this.revision)}`,
    });
  }

  async findInstance(input: {
    connectionId: string;
    masterExternalEventId: string;
    occurrenceDate: string;
  }): Promise<GoogleWorkingLocationEvent | null> {
    const events = this.account(input.connectionId);
    const existing = [...events.values()].find(
      (event) =>
        event.recurringEventId === input.masterExternalEventId &&
        (event.originalStartTime?.date ?? event.originalStartTime?.dateTime?.slice(0, 10)) ===
          input.occurrenceDate,
    );
    if (existing) return existing;
    const master = events.get(input.masterExternalEventId);
    if (!master) return null;
    const nextDate = new Date(`${input.occurrenceDate}T00:00:00.000Z`);
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
    const { recurrence: _omittedRecurrence, ...instanceBase } = master;
    const created: GoogleWorkingLocationEvent = {
      ...instanceBase,
      id: `${input.masterExternalEventId}-${input.occurrenceDate}`,
      recurringEventId: input.masterExternalEventId,
      originalStartTime: { date: input.occurrenceDate },
      start: { date: input.occurrenceDate },
      end: { date: nextDate.toISOString().slice(0, 10) },
    };
    events.set(requireValue(created.id, 'created instance id'), created);
    return created;
  }

  private account(connectionId: string): Map<string, GoogleWorkingLocationEvent> {
    const existing = this.events.get(connectionId);
    if (existing) return existing;
    const created = new Map<string, GoogleWorkingLocationEvent>();
    this.events.set(connectionId, created);
    return created;
  }
}

let client!: PGlite;
let database!: Database;
let userId!: string;
let hubId!: string;
let connectionA!: string;
let connectionB!: string;

describe('two-account work-location convergence', () => {
  beforeAll(async () => {
    client = new PGlite('memory://');
    const migrated = drizzle(client, { schema: fullSchema });
    await migrate(migrated, {
      migrationsFolder: resolve(import.meta.dirname, '../../../../../packages/db/drizzle'),
    });
    database = migrated;
    userId = requireValue(
      await database
        .insert(user)
        .values({ name: 'Ada', email: `work-location-sync-${Date.now()}@example.com` })
        .returning()
        .then((rows) => rows[0]),
      'inserted user',
    ).id;
    hubId = requireValue(
      await database
        .insert(hub)
        .values({ userId, preferences: { timezone: 'America/Los_Angeles' } })
        .returning()
        .then((rows) => rows[0]),
      'inserted hub',
    ).id;
    await database.insert(account).values([
      { accountId: 'google-a', providerId: 'google', userId },
      { accountId: 'google-b', providerId: 'google', userId },
    ]);
    const connections = await database
      .insert(calendarConnection)
      .values([
        {
          userId,
          externalAccountId: 'google-a',
          accountEmail: 'a@example.com',
          scopeState: {
            grantedScopes: ['https://www.googleapis.com/auth/calendar.events'],
            calendarRead: true,
            calendarWrite: true,
            capturedAt: '2026-08-14T17:00:00.000Z',
          },
        },
        {
          userId,
          externalAccountId: 'google-b',
          accountEmail: 'b@example.com',
          scopeState: {
            grantedScopes: ['https://www.googleapis.com/auth/calendar.events'],
            calendarRead: true,
            calendarWrite: true,
            capturedAt: '2026-08-14T17:00:00.000Z',
          },
        },
      ])
      .returning({
        id: calendarConnection.id,
        externalAccountId: calendarConnection.externalAccountId,
      });
    connectionA = requireValue(
      connections.find((connection) => connection.externalAccountId === 'google-a'),
      'Google A connection',
    ).id;
    connectionB = requireValue(
      connections.find((connection) => connection.externalAccountId === 'google-b'),
      'Google B connection',
    ).id;
  });

  afterAll(async () => {
    await client.close();
  });

  it('imports A, projects B, adopts an edit/delete in B, and converges A', async () => {
    const transport = new FakeGoogleWorkLocationTransport();
    transport.seed(connectionA, {
      id: 'event-a',
      eventType: 'workingLocation',
      updated: '2026-08-14T17:00:00.000Z',
      etag: 'etag-a',
      start: { date: '2026-08-14' },
      end: { date: '2026-08-15' },
      workingLocationProperties: {
        type: 'customLocation',
        customLocation: { label: 'Main library' },
      },
    });

    await syncUserWorkLocations(database, { userId, transport });
    await drainWorkLocationWrites(database, { userId, transport });
    const projectedToB = requireValue(
      [...requireValue(transport.events.get(connectionB), 'Google B events').values()].find(
        (event) => event.status !== 'cancelled',
      ),
      'event projected to Google B',
    );
    expect(projectedToB.workingLocationProperties).toMatchObject({
      customLocation: { label: 'Main library' },
    });

    transport.edit(connectionB, requireValue(projectedToB.id, 'projected event id'), {
      workingLocationProperties: {
        type: 'customLocation',
        customLocation: { label: 'Editing studio' },
      },
    });
    await syncUserWorkLocations(database, { userId, transport });
    await drainWorkLocationWrites(database, { userId, transport });
    const canonical = requireValue(
      (
        await database
          .select()
          .from(workLocationAssertion)
          .where(eq(workLocationAssertion.hubId, hubId))
      ).find((assertion) => assertion.archivedAt === null),
      'active canonical assertion',
    );
    const places = await database
      .select()
      .from(fullSchema.workPlace)
      .where(eq(fullSchema.workPlace.hubId, hubId));
    expect(places.find((place) => place.id === canonical.placeId)?.name).toBe('Editing studio');
    expect(
      requireValue(transport.events.get(connectionA), 'Google A events').get('event-a')
        ?.workingLocationProperties,
    ).toMatchObject({
      customLocation: { label: 'Editing studio' },
    });

    await transport.delete({
      connectionId: connectionB,
      externalEventId: requireValue(projectedToB.id, 'projected event id'),
    });
    await syncUserWorkLocations(database, { userId, transport });
    await drainWorkLocationWrites(database, { userId, transport });
    const deletedCanonical = requireValue(
      await database
        .select()
        .from(workLocationAssertion)
        .where(eq(workLocationAssertion.id, canonical.id))
        .then((rows) => rows[0]),
      'deleted canonical assertion',
    );
    expect(deletedCanonical.archivedAt).not.toBeNull();
    expect(
      requireValue(transport.events.get(connectionA), 'Google A events').get('event-a')?.status,
    ).toBe('cancelled');
  });

  it('projects cancellation, replacement, and restoration to recurring provider instances', async () => {
    await database
      .update(workLocationSyncAccount)
      .set({ state: 'healthy', reason: null, bootstrapCompletedAt: new Date() })
      .where(eq(workLocationSyncAccount.hubId, hubId));
    const transport = new FakeGoogleWorkLocationTransport();
    const place = await createWorkPlace(database, hubId, {
      name: 'Eastside library',
      geofence: null,
      providerMappings: [],
      sort: 0,
    });
    const alternate = await createWorkPlace(database, hubId, {
      name: 'Ceramics studio',
      geofence: null,
      providerMappings: [],
      sort: 1,
    });
    let assertion = await createWorkLocationAssertion(database, hubId, {
      placeId: place.id,
      schedule: {
        type: 'weekly_all_day',
        effectiveFrom: '2026-08-10',
        effectiveUntil: null,
        weekdays: [0],
        timezone: 'America/Los_Angeles',
      },
    });
    await enqueueWorkLocationProjection(database, hubId, assertion, 'create');
    await drainWorkLocationWrites(database, { userId, transport });

    assertion = await setWorkLocationOccurrence(database, hubId, assertion.id, '2026-08-17', {
      action: 'cancel',
      date: '2026-08-17',
    });
    await enqueueWorkLocationProjection(database, hubId, assertion, 'update', '2026-08-17');
    await drainWorkLocationWrites(database, { userId, transport });
    for (const connectionId of [connectionA, connectionB]) {
      expect(
        [...requireValue(transport.events.get(connectionId), 'provider events').values()].find(
          (event) => event.originalStartTime?.date === '2026-08-17',
        )?.status,
      ).toBe('cancelled');
    }

    assertion = await setWorkLocationOccurrence(database, hubId, assertion.id, '2026-08-17', {
      action: 'replace',
      date: '2026-08-17',
      placeId: alternate.id,
      schedule: {
        type: 'one_off_all_day',
        date: '2026-08-17',
        timezone: 'America/Los_Angeles',
      },
    });
    await enqueueWorkLocationProjection(database, hubId, assertion, 'update', '2026-08-17');
    await drainWorkLocationWrites(database, { userId, transport });
    expect(
      [...requireValue(transport.events.get(connectionA), 'Google A events').values()].find(
        (event) => event.originalStartTime?.date === '2026-08-17',
      ),
    ).toMatchObject({
      status: 'confirmed',
      workingLocationProperties: { customLocation: { label: 'Ceramics studio' } },
    });

    assertion = await clearWorkLocationOccurrence(database, hubId, assertion.id, '2026-08-17');
    await enqueueWorkLocationProjection(database, hubId, assertion, 'update', '2026-08-17');
    await drainWorkLocationWrites(database, { userId, transport });
    expect(
      [...requireValue(transport.events.get(connectionA), 'Google A events').values()].find(
        (event) => event.originalStartTime?.date === '2026-08-17',
      ),
    ).toMatchObject({
      status: 'confirmed',
      workingLocationProperties: { customLocation: { label: 'Eastside library' } },
    });

    assertion = await setWorkLocationOccurrence(database, hubId, assertion.id, '2026-08-17', {
      action: 'replace',
      date: '2026-08-17',
      placeId: alternate.id,
      schedule: {
        type: 'one_off_all_day',
        date: '2026-08-17',
        timezone: 'America/Los_Angeles',
      },
    });
    await enqueueWorkLocationProjection(database, hubId, assertion, 'update', '2026-08-17');
    await drainWorkLocationWrites(database, { userId, transport });
    const remoteInstance = requireValue(
      [...requireValue(transport.events.get(connectionB), 'Google B events').values()].find(
        (event) => event.originalStartTime?.date === '2026-08-17',
      ),
      'Google B recurring instance',
    );
    await transport.delete({
      connectionId: connectionB,
      externalEventId: requireValue(remoteInstance.id, 'remote instance id'),
    });
    await syncUserWorkLocations(database, { userId, transport });
    assertion = requireValue(
      (await listWorkLocationAssertions(database, hubId)).items.find(
        (candidate) => candidate.id === assertion.id,
      ),
      'updated assertion',
    );
    expect(assertion.exceptions).toEqual([]);
    await drainWorkLocationWrites(database, { userId, transport });
  });

  it('imports a cancelled recurring occurrence during first bootstrap and fans it out', async () => {
    await database
      .update(workLocationSyncAccount)
      .set({ state: 'pending', reason: null, syncToken: null, bootstrapCompletedAt: null })
      .where(eq(workLocationSyncAccount.hubId, hubId));
    const transport = new FakeGoogleWorkLocationTransport();
    transport.seed(connectionA, {
      id: 'bootstrap-master-a',
      eventType: 'workingLocation',
      updated: '2026-08-14T17:00:00.000Z',
      etag: 'bootstrap-master-etag',
      start: { date: '2026-09-07', timeZone: 'America/Los_Angeles' },
      end: { date: '2026-09-08', timeZone: 'America/Los_Angeles' },
      recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO'],
      workingLocationProperties: {
        type: 'customLocation',
        customLocation: { label: 'North campus' },
      },
    });
    transport.seed(connectionA, {
      id: 'bootstrap-cancel-a',
      status: 'cancelled',
      updated: '2026-08-14T17:05:00.000Z',
      etag: 'bootstrap-cancel-etag',
      recurringEventId: 'bootstrap-master-a',
      originalStartTime: { date: '2026-09-14' },
    });

    await syncUserWorkLocations(database, { userId, transport });
    const imported = requireValue(
      (await listWorkLocationAssertions(database, hubId)).items.find(
        (candidate) =>
          candidate.originConnectionId === connectionA &&
          candidate.schedule.type === 'weekly_all_day' &&
          candidate.schedule.effectiveFrom === '2026-09-07',
      ),
      'imported recurring assertion',
    );
    expect(imported.exceptions).toEqual([
      expect.objectContaining({ action: 'cancel', date: '2026-09-14' }),
    ]);

    await drainWorkLocationWrites(database, { userId, transport });
    expect(
      [...requireValue(transport.events.get(connectionB), 'Google B events').values()].find(
        (event) => event.originalStartTime?.date === '2026-09-14',
      )?.status,
    ).toBe('cancelled');
  });

  it('retries failed individual writes and heals the account after delivery succeeds', async () => {
    await database
      .update(workLocationSyncAccount)
      .set({ state: 'healthy', reason: null, bootstrapCompletedAt: new Date() })
      .where(eq(workLocationSyncAccount.hubId, hubId));
    const transport = new FakeGoogleWorkLocationTransport();
    transport.failUpserts = 1;
    const place = await createWorkPlace(database, hubId, {
      name: 'Retry coworking room',
      geofence: null,
      providerMappings: [],
      sort: 0,
    });
    const assertion = await createWorkLocationAssertion(database, hubId, {
      placeId: place.id,
      schedule: {
        type: 'one_off_all_day',
        date: '2026-10-01',
        timezone: 'America/Los_Angeles',
      },
    });
    await enqueueWorkLocationProjection(database, hubId, assertion, 'create');
    const now = new Date('2026-08-14T19:00:00.000Z');

    expect(await drainWorkLocationWrites(database, { userId, transport, now })).toMatchObject({
      retried: 1,
    });
    const retrying = requireValue(
      (
        await database
          .select()
          .from(workLocationSyncAccount)
          .where(eq(workLocationSyncAccount.hubId, hubId))
      ).find((accountState) => accountState.state === 'retrying'),
      'retrying account state',
    );

    expect(
      await drainWorkLocationWrites(database, {
        userId,
        transport,
        now: new Date('2026-08-14T19:03:00.000Z'),
      }),
    ).toMatchObject({ applied: 1 });
    expect(
      (
        await database
          .select()
          .from(workLocationSyncAccount)
          .where(eq(workLocationSyncAccount.id, retrying.id))
      )[0],
    ).toMatchObject({ state: 'healthy', reason: null });
  });

  it.each([
    [401, 'action_required', 'reauth_required'],
    [400, 'unsupported', 'unsupported_account'],
    [403, 'unsupported', 'unsupported_account'],
    [429, 'retrying', 'provider_unavailable'],
  ] as const)(
    'classifies Google status %i as %s instead of retrying every account failure',
    async (status, state, reason) => {
      await database
        .update(workLocationSyncAccount)
        .set({ state: 'pending', reason: null })
        .where(eq(workLocationSyncAccount.hubId, hubId));
      const failing: GoogleWorkLocationTransport = {
        pull: async () => {
          throw new GoogleWorkLocationApiError(status);
        },
        upsert: async () => {
          throw new Error('not used');
        },
        delete: async () => {
          throw new Error('not used');
        },
        findInstance: async () => {
          throw new Error('not used');
        },
      };

      await syncUserWorkLocations(database, { userId, transport: failing });
      const accountState = requireValue(
        await database
          .select()
          .from(workLocationSyncAccount)
          .where(eq(workLocationSyncAccount.connectionId, connectionA))
          .then((rows) => rows[0]),
        'Google A sync state',
      );
      expect(accountState).toMatchObject({ state, reason });
    },
  );

  it('does not keep polling or watching an account classified as unsupported', async () => {
    await database
      .update(workLocationSyncAccount)
      .set({ state: 'unsupported', reason: 'unsupported_account' })
      .where(eq(workLocationSyncAccount.hubId, hubId));
    let pulls = 0;
    let watches = 0;
    const transport: GoogleWorkLocationTransport = {
      pull: async () => {
        pulls += 1;
        return { events: [], nextCursor: null };
      },
      upsert: async () => {
        throw new Error('not used');
      },
      delete: async () => {
        throw new Error('not used');
      },
      findInstance: async () => {
        throw new Error('not used');
      },
      startWatch: async () => {
        watches += 1;
        return { resourceId: 'not-used', expiresAt: new Date('2026-08-21T00:00:00.000Z') };
      },
    };

    await syncUserWorkLocations(database, { userId, transport });
    expect(
      await registerWorkLocationWatches(database, {
        userId,
        transport,
        callbackUrl: 'https://api.example.com/webhooks/calendar/google',
      }),
    ).toBe(0);
    expect({ pulls, watches }).toEqual({ pulls: 0, watches: 0 });
  });
});
