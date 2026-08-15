/**
 * `@docket/api` — task visibility across project, program, and cycle delivery roll-ups.
 *
 * @remarks
 * Container membership is not a task visibility grant. These regressions use persisted task
 * grants rather than the route harness's injected organization capabilities, so each roll-up is
 * checked against the same task cascade as the primary tasks router.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import {
  appWithActor,
  getDb,
  one,
  seedBaseOrg,
  type StatusIdLookup,
} from '../support/routes-harness';
import type cyclesRouter from '../../src/routes/cycles';
import type projectRollupRouter from '../../src/routes/project-rollup';
import type projectsRouter from '../../src/routes/projects';
import type programsRouter from '../../src/routes/programs';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let cycles!: typeof cyclesRouter;
let projectRollup!: typeof projectRollupRouter;
let projects!: typeof projectsRouter;
let programs!: typeof programsRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  cycles = (await import('../../src/routes/cycles')).default;
  projectRollup = (await import('../../src/routes/project-rollup')).default;
  projects = (await import('../../src/routes/projects')).default;
  programs = (await import('../../src/routes/programs')).default;
});

/** Create an active private task in a selected roll-up context. */
async function seedPrivateTask(
  statusId: StatusIdLookup,
  orgId: string,
  teamId: string,
  options: {
    readonly programId?: string;
    readonly projectId?: string;
    readonly cycleId?: string;
    readonly milestoneId?: string;
    readonly estimate?: number;
    readonly createdAt?: Date;
  },
): Promise<string> {
  return one(
    await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        programId: options.programId,
        projectId: options.projectId,
        cycleId: options.cycleId,
        milestoneId: options.milestoneId,
        estimate: options.estimate,
        ...(options.createdAt ? { createdAt: options.createdAt } : {}),
        title: 'Private roll-up work',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        visibility: 'private',
      })
      .returning({ id: schema.task.id }),
  ).id;
}

/** Create a cycle with a deterministic window for task roll-up assertions. */
async function seedCycle(orgId: string, teamId: string, actorId: string): Promise<string> {
  return one(
    await db
      .insert(schema.cycle)
      .values({
        organizationId: orgId,
        teamId,
        number: 1,
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        endsAt: new Date('2026-01-14T00:00:00.000Z'),
        createdBy: actorId,
      })
      .returning({ id: schema.cycle.id }),
  ).id;
}

/** Create a project for the project delivery roll-up regressions. */
async function seedProject(
  statusId: StatusIdLookup,
  orgId: string,
  teamId: string,
  actorId: string,
): Promise<string> {
  return one(
    await db
      .insert(schema.project)
      .values({
        organizationId: orgId,
        teamId,
        name: 'Private project',
        statusId: statusId('project', 'planned'),
        createdBy: actorId,
      })
      .returning({ id: schema.project.id }),
  ).id;
}

/** Create a project-scoped milestone to make the task metadata projection observable. */
async function seedMilestone(orgId: string, projectId: string, actorId: string): Promise<string> {
  return one(
    await db
      .insert(schema.milestone)
      .values({ organizationId: orgId, projectId, name: 'Private milestone', createdBy: actorId })
      .returning({ id: schema.milestone.id }),
  ).id;
}

/** Seed an agent session and activity on one task for the project-rollup privacy regression. */
async function seedTaskSessionActivity(
  orgId: string,
  taskId: string,
  humanActorId: string,
): Promise<string> {
  const agentActorId = one(
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'agent', displayName: 'Private task agent' })
      .returning({ id: schema.actor.id }),
  ).id;
  const agentId = one(
    await db
      .insert(schema.agent)
      .values({ organizationId: orgId, actorId: agentActorId, createdBy: humanActorId })
      .returning({ id: schema.agent.id }),
  ).id;
  const sessionId = one(
    await db
      .insert(schema.agentSession)
      .values({
        organizationId: orgId,
        agentId,
        taskId,
        trigger: 'assignment',
        status: 'running',
        initiatorId: humanActorId,
      })
      .returning({ id: schema.agentSession.id }),
  ).id;
  return one(
    await db
      .insert(schema.sessionActivity)
      .values({
        organizationId: orgId,
        sessionId,
        type: 'response',
        body: { text: 'Private task activity' },
      })
      .returning({ id: schema.sessionActivity.id }),
  ).id;
}

/** Grant one actor the exact task capability that also satisfies read access. */
async function grantTaskContribute(orgId: string, actorId: string, taskId: string): Promise<void> {
  await db.insert(schema.grant).values({
    organizationId: orgId,
    subjectKind: 'actor',
    subjectId: actorId,
    resourceKind: 'task',
    resourceId: taskId,
    capabilities: ['contribute'],
    effect: 'allow',
    cascades: false,
  });
}

/** Flatten a program work board down to its delivered task ids. */
function programWorkTaskIds(body: {
  readonly groups: readonly {
    readonly segments: readonly { readonly tasks: readonly { readonly id: string }[] }[];
  }[];
}): string[] {
  return body.groups.flatMap((group) =>
    group.segments.flatMap((segment) => segment.tasks.map((task) => task.id)),
  );
}

describe('task roll-up resource access', () => {
  it('filters private program work until the caller receives a direct task grant', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const programId = one(
      await db
        .insert(schema.program)
        .values({
          organizationId: orgId,
          name: 'Private delivery',
          statusId: statusId('program', 'active'),
          createdBy: humanActorId,
        })
        .returning({ id: schema.program.id }),
    ).id;
    const taskId = await seedPrivateTask(statusId, orgId, teamId, { programId });
    const caller = appWithActor(programs, orgId, [], humanActorId);

    const hidden = await caller.request(`/${programId}/work`);
    expect(hidden.status).toBe(200);
    expect(
      programWorkTaskIds((await hidden.json()) as Parameters<typeof programWorkTaskIds>[0]),
    ).toEqual([]);

    await grantTaskContribute(orgId, humanActorId, taskId);
    const granted = await caller.request(`/${programId}/work`);
    expect(granted.status).toBe(200);
    expect(
      programWorkTaskIds((await granted.json()) as Parameters<typeof programWorkTaskIds>[0]),
    ).toEqual([taskId]);
  });

  it('excludes private tasks from a program roll-up count until directly granted', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const programId = one(
      await db
        .insert(schema.program)
        .values({
          organizationId: orgId,
          name: 'Private count',
          statusId: statusId('program', 'active'),
          createdBy: humanActorId,
        })
        .returning({ id: schema.program.id }),
    ).id;
    const taskId = await seedPrivateTask(statusId, orgId, teamId, { programId });
    const caller = appWithActor(programs, orgId, [], humanActorId);

    const hidden = await caller.request(`/${programId}`);
    expect(hidden.status).toBe(200);
    expect(
      ((await hidden.json()) as { readonly rollup: { readonly tasks: number } }).rollup.tasks,
    ).toBe(0);

    await grantTaskContribute(orgId, humanActorId, taskId);
    const granted = await caller.request(`/${programId}`);
    expect(
      ((await granted.json()) as { readonly rollup: { readonly tasks: number } }).rollup.tasks,
    ).toBe(1);
  });

  it('filters private task metadata and pace data from cycle roll-ups until directly granted', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const cycleId = await seedCycle(orgId, teamId, humanActorId);
    const taskId = await seedPrivateTask(statusId, orgId, teamId, {
      cycleId,
      estimate: 5,
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    const caller = appWithActor(cycles, orgId, [], humanActorId);

    const hiddenTasks = await caller.request(`/${cycleId}/tasks`);
    expect(hiddenTasks.status).toBe(200);
    expect(((await hiddenTasks.json()) as { readonly groups: readonly unknown[] }).groups).toEqual(
      [],
    );

    const hiddenDetail = await caller.request(`/${cycleId}`);
    expect(
      (
        (await hiddenDetail.json()) as {
          readonly stats: { readonly committed: number; readonly capacity: number };
        }
      ).stats,
    ).toMatchObject({ committed: 0, capacity: 0 });

    const hiddenList = await caller.request('/');
    const hiddenCycle = (
      (await hiddenList.json()) as {
        readonly items: readonly {
          readonly id: string;
          readonly stats: { readonly committed: number; readonly capacity: number };
        }[];
      }
    ).items.find((item) => item.id === cycleId);
    expect(hiddenCycle?.stats).toMatchObject({ committed: 0, capacity: 0 });

    const hiddenBurnup = await caller.request(`/${cycleId}/burnup`);
    expect(
      (
        (await hiddenBurnup.json()) as {
          readonly capacity: number;
          readonly scopeChanges: readonly { readonly taskId: string }[];
        }
      ).scopeChanges,
    ).toEqual([]);

    await grantTaskContribute(orgId, humanActorId, taskId);

    const grantedTasks = await caller.request(`/${cycleId}/tasks`);
    expect(
      (
        (await grantedTasks.json()) as {
          readonly groups: readonly { readonly tasks: readonly { readonly id: string }[] }[];
        }
      ).groups.flatMap((group) => group.tasks.map((task) => task.id)),
    ).toEqual([taskId]);
    const grantedList = await caller.request('/');
    const grantedCycle = (
      (await grantedList.json()) as {
        readonly items: readonly {
          readonly id: string;
          readonly stats: { readonly committed: number; readonly capacity: number };
        }[];
      }
    ).items.find((item) => item.id === cycleId);
    expect(grantedCycle?.stats).toMatchObject({ committed: 1, capacity: 5 });
    const grantedDetail = await caller.request(`/${cycleId}`);
    expect(
      (
        (await grantedDetail.json()) as {
          readonly stats: { readonly committed: number; readonly capacity: number };
        }
      ).stats,
    ).toMatchObject({ committed: 1, capacity: 5 });
    const grantedBurnup = await caller.request(`/${cycleId}/burnup`);
    expect(
      (
        (await grantedBurnup.json()) as {
          readonly capacity: number;
          readonly scopeChanges: readonly { readonly taskId: string }[];
        }
      ).scopeChanges.map((change) => change.taskId),
    ).toEqual([taskId]);
  });

  it('filters private task metadata and counts from project roll-ups until directly granted', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const projectId = await seedProject(statusId, orgId, teamId, humanActorId);
    const milestoneId = await seedMilestone(orgId, projectId, humanActorId);
    const taskId = await seedPrivateTask(statusId, orgId, teamId, { projectId, milestoneId });
    const projectsCaller = appWithActor(projects, orgId, [], humanActorId);
    const rollupCaller = appWithActor(projectRollup, orgId, [], humanActorId);

    const hiddenProgress = await projectsCaller.request(`/${projectId}/progress`);
    expect(((await hiddenProgress.json()) as { readonly taskCount: number }).taskCount).toBe(0);

    const hiddenOverview = await projectsCaller.request('/overview');
    const hiddenProject = (
      (await hiddenOverview.json()) as {
        readonly items: readonly { readonly id: string; readonly taskCount: number }[];
      }
    ).items.find((item) => item.id === projectId);
    expect(hiddenProject?.taskCount).toBe(0);

    const hiddenRollup = await rollupCaller.request(`/${projectId}/rollup`);
    expect(
      (
        (await hiddenRollup.json()) as {
          readonly taskMilestones: readonly {
            readonly taskId: string;
            readonly milestoneId: string | null;
          }[];
        }
      ).taskMilestones,
    ).toEqual([]);

    await grantTaskContribute(orgId, humanActorId, taskId);

    const grantedOverview = await projectsCaller.request('/overview');
    const grantedProject = (
      (await grantedOverview.json()) as {
        readonly items: readonly { readonly id: string; readonly taskCount: number }[];
      }
    ).items.find((item) => item.id === projectId);
    expect(grantedProject?.taskCount).toBe(1);
    const grantedProgress = await projectsCaller.request(`/${projectId}/progress`);
    expect(((await grantedProgress.json()) as { readonly taskCount: number }).taskCount).toBe(1);
    const grantedRollup = await rollupCaller.request(`/${projectId}/rollup`);
    expect(
      (
        (await grantedRollup.json()) as {
          readonly taskMilestones: readonly {
            readonly taskId: string;
            readonly milestoneId: string | null;
          }[];
        }
      ).taskMilestones,
    ).toEqual([{ taskId, milestoneId }]);
  });

  it('filters activity rooted in a private project task until directly granted', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const projectId = await seedProject(statusId, orgId, teamId, humanActorId);
    const taskId = await seedPrivateTask(statusId, orgId, teamId, { projectId });
    const activityId = await seedTaskSessionActivity(orgId, taskId, humanActorId);
    const caller = appWithActor(projectRollup, orgId, [], humanActorId);

    const hidden = await caller.request(`/${projectId}/rollup`);
    expect(
      ((await hidden.json()) as { readonly recentActivity: readonly { readonly id: string }[] })
        .recentActivity,
    ).toEqual([]);

    await grantTaskContribute(orgId, humanActorId, taskId);
    const granted = await caller.request(`/${projectId}/rollup`);
    expect(
      (
        (await granted.json()) as { readonly recentActivity: readonly { readonly id: string }[] }
      ).recentActivity.map((activity) => activity.id),
    ).toEqual([activityId]);
  });
});
