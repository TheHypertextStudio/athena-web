import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, seedBaseOrg } from './harness.test';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
const r: Record<string, unknown> = {};

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  r['savedViews'] = (await import('./saved-views')).default;
  r['agents'] = (await import('./agents')).default;
  r['roles'] = (await import('./roles')).default;
  r['integrations'] = (await import('./integrations')).default;
  r['cycles'] = (await import('./cycles')).default;
  r['daily-plan'] = (await import('./daily-plan')).default;
});

const J = { 'content-type': 'application/json' };
async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Create then return the id of an entity via a router POST. */
async function makeId(app: ReturnType<typeof appWithActor>, payload: unknown): Promise<string> {
  const res = await app.request('/', { method: 'POST', headers: J, body: JSON.stringify(payload) });
  return (await body<{ id: string }>(res)).id;
}

describe('saved-views: a patch that omits name (covers the name-absent branch)', () => {
  it('patches scope only', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(r['savedViews'], orgId, ['contribute'], humanActorId);
    const id = await makeId(w, { name: 'V' });
    expect(
      (
        await w.request(`/${id}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ scope: 'team' }),
        })
      ).status,
    ).toBe(200);
  });
});

describe('agents: create with approvalPolicy + a patch omitting guidance', () => {
  it('create with explicit approvalPolicy', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(r['agents'], orgId, ['manage'], humanActorId);
    const res = await w.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ displayName: 'Pol', approvalPolicy: 'autonomous' }),
    });
    expect(res.status).toBe(200);
  });

  it('patch sets connection only (every other field absent)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(r['agents'], orgId, ['manage'], humanActorId);
    const id = await makeId(w, { displayName: 'A' });
    expect(
      (
        await w.request(`/${id}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ connection: null }),
        })
      ).status,
    ).toBe(200);
  });
});

describe('roles: a patch that omits name (covers the name-absent branch)', () => {
  it('patches capabilities only', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const w = appWithActor(r['roles'], orgId, ['manage']);
    const id = await makeId(w, { key: 'k', name: 'K' });
    expect(
      (
        await w.request(`/${id}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ capabilities: ['view'] }),
        })
      ).status,
    ).toBe(200);
  });
});

describe('integrations: a patch that omits status (covers the status-absent branch)', () => {
  it('patches roles only', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(r['integrations'], orgId, ['manage'], humanActorId);
    const id = await makeId(w, { provider: 'github', pattern: 'connector' });
    expect(
      (
        await w.request(`/${id}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ roles: ['work'] }),
        })
      ).status,
    ).toBe(200);
  });
});

describe('cycles: a patch that omits name (covers the name-absent branch)', () => {
  it('patches number only', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(r['cycles'], orgId, ['contribute'], humanActorId);
    const id = await makeId(w, { teamId, number: 1, startsAt: '2026-01-01', endsAt: '2026-01-14' });
    expect(
      (
        await w.request(`/${id}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ number: 9 }),
        })
      ).status,
    ).toBe(200);
  });
});

describe('daily-plan: null timeboxes on create + a minimal patch', () => {
  it('creates with explicit null timeboxes and patches a single field', async () => {
    const [user] = await db
      .insert(schema.user)
      .values({ name: 'D', email: `d-${Math.random().toString(36).slice(2)}@e.com` })
      .returning({ id: schema.user.id });
    const [h] = await db
      .insert(schema.hub)
      .values({ userId: user!.id })
      .returning({ id: schema.hub.id });
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'D', userId: user!.id });
    const [t] = await db
      .insert(schema.task)
      .values({ organizationId: orgId, title: 'T', teamId, state: 'todo', createdBy: humanActorId })
      .returning({ id: schema.task.id });

    // appWithActor also injects a session; daily-plan reads the session for the user.
    const { appWithSession, fakeSession } = await import('./harness.test');
    const app = appWithSession(r['daily-plan'], fakeSession(user!.id));
    void h;

    // Create with explicit null timeboxes (covers the inner `? : null` null sides).
    const created = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        refOrganizationId: orgId,
        refTaskId: t!.id,
        date: '2026-07-01',
        timeboxStartsAt: null,
        timeboxEndsAt: null,
      }),
    });
    expect(created.status).toBe(200);
    const id = (await body<{ id: string }>(created)).id;

    // Patch with a single field (status) → other fields absent.
    expect(
      (
        await app.request(`/${id}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ status: 'done' }),
        })
      ).status,
    ).toBe(200);
    // Patch with both timeboxes set to a value (covers each inner truthy side).
    expect(
      (
        await app.request(`/${id}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({
            timeboxStartsAt: '2026-07-01T09:00:00.000Z',
            timeboxEndsAt: '2026-07-01T10:00:00.000Z',
          }),
        })
      ).status,
    ).toBe(200);
    // Patch with both timeboxes set to null (covers each inner null side).
    expect(
      (
        await app.request(`/${id}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ timeboxStartsAt: null, timeboxEndsAt: null }),
        })
      ).status,
    ).toBe(200);
    // Patch sort only (covers sort-present, timeboxes-absent).
    expect(
      (
        await app.request(`/${id}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ sort: 3 }),
        })
      ).status,
    ).toBe(200);
  });
});
