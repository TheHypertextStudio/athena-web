/**
 * `@docket/api` — task dependency-graph route tests.
 *
 * @remarks
 * Covers the org-wide cross-project directed-acyclic `blocks` graph: edge creation
 * from either endpoint, the GET split into blocking/blockedBy, the acyclic
 * reachability check (409 CycleError), self-edge + duplicate rejection, deletion from
 * either endpoint, tenant isolation, and capability gating. Mirrors `harness.test.ts`.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, seedBaseOrg } from './harness.test';
import type tasksRouter from './tasks';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let tasks!: typeof tasksRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  tasks = (await import('./tasks')).default;
});

/** Parse a JSON response body as the given shape. */
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

// A valid ULID-shaped id that no seeded row uses.
const MISSING_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

/** Create a task via the router and return its id. */
async function createTask(
  app: ReturnType<typeof appWithActor>,
  teamId: string,
  title = 'T',
): Promise<string> {
  const res = await app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, teamId }),
  });
  expect(res.status).toBe(200);
  return (await json<{ id: string }>(res)).id;
}

/** Add a `blocking → blocked` edge by calling POST on the blocked task. */
async function addEdge(
  app: ReturnType<typeof appWithActor>,
  blockedId: string,
  blockingId: string,
): Promise<Response> {
  return app.request(`/${blockedId}/dependencies`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ blockingTaskId: blockingId }),
  });
}

describe('task dependencies create + read', () => {
  it('adds an edge via blockingTaskId and splits it into blocking/blockedBy', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const a = await createTask(app, teamId, 'A');
    const b = await createTask(app, teamId, 'B');

    // B is blocked by A (edge A → B).
    const created = await addEdge(app, b, a);
    expect(created.status).toBe(200);
    const ack = await json<{ created: boolean; blockingTaskId: string; blockedTaskId: string }>(
      created,
    );
    expect(ack.created).toBe(true);
    expect(ack.blockingTaskId).toBe(a);
    expect(ack.blockedTaskId).toBe(b);

    // From B: it is blockedBy A, blocks nothing.
    const depsB = await json<{ blocking: { id: string }[]; blockedBy: { id: string }[] }>(
      await app.request(`/${b}/dependencies`, { method: 'GET' }),
    );
    expect(depsB.blockedBy.map((t) => t.id)).toEqual([a]);
    expect(depsB.blocking).toHaveLength(0);

    // From A: it blocks B, is blockedBy nothing.
    const depsA = await json<{ blocking: { id: string }[]; blockedBy: { id: string }[] }>(
      await app.request(`/${a}/dependencies`, { method: 'GET' }),
    );
    expect(depsA.blocking.map((t) => t.id)).toEqual([b]);
    expect(depsA.blockedBy).toHaveLength(0);

    // The detail view mirrors the same split.
    const detail = await json<{ blocking: { id: string }[]; blockedBy: { id: string }[] }>(
      await app.request(`/${a}`, { method: 'GET' }),
    );
    expect(detail.blocking.map((t) => t.id)).toEqual([b]);
  });

  it('adds an edge via blockedTaskId (the other direction)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const a = await createTask(app, teamId, 'A');
    const b = await createTask(app, teamId, 'B');

    // On A: A blocks B (edge A → B).
    const created = await app.request(`/${a}/dependencies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blockedTaskId: b }),
    });
    expect(created.status).toBe(200);
    const ack = await json<{ blockingTaskId: string; blockedTaskId: string }>(created);
    expect(ack.blockingTaskId).toBe(a);
    expect(ack.blockedTaskId).toBe(b);
  });

  it('carries each ref project across projects', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const [proj] = await db
      .insert(schema.project)
      .values({ organizationId: orgId, name: 'P', teamId, createdBy: humanActorId })
      .returning({ id: schema.project.id });
    const projectId = proj!.id;

    const blocker = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Blocker', teamId, projectId }),
    });
    const blockerId = (await json<{ id: string }>(blocker)).id;
    const b = await createTask(app, teamId, 'B');

    await addEdge(app, b, blockerId);
    const depsB = await json<{ blockedBy: { id: string; projectId: string | null }[] }>(
      await app.request(`/${b}/dependencies`, { method: 'GET' }),
    );
    expect(depsB.blockedBy[0]?.projectId).toBe(projectId);
  });
});

describe('task dependencies acyclic enforcement', () => {
  it('rejects an edge that would create a cycle (409)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const a = await createTask(app, teamId, 'A');
    const b = await createTask(app, teamId, 'B');
    const cTask = await createTask(app, teamId, 'C');

    // A → B, B → C.
    expect((await addEdge(app, b, a)).status).toBe(200);
    expect((await addEdge(app, cTask, b)).status).toBe(200);

    // Adding C → A (A blocked by C) closes the cycle A→B→C→A.
    const res = await addEdge(app, a, cTask);
    expect(res.status).toBe(409);
    const problem = await json<{ code: string }>(res);
    expect(problem.code).toBe('dependency_cycle');
  });

  it('rejects a direct 2-cycle (A→B then B→A)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const a = await createTask(app, teamId, 'A');
    const b = await createTask(app, teamId, 'B');
    expect((await addEdge(app, b, a)).status).toBe(200); // A → B
    expect((await addEdge(app, a, b)).status).toBe(409); // B → A would cycle
  });

  it('rejects a self-edge (422)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const a = await createTask(app, teamId, 'A');
    const res = await addEdge(app, a, a);
    expect(res.status).toBe(422);
  });

  it('rejects a duplicate edge as a conflict (409)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const a = await createTask(app, teamId, 'A');
    const b = await createTask(app, teamId, 'B');
    expect((await addEdge(app, b, a)).status).toBe(200);
    expect((await addEdge(app, b, a)).status).toBe(409);
  });
});

describe('task dependencies validation + isolation', () => {
  it('422s when neither (or both) endpoint id is given', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const a = await createTask(app, teamId, 'A');
    const b = await createTask(app, teamId, 'B');

    const none = await app.request(`/${a}/dependencies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(none.status).toBe(422);

    const both = await app.request(`/${a}/dependencies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blockingTaskId: b, blockedTaskId: b }),
    });
    expect(both.status).toBe(422);
  });

  it('404s when the path task or the other endpoint is missing', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const a = await createTask(app, teamId, 'A');

    // Missing path task.
    expect((await addEdge(app, MISSING_ULID, a)).status).toBe(404);
    // Missing other endpoint.
    expect((await addEdge(app, a, MISSING_ULID)).status).toBe(404);
    // GET on a missing task.
    expect((await app.request(`/${MISSING_ULID}/dependencies`, { method: 'GET' })).status).toBe(
      404,
    );
  });

  it('isolates tenants: cannot depend on a task in another org', async () => {
    const owner = await seedBaseOrg(db, schema);
    const other = await seedBaseOrg(db, schema);
    const appA = appWithActor(tasks, owner.orgId, ['contribute'], owner.humanActorId);
    const appB = appWithActor(tasks, other.orgId, ['contribute'], other.humanActorId);
    const a = await createTask(appA, owner.teamId, 'A');
    const foreign = await createTask(appB, other.teamId, 'Foreign');

    // From org A, the foreign task does not exist → 404.
    expect((await addEdge(appA, a, foreign)).status).toBe(404);
  });

  it('403s for a view-only actor on create + delete', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const viewer = appWithActor(tasks, orgId, ['view'], humanActorId);
    expect(
      (
        await viewer.request(`/${MISSING_ULID}/dependencies`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ blockingTaskId: MISSING_ULID }),
        })
      ).status,
    ).toBe(403);
    expect(
      (await viewer.request(`/${MISSING_ULID}/dependencies/${MISSING_ULID}`, { method: 'DELETE' }))
        .status,
    ).toBe(403);
  });
});

describe('task dependencies delete', () => {
  it('removes an edge from either endpoint', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const a = await createTask(app, teamId, 'A');
    const b = await createTask(app, teamId, 'B');
    await addEdge(app, b, a); // A → B

    // Delete addressed from the blocking side (A, depId=B).
    const removed = await app.request(`/${a}/dependencies/${b}`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect((await json<{ removed: boolean }>(removed)).removed).toBe(true);

    // Edge is gone.
    const depsA = await json<{ blocking: unknown[] }>(
      await app.request(`/${a}/dependencies`, { method: 'GET' }),
    );
    expect(depsA.blocking).toHaveLength(0);
  });

  it('removes an edge addressed from the blocked side', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const a = await createTask(app, teamId, 'A');
    const b = await createTask(app, teamId, 'B');
    await addEdge(app, b, a); // A → B

    // Delete addressed from the blocked side (B, depId=A).
    const removed = await app.request(`/${b}/dependencies/${a}`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
  });

  it('404s when the edge does not exist', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const a = await createTask(app, teamId, 'A');
    const b = await createTask(app, teamId, 'B');
    // No edge between A and B yet.
    expect((await app.request(`/${a}/dependencies/${b}`, { method: 'DELETE' })).status).toBe(404);
    // Missing path task.
    expect(
      (await app.request(`/${MISSING_ULID}/dependencies/${b}`, { method: 'DELETE' })).status,
    ).toBe(404);
  });
});
