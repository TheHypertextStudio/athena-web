import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import {
  account,
  calendarConnection,
  fullSchema,
  hub,
  user,
  workLocationObservation,
  type Database,
} from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { CalendarConnectionId } from '@docket/planning/ids';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConflictError, NotFoundError } from '../../../src/error';
import {
  archiveWorkLocationAssertion,
  archiveWorkPlace,
  createWorkLocationAssertion,
  createWorkPlace,
  listWorkLocationAssertions,
  listWorkPlaces,
  loadWorkLocationResolutionState,
  recordDeviceWorkLocation,
  setManualCurrentWorkLocation,
  setWorkLocationOccurrence,
  updateWorkLocationProfile,
} from '../../../src/services/work-location/repository';

let client!: PGlite;
let database!: Database;
let hubId!: string;
let otherHubId!: string;
let connectionId!: ReturnType<typeof CalendarConnectionId.parse>;

function firstRow<T>(rows: readonly T[], operation: string): T {
  const row = rows[0];
  if (!row) throw new Error(`Expected ${operation} to return a row`);
  return row;
}

describe('work-location repository', () => {
  beforeAll(async () => {
    client = new PGlite('memory://');
    const migrated = drizzle(client, { schema: fullSchema });
    await migrate(migrated, {
      migrationsFolder: resolve(import.meta.dirname, '../../../../../packages/db/drizzle'),
    });
    database = migrated;

    const owner = firstRow(
      await database
        .insert(user)
        .values({ name: 'Ada', email: `work-location-owner-${Date.now()}@example.com` })
        .returning(),
      'owner insertion',
    );
    const other = firstRow(
      await database
        .insert(user)
        .values({ name: 'Grace', email: `work-location-other-${Date.now()}@example.com` })
        .returning(),
      'other user insertion',
    );
    hubId = firstRow(
      await database
        .insert(hub)
        .values({ userId: owner.id, preferences: { timezone: 'America/Los_Angeles' } })
        .returning(),
      'owner hub insertion',
    ).id;
    otherHubId = firstRow(
      await database.insert(hub).values({ userId: other.id }).returning(),
      'other hub insertion',
    ).id;
    await database.insert(account).values({
      accountId: 'google-ada-work-location',
      providerId: 'google',
      userId: owner.id,
    });
    connectionId = CalendarConnectionId.parse(
      firstRow(
        await database
          .insert(calendarConnection)
          .values({
            userId: owner.id,
            externalAccountId: 'google-ada-work-location',
            accountEmail: 'ada@example.com',
          })
          .returning(),
        'calendar connection insertion',
      ).id,
    );
  });

  afterAll(async () => {
    await client.close();
  });

  it('stores arbitrary places, account mappings, and one independent home designation', async () => {
    const place = await createWorkPlace(database, hubId, {
      name: 'North branch library',
      address: '10 Library Lane',
      geofence: { latitude: 36.17, longitude: -115.14, radiusMeters: 180 },
      providerMappings: [
        {
          provider: 'google',
          connectionId,
          classification: 'officeLocation',
          providerPlaceId: 'north-branch',
          metadata: { floorId: '2' },
        },
      ],
      sort: 2,
    });
    const profile = await updateWorkLocationProfile(database, hubId, { homePlaceId: place.id });

    expect(profile.homePlaceId).toBe(place.id);
    expect(place.address).toBe('10 Library Lane');
    expect((await listWorkPlaces(database, hubId)).items).toContainEqual(place);
    await expect(
      updateWorkLocationProfile(database, otherHubId, { homePlaceId: place.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('hides cross-Hub ids and prevents retirement while an active or future assertion refers to a place', async () => {
    const place = await createWorkPlace(database, hubId, {
      name: 'Editing studio',
      geofence: null,
      providerMappings: [],
      sort: 0,
    });
    const assertion = await createWorkLocationAssertion(database, hubId, {
      placeId: place.id,
      schedule: {
        type: 'weekly_timed',
        effectiveFrom: '2026-08-10',
        effectiveUntil: null,
        weekdays: [0, 2, 4],
        startMinute: 540,
        endMinute: 1_020,
        timezone: 'America/Los_Angeles',
      },
    });

    await expect(
      archiveWorkPlace(database, hubId, place.id, new Date('2026-08-13T17:00:00.000Z')),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      archiveWorkLocationAssertion(database, otherHubId, assertion.id),
    ).rejects.toBeInstanceOf(NotFoundError);

    await archiveWorkLocationAssertion(database, hubId, assertion.id);
    await expect(
      archiveWorkPlace(database, hubId, place.id, new Date('2026-08-13T17:00:00.000Z')),
    ).resolves.toBeUndefined();
  });

  it('upserts cancel and replace occurrence exceptions while advancing canonical revision', async () => {
    const [regular, alternate] = await Promise.all([
      createWorkPlace(database, hubId, {
        name: 'Regular place',
        geofence: null,
        providerMappings: [],
        sort: 0,
      }),
      createWorkPlace(database, hubId, {
        name: 'Alternate place',
        geofence: null,
        providerMappings: [],
        sort: 1,
      }),
    ]);
    const assertion = await createWorkLocationAssertion(database, hubId, {
      placeId: regular.id,
      schedule: {
        type: 'weekly_all_day',
        effectiveFrom: '2026-08-03',
        effectiveUntil: null,
        weekdays: [0],
        timezone: 'America/Los_Angeles',
      },
    });

    const cancelled = await setWorkLocationOccurrence(database, hubId, assertion.id, '2026-08-10', {
      action: 'cancel',
      date: '2026-08-10',
    });
    const replaced = await setWorkLocationOccurrence(database, hubId, assertion.id, '2026-08-10', {
      action: 'replace',
      date: '2026-08-10',
      placeId: alternate.id,
      schedule: {
        type: 'one_off_timed',
        startsAt: '2026-08-10T18:00:00.000Z',
        endsAt: '2026-08-10T22:00:00.000Z',
        timezone: 'America/Los_Angeles',
      },
    });

    expect(cancelled.revision).toBe(assertion.revision + 1);
    expect(replaced.revision).toBe(assertion.revision + 2);
    expect(replaced.exceptions).toEqual([
      expect.objectContaining({ action: 'replace', date: '2026-08-10', placeId: alternate.id }),
    ]);

    await expect(
      setWorkLocationOccurrence(database, hubId, assertion.id, '2026-08-11', {
        action: 'cancel',
        date: '2026-08-11',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('server-stamps short-lived device evidence and removes expired observations', async () => {
    const place = await createWorkPlace(database, hubId, {
      name: 'Community center',
      geofence: null,
      providerMappings: [],
      sort: 0,
    });
    const now = new Date('2026-08-13T17:00:00.000Z');
    await recordDeviceWorkLocation(database, hubId, { placeId: place.id, accuracyMeters: 25 }, now);
    await setManualCurrentWorkLocation(
      database,
      hubId,
      { placeId: place.id, expiresAt: '2026-08-13T20:00:00.000Z' },
      now,
    );

    const state = await loadWorkLocationResolutionState(
      database,
      hubId,
      new Date('2026-08-13T17:01:00.000Z'),
    );
    expect(state.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'device',
          expiresAt: new Date('2026-08-13T17:15:00.000Z'),
        }),
        expect.objectContaining({
          source: 'manual',
          expiresAt: new Date('2026-08-13T20:00:00.000Z'),
        }),
      ]),
    );

    await loadWorkLocationResolutionState(database, hubId, new Date('2026-08-13T20:00:00.000Z'));
    const expiredRows = await database
      .select()
      .from(workLocationObservation)
      .where(
        and(
          eq(workLocationObservation.hubId, hubId),
          eq(workLocationObservation.placeId, place.id),
        ),
      );
    expect(expiredRows).toEqual([]);
  });

  it('lists only active assertions owned by the Hub', async () => {
    const place = await createWorkPlace(database, otherHubId, {
      name: 'Other person place',
      geofence: null,
      providerMappings: [],
      sort: 0,
    });
    await createWorkLocationAssertion(database, otherHubId, {
      placeId: place.id,
      schedule: {
        type: 'one_off_all_day',
        date: '2026-08-13',
        timezone: 'UTC',
      },
    });

    expect((await listWorkLocationAssertions(database, hubId)).items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ placeId: place.id })]),
    );
  });
});
