import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import workLocation from '../../src/routes/work-location';
import {
  appWithSession,
  fakeSession,
  getDb,
  one,
  seedUserWithHub,
} from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

async function seedWorkLocationUser(label: string) {
  const userId = await seedUserWithHub(db, schema, label);
  const hubRow = one(
    await db.select({ id: schema.hub.id }).from(schema.hub).where(eq(schema.hub.userId, userId)),
  );
  await db
    .update(schema.hub)
    .set({ preferences: { timezone: 'America/Los_Angeles' } })
    .where(eq(schema.hub.id, hubRow.id));
  await db.insert(schema.account).values({
    accountId: `google-${label}`,
    providerId: 'google',
    userId,
  });
  const connection = one(
    await db
      .insert(schema.calendarConnection)
      .values({
        userId,
        externalAccountId: `google-${label}`,
        accountEmail: `${label}@example.com`,
      })
      .returning({ id: schema.calendarConnection.id }),
  );
  return {
    userId,
    hubId: hubRow.id,
    connectionId: connection.id,
    app: appWithSession(workLocation, fakeSession(userId, label, `${label}@example.com`)),
  };
}

async function createPlace(app: ReturnType<typeof appWithSession>, name: string) {
  const response = await app.request('/places', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, geofence: null, providerMappings: [], sort: 0 }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as {
    place: { id: string; name: string };
    projections: { state: string }[];
  };
}

describe('/v1/me/work-location routes', () => {
  it('requires a session on the personal source-of-truth surface', async () => {
    const response = await appWithSession(workLocation, null).request('/places');
    expect(response.status).toBe(401);
  });

  it('is ready immediately when the user has no linked calendar accounts', async () => {
    const userId = await seedUserWithHub(db, schema, 'WorkLocationNoAccounts');
    const app = appWithSession(
      workLocation,
      fakeSession(userId, 'WorkLocationNoAccounts', 'no-accounts@example.com'),
    );

    const response = await app.request('/sync-state');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ready: true, accounts: [] });
  });

  it('creates arbitrary places, designates home independently, and exposes account sync state', async () => {
    const { app } = await seedWorkLocationUser('WorkLocationPlaces');
    const created = await createPlace(app, 'North branch library');
    expect(created.place.name).toBe('North branch library');
    expect(created.projections).toEqual([expect.objectContaining({ state: 'pending' })]);

    const profileResponse = await app.request('/profile', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ homePlaceId: created.place.id }),
    });
    expect(profileResponse.status).toBe(200);
    expect(await profileResponse.json()).toMatchObject({
      profile: { homePlaceId: created.place.id },
    });

    const listed = await app.request('/places');
    expect(await listed.json()).toMatchObject({
      items: [expect.objectContaining({ id: created.place.id, name: 'North branch library' })],
      profile: { homePlaceId: created.place.id },
    });
    const sync = await app.request('/sync-state');
    expect(await sync.json()).toMatchObject({
      ready: false,
      accounts: [expect.objectContaining({ provider: 'google', state: 'pending' })],
    });
  });

  it('resolves a canonical assertion and prevents retiring its referenced place', async () => {
    const { app } = await seedWorkLocationUser('WorkLocationAssertion');
    const { place } = await createPlace(app, 'Editing studio');
    const created = await app.request('/assertions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        placeId: place.id,
        schedule: {
          type: 'one_off_timed',
          startsAt: '2036-08-14T16:00:00.000Z',
          endsAt: '2036-08-14T20:00:00.000Z',
          timezone: 'America/Los_Angeles',
        },
      }),
    });
    expect(created.status).toBe(201);
    const assertionBody = (await created.json()) as {
      assertion: { id: string };
      projections: { state: string }[];
    };
    expect(assertionBody.projections).toEqual([expect.objectContaining({ state: 'pending' })]);

    const point = await app.request('/?at=2036-08-14T17%3A00%3A00.000Z');
    expect(await point.json()).toMatchObject({
      expected: { place: { id: place.id }, source: 'assertion' },
      current: { place: { id: place.id }, source: 'inferred_from_expected' },
    });
    const retired = await app.request(`/places/${place.id}`, { method: 'DELETE' });
    expect(retired.status).toBe(409);

    const deleted = await app.request(`/assertions/${assertionBody.assertion.id}`, {
      method: 'DELETE',
    });
    expect(deleted.status).toBe(204);
    expect((await app.request(`/places/${place.id}`, { method: 'DELETE' })).status).toBe(204);
  });

  it('supports one-occurrence replacement and deletion on weekly series', async () => {
    const { app } = await seedWorkLocationUser('WorkLocationOccurrence');
    const regular = (await createPlace(app, 'Regular place')).place;
    const alternate = (await createPlace(app, 'Alternate place')).place;
    const created = await app.request('/assertions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        placeId: regular.id,
        schedule: {
          type: 'weekly_all_day',
          effectiveFrom: '2026-08-03',
          effectiveUntil: null,
          weekdays: [4],
          timezone: 'America/Los_Angeles',
        },
      }),
    });
    const id = ((await created.json()) as { assertion: { id: string } }).assertion.id;
    const replaced = await app.request(`/assertions/${id}/occurrences/2026-08-14`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'replace',
        date: '2026-08-14',
        placeId: alternate.id,
        schedule: {
          type: 'one_off_all_day',
          date: '2026-08-14',
          timezone: 'America/Los_Angeles',
        },
      }),
    });
    expect(replaced.status).toBe(200);
    expect(await replaced.json()).toMatchObject({
      assertion: { exceptions: [expect.objectContaining({ placeId: alternate.id })] },
    });
    expect(
      (await app.request(`/assertions/${id}/occurrences/2026-08-14`, { method: 'DELETE' })).status,
    ).toBe(200);
  });

  it('rejects observation coordinates, accepts matched place evidence, and defaults manual expiry to local day end', async () => {
    const { app, hubId } = await seedWorkLocationUser('WorkLocationEvidence');
    const { place } = await createPlace(app, 'Community center');
    const rejected = await app.request('/observations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        placeId: place.id,
        accuracyMeters: 20,
        latitude: 36.17,
        longitude: -115.14,
      }),
    });
    expect(rejected.status).toBe(422);
    const accepted = await app.request('/observations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ placeId: place.id, accuracyMeters: 20 }),
    });
    expect(accepted.status).toBe(204);

    const manual = await app.request('/current', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ placeId: place.id }),
    });
    expect(manual.status).toBe(204);
    const manualRows = await db
      .select()
      .from(schema.workLocationObservation)
      .where(eq(schema.workLocationObservation.hubId, hubId));
    const override = one(manualRows.filter((row) => row.source === 'manual'));
    expect(override.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect((await app.request('/current', { method: 'DELETE' })).status).toBe(204);
  });
});
