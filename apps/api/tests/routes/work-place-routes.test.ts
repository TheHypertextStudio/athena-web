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

describe('/v1/me/work-location saved-place routes', () => {
  it('requires a session on the personal source-of-truth surface', async () => {
    const response = await appWithSession(workLocation, null).request('/places');
    expect(response.status).toBe(401);
  });

  it('requires a session for saved-place geocoding', async () => {
    const response = await appWithSession(workLocation, null).request(
      '/places/geocoding/search?query=Library',
    );
    expect(response.status).toBe(401);
  });

  it('searches, permanently resolves, and reverse-geocodes saved-place locations', async () => {
    const { app } = await seedWorkLocationUser('WorkLocationGeocoding');

    const searched = await app.request('/places/geocoding/search?query=Library');
    expect(searched.status).toBe(200);
    expect(await searched.json()).toEqual({
      items: [
        {
          id: 'local:10-library-lane',
          address: '10 Library Lane, Las Vegas, Nevada 89101',
          latitude: 36.1716,
          longitude: -115.1391,
        },
      ],
      attribution: 'Search results by Mapbox',
    });

    const resolved = await app.request('/places/geocoding/resolutions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'local:10-library-lane',
        address: '10 Library Lane, Las Vegas, Nevada 89101',
      }),
    });
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toMatchObject({
      address: '10 Library Lane, Las Vegas, Nevada 89101',
      latitude: 36.1716,
      longitude: -115.1391,
    });

    const reversed = await app.request('/places/geocoding/reverse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ latitude: 36.1699, longitude: -115.141 }),
    });
    expect(reversed.status).toBe(200);
    expect(await reversed.json()).toMatchObject({ latitude: 36.1699, longitude: -115.141 });
  });

  it('strictly validates geocoding queries and coordinate bounds', async () => {
    const { app } = await seedWorkLocationUser('WorkLocationGeocodingValidation');
    expect((await app.request('/places/geocoding/search?query=ab')).status).toBe(422);
    expect((await app.request(`/places/geocoding/search?query=${'a'.repeat(241)}`)).status).toBe(
      422,
    );
    expect(
      (await app.request('/places/geocoding/search?query=Library&permanent=true')).status,
    ).toBe(422);
    expect(
      (
        await app.request('/places/geocoding/reverse', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ latitude: 91, longitude: 0 }),
        })
      ).status,
    ).toBe(422);
  });

  it('durably limits one user to thirty geocoding requests in a rolling minute', async () => {
    const { app } = await seedWorkLocationUser('WorkLocationGeocodingLimit');
    for (let request = 0; request < 30; request += 1) {
      const response = await app.request('/places/geocoding/search?query=Library');
      expect(response.status).toBe(200);
    }

    const limited = await app.request('/places/geocoding/search?query=Library');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toMatch(/^\d+$/);
    expect(await limited.json()).toMatchObject({ code: 'rate_limited' });

    const { app: otherUserApp } = await seedWorkLocationUser('WorkLocationGeocodingLimitOther');
    expect((await otherUserApp.request('/places/geocoding/search?query=Library')).status).toBe(200);
  });

  it('maps provider failures to stable application-owned copy', async () => {
    const { app } = await seedWorkLocationUser('WorkLocationGeocodingUnavailable');
    const response = await app.request('/places/geocoding/resolutions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'provider-secret-that-must-not-escape',
        address: '10 Library Lane',
      }),
    });

    expect(response.status).toBe(503);
    const problem = await response.json();
    expect(problem).toMatchObject({ code: 'geocoding_unavailable' });
    expect(JSON.stringify(problem)).not.toContain('provider-secret-that-must-not-escape');
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
});
