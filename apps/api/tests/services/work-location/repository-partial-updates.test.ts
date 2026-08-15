/**
 * Partial updates and retirement guards in the work-location repository.
 *
 * @remarks
 * These endpoints are PATCH-shaped: a caller sends the fields it means to change and nothing else.
 * Every `input.x === undefined ? {} : { x }` in the repository exists to keep an omitted field from
 * being written as null, and the failure is silent — a client that sends only a new name would
 * quietly erase an address and a geofence, and nothing would report an error. So each field is
 * asserted to move on its own while its neighbours hold.
 *
 * The retirement guards are the other half: a place cannot be retired out from under the
 * designation or the assertions that still point at it, because the rows that survive would
 * reference something a person can no longer see.
 */
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { fullSchema, hub, user, type Database } from '@docket/db';
import type { WorkPlaceId } from '@docket/types';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';

import { ConflictError, NotFoundError } from '../../../src/error';
import {
  archiveWorkPlace,
  createWorkLocationAssertion,
  createWorkPlace,
  listWorkPlaces,
  resolveWorkLocationHubId,
  setWorkLocationOccurrence,
  updateWorkLocationAssertion,
  updateWorkLocationProfile,
  updateWorkPlace,
} from '../../../src/services/work-location/repository';

let database!: Database;
let hubId!: string;
let otherHubId!: string;

/** The first row, or a named failure rather than an undefined read downstream. */
function firstRow<T>(rows: readonly T[], operation: string): T {
  const row = rows[0];
  if (!row) throw new Error(`Expected ${operation} to return a row`);
  return row;
}

beforeAll(async () => {
  const client = new PGlite('memory://');
  const migrated = drizzle(client, { schema: fullSchema });
  await migrate(migrated, {
    migrationsFolder: resolve(import.meta.dirname, '../../../../../packages/db/drizzle'),
  });
  database = migrated;

  const owner = firstRow(
    await database
      .insert(user)
      .values({ name: 'Ada', email: `wl-partial-owner-${Date.now()}@example.com` })
      .returning(),
    'owner insertion',
  );
  const other = firstRow(
    await database
      .insert(user)
      .values({ name: 'Grace', email: `wl-partial-other-${Date.now()}@example.com` })
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
});

/** A fully-populated place, so an update can be shown to leave its neighbours alone. */
async function seedPlace(name = 'Studio') {
  return createWorkPlace(database, hubId, {
    name,
    address: '1 Market St',
    sort: 10,
    geofence: { latitude: 37.79, longitude: -122.4, radiusMeters: 120 },
  });
}

/** Read one place back out of the list projection. */
async function readPlace(placeId: string) {
  const list = await listWorkPlaces(database, hubId);
  const place = list.items.find((item) => item.id === placeId);
  if (!place) throw new Error(`place ${placeId} is not listed`);
  return place;
}

describe('updating one field of a place', () => {
  it('renames without disturbing the address, ordering, or geofence', async () => {
    const created = await seedPlace('Before');

    await updateWorkPlace(database, hubId, created.id, { name: 'After' });

    const place = await readPlace(created.id);
    expect(place.name).toBe('After');
    expect(place.address).toBe('1 Market St');
    expect(place.sort).toBe(10);
    expect(place.geofence).toMatchObject({ radiusMeters: 120 });
  });

  it('changes the address alone', async () => {
    const created = await seedPlace();
    await updateWorkPlace(database, hubId, created.id, { address: '2 Mission St' });

    const place = await readPlace(created.id);
    expect(place.address).toBe('2 Mission St');
    expect(place.name).toBe('Studio');
  });

  it('changes the ordering alone', async () => {
    const created = await seedPlace();
    await updateWorkPlace(database, hubId, created.id, { sort: 99 });

    const place = await readPlace(created.id);
    expect(place.sort).toBe(99);
    expect(place.address).toBe('1 Market St');
  });

  it('moves the geofence alone', async () => {
    const created = await seedPlace();
    await updateWorkPlace(database, hubId, created.id, {
      geofence: { latitude: 40.7, longitude: -74, radiusMeters: 250 },
    });

    const place = await readPlace(created.id);
    expect(place.geofence).toMatchObject({ radiusMeters: 250 });
    expect(place.name).toBe('Studio');
  });

  it('removes a geofence when one is explicitly cleared', async () => {
    // Distinct from omitting the field: `null` is an instruction, `undefined` is silence.
    const created = await seedPlace();
    await updateWorkPlace(database, hubId, created.id, { geofence: null });

    expect((await readPlace(created.id)).geofence).toBeNull();
  });

  it('leaves everything untouched when asked to change nothing', async () => {
    const created = await seedPlace();
    await updateWorkPlace(database, hubId, created.id, {});

    const place = await readPlace(created.id);
    expect(place).toMatchObject({ name: 'Studio', address: '1 Market St', sort: 10 });
  });

  it('refuses to update a place belonging to somebody else', async () => {
    // Addressed by id, so without the hub guard one person could edit another's places.
    const created = await seedPlace();
    await expect(
      updateWorkPlace(database, otherHubId, created.id, { name: 'Stolen' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses to update a place that does not exist', async () => {
    await expect(
      updateWorkPlace(database, hubId, '01ARZ3NDEKTSV4RRFFQ69G5FAV', { name: 'Ghost' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('retiring a place', () => {
  it('retires one that nothing depends on', async () => {
    const created = await seedPlace('Retired');
    await archiveWorkPlace(database, hubId, created.id);

    const list = await listWorkPlaces(database, hubId);
    expect(list.items.some((item) => item.id === created.id)).toBe(false);
  });

  it('refuses while the place is still designated as home', async () => {
    // Retiring it would leave the profile pointing at something no surface can show.
    const created = await seedPlace('Home base');
    await updateWorkLocationProfile(database, hubId, { homePlaceId: created.id });

    try {
      await expect(archiveWorkPlace(database, hubId, created.id)).rejects.toBeInstanceOf(
        ConflictError,
      );
    } finally {
      // The designation lives on the hub every test in this file shares, so it is cleared here
      // rather than left for a later test to overwrite. Without this, a case added below would
      // fail on a ConflictError this test caused and name itself as the culprit.
      await updateWorkLocationProfile(database, hubId, { homePlaceId: null });
    }
  });

  it('retires it once the home designation is moved away', async () => {
    const home = await seedPlace('Home base 2');
    await updateWorkLocationProfile(database, hubId, { homePlaceId: home.id });
    await updateWorkLocationProfile(database, hubId, { homePlaceId: null });

    await expect(archiveWorkPlace(database, hubId, home.id)).resolves.toBeUndefined();
  });

  it('refuses to retire a place belonging to somebody else', async () => {
    const created = await seedPlace('Not yours');
    await expect(archiveWorkPlace(database, otherHubId, created.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('updating the work-location profile', () => {
  it('sets and clears the home designation', async () => {
    const created = await seedPlace('Home candidate');

    await updateWorkLocationProfile(database, hubId, { homePlaceId: created.id });
    await updateWorkLocationProfile(database, hubId, { homePlaceId: null });

    // Clearing it is what makes the place retirable again.
    await expect(archiveWorkPlace(database, hubId, created.id)).resolves.toBeUndefined();
  });

  it('refuses to designate a place belonging to somebody else as home', async () => {
    const created = await seedPlace('Foreign home');
    await expect(
      updateWorkLocationProfile(database, otherHubId, { homePlaceId: created.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('updating an assertion', () => {
  /** A weekly Monday/Wednesday assertion the occurrence tests can override. */
  async function seedWeekly(placeId: ReturnType<typeof WorkPlaceId.parse>) {
    return createWorkLocationAssertion(database, hubId, {
      placeId,
      schedule: {
        type: 'weekly_all_day',
        effectiveFrom: '2026-08-10',
        effectiveUntil: null,
        weekdays: [0, 2],
        timezone: 'America/Los_Angeles',
      },
    });
  }

  it('moves the place while keeping the schedule, and bumps the revision', async () => {
    // The revision is what the resolver breaks ties on, so an edit that did not bump it could lose
    // to the version it replaced.
    const from = await seedPlace('Assertion from');
    const to = await seedPlace('Assertion to');
    const created = await seedWeekly(from.id);

    const updated = await updateWorkLocationAssertion(database, hubId, created.id, {
      placeId: to.id,
    });

    expect(updated.placeId).toBe(to.id);
    expect(updated.schedule).toMatchObject({ weekdays: [0, 2] });
    expect(updated.revision).toBe(created.revision + 1);
  });

  it('changes the schedule while keeping the place', async () => {
    const place = await seedPlace('Assertion place');
    const created = await seedWeekly(place.id);

    const updated = await updateWorkLocationAssertion(database, hubId, created.id, {
      schedule: {
        type: 'weekly_all_day',
        effectiveFrom: '2026-08-10',
        effectiveUntil: '2026-12-31',
        weekdays: [4],
        timezone: 'America/Los_Angeles',
      },
    });

    expect(updated.placeId).toBe(place.id);
    expect(updated.schedule).toMatchObject({ weekdays: [4], effectiveUntil: '2026-12-31' });
  });

  it('refuses to point an assertion at somebody else’s place', async () => {
    const mine = await seedPlace('Mine');
    const created = await seedWeekly(mine.id);
    const foreign = firstRow(
      await database
        .insert(fullSchema.workPlace)
        .values({ hubId: otherHubId, name: 'Theirs' })
        .returning(),
      'foreign place insertion',
    );

    await expect(
      updateWorkLocationAssertion(database, hubId, created.id, { placeId: foreign.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('overriding one occurrence of a weekly assertion', () => {
  async function seedWeekly(placeId: ReturnType<typeof WorkPlaceId.parse>) {
    return createWorkLocationAssertion(database, hubId, {
      placeId,
      schedule: {
        type: 'weekly_all_day',
        effectiveFrom: '2026-08-10',
        effectiveUntil: '2026-09-30',
        weekdays: [0, 2],
        timezone: 'America/Los_Angeles',
      },
    });
  }

  it('cancels one occurrence without touching the rest of the series', async () => {
    const place = await seedPlace('Weekly place');
    const created = await seedWeekly(place.id);

    const updated = await setWorkLocationOccurrence(database, hubId, created.id, '2026-08-12', {
      date: '2026-08-12',
      action: 'cancel',
    });

    expect(updated.schedule).toMatchObject({ weekdays: [0, 2] });
  });

  it('refuses an override on a one-off assertion, which has no occurrences', async () => {
    const place = await seedPlace('One-off place');
    const oneOff = await createWorkLocationAssertion(database, hubId, {
      placeId: place.id,
      schedule: { type: 'one_off_all_day', date: '2026-08-12', timezone: 'America/Los_Angeles' },
    });

    await expect(
      setWorkLocationOccurrence(database, hubId, oneOff.id, '2026-08-12', {
        date: '2026-08-12',
        action: 'cancel',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses when the route date and the body disagree', async () => {
    // Trusting either one alone would let a request edit a different day than the URL names.
    const place = await seedPlace('Mismatch place');
    const created = await seedWeekly(place.id);

    await expect(
      setWorkLocationOccurrence(database, hubId, created.id, '2026-08-12', {
        date: '2026-08-19',
        action: 'cancel',
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it.each([
    ['before the series starts', '2026-08-03'],
    ['after the series ends', '2026-10-07'],
    ['on a weekday the series does not cover', '2026-08-11'],
  ])('refuses a date %s', async (_label, date) => {
    // An exception for a day the series never covers would sit in the row forever, unreachable.
    const place = await seedPlace(`Range place ${date}`);
    const created = await seedWeekly(place.id);

    await expect(
      setWorkLocationOccurrence(database, hubId, created.id, date, { date, action: 'cancel' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses a replacement that does not start on the occurrence being replaced', async () => {
    const place = await seedPlace('Replacement place');
    const created = await seedWeekly(place.id);

    await expect(
      setWorkLocationOccurrence(database, hubId, created.id, '2026-08-12', {
        date: '2026-08-12',
        action: 'replace',
        placeId: place.id,
        schedule: {
          type: 'one_off_all_day',
          date: '2026-08-19',
          timezone: 'America/Los_Angeles',
        },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('resolving a hub from its owner', () => {
  it('finds the hub belonging to a user', async () => {
    const owner = firstRow(
      await database
        .insert(user)
        .values({ name: 'Resolvable', email: `wl-resolve-${Date.now()}@example.com` })
        .returning(),
      'resolvable user insertion',
    );
    const created = firstRow(
      await database.insert(hub).values({ userId: owner.id }).returning(),
      'resolvable hub insertion',
    );

    expect(await resolveWorkLocationHubId(owner.id, database)).toBe(created.id);
  });

  it('reports a user with no hub as not found rather than returning nothing', async () => {
    // Returning undefined here would surface later as a query against `hubId = undefined`, which
    // reads as an empty workspace instead of an error.
    const orphan = firstRow(
      await database
        .insert(user)
        .values({ name: 'Hubless', email: `wl-orphan-${Date.now()}@example.com` })
        .returning(),
      'orphan user insertion',
    );

    await expect(resolveWorkLocationHubId(orphan.id, database)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe('listing places', () => {
  it('keeps each hub’s places to itself', async () => {
    // The list is the surface a person picks a place from; a leak here is a cross-tenant
    // disclosure of where somebody works.
    const mine = await seedPlace('Isolation check');
    const theirs = firstRow(
      await database
        .insert(fullSchema.workPlace)
        .values({ hubId: otherHubId, name: 'Their studio' })
        .returning(),
      'foreign place insertion',
    );

    const list = await listWorkPlaces(database, hubId);
    const ids = list.items.map((item) => item.id);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
  });
});
