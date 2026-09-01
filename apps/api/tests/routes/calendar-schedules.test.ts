import { beforeAll, describe, expect, it } from 'vitest';

import type { ScheduleComparisonOut } from '@docket/planning/calendar-contract';
import { eq } from 'drizzle-orm';

import {
  addMember,
  appWithActor,
  fakeSession,
  getDb,
  one,
  seedBaseOrg,
  seedUserWithHub,
} from '../support/routes-harness';

let schedulesRouter: unknown;

beforeAll(async () => {
  schedulesRouter = (await import('../../src/routes/calendar-schedules')).default;
});

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe('workspace schedule comparison', () => {
  it('returns active actors in request order and structurally redacts busy/private items', async () => {
    const schema = await getDb();
    const org = await seedBaseOrg(schema.db, schema);
    const detailsUserId = await seedUserWithHub(schema.db, schema, 'DetailsPerson');
    const busyUserId = await seedUserWithHub(schema.db, schema, 'BusyPerson');
    const detailsActorId = await addMember(schema.db, schema, org.orgId, detailsUserId);
    const busyActorId = await addMember(schema.db, schema, org.orgId, busyUserId);
    await schema.db
      .update(schema.hub)
      .set({ preferences: { timezone: 'America/Los_Angeles' } })
      .where(eq(schema.hub.userId, detailsUserId));

    const detailsLayer = one(
      await schema.db
        .insert(schema.calendarLayer)
        .values({
          userId: detailsUserId,
          provider: 'docket',
          sourceKind: 'native_blocks',
          title: 'Details layer',
          timezone: 'UTC',
          editableCore: true,
        })
        .returning({ id: schema.calendarLayer.id }),
    );
    const busyLayer = one(
      await schema.db
        .insert(schema.calendarLayer)
        .values({
          userId: busyUserId,
          provider: 'docket',
          sourceKind: 'native_blocks',
          title: 'Busy layer',
          timezone: 'Europe/London',
          editableCore: true,
        })
        .returning({ id: schema.calendarLayer.id }),
    );
    await schema.db.insert(schema.calendarLayerShare).values([
      {
        layerId: detailsLayer.id,
        organizationId: org.orgId,
        access: 'details',
        createdBy: detailsActorId,
      },
      {
        layerId: busyLayer.id,
        organizationId: org.orgId,
        access: 'busy',
        createdBy: busyActorId,
      },
    ]);
    await schema.db.insert(schema.calendarItem).values([
      {
        userId: detailsUserId,
        layerId: detailsLayer.id,
        kind: 'native_event',
        title: 'Visible design review',
        startsAt: new Date('2026-08-04T10:00:00.000Z'),
        endsAt: new Date('2026-08-04T11:00:00.000Z'),
      },
      {
        userId: detailsUserId,
        layerId: detailsLayer.id,
        kind: 'provider_event',
        title: 'Secret acquisition',
        providerRaw: { visibility: 'private' },
        startsAt: new Date('2026-08-04T12:00:00.000Z'),
        endsAt: new Date('2026-08-04T13:00:00.000Z'),
      },
      {
        userId: busyUserId,
        layerId: busyLayer.id,
        kind: 'native_block',
        title: 'Private therapy',
        startsAt: new Date('2026-08-04T14:00:00.000Z'),
        endsAt: new Date('2026-08-04T15:00:00.000Z'),
      },
    ]);

    const app = appWithActor(
      schedulesRouter,
      org.orgId,
      [],
      detailsActorId,
      fakeSession(detailsUserId),
    );
    const response = await app.request(
      `/schedules?start=2026-08-04T00%3A00%3A00.000Z&end=2026-08-05T00%3A00%3A00.000Z&actorIds=${busyActorId}&actorIds=${detailsActorId}`,
    );
    expect(response.status).toBe(200);
    const comparison = await body<ScheduleComparisonOut>(response);
    expect(comparison.people.map((person) => person.actorId)).toEqual([
      busyActorId,
      detailsActorId,
    ]);
    expect(comparison.people[0]).toMatchObject({
      actorId: busyActorId,
      timezone: 'Europe/London',
      items: [{ access: 'busy' }],
    });
    expect(comparison.people[0]?.items[0]).not.toHaveProperty('title');
    expect(comparison.people[1]?.timezone).toBe('America/Los_Angeles');
    expect(comparison.people[1]?.items).toHaveLength(2);
    expect(comparison.people[1]?.items[0]).toMatchObject({
      access: 'details',
      title: 'Visible design review',
    });
    expect(comparison.people[1]?.items[1]).toEqual({
      access: 'busy',
      startsAt: '2026-08-04T12:00:00.000Z',
      endsAt: '2026-08-04T13:00:00.000Z',
      allDayStartDate: null,
      allDayEndDate: null,
    });
  });

  it('rejects duplicate, suspended, and cross-org actor ids', async () => {
    const schema = await getDb();
    const org = await seedBaseOrg(schema.db, schema);
    const userId = await seedUserWithHub(schema.db, schema, 'ScheduleCaller');
    const actorId = await addMember(schema.db, schema, org.orgId, userId);
    const suspendedUserId = await seedUserWithHub(schema.db, schema, 'SuspendedPerson');
    const suspendedActorId = await addMember(
      schema.db,
      schema,
      org.orgId,
      suspendedUserId,
      'member',
      'suspended',
    );
    const foreign = await seedBaseOrg(schema.db, schema);
    const app = appWithActor(schedulesRouter, org.orgId, [], actorId, fakeSession(userId));
    const base = '/schedules?start=2026-08-04T00%3A00%3A00.000Z&end=2026-08-05T00%3A00%3A00.000Z';

    expect((await app.request(`${base}&actorIds=${actorId}&actorIds=${actorId}`)).status).toBe(422);
    expect((await app.request(`${base}&actorIds=${suspendedActorId}`)).status).toBe(404);
    expect((await app.request(`${base}&actorIds=${foreign.humanActorId}`)).status).toBe(404);
    const suspendedCaller = appWithActor(
      schedulesRouter,
      org.orgId,
      [],
      suspendedActorId,
      fakeSession(suspendedUserId),
    );
    expect((await suspendedCaller.request(`${base}&actorIds=${actorId}`)).status).toBe(404);
  });

  it('reports a null timezone and no items for an active actor with no linked user', async () => {
    const schema = await getDb();
    // seedBaseOrg's human actor is deliberately unclaimed: active + human, but userId is null.
    const org = await seedBaseOrg(schema.db, schema);
    const callerUserId = await seedUserWithHub(schema.db, schema, 'ScheduleCallerUnclaimed');
    const callerActorId = await addMember(schema.db, schema, org.orgId, callerUserId);
    const app = appWithActor(
      schedulesRouter,
      org.orgId,
      [],
      callerActorId,
      fakeSession(callerUserId),
    );
    const base = '/schedules?start=2026-08-04T00%3A00%3A00.000Z&end=2026-08-05T00%3A00%3A00.000Z';

    const response = await app.request(`${base}&actorIds=${org.humanActorId}`);
    expect(response.status).toBe(200);
    const comparison = await body<ScheduleComparisonOut>(response);
    expect(comparison.people).toEqual([
      expect.objectContaining({ actorId: org.humanActorId, timezone: null, items: [] }),
    ]);
  });

  it('leaves timezone null when neither the Hub preferences nor the shared layer name one', async () => {
    const schema = await getDb();
    const org = await seedBaseOrg(schema.db, schema);
    // A fresh Hub's preferences default to `{}` — no timezone — and this layer names none either.
    const personUserId = await seedUserWithHub(schema.db, schema, 'NoTzPerson');
    const personActorId = await addMember(schema.db, schema, org.orgId, personUserId);
    const callerUserId = await seedUserWithHub(schema.db, schema, 'NoTzCaller');
    const callerActorId = await addMember(schema.db, schema, org.orgId, callerUserId);

    const layer = one(
      await schema.db
        .insert(schema.calendarLayer)
        .values({
          userId: personUserId,
          provider: 'docket',
          sourceKind: 'native_blocks',
          title: 'No timezone layer',
          timezone: null,
          editableCore: true,
        })
        .returning({ id: schema.calendarLayer.id }),
    );
    await schema.db.insert(schema.calendarLayerShare).values({
      layerId: layer.id,
      organizationId: org.orgId,
      access: 'busy',
      createdBy: personActorId,
    });

    const app = appWithActor(
      schedulesRouter,
      org.orgId,
      [],
      callerActorId,
      fakeSession(callerUserId),
    );
    const res = await app.request(
      `/schedules?start=2026-08-04T00%3A00%3A00.000Z&end=2026-08-05T00%3A00%3A00.000Z&actorIds=${personActorId}`,
    );
    expect(res.status).toBe(200);
    const comparison = await body<ScheduleComparisonOut>(res);
    expect(comparison.people).toEqual([
      expect.objectContaining({ actorId: personActorId, timezone: null }),
    ]);
  });
});
