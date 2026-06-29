/**
 * `@docket/api` — project roll-up route tests: the detail screen's waterfall-collapsing read
 * (`GET /:id/rollup`) that returns each task's milestone + the project's initiative in one shot.
 *
 * @remarks
 * Mirrors `harness.test.ts` (pglite + injected actor context). Verifies the task→milestone map
 * (the per-task N+1 the screen used to do), the project→initiative inverse lookup (the
 * per-initiative M+1), org-scoping, and the missing-project 404.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, seedBaseOrg } from './harness.test';
import type projectRollupRouter from '../../src/routes/project-rollup';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let projectRollup!: typeof projectRollupRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  projectRollup = (await import('../../src/routes/project-rollup')).default;
});

/** Parse a JSON response body as the given shape. */
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

// A valid ULID-shaped id that no seeded row uses (passes branded-id validation, 404s on lookup).
const MISSING_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

/** Insert a project row directly; returns its id. */
async function makeProject(orgId: string, teamId: string, actorId: string): Promise<string> {
  const [row] = await db
    .insert(schema.project)
    .values({ organizationId: orgId, name: 'P', teamId, createdBy: actorId })
    .returning({ id: schema.project.id });
  return row!.id;
}

/** Insert a milestone under a project; returns its id. */
async function makeMilestone(orgId: string, projectId: string, actorId: string): Promise<string> {
  const [row] = await db
    .insert(schema.milestone)
    .values({ organizationId: orgId, projectId, name: 'M', createdBy: actorId })
    .returning({ id: schema.milestone.id });
  return row!.id;
}

/** Insert a task directly (control over project + milestone); returns its id. */
async function makeTask(
  orgId: string,
  teamId: string,
  actorId: string,
  opts: { projectId?: string | null; milestoneId?: string | null } = {},
): Promise<string> {
  const [row] = await db
    .insert(schema.task)
    .values({
      organizationId: orgId,
      title: 'T',
      teamId,
      state: 'todo',
      projectId: opts.projectId ?? null,
      milestoneId: opts.milestoneId ?? null,
      createdBy: actorId,
    })
    .returning({ id: schema.task.id });
  return row!.id;
}

/** Insert an initiative and link it to a project; returns the initiative id. */
async function makeLinkedInitiative(
  orgId: string,
  projectId: string,
  actorId: string,
): Promise<string> {
  const [init] = await db
    .insert(schema.initiative)
    .values({ organizationId: orgId, name: 'I', createdBy: actorId })
    .returning({ id: schema.initiative.id });
  await db
    .insert(schema.initiativeProject)
    .values({ initiativeId: init!.id, projectId, organizationId: orgId });
  return init!.id;
}

/** Seed an agent + a session on `taskId` + one activity on that session; returns the ids. */
async function seedSessionActivity(
  orgId: string,
  taskId: string,
  humanActorId: string,
): Promise<{ agentId: string; activityId: string }> {
  const [agentActor] = await db
    .insert(schema.actor)
    .values({ organizationId: orgId, kind: 'agent', displayName: 'Bot' })
    .returning({ id: schema.actor.id });
  const [ag] = await db
    .insert(schema.agent)
    .values({ organizationId: orgId, actorId: agentActor!.id, createdBy: humanActorId })
    .returning({ id: schema.agent.id });
  const [session] = await db
    .insert(schema.agentSession)
    .values({
      organizationId: orgId,
      agentId: ag!.id,
      taskId,
      trigger: 'assignment',
      status: 'running',
      initiatorId: humanActorId,
    })
    .returning({ id: schema.agentSession.id });
  const [activity] = await db
    .insert(schema.sessionActivity)
    .values({
      sessionId: session!.id,
      organizationId: orgId,
      type: 'response',
      body: { text: 'hi' },
    })
    .returning({ id: schema.sessionActivity.id });
  return { agentId: ag!.id, activityId: activity!.id };
}

interface RollupBody {
  taskMilestones: { taskId: string; milestoneId: string | null }[];
  currentInitiativeId: string | null;
  recentActivity: { id: string; agentId: string; type: string; createdAt: string }[];
}

describe('project roll-up (GET /:id/rollup)', () => {
  it('maps each project task to its milestone and resolves the project’s initiative', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const projectId = await makeProject(orgId, teamId, humanActorId);
    const milestoneId = await makeMilestone(orgId, projectId, humanActorId);

    const t1 = await makeTask(orgId, teamId, humanActorId, { projectId, milestoneId });
    const t2 = await makeTask(orgId, teamId, humanActorId, { projectId, milestoneId });
    const tUngrouped = await makeTask(orgId, teamId, humanActorId, {
      projectId,
      milestoneId: null,
    });
    // A task on another project must NOT appear in this project's roll-up.
    const otherProject = await makeProject(orgId, teamId, humanActorId);
    await makeTask(orgId, teamId, humanActorId, { projectId: otherProject });

    const initiativeId = await makeLinkedInitiative(orgId, projectId, humanActorId);

    const reader = appWithActor(projectRollup, orgId, ['view'], humanActorId);
    const res = await reader.request(`/${projectId}/rollup`);
    expect(res.status).toBe(200);
    const body = await json<RollupBody>(res);

    expect(body.currentInitiativeId).toBe(initiativeId);
    expect(body.taskMilestones).toHaveLength(3);
    const byTask = new Map(body.taskMilestones.map((tm) => [tm.taskId, tm.milestoneId]));
    expect(byTask.get(t1)).toBe(milestoneId);
    expect(byTask.get(t2)).toBe(milestoneId);
    expect(byTask.get(tUngrouped)).toBeNull();
  });

  it('returns recent activity on the project’s sessions, scoped to this project', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const projectId = await makeProject(orgId, teamId, humanActorId);
    const taskId = await makeTask(orgId, teamId, humanActorId, { projectId });
    const { agentId, activityId } = await seedSessionActivity(orgId, taskId, humanActorId);

    // Activity on a session for ANOTHER project's task must not appear in this project's roll-up.
    const otherProject = await makeProject(orgId, teamId, humanActorId);
    const otherTask = await makeTask(orgId, teamId, humanActorId, { projectId: otherProject });
    await seedSessionActivity(orgId, otherTask, humanActorId);

    const reader = appWithActor(projectRollup, orgId, ['view'], humanActorId);
    const body = await json<RollupBody>(await reader.request(`/${projectId}/rollup`));
    expect(body.recentActivity).toHaveLength(1);
    expect(body.recentActivity[0]!.id).toBe(activityId);
    expect(body.recentActivity[0]!.agentId).toBe(agentId);
  });

  it('returns a null initiative when the project belongs to none', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const projectId = await makeProject(orgId, teamId, humanActorId);
    await makeTask(orgId, teamId, humanActorId, { projectId });

    const reader = appWithActor(projectRollup, orgId, ['view'], humanActorId);
    const body = await json<RollupBody>(await reader.request(`/${projectId}/rollup`));
    expect(body.currentInitiativeId).toBeNull();
    expect(body.taskMilestones).toHaveLength(1);
    expect(body.taskMilestones[0]!.milestoneId).toBeNull();
  });

  it('404s on a missing project', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const reader = appWithActor(projectRollup, orgId, ['view'], humanActorId);
    expect((await reader.request(`/${MISSING_ULID}/rollup`)).status).toBe(404);
  });

  it('isolates tenants: another org’s project 404s', async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    const projectA = await makeProject(a.orgId, a.teamId, a.humanActorId);
    const readerB = appWithActor(projectRollup, b.orgId, ['view'], b.humanActorId);
    expect((await readerB.request(`/${projectA}/rollup`)).status).toBe(404);
  });
});
