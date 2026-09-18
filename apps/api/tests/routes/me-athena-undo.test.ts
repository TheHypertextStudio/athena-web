/**
 * Personal Athena undo route: ownership is derived from the change set's originating session, not
 * from the caller's identity carried on the change set itself (it has none).
 */
import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';

import type { AppEnv } from '../../src/context';
import { onError } from '../../src/error';
import { trackedFields } from '../../src/mcp/change-set';
import type meAthenaRouter from '../../src/routes/me-athena';
import {
  fakeSession,
  getDb,
  grantDocketPro,
  one,
  seedStatuses,
  seedUserWithHub,
} from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let meAthena!: typeof meAthenaRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  meAthena = (await import('../../src/routes/me-athena')).default;
});

/** Mount the personal route with only a Better Auth session, never an org actor context. */
function appFor(userId: string) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('session', fakeSession(userId));
    await next();
  });
  app.route('/', meAthena);
  app.onError(onError);
  return app;
}

interface Fixture {
  readonly ownerUserId: string;
  readonly otherUserId: string;
  readonly changeSetId: string;
  readonly taskId: string;
}

/** One caller-owned Athena session with one recorded, still-undoable task rename. */
async function seedUndoableChange(): Promise<Fixture> {
  const suffix = Math.random().toString(36).slice(2, 9);
  const orgId = one(
    await db
      .insert(schema.organization)
      .values({ name: `Undo-${suffix}`, slug: `undo-${suffix}`, lifecycleState: 'active' })
      .returning({ id: schema.organization.id }),
  ).id;
  await grantDocketPro(db, schema, orgId);
  const statusId = await seedStatuses(db, schema, orgId);
  const actorId = one(
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Owner' })
      .returning({ id: schema.actor.id }),
  ).id;
  const teamId = one(
    await db
      .insert(schema.team)
      .values({ organizationId: orgId, name: 'Core', key: `T${suffix.slice(-3)}` })
      .returning({ id: schema.team.id }),
  ).id;
  const taskRow = one(
    await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: 'New title',
        state: 'todo',
        statusId: statusId('task', 'todo'),
        createdBy: actorId,
      })
      .returning(),
  );

  const ownerUserId = await seedUserWithHub(db, schema, 'Owner');
  const otherUserId = await seedUserWithHub(db, schema, 'Other');

  const sessionId = one(
    await db
      .insert(schema.agentSession)
      .values({
        executorKind: 'athena',
        ownerUserId,
        contextOrganizationId: orgId,
        kind: 'job',
        trigger: 'delegation',
        status: 'completed',
      })
      .returning({ id: schema.agentSession.id }),
  ).id;

  const after = trackedFields('task', taskRow);
  const before = { ...after, title: 'Old title' };
  const changeSetId = one(
    await db
      .insert(schema.changeSet)
      .values({
        id: `cs_${suffix}`,
        organizationId: orgId,
        actorId,
        origin: { tool: 'update_task', sessionId },
        summary: 'Renamed the task',
      })
      .returning({ id: schema.changeSet.id }),
  ).id;
  await db.insert(schema.changeSetEntry).values({
    changeSetId,
    entityKind: 'task',
    entityId: taskRow.id,
    op: 'update',
    before,
    after,
  });

  return { ownerUserId, otherUserId, changeSetId, taskId: taskRow.id };
}

describe('POST /changes/:changeSetId/undo', () => {
  it("reverses a change recorded on the caller's own session", async () => {
    const fixture = await seedUndoableChange();

    const response = await appFor(fixture.ownerUserId).request(
      `/changes/${fixture.changeSetId}/undo`,
      { method: 'POST' },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      changeSetId: fixture.changeSetId,
      undone: true,
    });
    const [task] = await db
      .select({ title: schema.task.title })
      .from(schema.task)
      .where(eq(schema.task.id, fixture.taskId));
    expect(task?.title).toBe('Old title');
  });

  it("hides a change recorded on someone else's session as not found", async () => {
    const fixture = await seedUndoableChange();

    const response = await appFor(fixture.otherUserId).request(
      `/changes/${fixture.changeSetId}/undo`,
      { method: 'POST' },
    );

    expect(response.status).toBe(404);
    const [task] = await db
      .select({ title: schema.task.title })
      .from(schema.task)
      .where(eq(schema.task.id, fixture.taskId));
    expect(task?.title).toBe('New title');
  });

  it('reports a change set with no recorded session as not found', async () => {
    const fixture = await seedUndoableChange();
    await db
      .update(schema.changeSet)
      .set({ origin: { tool: 'update_task' } })
      .where(eq(schema.changeSet.id, fixture.changeSetId));

    const response = await appFor(fixture.ownerUserId).request(
      `/changes/${fixture.changeSetId}/undo`,
      { method: 'POST' },
    );

    expect(response.status).toBe(404);
  });
});
