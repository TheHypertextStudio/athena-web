/**
 * `@docket/api` — atomic task hierarchy mutation tests (`POST /tasks/reparent`).
 *
 * @remarks
 * A hierarchy gesture may move several selected tasks. The endpoint commits those assignments as
 * one operation, preserves selected subtrees when requested, and returns the previous assignments
 * needed for a precise Undo.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, one, seedBaseOrg } from '../support/routes-harness';
import type tasksRouter from '../../src/routes/tasks';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let tasks!: typeof tasksRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  tasks = (await import('../../src/routes/tasks')).default;
});

/** Insert an active task row and return its id. */
async function seedTask(orgId: string, teamId: string, title: string, parentTaskId?: string) {
  const statuses = await schema.seedWorkspaceStatuses(db, orgId);
  const statusId = statuses.get(schema.statusLookupKey('task', 'todo'));
  if (statusId === undefined) throw new Error('seeded workspace has no todo task status');
  return one(
    await db
      .insert(schema.task)
      .values({ organizationId: orgId, title, teamId, state: 'todo', statusId, parentTaskId })
      .returning({ id: schema.task.id }),
  ).id;
}

/** Submit an atomic hierarchy mutation. */
async function reparent(
  app: ReturnType<typeof appWithActor>,
  moves: { taskId: string; parentTaskId: string | null }[],
  preserveSelectedSubtrees: boolean,
): Promise<Response> {
  return app.request('/reparent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ moves, preserveSelectedSubtrees }),
  });
}

/** Read the stored parent for a task in one organization. */
async function parentOf(orgId: string, id: string): Promise<string | null> {
  const rows = await db
    .select({ parentTaskId: schema.task.parentTaskId })
    .from(schema.task)
    .where(and(eq(schema.task.id, id), eq(schema.task.organizationId, orgId)));
  return rows[0]?.parentTaskId ?? null;
}

describe('atomic task reparenting', () => {
  it('supports one move, detach, and a same-parent no-op', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const parent = await seedTask(orgId, teamId, 'Parent');
    const child = await seedTask(orgId, teamId, 'Child');

    const nested = await reparent(app, [{ taskId: child, parentTaskId: parent }], false);
    expect(nested.status).toBe(200);
    expect(await nested.json()).toEqual({
      moves: [{ taskId: child, previousParentTaskId: null, parentTaskId: parent }],
    });

    const noOp = await reparent(app, [{ taskId: child, parentTaskId: parent }], false);
    expect(noOp.status).toBe(200);
    expect(await noOp.json()).toEqual({ moves: [] });

    const detached = await reparent(app, [{ taskId: child, parentTaskId: null }], false);
    expect(detached.status).toBe(200);
    expect(await detached.json()).toEqual({
      moves: [{ taskId: child, previousParentTaskId: parent, parentTaskId: null }],
    });
    expect(await parentOf(orgId, child)).toBe(null);
  });

  it('commits multiple roots and returns exact assignments for Undo', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const oldParent = await seedTask(orgId, teamId, 'Old parent');
    const target = await seedTask(orgId, teamId, 'Target');
    const a = await seedTask(orgId, teamId, 'A', oldParent);
    const b = await seedTask(orgId, teamId, 'B');

    const response = await reparent(
      app,
      [
        { taskId: a, parentTaskId: target },
        { taskId: b, parentTaskId: target },
      ],
      false,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      moves: [
        { taskId: a, previousParentTaskId: oldParent, parentTaskId: target },
        { taskId: b, previousParentTaskId: null, parentTaskId: target },
      ],
    });
    expect(await parentOf(orgId, a)).toBe(target);
    expect(await parentOf(orgId, b)).toBe(target);
  });

  it('moves only selected roots when preserving selected subtrees', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const target = await seedTask(orgId, teamId, 'Target');
    const ancestor = await seedTask(orgId, teamId, 'Ancestor');
    const descendant = await seedTask(orgId, teamId, 'Descendant', ancestor);

    const response = await reparent(
      app,
      [
        { taskId: ancestor, parentTaskId: target },
        { taskId: descendant, parentTaskId: target },
      ],
      true,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      moves: [{ taskId: ancestor, previousParentTaskId: null, parentTaskId: target }],
    });
    expect(await parentOf(orgId, ancestor)).toBe(target);
    expect(await parentOf(orgId, descendant)).toBe(ancestor);
  });

  it('rejects a combined cycle without committing any move', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const a = await seedTask(orgId, teamId, 'A');
    const b = await seedTask(orgId, teamId, 'B');

    const response = await reparent(
      app,
      [
        { taskId: a, parentTaskId: b },
        { taskId: b, parentTaskId: a },
      ],
      false,
    );

    expect(response.status).toBe(409);
    expect(((await response.json()) as { code: string }).code).toBe('dependency_cycle');
    expect(await parentOf(orgId, a)).toBe(null);
    expect(await parentOf(orgId, b)).toBe(null);
  });

  it('rejects self-parenting and a descendant target without changing the hierarchy', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const ancestor = await seedTask(orgId, teamId, 'Ancestor');
    const descendant = await seedTask(orgId, teamId, 'Descendant', ancestor);

    expect(
      (await reparent(app, [{ taskId: ancestor, parentTaskId: ancestor }], false)).status,
    ).toBe(422);
    expect(
      (await reparent(app, [{ taskId: ancestor, parentTaskId: descendant }], false)).status,
    ).toBe(409);
    expect(await parentOf(orgId, ancestor)).toBe(null);
    expect(await parentOf(orgId, descendant)).toBe(ancestor);
  });

  it('rejects duplicate subjects and missing capability before writing', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const readOnlyApp = appWithActor(tasks, orgId, ['view'], humanActorId);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const a = await seedTask(orgId, teamId, 'A');
    const b = await seedTask(orgId, teamId, 'B');

    expect(
      (
        await reparent(
          app,
          [
            { taskId: a, parentTaskId: b },
            { taskId: a, parentTaskId: null },
          ],
          false,
        )
      ).status,
    ).toBe(422);
    expect((await reparent(readOnlyApp, [{ taskId: a, parentTaskId: b }], false)).status).toBe(403);
    expect(await parentOf(orgId, a)).toBe(null);
  });

  it('treats archived subjects and parents as not found', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const active = await seedTask(orgId, teamId, 'Active');
    const archived = await seedTask(orgId, teamId, 'Archived');
    await db
      .update(schema.task)
      .set({ archivedAt: new Date() })
      .where(eq(schema.task.id, archived));

    expect((await reparent(app, [{ taskId: active, parentTaskId: archived }], false)).status).toBe(
      404,
    );
    expect((await reparent(app, [{ taskId: archived, parentTaskId: active }], false)).status).toBe(
      404,
    );
    expect(await parentOf(orgId, active)).toBe(null);
  });

  it('hides missing and cross-organization task ids without partial writes', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const other = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const a = await seedTask(orgId, teamId, 'A');
    const target = await seedTask(orgId, teamId, 'Target');
    const foreign = await seedTask(other.orgId, other.teamId, 'Foreign');

    const response = await reparent(
      app,
      [
        { taskId: a, parentTaskId: target },
        { taskId: foreign, parentTaskId: target },
      ],
      false,
    );

    expect(response.status).toBe(404);
    expect(await parentOf(orgId, a)).toBe(null);
  });
});
