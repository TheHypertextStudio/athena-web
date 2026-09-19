import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { assertDefined } from '@docket/test-utils';

import { cycleWindowContaining } from '../../src/lib/cycle-window';
import type teamsRouter from '../../src/routes/teams';
import { appWithActor, getDb, seedBaseOrg, seedTask } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let teams!: typeof teamsRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  teams = (await import('../../src/routes/teams')).default;
});

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function insertCycle(
  orgId: string,
  teamId: string,
  startDate: string,
  endDate: string,
  number: number,
): Promise<string> {
  const [row] = await db
    .insert(schema.cycle)
    .values({
      organizationId: orgId,
      teamId,
      number,
      startsAt: new Date(`${startDate}T00:00:00.000Z`),
      endsAt: new Date(`${endDate}T23:59:59.999Z`),
      status: 'upcoming',
    })
    .returning({ id: schema.cycle.id });
  return assertDefined(row).id;
}

describe('team cycle cadence changes', () => {
  it('keeps every task assignment and removes only empty native cycles after the safe boundary', async () => {
    const base = await seedBaseOrg(db, schema);
    const today = new Date().toISOString().slice(0, 10);
    const current = cycleWindowContaining({ anchorDate: '2024-01-01', cadenceDays: 7 }, today);
    const currentId = await insertCycle(
      base.orgId,
      base.teamId,
      current.startDate,
      current.endDate,
      30_000_001,
    );
    const firstEmptyId = await insertCycle(
      base.orgId,
      base.teamId,
      addDays(current.startDate, 7),
      addDays(current.endDate, 7),
      30_000_002,
    );
    const occupiedId = await insertCycle(
      base.orgId,
      base.teamId,
      addDays(current.startDate, 14),
      addDays(current.endDate, 14),
      30_000_003,
    );
    const trailingEmptyId = await insertCycle(
      base.orgId,
      base.teamId,
      addDays(current.startDate, 21),
      addDays(current.endDate, 21),
      30_000_004,
    );
    const currentTask = await seedTask(db, schema, base.statusId, {
      organizationId: base.orgId,
      teamId: base.teamId,
      title: 'Current work',
      state: 'backlog',
      cycleId: currentId,
    });
    const futureTask = await seedTask(db, schema, base.statusId, {
      organizationId: base.orgId,
      teamId: base.teamId,
      title: 'Planned work',
      state: 'backlog',
      cycleId: occupiedId,
    });
    const safeAnchor = addDays(current.endDate, 15);

    const writer = appWithActor(teams, base.orgId, ['manage'], base.humanActorId);
    const response = await writer.request(`/${base.teamId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cycleCadenceDays: 10,
        cycleCadenceAnchor: safeAnchor,
        cycleCadenceRevision: 1,
      }),
    });
    expect(response.status).toBe(200);
    const body = await json<{
      cycleCadenceDays: number;
      cycleCadenceAnchor: string;
      cycleCadenceRevision: number;
      cadenceChange: { effectiveAnchor: string; removedEmptyCycles: number };
    }>(response);
    expect(body).toMatchObject({
      cycleCadenceDays: 10,
      cycleCadenceAnchor: safeAnchor,
      cycleCadenceRevision: 2,
      cadenceChange: { effectiveAnchor: safeAnchor, removedEmptyCycles: 1 },
    });

    const taskRows = await db
      .select({ id: schema.task.id, cycleId: schema.task.cycleId })
      .from(schema.task)
      .where(eq(schema.task.organizationId, base.orgId));
    expect(taskRows).toEqual(
      expect.arrayContaining([
        { id: currentTask.id, cycleId: currentId },
        { id: futureTask.id, cycleId: occupiedId },
      ]),
    );
    const remaining = await db
      .select({ id: schema.cycle.id })
      .from(schema.cycle)
      .where(
        and(eq(schema.cycle.organizationId, base.orgId), eq(schema.cycle.teamId, base.teamId)),
      );
    expect(remaining.map(({ id }) => id)).toEqual(
      expect.arrayContaining([currentId, firstEmptyId, occupiedId]),
    );
    expect(remaining.map(({ id }) => id)).not.toContain(trailingEmptyId);
  });

  it('rejects an unsafe anchor and accepts an intentional later gap', async () => {
    const base = await seedBaseOrg(db, schema);
    const current = cycleWindowContaining(
      { anchorDate: '2024-01-01', cadenceDays: 7 },
      new Date().toISOString().slice(0, 10),
    );
    const writer = appWithActor(teams, base.orgId, ['manage'], base.humanActorId);

    const unsafe = await writer.request(`/${base.teamId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cycleCadenceDays: 1,
        cycleCadenceAnchor: current.endDate,
        cycleCadenceRevision: 1,
      }),
    });
    expect(unsafe.status).toBe(422);

    const laterAnchor = addDays(current.endDate, 30);
    const accepted = await writer.request(`/${base.teamId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cycleCadenceDays: 1,
        cycleCadenceAnchor: laterAnchor,
        cycleCadenceRevision: 1,
      }),
    });
    expect(accepted.status).toBe(200);
    expect(await json<{ cycleCadenceAnchor: string }>(accepted)).toMatchObject({
      cycleCadenceAnchor: laterAnchor,
    });
  });

  it('makes identical retries a no-op and rejects a stale competing revision', async () => {
    const base = await seedBaseOrg(db, schema);
    const current = cycleWindowContaining(
      { anchorDate: '2024-01-01', cadenceDays: 7 },
      new Date().toISOString().slice(0, 10),
    );
    const anchor = addDays(current.endDate, 1);
    const writer = appWithActor(teams, base.orgId, ['manage'], base.humanActorId);
    const update = { cycleCadenceDays: 10, cycleCadenceAnchor: anchor, cycleCadenceRevision: 1 };

    expect(
      (
        await writer.request(`/${base.teamId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(update),
        })
      ).status,
    ).toBe(200);
    const retry = await writer.request(`/${base.teamId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(update),
    });
    expect(retry.status).toBe(200);
    expect((await json<{ cycleCadenceRevision: number }>(retry)).cycleCadenceRevision).toBe(2);

    const stale = await writer.request(`/${base.teamId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...update, cycleCadenceDays: 11 }),
    });
    expect(stale.status).toBe(409);
    expect((await json<{ code: string }>(stale)).code).toBe('cadence_changed');
  });

  it('refuses cadence changes while an active provider owns the schedule', async () => {
    const base = await seedBaseOrg(db, schema);
    const [integration] = await db
      .insert(schema.integration)
      .values({
        organizationId: base.orgId,
        provider: 'linear',
        pattern: 'connector',
        status: 'connected',
      })
      .returning({ id: schema.integration.id });
    await db.insert(schema.cycle).values({
      organizationId: base.orgId,
      teamId: base.teamId,
      number: 1,
      source: 'linked',
      sourceIntegrationId: assertDefined(integration).id,
      externalId: 'provider-cycle',
      startsAt: new Date('2026-09-01T00:00:00.000Z'),
      endsAt: new Date('2026-09-30T23:59:59.999Z'),
      status: 'active',
    });
    const writer = appWithActor(teams, base.orgId, ['manage'], base.humanActorId);
    const response = await writer.request(`/${base.teamId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cycleCadenceDays: 1,
        cycleCadenceAnchor: '2026-10-01',
        cycleCadenceRevision: 1,
      }),
    });
    expect(response.status).toBe(409);
  });
});
