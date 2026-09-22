import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type { StatusIdLookup } from '../support/routes-harness';
import {
  appWithActor,
  getDb,
  one,
  seedBaseOrg,
  seedTaskAccessOrg,
} from '../support/routes-harness';
import type milestonesRouter from '../../src/routes/milestones';
import type tasksRouter from '../../src/routes/tasks';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let milestones!: typeof milestonesRouter;
let tasks!: typeof tasksRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  milestones = (await import('../../src/routes/milestones')).default;
  tasks = (await import('../../src/routes/tasks')).default;
});

/** Parse a JSON response body as the given shape. */
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Create a project row directly in the db and return its id. */
async function seedProject(
  statusId: StatusIdLookup,
  orgId: string,
  teamId: string,
  createdBy: string,
): Promise<string> {
  return one(
    await db
      .insert(schema.project)
      .values({
        organizationId: orgId,
        name: 'Proj',
        teamId,
        createdBy,
        status: 'planned',
        statusId: statusId('project', 'planned'),
      })
      .returning({ id: schema.project.id }),
  ).id;
}

/** Create a milestone row directly in the db (bypassing the router) and return its id. */
async function seedMilestone(orgId: string, projectId: string, createdBy: string): Promise<string> {
  const [m] = await db
    .insert(schema.milestone)
    .values({ organizationId: orgId, projectId, name: 'M', createdBy })
    .returning({ id: schema.milestone.id });
  return assertDefined(m).id;
}

describe('milestones detail: tenant isolation', () => {
  it("cannot get/patch/delete another org's milestone (404, existence-hidden)", async () => {
    const orgA = await seedBaseOrg(db, schema);
    const orgB = await seedBaseOrg(db, schema);
    const projA = await seedProject(orgA.statusId, orgA.orgId, orgA.teamId, orgA.humanActorId);
    const idInA = await seedMilestone(orgA.orgId, projA, orgA.humanActorId);

    // An actor scoped to org B must not see org A's milestone, even with manage-level caps.
    const writerB = appWithActor(milestones, orgB.orgId, ['contribute'], orgB.humanActorId);

    const path = `/${projA}/milestones/${idInA}`;
    expect((await writerB.request(path, { method: 'GET' })).status).toBe(404);
    expect(
      (
        await writerB.request(path, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'hijack' }),
        })
      ).status,
    ).toBe(404);
    expect((await writerB.request(path, { method: 'DELETE' })).status).toBe(404);

    // The row in org A is untouched (the cross-tenant writes never landed).
    const stillThere = await db
      .select()
      .from(schema.milestone)
      .where(eq(schema.milestone.id, idInA))
      .limit(1);
    expect(stillThere[0]?.name).toBe('M');
  });

  it("list is org-scoped: another org's milestones never appear", async () => {
    const orgA = await seedBaseOrg(db, schema);
    const orgB = await seedBaseOrg(db, schema);
    const projA = await seedProject(orgA.statusId, orgA.orgId, orgA.teamId, orgA.humanActorId);
    await seedMilestone(orgA.orgId, projA, orgA.humanActorId);

    // Naming org A's project from org B hides its existence rather than leaking its milestones.
    const readerB = appWithActor(milestones, orgB.orgId, ['view'], orgB.humanActorId);
    const listed = await readerB.request(`/${projA}/milestones`, { method: 'GET' });
    expect(listed.status).toBe(404);
  });
});

describe('milestones detail: a milestone is reachable only through its own project', () => {
  it("404s when the path names a sibling project instead of the milestone's own", async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(milestones, orgId, ['contribute'], humanActorId);
    const owning = await seedProject(statusId, orgId, teamId, humanActorId);
    const sibling = await seedProject(statusId, orgId, teamId, humanActorId);
    const milestoneId = await seedMilestone(orgId, owning, humanActorId);

    // Same org, real project, real milestone — but the two are unrelated, so guessing an id
    // through a project the caller happens to know must not reach it.
    expect(
      (await writer.request(`/${sibling}/milestones/${milestoneId}`, { method: 'GET' })).status,
    ).toBe(404);
    expect(
      (await writer.request(`/${sibling}/milestones/${milestoneId}`, { method: 'DELETE' })).status,
    ).toBe(404);
    expect(
      (await writer.request(`/${owning}/milestones/${milestoneId}`, { method: 'GET' })).status,
    ).toBe(200);
  });
});

describe('milestones detail: an archived project hides its milestones consistently', () => {
  it('404s every route once the project is archived, not just the list', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(milestones, orgId, ['contribute'], humanActorId);
    const projectId = await seedProject(statusId, orgId, teamId, humanActorId);
    const milestoneId = await seedMilestone(orgId, projectId, humanActorId);

    await db
      .update(schema.project)
      .set({ archivedAt: new Date() })
      .where(eq(schema.project.id, projectId));

    // The member routes read the parent on the same terms the collection does, so a milestone is
    // never simultaneously unlistable and editable.
    expect((await writer.request(`/${projectId}/milestones`)).status).toBe(404);
    expect((await writer.request(`/${projectId}/milestones/${milestoneId}`)).status).toBe(404);
    expect(
      (
        await writer.request(`/${projectId}/milestones/${milestoneId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: 'x' }),
        })
      ).status,
    ).toBe(404);
    expect(
      (await writer.request(`/${projectId}/milestones/${milestoneId}`, { method: 'DELETE' }))
        .status,
    ).toBe(404);
  });
});

describe('milestones detail: delete nulls referencing tasks', () => {
  it("deleting a milestone sets referencing tasks' milestone_id to null (FK on delete)", async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(milestones, orgId, ['contribute'], humanActorId);
    const projectId = await seedProject(statusId, orgId, teamId, humanActorId);
    const milestoneId = await seedMilestone(orgId, projectId, humanActorId);

    // A task pinned to the milestone.
    const [t] = await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        title: 'Pinned',
        teamId,
        state: 'backlog',
        statusId: statusId('task', 'backlog'),
        projectId,
        milestoneId,
      })
      .returning({ id: schema.task.id });
    const taskId = assertDefined(t).id;

    const deleted = await writer.request(`/${projectId}/milestones/${milestoneId}`, {
      method: 'DELETE',
    });
    expect(deleted.status).toBe(200);
    expect((await json<{ id: string }>(deleted)).id).toBe(milestoneId);

    // The task survives but its milestone_id was nulled by the FK's ON DELETE SET NULL.
    const after = await db.select().from(schema.task).where(eq(schema.task.id, taskId)).limit(1);
    expect(after[0]).toBeDefined();
    expect(after[0]?.milestoneId).toBeNull();
  });
});

describe('milestones detail: description field', () => {
  it('round-trips a description through create and read', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(milestones, orgId, ['contribute'], humanActorId);
    const projectId = await seedProject(statusId, orgId, teamId, humanActorId);

    const created = await writer.request(`/${projectId}/milestones`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Beta', description: 'Some notes' }),
    });
    expect(created.status).toBe(201);
    const body = await json<{ id: string; description: string | null }>(created);
    expect(body.description).toBe('Some notes');

    const fetched = await writer.request(`/${projectId}/milestones/${body.id}`, { method: 'GET' });
    expect((await json<{ description: string | null }>(fetched)).description).toBe('Some notes');
  });

  it('omitting description on create leaves it null', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(milestones, orgId, ['contribute'], humanActorId);
    const projectId = await seedProject(statusId, orgId, teamId, humanActorId);

    const created = await writer.request(`/${projectId}/milestones`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Beta' }),
    });
    expect((await json<{ description: string | null }>(created)).description).toBeNull();
  });

  it('an explicit null on patch clears the description', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(milestones, orgId, ['contribute'], humanActorId);
    const projectId = await seedProject(statusId, orgId, teamId, humanActorId);
    const milestoneId = await seedMilestone(orgId, projectId, humanActorId);

    await writer.request(`/${projectId}/milestones/${milestoneId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'Has notes' }),
    });
    const cleared = await writer.request(`/${projectId}/milestones/${milestoneId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: null }),
    });
    expect((await json<{ description: string | null }>(cleared)).description).toBeNull();
  });

  it('omitting description on patch leaves it unchanged', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(milestones, orgId, ['contribute'], humanActorId);
    const projectId = await seedProject(statusId, orgId, teamId, humanActorId);
    const milestoneId = await seedMilestone(orgId, projectId, humanActorId);

    await writer.request(`/${projectId}/milestones/${milestoneId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'Keep me' }),
    });
    const renamed = await writer.request(`/${projectId}/milestones/${milestoneId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });
    expect((await json<{ description: string | null }>(renamed)).description).toBe('Keep me');
  });
});

describe('milestones detail: invalid input', () => {
  it('422s on an empty name in the create body (rejected before any db work)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(milestones, orgId, ['contribute'], humanActorId);
    const res = await writer.request('/p/milestones', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(422);
  });

  it('422s on a non-integer sort in the create body', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(milestones, orgId, ['contribute'], humanActorId);
    const projectId = await seedProject(statusId, orgId, teamId, humanActorId);
    const res = await writer.request(`/${projectId}/milestones`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'M', sort: 'not-a-number' }),
    });
    expect(res.status).toBe(422);
  });
});

describe('milestones: an omitted sort appends', () => {
  it('places each new milestone after the project’s current last one', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(milestones, orgId, ['contribute'], humanActorId);
    const projectId = await seedProject(statusId, orgId, teamId, humanActorId);

    /** Create a milestone with no position and report the one the server gave it. */
    async function append(name: string): Promise<number> {
      const res = await writer.request(`/${projectId}/milestones`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      return (await json<{ sort: number }>(res)).sort;
    }

    expect(await append('First')).toBe(0);
    expect(await append('Second')).toBe(1);

    // Appending reads the highest position in use, not the count — the row at 5 moves the end of
    // the list even though only three milestones exist.
    await writer.request(`/${projectId}/milestones`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Explicit', sort: 5 }),
    });
    expect(await append('Last')).toBe(6);
  });

  it('starts at zero for a project with no milestones yet', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(milestones, orgId, ['contribute'], humanActorId);
    const projectId = await seedProject(statusId, orgId, teamId, humanActorId);
    const res = await writer.request(`/${projectId}/milestones`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Only' }),
    });
    expect((await json<{ sort: number }>(res)).sort).toBe(0);
  });
});

describe('milestones detail: progress and task links', () => {
  /** Seed a project with a milestone, one done and one open task on it, and one task off it. */
  async function seedProgress() {
    const base = await seedTaskAccessOrg(db, schema);
    const { orgId, teamId, humanActorId, statusId } = base;
    const projectId = await seedProject(statusId, orgId, teamId, humanActorId);
    const milestoneId = await seedMilestone(orgId, projectId, humanActorId);
    const insertTask = async (title: string, onMilestone: boolean, done: boolean) =>
      one(
        await db
          .insert(schema.task)
          .values({
            organizationId: orgId,
            title,
            teamId,
            state: done ? 'done' : 'backlog',
            statusId: statusId('task', done ? 'done' : 'backlog'),
            completedAt: done ? new Date() : null,
            projectId,
            milestoneId: onMilestone ? milestoneId : null,
          })
          .returning({ id: schema.task.id }),
      ).id;
    const doneTask = await insertTask('Shipped', true, true);
    const openTask = await insertTask('Open', true, false);
    await insertTask('Elsewhere', false, false);
    return { ...base, projectId, milestoneId, doneTask, openTask };
  }

  it('reports visible task progress on list, get, and update', async () => {
    const s = await seedProgress();
    const app = appWithActor(milestones, s.orgId, ['contribute'], s.humanActorId);
    const expected = { total: 2, completed: 1 };

    const listed = await json<{ items: { progress: unknown }[] }>(
      await app.request(`/${s.projectId}/milestones`, { method: 'GET' }),
    );
    expect(listed.items.map((m) => m.progress)).toEqual([expected]);
    const got = await json<{ progress: unknown }>(
      await app.request(`/${s.projectId}/milestones/${s.milestoneId}`, { method: 'GET' }),
    );
    expect(got.progress).toEqual(expected);
    const patched = await json<{ progress: unknown }>(
      await app.request(`/${s.projectId}/milestones/${s.milestoneId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed' }),
      }),
    );
    expect(patched.progress).toEqual(expected);
  });

  it("lists a milestone's tasks and clears the link when a task moves project", async () => {
    const s = await seedProgress();
    const app = appWithActor(tasks, s.orgId, ['contribute'], s.humanActorId);
    const onMilestone = await json<{ items: { id: string }[] }>(
      await app.request(`/?milestoneId=${s.milestoneId}`, { method: 'GET' }),
    );
    expect(onMilestone.items.map((t) => t.id).sort()).toEqual([s.doneTask, s.openTask].sort());

    const other = await seedProject(s.statusId, s.orgId, s.teamId, s.humanActorId);
    const moved = await app.request(`/${s.openTask}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: other }),
    });
    expect(moved.status).toBe(200);
    const [row] = await db
      .select({ milestoneId: schema.task.milestoneId })
      .from(schema.task)
      .where(eq(schema.task.id, s.openTask));
    expect(row?.milestoneId).toBeNull();

    // A move within the same project keeps the link.
    const kept = await app.request(`/${s.doneTask}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: s.projectId }),
    });
    expect(kept.status).toBe(200);
    const [keptRow] = await db
      .select({ milestoneId: schema.task.milestoneId })
      .from(schema.task)
      .where(eq(schema.task.id, s.doneTask));
    expect(keptRow?.milestoneId).toBe(s.milestoneId);
  });
});
