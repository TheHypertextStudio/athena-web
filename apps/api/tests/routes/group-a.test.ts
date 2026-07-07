import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, seedBaseOrg } from '../support/routes-harness';
import type cyclesRouter from '../../src/routes/cycles';
import type initiativesRouter from '../../src/routes/initiatives';
import type milestonesRouter from '../../src/routes/milestones';
import type programsRouter from '../../src/routes/programs';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let initiatives!: typeof initiativesRouter;
let programs!: typeof programsRouter;
let cycles!: typeof cyclesRouter;
let milestones!: typeof milestonesRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  initiatives = (await import('../../src/routes/initiatives')).default;
  programs = (await import('../../src/routes/programs')).default;
  cycles = (await import('../../src/routes/cycles')).default;
  milestones = (await import('../../src/routes/milestones')).default;
});

/** Parse a JSON response body as the given shape. */
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

// A valid ULID-shaped id that no seeded row uses (passes branded-id validation, 404s on lookup).
const MISSING_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('initiatives router', () => {
  it('lists, creates, gets, patches, and deletes', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(initiatives, orgId, ['manage'], humanActorId);

    // Empty list first.
    const empty = await writer.request('/', { method: 'GET' });
    expect(empty.status).toBe(200);
    expect((await json<{ items: unknown[] }>(empty)).items).toHaveLength(0);

    // Create (covers status default + targetDate present).
    const created = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Q3 Push', targetDate: '2026-09-30', health: 'on_track' }),
    });
    expect(created.status).toBe(200);
    const initiative = await json<{ id: string; targetDate: string | null }>(created);
    expect(initiative.targetDate).toBe('2026-09-30T00:00:00.000Z');

    // List has one now.
    const listed = await writer.request('/', { method: 'GET' });
    expect((await json<{ items: unknown[] }>(listed)).items).toHaveLength(1);

    // Get by id.
    const got = await writer.request(`/${initiative.id}`, { method: 'GET' });
    expect(got.status).toBe(200);
    expect((await json<{ id: string }>(got)).id).toBe(initiative.id);

    // Patch (covers every set branch incl. targetDate→null).
    const patched = await writer.request(`/${initiative.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Q3 Push v2',
        description: 'desc',
        ownerId: humanActorId,
        status: 'completed',
        targetDate: null,
        health: 'at_risk',
      }),
    });
    expect(patched.status).toBe(200);
    expect((await json<{ targetDate: string | null }>(patched)).targetDate).toBeNull();

    // Delete.
    const deleted = await writer.request(`/${initiative.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    const after = await writer.request(`/${initiative.id}`, { method: 'GET' });
    expect(after.status).toBe(404);
  });

  it('create without targetDate omits the date (undefined branch)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(initiatives, orgId, ['manage'], humanActorId);
    const created = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'No date' }),
    });
    expect(created.status).toBe(200);
    expect((await json<{ targetDate: string | null }>(created)).targetDate).toBeNull();
  });

  it('patch with targetDate set to a date covers the non-null branch', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(initiatives, orgId, ['manage'], humanActorId);
    const created = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    });
    const id = (await json<{ id: string }>(created)).id;
    const patched = await writer.request(`/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetDate: '2027-01-01' }),
    });
    expect((await json<{ targetDate: string | null }>(patched)).targetDate).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });

  it('403s on create/patch/delete for a view-only member', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const viewer = appWithActor(initiatives, orgId, ['view']);
    expect(
      (
        await viewer.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'x' }),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await viewer.request('/whatever', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'x' }),
        })
      ).status,
    ).toBe(403);
    expect((await viewer.request('/whatever', { method: 'DELETE' })).status).toBe(403);
  });

  it('404s on get/patch/delete of a missing id', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(initiatives, orgId, ['manage'], humanActorId);
    expect((await writer.request('/missing', { method: 'GET' })).status).toBe(404);
    expect(
      (
        await writer.request('/missing', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'x' }),
        })
      ).status,
    ).toBe(404);
    expect((await writer.request('/missing', { method: 'DELETE' })).status).toBe(404);
  });

  it('422s on an invalid create body', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(initiatives, orgId, ['manage']);
    const res = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(422);
  });
});

describe('programs router', () => {
  it('lists, creates (defaults), gets, patches (all branches), deletes', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(programs, orgId, ['manage'], humanActorId);

    expect((await json<{ items: unknown[] }>(await writer.request('/'))).items).toHaveLength(0);

    const created = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Platform' }),
    });
    expect(created.status).toBe(200);
    const id = (await json<{ id: string }>(created)).id;

    expect((await writer.request(`/${id}`)).status).toBe(200);

    const patched = await writer.request(`/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Platform v2',
        description: 'd',
        ownerId: humanActorId,
        status: 'paused',
        health: 'off_track',
        visibility: 'private',
      }),
    });
    expect(patched.status).toBe(200);

    expect((await writer.request(`/${id}`, { method: 'DELETE' })).status).toBe(200);
  });

  it('403 / 404 / 422 branches', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const viewer = appWithActor(programs, orgId, ['view']);
    expect(
      (
        await viewer.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'x' }),
        })
      ).status,
    ).toBe(403);

    const writer = appWithActor(programs, orgId, ['manage']);
    expect((await writer.request('/none')).status).toBe(404);
    expect(
      (
        await writer.request('/none', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'x' }),
        })
      ).status,
    ).toBe(404);
    expect((await writer.request('/none', { method: 'DELETE' })).status).toBe(404);
    expect(
      (
        await writer.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(422);
  });
});

describe('cycles router', () => {
  it('lists, creates, gets, patches, deletes (team must exist)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(cycles, orgId, ['contribute'], humanActorId);

    expect((await json<{ items: unknown[] }>(await writer.request('/'))).items).toHaveLength(0);

    const created = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        teamId,
        number: 1,
        name: 'Cycle 1',
        startsAt: '2026-01-01',
        endsAt: '2026-01-14',
      }),
    });
    expect(created.status).toBe(200);
    const id = (await json<{ id: string }>(created)).id;

    expect((await writer.request(`/${id}`)).status).toBe(200);

    const patched = await writer.request(`/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        number: 2,
        name: 'Cycle 2',
        startsAt: '2026-02-01',
        endsAt: '2026-02-14',
        status: 'active',
      }),
    });
    expect(patched.status).toBe(200);

    expect((await writer.request(`/${id}`, { method: 'DELETE' })).status).toBe(200);
  });

  it('404s on create when the team is not in the org', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(cycles, orgId, ['contribute'], humanActorId);
    const res = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        teamId: MISSING_ULID,
        number: 1,
        startsAt: '2026-01-01',
        endsAt: '2026-01-14',
      }),
    });
    expect(res.status).toBe(404);
  });

  it('403 / 404 / 422 branches', async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const viewer = appWithActor(cycles, orgId, ['view']);
    expect(
      (
        await viewer.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ teamId, number: 1, startsAt: '2026-01-01', endsAt: '2026-01-14' }),
        })
      ).status,
    ).toBe(403);

    const writer = appWithActor(cycles, orgId, ['contribute']);
    expect((await writer.request('/none')).status).toBe(404);
    expect(
      (
        await writer.request('/none', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ number: 9 }),
        })
      ).status,
    ).toBe(404);
    expect((await writer.request('/none', { method: 'DELETE' })).status).toBe(404);
    expect(
      (
        await writer.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ number: 'x' }),
        })
      ).status,
    ).toBe(422);
  });
});

describe('milestones router', () => {
  it('lists (with + without project filter), creates, gets, patches, deletes', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(milestones, orgId, ['contribute'], humanActorId);

    // Seed a project to attach milestones to.
    const [proj] = await db
      .insert(schema.project)
      .values({ organizationId: orgId, name: 'Proj', teamId, createdBy: humanActorId })
      .returning({ id: schema.project.id });
    const projectId = proj!.id;

    // Empty list (no filter branch).
    expect((await json<{ items: unknown[] }>(await writer.request('/'))).items).toHaveLength(0);

    const created = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, name: 'M1', targetDate: '2026-06-01', sort: 1 }),
    });
    expect(created.status).toBe(200);
    const id = (await json<{ id: string }>(created)).id;

    // List with the project filter branch.
    const filtered = await writer.request(`/?projectId=${projectId}`);
    expect((await json<{ items: unknown[] }>(filtered)).items).toHaveLength(1);

    expect((await writer.request(`/${id}`)).status).toBe(200);

    const patched = await writer.request(`/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'M1b', targetDate: null, sort: 5 }),
    });
    expect(patched.status).toBe(200);
    expect((await json<{ targetDate: string | null }>(patched)).targetDate).toBeNull();

    // Patch targetDate to a value (non-null branch).
    const patched2 = await writer.request(`/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetDate: '2026-07-01' }),
    });
    expect((await json<{ targetDate: string | null }>(patched2)).targetDate).toBe(
      '2026-07-01T00:00:00.000Z',
    );

    expect((await writer.request(`/${id}`, { method: 'DELETE' })).status).toBe(200);
  });

  it('create without targetDate omits the date', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(milestones, orgId, ['contribute'], humanActorId);
    const [proj] = await db
      .insert(schema.project)
      .values({ organizationId: orgId, name: 'P2', teamId, createdBy: humanActorId })
      .returning({ id: schema.project.id });
    const created = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: proj!.id, name: 'M-nodate' }),
    });
    expect(created.status).toBe(200);
    expect((await json<{ targetDate: string | null }>(created)).targetDate).toBeNull();
  });

  it('404s on create when the project is not in the org', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(milestones, orgId, ['contribute'], humanActorId);
    const res = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: MISSING_ULID, name: 'M' }),
    });
    expect(res.status).toBe(404);
  });

  it('403 / 404 / 422 branches', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const viewer = appWithActor(milestones, orgId, ['view']);
    expect(
      (
        await viewer.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ projectId: 'p', name: 'M' }),
        })
      ).status,
    ).toBe(403);

    const writer = appWithActor(milestones, orgId, ['contribute']);
    expect((await writer.request('/none')).status).toBe(404);
    expect(
      (
        await writer.request('/none', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'x' }),
        })
      ).status,
    ).toBe(404);
    expect((await writer.request('/none', { method: 'DELETE' })).status).toBe(404);
    expect(
      (
        await writer.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ projectId: 'p' }),
        })
      ).status,
    ).toBe(422);
  });
});
