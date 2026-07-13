import { beforeAll, describe, expect, it } from 'vitest';

import type {
  CalendarItemOut,
  CalendarItemRelationOut,
  CalendarLayerShareOut,
} from '@docket/types';

import {
  addMember,
  appWithSession,
  fakeSession,
  getDb,
  seedBaseOrg,
  seedUserWithHub,
} from '../support/routes-harness';

let calendarRouter: unknown;

beforeAll(async () => {
  calendarRouter = (await import('../../src/routes/me-calendar')).default;
});

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

async function createItem(
  app: ReturnType<typeof appWithSession>,
  title: string,
): Promise<CalendarItemOut> {
  return body<CalendarItemOut>(
    await app.request('/items', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        kind: 'native_block',
        title,
        startsAt: '2026-08-04T10:00:00.000Z',
        endsAt: '2026-08-04T11:00:00.000Z',
      }),
    }),
  );
}

describe('calendar item creation intents', () => {
  it('routes event and timebox intents through the unified create service', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'CreateIntentOwner');
    const app = appWithSession(calendarRouter, fakeSession(userId));

    const eventResponse = await app.request('/items', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        intent: 'event',
        title: 'Design review',
        startsAt: '2026-08-04T09:00:00.000Z',
        endsAt: '2026-08-04T10:00:00.000Z',
      }),
    });
    expect(eventResponse.status).toBe(200);
    expect((await body<CalendarItemOut>(eventResponse)).kind).toBe('native_event');

    const timeboxResponse = await app.request('/items', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        intent: 'timebox',
        title: 'Prepare slides',
        startsAt: '2026-08-04T10:00:00.000Z',
        endsAt: '2026-08-04T11:00:00.000Z',
      }),
    });
    expect(timeboxResponse.status).toBe(200);
    expect((await body<CalendarItemOut>(timeboxResponse)).kind).toBe('timebox');
  });
});

describe('calendar item relationships', () => {
  it('creates and deletes a same-owner relationship while rejecting self, duplicate, and foreign targets', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'RelationOwner');
    const foreignUserId = await seedUserWithHub(schema.db, schema, 'RelationForeign');
    const app = appWithSession(calendarRouter, fakeSession(userId));
    const foreignApp = appWithSession(calendarRouter, fakeSession(foreignUserId));
    const source = await createItem(app, 'Planning');
    const target = await createItem(app, 'Contained focus block');
    const foreign = await createItem(foreignApp, 'Private foreign block');

    const createdResponse = await app.request(`/items/${source.id}/relations`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ targetItemId: target.id, role: 'contained' }),
    });
    expect(createdResponse.status).toBe(200);
    expect(await body<CalendarItemRelationOut>(createdResponse)).toMatchObject({
      sourceItemId: source.id,
      targetItemId: target.id,
      role: 'contained',
      createdByUserId: userId,
    });

    const listedResponse = await app.request(`/items/${source.id}/relations`);
    expect(listedResponse.status).toBe(200);
    expect((await body<{ items: CalendarItemRelationOut[] }>(listedResponse)).items).toEqual([
      expect.objectContaining({
        sourceItemId: source.id,
        targetItemId: target.id,
        targetTitle: target.title,
        targetKind: target.kind,
        role: 'contained',
      }),
    ]);

    const duplicate = await app.request(`/items/${source.id}/relations`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ targetItemId: target.id, role: 'related' }),
    });
    expect(duplicate.status).toBe(409);
    expect((await body<{ code: string }>(duplicate)).code).toBe('conflict');

    const self = await app.request(`/items/${source.id}/relations`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ targetItemId: source.id, role: 'related' }),
    });
    expect(self.status).toBe(422);

    const foreignTarget = await app.request(`/items/${source.id}/relations`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ targetItemId: foreign.id, role: 'related' }),
    });
    expect(foreignTarget.status).toBe(404);

    const deletedResponse = await app.request(`/items/${source.id}/relations/${target.id}`, {
      method: 'DELETE',
    });
    expect(deletedResponse.status).toBe(200);
    expect(await body<CalendarItemRelationOut>(deletedResponse)).toMatchObject({
      sourceItemId: source.id,
      targetItemId: target.id,
    });
    expect(
      (
        await app.request(`/items/${source.id}/relations/${target.id}`, {
          method: 'DELETE',
        })
      ).status,
    ).toBe(404);
  });
});

describe('workspace calendar-layer sharing', () => {
  it('replaces only the caller layer exposures and existence-hides foreign layers and workspaces', async () => {
    const schema = await getDb();
    const org = await seedBaseOrg(schema.db, schema);
    const userId = await seedUserWithHub(schema.db, schema, 'ShareOwner');
    await addMember(schema.db, schema, org.orgId, userId);
    const foreignUserId = await seedUserWithHub(schema.db, schema, 'ShareForeign');
    const app = appWithSession(calendarRouter, fakeSession(userId));
    const foreignApp = appWithSession(calendarRouter, fakeSession(foreignUserId));
    const first = await createItem(app, 'Shared details');
    const foreign = await createItem(foreignApp, 'Not mine');
    const foreignActorId = await addMember(schema.db, schema, org.orgId, foreignUserId);
    await schema.db.insert(schema.calendarLayerShare).values({
      layerId: foreign.layerId,
      organizationId: org.orgId,
      access: 'details',
      createdBy: foreignActorId,
    });

    const replaced = await app.request(`/shares/${org.orgId}`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ shares: [{ layerId: first.layerId, access: 'busy' }] }),
    });
    expect(replaced.status).toBe(200);
    expect((await body<{ items: CalendarLayerShareOut[] }>(replaced)).items).toEqual([
      expect.objectContaining({
        layerId: first.layerId,
        organizationId: org.orgId,
        access: 'busy',
      }),
    ]);

    const listed = await body<{ items: CalendarLayerShareOut[] }>(
      await app.request(`/shares/${org.orgId}`),
    );
    expect(listed.items.map((share) => share.layerId)).toEqual([first.layerId]);

    const duplicate = await app.request(`/shares/${org.orgId}`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        shares: [
          { layerId: first.layerId, access: 'busy' },
          { layerId: first.layerId, access: 'details' },
        ],
      }),
    });
    expect(duplicate.status).toBe(422);

    const foreignLayer = await app.request(`/shares/${org.orgId}`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ shares: [{ layerId: foreign.layerId, access: 'details' }] }),
    });
    expect(foreignLayer.status).toBe(404);

    const cleared = await app.request(`/shares/${org.orgId}`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({ shares: [] }),
    });
    expect(cleared.status).toBe(200);
    expect((await body<{ items: unknown[] }>(cleared)).items).toEqual([]);
    const survivingShares = await schema.db.select().from(schema.calendarLayerShare);
    expect(survivingShares).toEqual([
      expect.objectContaining({ layerId: foreign.layerId, organizationId: org.orgId }),
    ]);

    const nonMemberOrg = await seedBaseOrg(schema.db, schema);
    expect((await app.request(`/shares/${nonMemberOrg.orgId}`)).status).toBe(404);
  });
});
