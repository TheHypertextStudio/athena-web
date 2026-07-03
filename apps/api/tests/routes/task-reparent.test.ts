/**
 * `@docket/api` — RESTful task reparenting tests (`PATCH /tasks/:id` with `parentTaskId`).
 *
 * @remarks
 * Reparenting is a property update: nest a task under another (its subtask), detach to top-level
 * (null), rejecting self-parenting (422) and any move that would make a task its own descendant
 * (409, acyclic guard). Mirrors `harness.test.ts`.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, one, seedBaseOrg } from './harness.test';
import type tasksRouter from '../../src/routes/tasks';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let tasks!: typeof tasksRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  tasks = (await import('../../src/routes/tasks')).default;
});

const MISSING_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

/** Insert a task row directly and return its (branded) id. */
async function seedTask(orgId: string, teamId: string, title: string) {
  return one(
    await db
      .insert(schema.task)
      .values({ organizationId: orgId, title, teamId, state: 'todo' })
      .returning({ id: schema.task.id }),
  ).id;
}

/** PATCH a task's parent and return the response. */
async function reparent(
  app: ReturnType<typeof appWithActor>,
  id: string,
  parentTaskId: string | null,
): Promise<Response> {
  return app.request(`/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ parentTaskId }),
  });
}

/** Read a task's current `parentTaskId`. */
async function parentOf(orgId: string, id: string): Promise<string | null> {
  const rows = await db
    .select({ p: schema.task.parentTaskId })
    .from(schema.task)
    .where(and(eq(schema.task.id, id), eq(schema.task.organizationId, orgId)));
  return rows[0]?.p ?? null;
}

describe('task reparenting', () => {
  it('nests a task under a new parent and detaches back to top-level', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const a = await seedTask(orgId, teamId, 'A');
    const b = await seedTask(orgId, teamId, 'B');

    expect((await reparent(app, b, a)).status).toBe(200);
    expect(await parentOf(orgId, b)).toBe(a);

    expect((await reparent(app, b, null)).status).toBe(200);
    expect(await parentOf(orgId, b)).toBe(null);
  });

  it('rejects self-parenting (422)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const a = await seedTask(orgId, teamId, 'A');
    expect((await reparent(app, a, a)).status).toBe(422);
  });

  it('rejects a move that would create a subtask cycle (409)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const a = await seedTask(orgId, teamId, 'A');
    const b = await seedTask(orgId, teamId, 'B');

    // A under B (B is now A's ancestor).
    expect((await reparent(app, a, b)).status).toBe(200);
    // Making B a child of A would close the loop A→B→A.
    const res = await reparent(app, b, a);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('dependency_cycle');
  });

  it('404s when the new parent is missing / cross-org', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const other = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const a = await seedTask(orgId, teamId, 'A');
    const foreign = await seedTask(other.orgId, other.teamId, 'Foreign');

    expect((await reparent(app, a, MISSING_ULID)).status).toBe(404);
    expect((await reparent(app, a, foreign)).status).toBe(404);
  });
});
