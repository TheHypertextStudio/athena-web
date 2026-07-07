import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, seedBaseOrg } from '../support/routes-harness';
import type milestonesRouter from '../../src/routes/milestones';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let milestones!: typeof milestonesRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  milestones = (await import('../../src/routes/milestones')).default;
});

/** Parse a JSON response body as the given shape. */
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Create a project row directly in the db and return its id. */
async function seedProject(orgId: string, teamId: string, createdBy: string): Promise<string> {
  const [proj] = await db
    .insert(schema.project)
    .values({ organizationId: orgId, name: 'Proj', teamId, createdBy })
    .returning({ id: schema.project.id });
  return proj!.id;
}

/** Create a milestone row directly in the db (bypassing the router) and return its id. */
async function seedMilestone(orgId: string, projectId: string, createdBy: string): Promise<string> {
  const [m] = await db
    .insert(schema.milestone)
    .values({ organizationId: orgId, projectId, name: 'M', createdBy })
    .returning({ id: schema.milestone.id });
  return m!.id;
}

describe('milestones detail: tenant isolation', () => {
  it("cannot get/patch/delete another org's milestone (404, existence-hidden)", async () => {
    const orgA = await seedBaseOrg(db, schema);
    const orgB = await seedBaseOrg(db, schema);
    const projA = await seedProject(orgA.orgId, orgA.teamId, orgA.humanActorId);
    const idInA = await seedMilestone(orgA.orgId, projA, orgA.humanActorId);

    // An actor scoped to org B must not see org A's milestone, even with manage-level caps.
    const writerB = appWithActor(milestones, orgB.orgId, ['contribute'], orgB.humanActorId);

    expect((await writerB.request(`/${idInA}`, { method: 'GET' })).status).toBe(404);
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
    const projA = await seedProject(orgA.orgId, orgA.teamId, orgA.humanActorId);
    await seedMilestone(orgA.orgId, projA, orgA.humanActorId);

    // Org B starts empty and stays empty regardless of org A's rows.
    const readerB = appWithActor(milestones, orgB.orgId, ['view'], orgB.humanActorId);
    const listed = await readerB.request('/', { method: 'GET' });
    expect(listed.status).toBe(200);
    expect((await json<{ items: unknown[] }>(listed)).items).toHaveLength(0);
  });
});

describe('milestones detail: list project filter is org-scoped', () => {
  it("filtering by a foreign org's projectId returns nothing for the caller's org", async () => {
    const orgA = await seedBaseOrg(db, schema);
    const orgB = await seedBaseOrg(db, schema);
    const projA = await seedProject(orgA.orgId, orgA.teamId, orgA.humanActorId);
    await seedMilestone(orgA.orgId, projA, orgA.humanActorId);

    // Even naming org A's projectId, org B's scope yields zero rows.
    const readerB = appWithActor(milestones, orgB.orgId, ['view'], orgB.humanActorId);
    const filtered = await readerB.request(`/?projectId=${projA}`, { method: 'GET' });
    expect(filtered.status).toBe(200);
    expect((await json<{ items: unknown[] }>(filtered)).items).toHaveLength(0);
  });
});

describe('milestones detail: delete nulls referencing tasks', () => {
  it("deleting a milestone sets referencing tasks' milestone_id to null (FK on delete)", async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(milestones, orgId, ['contribute'], humanActorId);
    const projectId = await seedProject(orgId, teamId, humanActorId);
    const milestoneId = await seedMilestone(orgId, projectId, humanActorId);

    // A task pinned to the milestone.
    const [t] = await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        title: 'Pinned',
        teamId,
        state: 'backlog',
        projectId,
        milestoneId,
      })
      .returning({ id: schema.task.id });
    const taskId = t!.id;

    const deleted = await writer.request(`/${milestoneId}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect((await json<{ id: string }>(deleted)).id).toBe(milestoneId);

    // The task survives but its milestone_id was nulled by the FK's ON DELETE SET NULL.
    const after = await db.select().from(schema.task).where(eq(schema.task.id, taskId)).limit(1);
    expect(after[0]).toBeDefined();
    expect(after[0]?.milestoneId).toBeNull();
  });
});

describe('milestones detail: invalid input', () => {
  it('422s on an empty name in the create body (rejected before any db work)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(milestones, orgId, ['contribute'], humanActorId);
    const res = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'p', name: '' }),
    });
    expect(res.status).toBe(422);
  });

  it('422s on a non-integer sort in the create body', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(milestones, orgId, ['contribute'], humanActorId);
    const projectId = await seedProject(orgId, teamId, humanActorId);
    const res = await writer.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, name: 'M', sort: 'not-a-number' }),
    });
    expect(res.status).toBe(422);
  });
});
