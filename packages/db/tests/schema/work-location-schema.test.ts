/** Storage invariants for the user-scoped work-location source of truth. */
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { getTableColumns } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fullSchema, type Database } from '../../src/client';
import {
  account,
  calendarConnection,
  calendarItem,
  hub,
  user,
  workLocationAssertion,
  workLocationObservation,
  workLocationProfile,
  workLocationSyncAccount,
  workPlace,
  workPlaceProviderMapping,
} from '../../src/schema';

let client!: PGlite;
let db!: Database;
let hubId!: string;
let connectionId!: string;

describe('work-location schema', () => {
  beforeAll(async () => {
    client = new PGlite('memory://');
    const migrated = drizzle(client, { schema: fullSchema });
    await migrate(migrated, { migrationsFolder: resolve(import.meta.dirname, '../../drizzle') });
    db = migrated;

    const userId = (
      await db
        .insert(user)
        .values({ name: 'Ada', email: `work-location-${Date.now()}@example.com` })
        .returning()
    )[0]!.id;
    hubId = (await db.insert(hub).values({ userId }).returning())[0]!.id;
    await db.insert(account).values({ accountId: 'google-ada', providerId: 'google', userId });
    connectionId = (
      await db
        .insert(calendarConnection)
        .values({ userId, externalAccountId: 'google-ada', accountEmail: 'ada@example.com' })
        .returning()
    )[0]!.id;
  });

  afterAll(async () => {
    await client.close();
  });

  it('stores arbitrary named places and one independent home designation', async () => {
    const places = await db
      .insert(workPlace)
      .values([
        { hubId, name: 'Downtown office', sort: 0 },
        { hubId, name: 'Tuesday client site', sort: 1 },
      ])
      .returning();

    await db.insert(workLocationProfile).values({ hubId, homePlaceId: places[1]!.id });
    await expect(
      db.insert(workLocationProfile).values({ hubId, homePlaceId: places[0]!.id }),
    ).rejects.toMatchObject({ cause: { constraint: 'work_location_profile_hub_uq' } });
  });

  it('lets calendar work carry a canonical place without replacing display location text', () => {
    expect(getTableColumns(calendarItem)).toHaveProperty('workPlaceId');
    expect(getTableColumns(calendarItem)).toHaveProperty('location');
  });

  it('allows multiple regular places to map to one provider office classification', async () => {
    const places = await db
      .insert(workPlace)
      .values([
        { hubId, name: 'HQ north' },
        { hubId, name: 'HQ south' },
      ])
      .returning();

    await expect(
      db
        .insert(workPlaceProviderMapping)
        .values(
          places.map((place, index) => ({
            hubId,
            placeId: place.id,
            connectionId,
            provider: 'google',
            classification: 'officeLocation',
            providerPlaceId: `building-${String(index)}`,
            metadata: {},
          })),
        )
        .returning(),
    ).resolves.toHaveLength(2);
  });

  it('persists one-off and weekly assertion payloads without provider event ownership', async () => {
    const place = (await db.insert(workPlace).values({ hubId, name: 'Library' }).returning())[0]!;
    const rows = await db
      .insert(workLocationAssertion)
      .values([
        {
          hubId,
          placeId: place.id,
          schedule: {
            type: 'one_off_all_day',
            date: '2026-08-13',
            timezone: 'America/Los_Angeles',
          },
        },
        {
          hubId,
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
        },
      ])
      .returning();

    expect(rows).toHaveLength(2);
    expect(rows[1]?.origin).toBe('docket');
    expect(rows[1]?.revision).toBe(1);
  });

  it('stores only matched place, accuracy, and freshness for device observations', async () => {
    const place = (await db.insert(workPlace).values({ hubId, name: 'Library' }).returning())[0]!;
    const observedAt = new Date('2026-08-13T17:00:00.000Z');
    const expiresAt = new Date('2026-08-13T17:15:00.000Z');
    const row = (
      await db
        .insert(workLocationObservation)
        .values({
          hubId,
          placeId: place.id,
          source: 'device',
          accuracyMeters: 24,
          observedAt,
          expiresAt,
        })
        .returning()
    )[0]!;

    expect(row.placeId).toBe(place.id);
    expect(row.expiresAt).toEqual(expiresAt);
    expect(getTableColumns(workLocationObservation)).not.toHaveProperty('latitude');
    expect(getTableColumns(workLocationObservation)).not.toHaveProperty('longitude');
  });

  it('keeps location sync independent of ordinary calendar-layer visibility', async () => {
    const row = (
      await db
        .insert(workLocationSyncAccount)
        .values({
          hubId,
          connectionId,
          provider: 'google',
          state: 'pending',
          capabilities: {
            scheduledIntervals: true,
            partialDays: true,
            weeklyRecurrence: true,
            currentPresence: false,
            providerPlaceIds: true,
            inboundChanges: true,
            writes: true,
          },
        })
        .returning()
    )[0]!;

    expect(row.connectionId).toBe(connectionId);
    expect(getTableColumns(workLocationSyncAccount)).not.toHaveProperty('calendarLayerId');
  });
});
