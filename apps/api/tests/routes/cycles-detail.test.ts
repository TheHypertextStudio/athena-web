/**
 * `@docket/api` — cycle detail-screen route tests: detail (with stats), grouped
 * committed-task list, burn-up report, and close (carryover review).
 *
 * @remarks
 * Mirrors `harness.test.ts` (pglite + injected actor context). List/create/patch/
 * delete coverage lives in `group-a.test.ts`; this file covers the §8.5 detail,
 * burn-up, and carryover-close surfaces added in lane B.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, seedBaseOrg } from './harness.test';
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

// A valid ULID-shaped id that no seeded row uses (passes branded-id validation, 404s on lookup).
const MISSING_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

/** Insert a cycle row directly; returns its id. */
async function makeCycle(
  orgId: string,
  teamId: string,
  actorId: string,
  opts: { number?: number; startsAt?: Date; endsAt?: Date; status?: 'upcoming' | 'active' } = {},
): Promise<string> {
  const [row] = await db
    .insert(schema.cycle)
    .values({
      organizationId: orgId,
      teamId,
      number: opts.number ?? 1,
      startsAt: opts.startsAt ?? new Date('2026-01-01T00:00:00.000Z'),
      endsAt: opts.endsAt ?? new Date('2026-01-14T00:00:00.000Z'),
      status: opts.status ?? 'active',
      createdBy: actorId,
    })
    .returning({ id: schema.cycle.id });
  return row!.id;
}

/** Insert a task row directly (full control over cycle/estimate/completedAt/createdAt). */
async function makeTask(
  orgId: string,
  teamId: string,
  actorId: string,
  opts: {
    cycleId?: string | null;
    projectId?: string | null;
    programId?: string | null;
    estimate?: number | null;
    completedAt?: Date | null;
    createdAt?: Date;
    state?: string;
  } = {},
): Promise<string> {
  const [row] = await db
    .insert(schema.task)
    .values({
      organizationId: orgId,
      title: 'T',
      teamId,
      state: opts.state ?? (opts.completedAt ? 'done' : 'todo'),
      cycleId: opts.cycleId ?? null,
      projectId: opts.projectId ?? null,
      programId: opts.programId ?? null,
      estimate: opts.estimate ?? null,
      completedAt: opts.completedAt ?? null,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
      createdBy: actorId,
    })
    .returning({ id: schema.task.id });
  return row!.id;
}

describe('cycle detail (GET /:id)', () => {
  it('returns the cycle with rolled-up stats over its committed tasks', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const cycleId = await makeCycle(orgId, teamId, humanActorId, {
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    // Two committed: one done (estimate 3, completed) + one open (estimate 5),
    // plus one open created mid-cycle (estimate 2 → scope change), plus an
    // unestimated open task (contributes 0 capacity but counts as committed/carryover).
    await makeTask(orgId, teamId, humanActorId, {
      cycleId,
      estimate: 3,
      completedAt: new Date('2026-01-05T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await makeTask(orgId, teamId, humanActorId, {
      cycleId,
      estimate: 5,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await makeTask(orgId, teamId, humanActorId, {
      cycleId,
      estimate: 2,
      createdAt: new Date('2026-01-08T00:00:00.000Z'), // after starts_at → scope change
    });
    await makeTask(orgId, teamId, humanActorId, {
      cycleId,
      estimate: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    // A task on a different cycle / no cycle must NOT count.
    await makeTask(orgId, teamId, humanActorId, { cycleId: null, estimate: 99 });

    const writer = appWithActor(cycles, orgId, ['view'], humanActorId);
    const res = await writer.request(`/${cycleId}`);
    expect(res.status).toBe(200);
    const body = await json<{
      id: string;
      stats: {
        committed: number;
        completed: number;
        capacity: number;
        completedCapacity: number;
        scopeChange: number;
        carryover: number;
      };
    }>(res);
    expect(body.id).toBe(cycleId);
    expect(body.stats.committed).toBe(4);
    expect(body.stats.completed).toBe(1);
    expect(body.stats.capacity).toBe(10); // 3 + 5 + 2 + 0
    expect(body.stats.completedCapacity).toBe(3);
    expect(body.stats.scopeChange).toBe(1);
    expect(body.stats.carryover).toBe(3); // committed - completed
  });

  it('404s on a missing id', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(cycles, orgId, ['view'], humanActorId);
    expect((await writer.request(`/${MISSING_ULID}`)).status).toBe(404);
  });

  it('isolates tenants: a cycle in another org 404s', async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    const cycleA = await makeCycle(a.orgId, a.teamId, a.humanActorId);
    const writerB = appWithActor(cycles, b.orgId, ['view'], b.humanActorId);
    expect((await writerB.request(`/${cycleA}`)).status).toBe(404);
  });
});

describe('cycle committed tasks (GET /:id/tasks)', () => {
  it('groups committed tasks by project (default)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const [proj] = await db
      .insert(schema.project)
      .values({ organizationId: orgId, name: 'P', teamId, createdBy: humanActorId })
      .returning({ id: schema.project.id });
    const cycleId = await makeCycle(orgId, teamId, humanActorId);

    const inProj = await makeTask(orgId, teamId, humanActorId, {
      cycleId,
      projectId: proj!.id,
    });
    // A second task in the SAME project — exercises the "append to existing bucket"
    // path of the grouping accumulator (not just first-insert).
    const inProj2 = await makeTask(orgId, teamId, humanActorId, {
      cycleId,
      projectId: proj!.id,
    });
    const noProj = await makeTask(orgId, teamId, humanActorId, { cycleId, projectId: null });

    const writer = appWithActor(cycles, orgId, ['view'], humanActorId);
    const res = await writer.request(`/${cycleId}/tasks`);
    expect(res.status).toBe(200);
    const body = await json<{
      groupBy: string;
      groups: { projectId: string | null; tasks: { id: string }[] }[];
    }>(res);
    expect(body.groupBy).toBe('project');

    const projGroup = body.groups.find((g) => g.projectId === proj!.id);
    const nullGroup = body.groups.find((g) => g.projectId === null);
    expect(projGroup?.tasks.map((t) => t.id).sort()).toEqual([inProj, inProj2].sort());
    expect(nullGroup?.tasks.map((t) => t.id)).toEqual([noProj]);
  });

  it('groups committed tasks by program when groupBy=program', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const [program] = await db
      .insert(schema.program)
      .values({ organizationId: orgId, name: 'Prog', createdBy: humanActorId })
      .returning({ id: schema.program.id });
    const cycleId = await makeCycle(orgId, teamId, humanActorId);
    const inProg = await makeTask(orgId, teamId, humanActorId, {
      cycleId,
      programId: program!.id,
    });

    const writer = appWithActor(cycles, orgId, ['view'], humanActorId);
    const res = await writer.request(`/${cycleId}/tasks?groupBy=program`);
    expect(res.status).toBe(200);
    const body = await json<{
      groupBy: string;
      groups: { programId: string | null; tasks: { id: string }[] }[];
    }>(res);
    expect(body.groupBy).toBe('program');
    expect(body.groups.find((g) => g.programId === program!.id)?.tasks.map((t) => t.id)).toEqual([
      inProg,
    ]);
  });

  it('returns an empty group list for a cycle with no committed tasks', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const cycleId = await makeCycle(orgId, teamId, humanActorId);
    const writer = appWithActor(cycles, orgId, ['view'], humanActorId);
    const body = await json<{ groups: unknown[] }>(await writer.request(`/${cycleId}/tasks`));
    expect(body.groups).toHaveLength(0);
  });

  it('422s on an invalid groupBy', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const cycleId = await makeCycle(orgId, teamId, humanActorId);
    const writer = appWithActor(cycles, orgId, ['view'], humanActorId);
    expect((await writer.request(`/${cycleId}/tasks?groupBy=nope`)).status).toBe(422);
  });

  it('404s on a missing cycle', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(cycles, orgId, ['view'], humanActorId);
    expect((await writer.request(`/${MISSING_ULID}/tasks`)).status).toBe(404);
  });
});

describe('cycle burn-up (GET /:id/burnup)', () => {
  it('builds a daily planned-vs-done series + scope changes over the window', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const cycleId = await makeCycle(orgId, teamId, humanActorId, {
      startsAt: new Date('2026-01-01T00:00:00.000Z'),
      endsAt: new Date('2026-01-03T00:00:00.000Z'), // 3-day window
    });
    // Day-one task (estimate 4), completed on day 2.
    await makeTask(orgId, teamId, humanActorId, {
      cycleId,
      estimate: 4,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      completedAt: new Date('2026-01-02T12:00:00.000Z'),
    });
    // Scope added on day 2 (estimate 2), still open.
    await makeTask(orgId, teamId, humanActorId, {
      cycleId,
      estimate: 2,
      createdAt: new Date('2026-01-02T09:00:00.000Z'),
    });
    // A second scope addition, created EARLIER on day 2 — exercises the sort
    // comparator so scopeChanges is ordered by when each task joined.
    const earlierScope = await makeTask(orgId, teamId, humanActorId, {
      cycleId,
      estimate: 1,
      createdAt: new Date('2026-01-02T03:00:00.000Z'),
    });

    const writer = appWithActor(cycles, orgId, ['view'], humanActorId);
    const res = await writer.request(`/${cycleId}/burnup`);
    expect(res.status).toBe(200);
    const body = await json<{
      cycleId: string;
      capacity: number;
      series: { date: string; planned: number; completed: number; remaining: number }[];
      scopeChanges: { taskId: string; estimate: number }[];
      stats: { capacity: number; scopeChange: number };
    }>(res);

    expect(body.cycleId).toBe(cycleId);
    expect(body.capacity).toBe(7); // 4 + 2 + 1
    expect(body.series).toHaveLength(3); // Jan 1, 2, 3

    // Day 1: only the first task is planned (4), nothing done yet.
    expect(body.series[0]).toMatchObject({
      date: '2026-01-01',
      planned: 4,
      completed: 0,
      remaining: 4,
    });
    // Day 2: both scope tasks join (planned 7), first task completes (done 4).
    expect(body.series[1]).toMatchObject({
      date: '2026-01-02',
      planned: 7,
      completed: 4,
      remaining: 3,
    });
    // Day 3: unchanged plan, still 4 done.
    expect(body.series[2]).toMatchObject({ date: '2026-01-03', planned: 7, completed: 4 });

    // Two mid-cycle additions, ordered by join time (the 03:00 task before the 09:00 one).
    expect(body.scopeChanges).toHaveLength(2);
    expect(body.scopeChanges[0]!.taskId).toBe(earlierScope);
    expect(body.scopeChanges[0]!.estimate).toBe(1);
    expect(body.scopeChanges[1]!.estimate).toBe(2);
    expect(body.stats.scopeChange).toBe(2);
  });

  it('404s on a missing cycle', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(cycles, orgId, ['view'], humanActorId);
    expect((await writer.request(`/${MISSING_ULID}/burnup`)).status).toBe(404);
  });

  it('isolates tenants', async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    const cycleA = await makeCycle(a.orgId, a.teamId, a.humanActorId);
    const writerB = appWithActor(cycles, b.orgId, ['view'], b.humanActorId);
    expect((await writerB.request(`/${cycleA}/burnup`)).status).toBe(404);
  });
});

describe('cycle close (POST /:id/close)', () => {
  /** Read a task's stored cycleId. */
  async function taskCycle(id: string): Promise<string | null> {
    const [row] = await db
      .select({ cycleId: schema.task.cycleId })
      .from(schema.task)
      .where(eq(schema.task.id, id));
    return row!.cycleId;
  }

  it('applies keep/move/triage decisions then marks the cycle completed', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const cycleId = await makeCycle(orgId, teamId, humanActorId, { number: 1 });
    const nextCycle = await makeCycle(orgId, teamId, humanActorId, {
      number: 2,
      status: 'upcoming',
    });

    const kept = await makeTask(orgId, teamId, humanActorId, { cycleId });
    const moved = await makeTask(orgId, teamId, humanActorId, { cycleId });
    const triaged = await makeTask(orgId, teamId, humanActorId, { cycleId });
    // A completed task is not eligible for a decision and is left untouched.
    const completed = await makeTask(orgId, teamId, humanActorId, {
      cycleId,
      completedAt: new Date('2026-01-05T00:00:00.000Z'),
    });

    const writer = appWithActor(cycles, orgId, ['contribute'], humanActorId);
    const res = await writer.request(`/${cycleId}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        carryover: [
          { taskId: kept, action: 'keep' },
          { taskId: moved, action: 'move', targetCycleId: nextCycle },
          { taskId: triaged, action: 'triage' },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const body = await json<{
      closed: boolean;
      keptCount: number;
      movedCount: number;
      triagedCount: number;
    }>(res);
    expect(body).toEqual({ closed: true, keptCount: 1, movedCount: 1, triagedCount: 1 });

    expect(await taskCycle(kept)).toBe(cycleId);
    expect(await taskCycle(moved)).toBe(nextCycle);
    expect(await taskCycle(triaged)).toBeNull();
    expect(await taskCycle(completed)).toBe(cycleId);

    const [cy] = await db
      .select({ status: schema.cycle.status })
      .from(schema.cycle)
      .where(eq(schema.cycle.id, cycleId));
    expect(cy!.status).toBe('completed');
  });

  it('closes with an empty (defaulted) carryover list', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const cycleId = await makeCycle(orgId, teamId, humanActorId);
    const writer = appWithActor(cycles, orgId, ['contribute'], humanActorId);
    const res = await writer.request(`/${cycleId}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect((await json<{ closed: boolean }>(res)).closed).toBe(true);
  });

  it('422s when a decision names a task not incomplete on this cycle', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const cycleId = await makeCycle(orgId, teamId, humanActorId);
    // A completed committed task is ineligible for a carryover decision.
    const done = await makeTask(orgId, teamId, humanActorId, {
      cycleId,
      completedAt: new Date('2026-01-05T00:00:00.000Z'),
    });
    const writer = appWithActor(cycles, orgId, ['contribute'], humanActorId);
    const res = await writer.request(`/${cycleId}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ carryover: [{ taskId: done, action: 'keep' }] }),
    });
    expect(res.status).toBe(422);

    // The transaction rolled back: the cycle is NOT closed.
    const [cy] = await db
      .select({ status: schema.cycle.status })
      .from(schema.cycle)
      .where(eq(schema.cycle.id, cycleId));
    expect(cy!.status).not.toBe('completed');
  });

  it('422s when a move targets a cycle on a different team', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const [otherTeam] = await db
      .insert(schema.team)
      .values({ organizationId: orgId, name: 'Other', key: `K${Date.now() % 100000}` })
      .returning({ id: schema.team.id });
    const cycleId = await makeCycle(orgId, teamId, humanActorId);
    const foreignCycle = await makeCycle(orgId, otherTeam!.id, humanActorId);
    const open = await makeTask(orgId, teamId, humanActorId, { cycleId });

    const writer = appWithActor(cycles, orgId, ['contribute'], humanActorId);
    const res = await writer.request(`/${cycleId}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        carryover: [{ taskId: open, action: 'move', targetCycleId: foreignCycle }],
      }),
    });
    expect(res.status).toBe(422);
  });

  it('422s when a move targets the cycle being closed', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const cycleId = await makeCycle(orgId, teamId, humanActorId);
    const open = await makeTask(orgId, teamId, humanActorId, { cycleId });
    const writer = appWithActor(cycles, orgId, ['contribute'], humanActorId);
    const res = await writer.request(`/${cycleId}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        carryover: [{ taskId: open, action: 'move', targetCycleId: cycleId }],
      }),
    });
    expect(res.status).toBe(422);
  });

  it('422s when a move decision omits targetCycleId (DTO refine)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const cycleId = await makeCycle(orgId, teamId, humanActorId);
    const open = await makeTask(orgId, teamId, humanActorId, { cycleId });
    const writer = appWithActor(cycles, orgId, ['contribute'], humanActorId);
    const res = await writer.request(`/${cycleId}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ carryover: [{ taskId: open, action: 'move' }] }),
    });
    expect(res.status).toBe(422);
  });

  it('403s for a view-only actor and 404s on a missing cycle', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const viewer = appWithActor(cycles, orgId, ['view'], humanActorId);
    expect(
      (
        await viewer.request(`/${MISSING_ULID}/close`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ carryover: [] }),
        })
      ).status,
    ).toBe(403);

    const writer = appWithActor(cycles, orgId, ['contribute'], humanActorId);
    expect(
      (
        await writer.request(`/${MISSING_ULID}/close`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ carryover: [] }),
        })
      ).status,
    ).toBe(404);
  });

  it('isolates tenants: cannot close another org’s cycle', async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    const cycleA = await makeCycle(a.orgId, a.teamId, a.humanActorId);
    const writerB = appWithActor(cycles, b.orgId, ['contribute'], b.humanActorId);
    const res = await writerB.request(`/${cycleA}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ carryover: [] }),
    });
    expect(res.status).toBe(404);
  });
});
