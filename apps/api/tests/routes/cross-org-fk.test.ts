/**
 * `@docket/api` — cross-org FK hardening tests for project + task PATCH and subtask create.
 *
 * @remarks
 * The work-layer FKs reference each table's *global* primary key with no `organization_id`
 * constraint, so the database alone would accept a PATCH that re-points a project/task at a
 * lead/program/team/assignee/delegate/project/milestone/cycle owned by *another* tenant.
 * The route layer must reject these (404, existence-hiding) before writing. These tests
 * seed two orgs and prove a reference into the *other* org is rejected, while an in-org
 * reference and a `null`/omitted reference are accepted. Mirrors `routes-harness`.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, seedBaseOrg } from '../support/routes-harness';
import type projectsRouter from '../../src/routes/projects';
import type tasksRouter from '../../src/routes/tasks';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let projects!: typeof projectsRouter;
let tasks!: typeof tasksRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  projects = (await import('../../src/routes/projects')).default;
  tasks = (await import('../../src/routes/tasks')).default;
});

/** Parse a JSON response body as the given shape. */
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** JSON request headers shared by every PATCH/POST below. */
const JSON_HEADERS = { 'content-type': 'application/json' } as const;

/** Insert a program in `orgId`, returning its id. */
async function seedProgram(orgId: string, createdBy: string): Promise<string> {
  const [row] = await db
    .insert(schema.program)
    .values({ organizationId: orgId, name: 'Prog', createdBy })
    .returning({ id: schema.program.id });
  return row!.id;
}

/** Insert a project in `orgId`, returning its id. */
async function seedProject(orgId: string, teamId: string, createdBy: string): Promise<string> {
  const [row] = await db
    .insert(schema.project)
    .values({ organizationId: orgId, name: 'Proj', teamId, createdBy })
    .returning({ id: schema.project.id });
  return row!.id;
}

/** Insert a milestone under a project in `orgId`, returning its id. */
async function seedMilestone(orgId: string, projectId: string, createdBy: string): Promise<string> {
  const [row] = await db
    .insert(schema.milestone)
    .values({ organizationId: orgId, projectId, name: 'MS', createdBy })
    .returning({ id: schema.milestone.id });
  return row!.id;
}

/** Insert a cycle for a team in `orgId`, returning its id. */
async function seedCycle(
  orgId: string,
  teamId: string,
  createdBy: string,
  number = 1,
): Promise<string> {
  const [row] = await db
    .insert(schema.cycle)
    .values({
      organizationId: orgId,
      teamId,
      number,
      startsAt: new Date('2026-01-01'),
      endsAt: new Date('2026-01-14'),
      createdBy,
    })
    .returning({ id: schema.cycle.id });
  return row!.id;
}

/** Create a task via the router and return its id. */
async function createTask(
  app: ReturnType<typeof appWithActor>,
  teamId: string,
  body: Record<string, unknown> = {},
): Promise<string> {
  const res = await app.request('/', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ title: 'T', teamId, ...body }),
  });
  expect(res.status).toBe(200);
  return (await json<{ id: string }>(res)).id;
}

describe('project create cross-org FK hardening', () => {
  it("rejects a create whose leadId/teamId points at another org's rows (404)", async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    const writer = appWithActor(projects, a.orgId, ['contribute'], a.humanActorId);

    for (const body of [{ leadId: b.humanActorId }, { teamId: b.teamId }]) {
      const res = await writer.request('/', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: 'P', ...body }),
      });
      expect(res.status).toBe(404);
      expect((await json<{ code: string }>(res)).code).toBe('not_found');
    }

    // No project was persisted by any rejected create.
    const rows = await db
      .select({ id: schema.project.id })
      .from(schema.project)
      .where(eq(schema.project.organizationId, a.orgId));
    expect(rows).toHaveLength(0);
  });

  it('accepts a create with in-org leadId/teamId references', async () => {
    const a = await seedBaseOrg(db, schema);
    const writer = appWithActor(projects, a.orgId, ['contribute'], a.humanActorId);

    const res = await writer.request('/', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: 'P', leadId: a.humanActorId, teamId: a.teamId }),
    });
    expect(res.status).toBe(200);
    const body = await json<{ leadId: string | null; teamId: string | null }>(res);
    expect(body.leadId).toBe(a.humanActorId);
    expect(body.teamId).toBe(a.teamId);
  });
});

describe('project PATCH cross-org FK hardening', () => {
  it("rejects re-pointing leadId/programId/teamId at another org's rows (404)", async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    const writer = appWithActor(projects, a.orgId, ['contribute'], a.humanActorId);
    const projectId = await seedProject(a.orgId, a.teamId, a.humanActorId);

    // org B's lead (actor), program, and team — all foreign to org A.
    const bProgram = await seedProgram(b.orgId, b.humanActorId);

    for (const body of [
      { leadId: b.humanActorId },
      { programId: bProgram },
      { teamId: b.teamId },
    ]) {
      const res = await writer.request(`/${projectId}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(404);
      expect((await json<{ code: string }>(res)).code).toBe('not_found');
    }

    // The project was never mutated: its team is still org A's original team.
    const [row] = await db
      .select({ teamId: schema.project.teamId, leadId: schema.project.leadId })
      .from(schema.project)
      .where(eq(schema.project.id, projectId));
    expect(row!.teamId).toBe(a.teamId);
    expect(row!.leadId).toBeNull();
  });

  it('accepts in-org leadId/programId/teamId references', async () => {
    const a = await seedBaseOrg(db, schema);
    const writer = appWithActor(projects, a.orgId, ['contribute'], a.humanActorId);
    const projectId = await seedProject(a.orgId, a.teamId, a.humanActorId);
    const program = await seedProgram(a.orgId, a.humanActorId);
    const [team2] = await db
      .insert(schema.team)
      .values({ organizationId: a.orgId, name: 'Other', key: 'OTH' })
      .returning({ id: schema.team.id });

    const res = await writer.request(`/${projectId}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ leadId: a.humanActorId, programId: program, teamId: team2!.id }),
    });
    expect(res.status).toBe(200);
    const body = await json<{
      leadId: string | null;
      programId: string | null;
      teamId: string | null;
    }>(res);
    expect(body.leadId).toBe(a.humanActorId);
    expect(body.programId).toBe(program);
    expect(body.teamId).toBe(team2!.id);
  });

  it('allows clearing references to null (no cross-org check on clear)', async () => {
    const a = await seedBaseOrg(db, schema);
    const writer = appWithActor(projects, a.orgId, ['contribute'], a.humanActorId);
    const program = await seedProgram(a.orgId, a.humanActorId);
    const projectId = await seedProject(a.orgId, a.teamId, a.humanActorId);
    // First attach in-org references, then clear them.
    await writer.request(`/${projectId}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ leadId: a.humanActorId, programId: program }),
    });

    const res = await writer.request(`/${projectId}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ leadId: null, programId: null, teamId: null }),
    });
    expect(res.status).toBe(200);
    const body = await json<{ leadId: string | null; programId: string | null }>(res);
    expect(body.leadId).toBeNull();
    expect(body.programId).toBeNull();
  });
});

describe('task create cross-org FK hardening', () => {
  it("rejects a create whose references point at another org's rows (404)", async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, a.orgId, ['contribute', 'assign'], a.humanActorId);

    // org B references — all foreign to org A.
    const bProject = await seedProject(b.orgId, b.teamId, b.humanActorId);
    const bMilestone = await seedMilestone(b.orgId, bProject, b.humanActorId);
    const bCycle = await seedCycle(b.orgId, b.teamId, b.humanActorId);
    const bParent = await createTask(
      appWithActor(tasks, b.orgId, ['contribute'], b.humanActorId),
      b.teamId,
    );

    for (const body of [
      { assigneeId: b.humanActorId },
      { projectId: bProject },
      { cycleId: bCycle },
      { milestoneId: bMilestone },
      { parentTaskId: bParent },
    ]) {
      const res = await writer.request('/', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ title: 'T', teamId: a.teamId, ...body }),
      });
      expect(res.status).toBe(404);
      expect((await json<{ code: string }>(res)).code).toBe('not_found');
    }

    // No task was persisted in org A by any rejected create.
    const rows = await db
      .select({ id: schema.task.id })
      .from(schema.task)
      .where(eq(schema.task.organizationId, a.orgId));
    expect(rows).toHaveLength(0);
  });

  it("rejects a create whose milestone's project is in another org (404)", async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, a.orgId, ['contribute'], a.humanActorId);
    const bProject = await seedProject(b.orgId, b.teamId, b.humanActorId);
    const bMilestone = await seedMilestone(b.orgId, bProject, b.humanActorId);

    const res = await writer.request('/', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ title: 'T', teamId: a.teamId, milestoneId: bMilestone }),
    });
    expect(res.status).toBe(404);
    expect((await json<{ code: string }>(res)).code).toBe('not_found');
  });

  it('accepts a create with in-org references', async () => {
    const a = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, a.orgId, ['contribute', 'assign'], a.humanActorId);
    const project = await seedProject(a.orgId, a.teamId, a.humanActorId);
    const milestone = await seedMilestone(a.orgId, project, a.humanActorId);
    const cycle = await seedCycle(a.orgId, a.teamId, a.humanActorId);
    const parent = await createTask(writer, a.teamId);

    const res = await writer.request('/', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        title: 'T',
        teamId: a.teamId,
        assigneeId: a.humanActorId,
        projectId: project,
        milestoneId: milestone,
        cycleId: cycle,
        parentTaskId: parent,
      }),
    });
    expect(res.status).toBe(200);
    const sub = await json<{ id: string; assigneeId: string | null; projectId: string | null }>(
      res,
    );
    expect(sub.assigneeId).toBe(a.humanActorId);
    expect(sub.projectId).toBe(project);

    const [row] = await db
      .select({
        milestoneId: schema.task.milestoneId,
        cycleId: schema.task.cycleId,
        parentTaskId: schema.task.parentTaskId,
      })
      .from(schema.task)
      .where(eq(schema.task.id, sub.id));
    expect(row!.milestoneId).toBe(milestone);
    expect(row!.cycleId).toBe(cycle);
    expect(row!.parentTaskId).toBe(parent);
  });
});

describe('task PATCH cross-org FK hardening', () => {
  it("rejects re-pointing each reference at another org's rows (404)", async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    // `assign` so the assignee/delegate branch is reachable (not blocked at 403).
    const writer = appWithActor(tasks, a.orgId, ['contribute', 'assign'], a.humanActorId);
    const taskId = await createTask(writer, a.teamId);

    // org B references — all foreign to org A.
    const bProgram = await seedProgram(b.orgId, b.humanActorId);
    const bProject = await seedProject(b.orgId, b.teamId, b.humanActorId);
    const bMilestone = await seedMilestone(b.orgId, bProject, b.humanActorId);
    const bCycle = await seedCycle(b.orgId, b.teamId, b.humanActorId);

    for (const body of [
      { assigneeId: b.humanActorId },
      { delegateId: b.humanActorId },
      { projectId: bProject },
      { programId: bProgram },
      { cycleId: bCycle },
      { milestoneId: bMilestone },
    ]) {
      const res = await writer.request(`/${taskId}`, {
        method: 'PATCH',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(404);
      expect((await json<{ code: string }>(res)).code).toBe('not_found');
    }

    // The task was never mutated by any rejected PATCH.
    const [row] = await db
      .select({
        assigneeId: schema.task.assigneeId,
        projectId: schema.task.projectId,
        milestoneId: schema.task.milestoneId,
        cycleId: schema.task.cycleId,
      })
      .from(schema.task)
      .where(eq(schema.task.id, taskId));
    expect(row!.assigneeId).toBeNull();
    expect(row!.projectId).toBeNull();
    expect(row!.milestoneId).toBeNull();
    expect(row!.cycleId).toBeNull();
  });

  it('rejects a milestone whose project is in another org (404)', async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, a.orgId, ['contribute'], a.humanActorId);
    const taskId = await createTask(writer, a.teamId);
    // Milestone has no organization_id; its tenant is its project's. Project is in B.
    const bProject = await seedProject(b.orgId, b.teamId, b.humanActorId);
    const bMilestone = await seedMilestone(b.orgId, bProject, b.humanActorId);

    const res = await writer.request(`/${taskId}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ milestoneId: bMilestone }),
    });
    expect(res.status).toBe(404);
    expect((await json<{ code: string }>(res)).code).toBe('not_found');
  });

  it('accepts in-org references on a task PATCH', async () => {
    const a = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, a.orgId, ['contribute', 'assign'], a.humanActorId);
    const taskId = await createTask(writer, a.teamId);
    const program = await seedProgram(a.orgId, a.humanActorId);
    const project = await seedProject(a.orgId, a.teamId, a.humanActorId);
    const milestone = await seedMilestone(a.orgId, project, a.humanActorId);
    const cycle = await seedCycle(a.orgId, a.teamId, a.humanActorId);

    const res = await writer.request(`/${taskId}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        assigneeId: a.humanActorId,
        delegateId: a.humanActorId,
        projectId: project,
        programId: program,
        cycleId: cycle,
        milestoneId: milestone,
      }),
    });
    expect(res.status).toBe(200);
    const body = await json<{ assigneeId: string | null; projectId: string | null }>(res);
    expect(body.assigneeId).toBe(a.humanActorId);
    expect(body.projectId).toBe(project);

    // milestoneId/cycleId aren't surfaced by TaskOut; verify them on the stored row.
    const [row] = await db
      .select({ milestoneId: schema.task.milestoneId, cycleId: schema.task.cycleId })
      .from(schema.task)
      .where(eq(schema.task.id, taskId));
    expect(row!.milestoneId).toBe(milestone);
    expect(row!.cycleId).toBe(cycle);
  });

  it('allows clearing references to null without a cross-org check', async () => {
    const a = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, a.orgId, ['contribute', 'assign'], a.humanActorId);
    const project = await seedProject(a.orgId, a.teamId, a.humanActorId);
    const taskId = await createTask(writer, a.teamId, {
      projectId: project,
      assigneeId: a.humanActorId,
    });

    const res = await writer.request(`/${taskId}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ assigneeId: null, projectId: null, milestoneId: null, cycleId: null }),
    });
    expect(res.status).toBe(200);
    const body = await json<{ assigneeId: string | null; projectId: string | null }>(res);
    expect(body.assigneeId).toBeNull();
    expect(body.projectId).toBeNull();
  });
});

describe('subtask create cross-org FK hardening', () => {
  it("rejects body references pointing at another org's rows (404)", async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, a.orgId, ['contribute', 'assign'], a.humanActorId);
    const parentId = await createTask(writer, a.teamId);

    const bProject = await seedProject(b.orgId, b.teamId, b.humanActorId);
    const bMilestone = await seedMilestone(b.orgId, bProject, b.humanActorId);
    const bCycle = await seedCycle(b.orgId, b.teamId, b.humanActorId);

    for (const body of [
      { assigneeId: b.humanActorId },
      { projectId: bProject },
      { cycleId: bCycle },
      { milestoneId: bMilestone },
    ]) {
      const res = await writer.request(`/${parentId}/subtasks`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ title: 'Sub', ...body }),
      });
      expect(res.status).toBe(404);
      expect((await json<{ code: string }>(res)).code).toBe('not_found');
    }

    // No subtask was created by any rejected request.
    const subtasks = await db
      .select({ id: schema.task.id })
      .from(schema.task)
      .where(eq(schema.task.parentTaskId, parentId));
    expect(subtasks).toHaveLength(0);
  });

  it('accepts in-org body references on a subtask create', async () => {
    const a = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, a.orgId, ['contribute', 'assign'], a.humanActorId);
    const parentId = await createTask(writer, a.teamId);
    const project = await seedProject(a.orgId, a.teamId, a.humanActorId);
    const milestone = await seedMilestone(a.orgId, project, a.humanActorId);
    const cycle = await seedCycle(a.orgId, a.teamId, a.humanActorId);

    const res = await writer.request(`/${parentId}/subtasks`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        title: 'Sub',
        assigneeId: a.humanActorId,
        projectId: project,
        milestoneId: milestone,
        cycleId: cycle,
      }),
    });
    expect(res.status).toBe(200);
    const sub = await json<{ id: string; projectId: string | null; assigneeId: string | null }>(
      res,
    );
    expect(sub.projectId).toBe(project);
    expect(sub.assigneeId).toBe(a.humanActorId);

    const [row] = await db
      .select({ milestoneId: schema.task.milestoneId, cycleId: schema.task.cycleId })
      .from(schema.task)
      .where(eq(schema.task.id, sub.id));
    expect(row!.milestoneId).toBe(milestone);
    expect(row!.cycleId).toBe(cycle);
  });
});
