/**
 * `@docket/api` — backlog-backfill (POST /:id/backfill): sweep a team's unscoped, open tasks
 * onto a cycle.
 *
 * @remarks
 * Only ever fills the `cycle_id IS NULL` gap; a task already on a cycle (this one or another)
 * or in a terminal workflow state is left untouched. Mirrors `cycles-detail.test.ts`'s
 * fixtures/harness conventions.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, seedBaseOrg } from '../support/routes-harness';
import type cyclesRouter from '../../src/routes/cycles';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let cycles!: typeof cyclesRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  cycles = (await import('../../src/routes/cycles')).default;
});

/** Parse a JSON response body as the given shape. */
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Insert a cycle row directly; returns its id. */
async function makeCycle(
  orgId: string,
  teamId: string,
  actorId: string,
  number = 1,
): Promise<string> {
  const [row] = await db
    .insert(schema.cycle)
    .values({
      organizationId: orgId,
      teamId,
      number,
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      endsAt: new Date('2026-01-14T00:00:00.000Z'),
      status: 'active',
      createdBy: actorId,
    })
    .returning({ id: schema.cycle.id });
  return row!.id;
}

/** Insert a task row directly, with control over cycle/state/archived. */
async function makeTask(
  orgId: string,
  teamId: string,
  actorId: string,
  opts: { cycleId?: string | null; state?: string; archivedAt?: Date } = {},
): Promise<string> {
  const [row] = await db
    .insert(schema.task)
    .values({
      organizationId: orgId,
      title: 'T',
      teamId,
      state: opts.state ?? 'todo',
      cycleId: opts.cycleId ?? null,
      createdBy: actorId,
      ...(opts.archivedAt ? { archivedAt: opts.archivedAt } : {}),
    })
    .returning({ id: schema.task.id });
  return row!.id;
}

/** The stored `cycleId` for a task. */
async function cycleOf(taskId: string): Promise<string | null> {
  const [row] = await db
    .select({ cycleId: schema.task.cycleId })
    .from(schema.task)
    .where(eq(schema.task.id, taskId));
  return row!.cycleId;
}

describe('cycle backfill (POST /:id/backfill)', () => {
  it('assigns only unscoped, non-terminal, non-archived tasks on the same team', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const cycleId = await makeCycle(orgId, teamId, humanActorId, 1);
    const otherCycle = await makeCycle(orgId, teamId, humanActorId, 2);

    const unscoped = await makeTask(orgId, teamId, humanActorId, { state: 'todo' });
    const alreadyOnThisCycle = await makeTask(orgId, teamId, humanActorId, { cycleId });
    const onAnotherCycle = await makeTask(orgId, teamId, humanActorId, { cycleId: otherCycle });
    const done = await makeTask(orgId, teamId, humanActorId, { state: 'done' });
    const canceled = await makeTask(orgId, teamId, humanActorId, { state: 'canceled' });
    const archived = await makeTask(orgId, teamId, humanActorId, {
      state: 'todo',
      archivedAt: new Date(),
    });

    const writer = appWithActor(cycles, orgId, ['contribute'], humanActorId);
    const res = await writer.request(`/${cycleId}/backfill`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await json<{ assignedCount: number }>(res)).toEqual({ assignedCount: 1 });

    expect(await cycleOf(unscoped)).toBe(cycleId);
    expect(await cycleOf(alreadyOnThisCycle)).toBe(cycleId);
    expect(await cycleOf(onAnotherCycle)).toBe(otherCycle);
    expect(await cycleOf(done)).toBeNull();
    expect(await cycleOf(canceled)).toBeNull();
    expect(await cycleOf(archived)).toBeNull();
  });

  it('is idempotent — a repeat call only touches tasks still missing a cycle', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const cycleId = await makeCycle(orgId, teamId, humanActorId);
    await makeTask(orgId, teamId, humanActorId, { state: 'todo' });

    const writer = appWithActor(cycles, orgId, ['contribute'], humanActorId);
    const first = await writer.request(`/${cycleId}/backfill`, { method: 'POST' });
    expect((await json<{ assignedCount: number }>(first)).assignedCount).toBe(1);

    const second = await writer.request(`/${cycleId}/backfill`, { method: 'POST' });
    expect((await json<{ assignedCount: number }>(second)).assignedCount).toBe(0);
  });

  it('leaves a task on another team untouched', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const [otherTeam] = await db
      .insert(schema.team)
      .values({ organizationId: orgId, name: 'Elsewhere', key: 'ELS' })
      .returning();
    const cycleId = await makeCycle(orgId, teamId, humanActorId);
    const foreignTask = await makeTask(orgId, otherTeam!.id, humanActorId, { state: 'todo' });

    const writer = appWithActor(cycles, orgId, ['contribute'], humanActorId);
    const res = await writer.request(`/${cycleId}/backfill`, { method: 'POST' });
    expect((await json<{ assignedCount: number }>(res)).assignedCount).toBe(0);
    expect(await cycleOf(foreignTask)).toBeNull();
  });

  it('404s for a cycle outside the caller org', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const other = await seedBaseOrg(db, schema);
    const foreignCycleId = await makeCycle(other.orgId, other.teamId, other.humanActorId);

    const writer = appWithActor(cycles, orgId, ['contribute'], humanActorId);
    const res = await writer.request(`/${foreignCycleId}/backfill`, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
