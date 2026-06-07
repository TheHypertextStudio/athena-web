import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, seedBaseOrg } from './harness.test';
import type projectsRouter from '../../src/routes/projects';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let projects!: typeof projectsRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  projects = (await import('../../src/routes/projects')).default;
});

/** Parse a JSON response body as the given shape. */
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

// A valid ULID-shaped id that no seeded row uses (passes branded-id validation, 404s on lookup).
const MISSING_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

/** Create a project row directly in the db (bypassing the router) and return its id. */
async function seedProject(orgId: string, teamId: string, createdBy: string): Promise<string> {
  const [proj] = await db
    .insert(schema.project)
    .values({ organizationId: orgId, name: 'Seeded', teamId, createdBy })
    .returning({ id: schema.project.id });
  return proj!.id;
}

/** Insert a task into a project; `estimate`/`completedAt` drive the progress roll-up. */
async function seedTask(args: {
  orgId: string;
  teamId: string;
  projectId: string | null;
  estimate?: number | null;
  completed?: boolean;
}): Promise<string> {
  const [t] = await db
    .insert(schema.task)
    .values({
      organizationId: args.orgId,
      title: 'T',
      teamId: args.teamId,
      state: 'backlog',
      projectId: args.projectId,
      estimate: args.estimate ?? null,
      completedAt: args.completed ? new Date() : null,
    })
    .returning({ id: schema.task.id });
  return t!.id;
}

describe('projects detail router', () => {
  it('gets a project by id', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(projects, orgId, ['contribute'], humanActorId);
    const id = await seedProject(orgId, teamId, humanActorId);

    const got = await writer.request(`/${id}`, { method: 'GET' });
    expect(got.status).toBe(200);
    const body = await json<{ id: string; status: string }>(got);
    expect(body.id).toBe(id);
    expect(body.status).toBe('planned');
  });

  it('patches every updatable field (incl. clearing nullable dates)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(projects, orgId, ['contribute'], humanActorId);

    // Seed a program + a second team to exercise programId/teamId re-pointing.
    const [prog] = await db
      .insert(schema.program)
      .values({ organizationId: orgId, name: 'Prog', createdBy: humanActorId })
      .returning({ id: schema.program.id });
    const [team2] = await db
      .insert(schema.team)
      .values({ organizationId: orgId, name: 'Other', key: 'OTH' })
      .returning({ id: schema.team.id });

    const id = await seedProject(orgId, teamId, humanActorId);

    // First patch: set dates + every field.
    const patched = await writer.request(`/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Renamed',
        description: 'a description',
        leadId: humanActorId,
        programId: prog!.id,
        teamId: team2!.id,
        status: 'active',
        health: 'at_risk',
        startDate: '2026-01-01',
        targetDate: '2026-12-31',
      }),
    });
    expect(patched.status).toBe(200);
    const after = await json<{
      name: string;
      description: string | null;
      status: string;
      health: string | null;
      startDate: string | null;
      targetDate: string | null;
      programId: string | null;
      teamId: string | null;
      leadId: string | null;
    }>(patched);
    expect(after.name).toBe('Renamed');
    expect(after.description).toBe('a description');
    expect(after.status).toBe('active');
    expect(after.health).toBe('at_risk');
    expect(after.startDate).toBe('2026-01-01T00:00:00.000Z');
    expect(after.targetDate).toBe('2026-12-31T00:00:00.000Z');
    expect(after.programId).toBe(prog!.id);
    expect(after.teamId).toBe(team2!.id);
    expect(after.leadId).toBe(humanActorId);

    // Second patch: clear the nullable columns (the `null` branches).
    const cleared = await writer.request(`/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        description: null,
        leadId: null,
        programId: null,
        teamId: null,
        health: null,
        startDate: null,
        targetDate: null,
      }),
    });
    expect(cleared.status).toBe(200);
    const clearedBody = await json<{
      description: string | null;
      startDate: string | null;
      targetDate: string | null;
      programId: string | null;
      health: string | null;
    }>(cleared);
    expect(clearedBody.description).toBeNull();
    expect(clearedBody.startDate).toBeNull();
    expect(clearedBody.targetDate).toBeNull();
    expect(clearedBody.programId).toBeNull();
    expect(clearedBody.health).toBeNull();
  });

  it('patches with an empty body (no-op, leaves the row intact)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(projects, orgId, ['contribute'], humanActorId);
    const id = await seedProject(orgId, teamId, humanActorId);
    const res = await writer.request(`/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect((await json<{ id: string; name: string }>(res)).name).toBe('Seeded');
  });

  it('deletes a project (manage), then 404s on re-read', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(projects, orgId, ['manage'], humanActorId);
    const id = await seedProject(orgId, teamId, humanActorId);

    const deleted = await writer.request(`/${id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect((await json<{ id: string }>(deleted)).id).toBe(id);

    const after = await writer.request(`/${id}`, { method: 'GET' });
    expect(after.status).toBe(404);
  });

  it('404s on get/patch/delete/progress of a missing id', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(projects, orgId, ['manage'], humanActorId);
    expect((await writer.request(`/${MISSING_ULID}`, { method: 'GET' })).status).toBe(404);
    expect(
      (
        await writer.request(`/${MISSING_ULID}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'x' }),
        })
      ).status,
    ).toBe(404);
    // Empty-body patch of a missing id hits the no-op re-read branch and still 404s.
    expect(
      (
        await writer.request(`/${MISSING_ULID}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        })
      ).status,
    ).toBe(404);
    expect((await writer.request(`/${MISSING_ULID}`, { method: 'DELETE' })).status).toBe(404);
    expect((await writer.request(`/${MISSING_ULID}/progress`, { method: 'GET' })).status).toBe(404);
  });

  it('403s on patch/delete for a view-only member; delete needs manage not contribute', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedProject(orgId, teamId, humanActorId);

    const viewer = appWithActor(projects, orgId, ['view']);
    expect(
      (
        await viewer.request(`/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'x' }),
        })
      ).status,
    ).toBe(403);
    expect((await viewer.request(`/${id}`, { method: 'DELETE' })).status).toBe(403);

    // A `contribute` actor may patch but NOT delete (delete requires `manage`).
    const contributor = appWithActor(projects, orgId, ['contribute'], humanActorId);
    expect((await contributor.request(`/${id}`, { method: 'DELETE' })).status).toBe(403);
  });

  it('422s on an invalid patch body (empty name)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(projects, orgId, ['contribute'], humanActorId);
    const id = await seedProject(orgId, teamId, humanActorId);
    const res = await writer.request(`/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(422);
  });

  it("isolates tenants: cannot read or progress another org's project", async () => {
    const orgA = await seedBaseOrg(db, schema);
    const orgB = await seedBaseOrg(db, schema);
    const idInA = await seedProject(orgA.orgId, orgA.teamId, orgA.humanActorId);

    // Actor scoped to org B must not see org A's project.
    const writerB = appWithActor(projects, orgB.orgId, ['manage'], orgB.humanActorId);
    expect((await writerB.request(`/${idInA}`, { method: 'GET' })).status).toBe(404);
    expect((await writerB.request(`/${idInA}/progress`, { method: 'GET' })).status).toBe(404);
    expect(
      (
        await writerB.request(`/${idInA}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'hijack' }),
        })
      ).status,
    ).toBe(404);
    expect((await writerB.request(`/${idInA}`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('projects progress (weighted completion)', () => {
  it('returns zeros for a project with no tasks', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(projects, orgId, ['view'], humanActorId);
    const id = await seedProject(orgId, teamId, humanActorId);

    const res = await writer.request(`/${id}/progress`, { method: 'GET' });
    expect(res.status).toBe(200);
    const p = await json<{
      percent: number;
      completedWeight: number;
      totalWeight: number;
      taskCount: number;
      completedCount: number;
    }>(res);
    expect(p).toEqual({
      percent: 0,
      completedWeight: 0,
      totalWeight: 0,
      taskCount: 0,
      completedCount: 0,
    });
  });

  it('weights by estimate when estimates are present', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(projects, orgId, ['view'], humanActorId);
    const id = await seedProject(orgId, teamId, humanActorId);

    // Completed weight 8 (estimate 8, done) + 2 (estimate 2, done) = 10; total = 10 + 5 + 5 = 20.
    await seedTask({ orgId, teamId, projectId: id, estimate: 8, completed: true });
    await seedTask({ orgId, teamId, projectId: id, estimate: 2, completed: true });
    await seedTask({ orgId, teamId, projectId: id, estimate: 5, completed: false });
    await seedTask({ orgId, teamId, projectId: id, estimate: 5, completed: false });

    const res = await writer.request(`/${id}/progress`, { method: 'GET' });
    const p = await json<{
      percent: number;
      completedWeight: number;
      totalWeight: number;
      taskCount: number;
      completedCount: number;
    }>(res);
    expect(p.totalWeight).toBe(20);
    expect(p.completedWeight).toBe(10);
    expect(p.percent).toBe(0.5);
    expect(p.taskCount).toBe(4);
    expect(p.completedCount).toBe(2);
  });

  it('falls back to task count when no task carries an estimate', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(projects, orgId, ['view'], humanActorId);
    const id = await seedProject(orgId, teamId, humanActorId);

    // 1 of 4 completed, no estimates -> percent 0.25, weights == counts.
    await seedTask({ orgId, teamId, projectId: id, completed: true });
    await seedTask({ orgId, teamId, projectId: id, completed: false });
    await seedTask({ orgId, teamId, projectId: id, completed: false });
    await seedTask({ orgId, teamId, projectId: id, completed: false });

    const res = await writer.request(`/${id}/progress`, { method: 'GET' });
    const p = await json<{
      percent: number;
      completedWeight: number;
      totalWeight: number;
      taskCount: number;
      completedCount: number;
    }>(res);
    expect(p.percent).toBe(0.25);
    expect(p.totalWeight).toBe(4);
    expect(p.completedWeight).toBe(1);
    expect(p.taskCount).toBe(4);
    expect(p.completedCount).toBe(1);
  });

  it('treats a partial-estimate project as estimate-weighted (missing estimate counts 0)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(projects, orgId, ['view'], humanActorId);
    const id = await seedProject(orgId, teamId, humanActorId);

    // One estimated+completed task (10), one un-estimated completed task (counts 0 weight).
    await seedTask({ orgId, teamId, projectId: id, estimate: 10, completed: true });
    await seedTask({ orgId, teamId, projectId: id, estimate: null, completed: true });

    const res = await writer.request(`/${id}/progress`, { method: 'GET' });
    const p = await json<{
      percent: number;
      completedWeight: number;
      totalWeight: number;
      taskCount: number;
      completedCount: number;
    }>(res);
    // Estimate mode kicks in (an estimate exists): total weight 10, completed weight 10.
    expect(p.totalWeight).toBe(10);
    expect(p.completedWeight).toBe(10);
    expect(p.percent).toBe(1);
    // Raw counts still reflect both tasks.
    expect(p.taskCount).toBe(2);
    expect(p.completedCount).toBe(2);
  });

  it('scopes progress to the project: tasks in another project do not count', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(projects, orgId, ['view'], humanActorId);
    const idA = await seedProject(orgId, teamId, humanActorId);
    const idB = await seedProject(orgId, teamId, humanActorId);

    await seedTask({ orgId, teamId, projectId: idA, estimate: 3, completed: true });
    // A task in project B and a project-less task must NOT affect project A's roll-up.
    await seedTask({ orgId, teamId, projectId: idB, estimate: 99, completed: false });
    await seedTask({ orgId, teamId, projectId: null, estimate: 99, completed: false });

    const res = await writer.request(`/${idA}/progress`, { method: 'GET' });
    const p = await json<{ totalWeight: number; taskCount: number; percent: number }>(res);
    expect(p.totalWeight).toBe(3);
    expect(p.taskCount).toBe(1);
    expect(p.percent).toBe(1);
  });
});
