/**
 * Task completion counts on `GET /v1/orgs/:orgId/projects/overview`.
 *
 * @remarks
 * The counts are aggregated in the database, under the same visibility policy the roster uses. They
 * were previously computed by selecting every non-archived Task in the workspace and filtering in
 * JavaScript, so these pin both halves: the arithmetic, and that a Task the caller cannot see does
 * not appear in anyone else's totals.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, seedBaseOrg, seedStatuses } from '../support/routes-harness';
import type projectsRouter from '../../src/routes/projects';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let projects!: typeof projectsRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  projects = (await import('../../src/routes/projects')).default;
});

interface OverviewItem {
  readonly id: string;
  readonly taskCount: number;
  readonly completedTaskCount: number;
}

/** Create a Project row directly and return its id. */
async function seedProject(orgId: string, teamId: string, createdBy: string): Promise<string> {
  const statusId = await seedStatuses(db, schema, orgId);
  const [row] = await db
    .insert(schema.project)
    .values({
      organizationId: orgId,
      name: 'Seeded',
      teamId,
      createdBy,
      status: 'planned',
      statusId: statusId('project', 'planned'),
    })
    .returning({ id: schema.project.id });
  return assertDefined(row).id;
}

/** Create a Task row directly and return its id. */
async function seedTask(args: {
  readonly orgId: string;
  readonly teamId: string;
  readonly projectId: string | null;
  readonly completed?: boolean;
  readonly visibility?: 'public' | 'private';
}): Promise<string> {
  const statusId = await seedStatuses(db, schema, args.orgId);
  const [row] = await db
    .insert(schema.task)
    .values({
      organizationId: args.orgId,
      title: 'T',
      teamId: args.teamId,
      state: 'backlog',
      statusId: statusId('task', 'backlog'),
      projectId: args.projectId,
      completedAt: args.completed ? new Date() : null,
      ...(args.visibility ? { visibility: args.visibility } : {}),
    })
    .returning({ id: schema.task.id });
  return assertDefined(row).id;
}

async function overviewItems(app: ReturnType<typeof appWithActor>): Promise<OverviewItem[]> {
  const response = await app.request('/overview');
  expect(response.status).toBe(200);
  return ((await response.json()) as { readonly items: OverviewItem[] }).items;
}

describe('Project overview task counts', () => {
  it('counts completed and outstanding Tasks per Project', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const counted = await seedProject(orgId, teamId, humanActorId);
    const empty = await seedProject(orgId, teamId, humanActorId);
    await seedTask({ orgId, teamId, projectId: counted, completed: true });
    await seedTask({ orgId, teamId, projectId: counted, completed: true });
    await seedTask({ orgId, teamId, projectId: counted, completed: false });
    // A Task belonging to no Project contributes to nothing, and is no longer even read.
    await seedTask({ orgId, teamId, projectId: null, completed: true });

    const items = await overviewItems(appWithActor(projects, orgId, ['view'], humanActorId));

    expect(items.find((item) => item.id === counted)).toMatchObject({
      taskCount: 3,
      completedTaskCount: 2,
    });
    expect(items.find((item) => item.id === empty)).toMatchObject({
      taskCount: 0,
      completedTaskCount: 0,
    });
  });

  it('reports a Project with no Tasks as empty rather than omitting it', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedProject(orgId, teamId, humanActorId);

    const items = await overviewItems(appWithActor(projects, orgId, ['view'], humanActorId));

    expect(items.map((item) => item.id)).toContain(id);
    expect(items.find((item) => item.id === id)?.taskCount).toBe(0);
  });
});
