/**
 * `@docket/api` — Project dependency route tests.
 *
 * @remarks
 * Project dependency edges are directed, tenant-scoped, and acyclic. These tests cover the
 * navigable split returned from both endpoints and the rejection of a cycle-closing edge.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type projectsRouter from '../../src/routes/projects';
import { appWithActor, getDb, seedBaseOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let projects!: typeof projectsRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  projects = (await import('../../src/routes/projects')).default;
});

/** Create a Project directly so the test can concentrate on its dependency edges. */
async function createProject(
  organizationId: string,
  teamId: string,
  createdBy: string,
  name: string,
): Promise<string> {
  const [row] = await db
    .insert(schema.project)
    .values({ organizationId, teamId, createdBy, name })
    .returning({ id: schema.project.id });
  return row!.id;
}

/** Add `blocking → blocked` by calling the blocked Project's relative dependency route. */
async function addEdge(
  app: ReturnType<typeof appWithActor>,
  blockedProjectId: string,
  blockingProjectId: string,
): Promise<Response> {
  return await app.request(`/${blockedProjectId}/dependencies`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ blockingProjectId }),
  });
}

describe('project dependencies', () => {
  it('lists a directed edge from both Project perspectives', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(projects, orgId, ['contribute'], humanActorId);
    const blocker = await createProject(orgId, teamId, humanActorId, 'Platform work');
    const blocked = await createProject(orgId, teamId, humanActorId, 'Launch work');

    expect((await addEdge(app, blocked, blocker)).status).toBe(200);

    const blocking = (await (await app.request(`/${blocker}/dependencies`)).json()) as {
      blocking: { id: string; name: string }[];
      blockedBy: { id: string }[];
    };
    expect(blocking.blocking).toMatchObject([{ id: blocked, name: 'Launch work' }]);
    expect(blocking.blockedBy).toEqual([]);

    const blockedBy = (await (await app.request(`/${blocked}/dependencies`)).json()) as {
      blocking: { id: string }[];
      blockedBy: { id: string; name: string }[];
    };
    expect(blockedBy.blocking).toEqual([]);
    expect(blockedBy.blockedBy).toMatchObject([{ id: blocker, name: 'Platform work' }]);
  });

  it('rejects a cycle-closing Project dependency', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(projects, orgId, ['contribute'], humanActorId);
    const a = await createProject(orgId, teamId, humanActorId, 'A');
    const b = await createProject(orgId, teamId, humanActorId, 'B');
    const c = await createProject(orgId, teamId, humanActorId, 'C');

    expect((await addEdge(app, b, a)).status).toBe(200);
    expect((await addEdge(app, c, b)).status).toBe(200);
    expect((await addEdge(app, a, c)).status).toBe(409);
  });
});
