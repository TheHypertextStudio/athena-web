/**
 * `@docket/api` — cycle auto-roll route tests: the lazy rolling-window generation and
 * date-derived "current" cycle exposed by `GET /current?teamId=…`, plus the `isCurrent`
 * flag surfaced on the list read.
 *
 * @remarks
 * DECISION (product): cycles auto-roll on a configurable cadence
 * (`team.cycle_cadence_weeks`, default 1 = weekly) so the user never creates them by
 * hand. These tests cover the generation idempotency, current-by-date selection, and
 * cadence stepping; manual create/list/patch/close coverage lives in `group-a` and
 * `cycles-detail`.
 */
import { and, eq } from 'drizzle-orm';
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

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

// A valid ULID-shaped id that no seeded row uses.
const MISSING_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

interface CycleDto {
  id: string;
  teamId: string;
  number: number;
  startsAt: string;
  endsAt: string;
  status: string;
  isCurrent?: boolean;
}
interface WindowDto {
  teamId: string;
  cadenceWeeks: number;
  current: CycleDto | null;
  cycles: CycleDto[];
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Insert a team with an explicit cadence; returns its id. */
async function makeTeam(orgId: string, cadenceWeeks: number): Promise<string> {
  const [row] = await db
    .insert(schema.team)
    .values({
      organizationId: orgId,
      name: 'Cadence',
      key: `K${Math.random().toString(36).slice(2, 7)}`,
      cycleCadenceWeeks: cadenceWeeks,
    })
    .returning({ id: schema.team.id });
  return row!.id;
}

/** Count the cycles stored for a team. */
async function countCycles(orgId: string, teamId: string): Promise<number> {
  const rows = await db
    .select({ id: schema.cycle.id })
    .from(schema.cycle)
    .where(and(eq(schema.cycle.teamId, teamId), eq(schema.cycle.organizationId, orgId)));
  return rows.length;
}

describe('cycle auto-roll (GET /current)', () => {
  it('lazily generates a rolling window and derives the current cycle by date', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    // Nothing exists up front — the window is generated on demand.
    expect(await countCycles(orgId, teamId)).toBe(0);

    const writer = appWithActor(cycles, orgId, ['view'], humanActorId);
    const res = await writer.request(`/current?teamId=${teamId}`);
    expect(res.status).toBe(200);
    const body = await json<WindowDto>(res);

    expect(body.teamId).toBe(teamId);
    expect(body.cadenceWeeks).toBe(1); // seedBaseOrg's team defaults to weekly
    expect(body.cycles.length).toBeGreaterThan(1);

    // Exactly one cycle is current, and it's the one returned as `current`.
    const currentFlags = body.cycles.filter((c) => c.isCurrent === true);
    expect(currentFlags).toHaveLength(1);
    expect(body.current).not.toBeNull();
    expect(body.current!.id).toBe(currentFlags[0]!.id);
    expect(body.current!.isCurrent).toBe(true);

    // "Now" really falls inside the current window.
    const now = Date.now();
    expect(now).toBeGreaterThanOrEqual(new Date(body.current!.startsAt).getTime());
    expect(now).toBeLessThanOrEqual(new Date(body.current!.endsAt).getTime());

    // The window's cycles are gap-free weekly tiles ordered by number.
    const sorted = [...body.cycles].sort((a, b) => a.number - b.number);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i]!.number - sorted[i - 1]!.number).toBe(1);
      expect(
        new Date(sorted[i]!.startsAt).getTime() - new Date(sorted[i - 1]!.startsAt).getTime(),
      ).toBe(WEEK_MS);
    }
  });

  it('is idempotent: re-requesting the window never duplicates cycles', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(cycles, orgId, ['view'], humanActorId);

    const first = await json<WindowDto>(await writer.request(`/current?teamId=${teamId}`));
    const countAfterFirst = await countCycles(orgId, teamId);
    expect(countAfterFirst).toBe(first.cycles.length);

    // A second (and third) call generates nothing new.
    const second = await json<WindowDto>(await writer.request(`/current?teamId=${teamId}`));
    await writer.request(`/current?teamId=${teamId}`);

    expect(await countCycles(orgId, teamId)).toBe(countAfterFirst);
    expect(second.cycles.map((c) => c.id).sort()).toEqual(first.cycles.map((c) => c.id).sort());
    // The same window resolves the same current cycle each time.
    expect(second.current!.id).toBe(first.current!.id);
  });

  it('steps the window by the team cadence (a 2-week team tiles 14 days apart)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const teamId = await makeTeam(orgId, 2);
    const writer = appWithActor(cycles, orgId, ['view'], humanActorId);

    const body = await json<WindowDto>(await writer.request(`/current?teamId=${teamId}`));
    expect(body.cadenceWeeks).toBe(2);

    const sorted = [...body.cycles].sort((a, b) => a.number - b.number);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(
        new Date(sorted[i]!.startsAt).getTime() - new Date(sorted[i - 1]!.startsAt).getTime(),
      ).toBe(2 * WEEK_MS);
    }
    // Each 2-week window spans 14 days minus one ms, and exactly one is current.
    const cur = body.cycles.find((c) => c.isCurrent);
    expect(cur).toBeDefined();
    expect(new Date(cur!.endsAt).getTime() - new Date(cur!.startsAt).getTime()).toBe(
      2 * WEEK_MS - 1,
    );
  });

  it('leaves manual cycles untouched and includes them in the window read', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    // A manually-created cycle with a number far outside the auto-rolled window.
    const [manual] = await db
      .insert(schema.cycle)
      .values({
        organizationId: orgId,
        teamId,
        number: 5,
        name: 'Manual',
        startsAt: new Date('2020-01-06T00:00:00.000Z'),
        endsAt: new Date('2020-01-12T00:00:00.000Z'),
        status: 'completed',
        createdBy: humanActorId,
      })
      .returning({ id: schema.cycle.id });

    const writer = appWithActor(cycles, orgId, ['view'], humanActorId);
    const body = await json<WindowDto>(await writer.request(`/current?teamId=${teamId}`));

    // The manual cycle is still present and is NOT the current one (its dates are old).
    const manualOut = body.cycles.find((c) => c.id === manual!.id);
    expect(manualOut).toBeDefined();
    expect(manualOut!.isCurrent).toBe(false);
    expect(body.current!.id).not.toBe(manual!.id);

    // Its stored fields are unchanged.
    const [row] = await db
      .select({ name: schema.cycle.name, status: schema.cycle.status, number: schema.cycle.number })
      .from(schema.cycle)
      .where(eq(schema.cycle.id, manual!.id));
    expect(row).toEqual({ name: 'Manual', status: 'completed', number: 5 });
  });

  it('breaks a tie deterministically: the earliest-starting overlapping cycle wins', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const now = Date.now();
    // Two manual cycles that BOTH contain "now" but start at different instants. The
    // earlier-starting one must be chosen as `current`. (Auto-rolled windows never
    // overlap, but a hand-created cycle can; the selection stays deterministic.)
    const earlier = await db
      .insert(schema.cycle)
      .values({
        organizationId: orgId,
        teamId,
        number: 7,
        startsAt: new Date(now - 10 * DAY_MS),
        endsAt: new Date(now + 10 * DAY_MS),
        status: 'active',
        createdBy: humanActorId,
      })
      .returning({ id: schema.cycle.id });
    const later = await db
      .insert(schema.cycle)
      .values({
        organizationId: orgId,
        teamId,
        number: 8,
        startsAt: new Date(now - 2 * DAY_MS),
        endsAt: new Date(now + 2 * DAY_MS),
        status: 'active',
        createdBy: humanActorId,
      })
      .returning({ id: schema.cycle.id });

    const writer = appWithActor(cycles, orgId, ['view'], humanActorId);
    const body = await json<WindowDto>(await writer.request(`/current?teamId=${teamId}`));

    // Both manual cycles flag as current, but `current` resolves to the earlier start.
    const flagged = body.cycles.filter((c) => c.id === earlier[0]!.id || c.id === later[0]!.id);
    expect(flagged.every((c) => c.isCurrent === true)).toBe(true);
    expect(body.current!.id).toBe(earlier[0]!.id);
  });

  it('404s for a team that is not in the org', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(cycles, orgId, ['view'], humanActorId);
    expect((await writer.request(`/current?teamId=${MISSING_ULID}`)).status).toBe(404);
  });

  it("404s for another org's team (tenant isolation)", async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    const writerB = appWithActor(cycles, b.orgId, ['view'], b.humanActorId);
    expect((await writerB.request(`/current?teamId=${a.teamId}`)).status).toBe(404);
  });

  it('422s when teamId is missing', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(cycles, orgId, ['view'], humanActorId);
    expect((await writer.request('/current')).status).toBe(422);
  });
});

/** Seed a `linear` integration row with the given status; returns its id. */
async function makeIntegration(orgId: string, status: 'connected' | 'error' | 'disconnected') {
  const [row] = await db
    .insert(schema.integration)
    .values({ organizationId: orgId, provider: 'linear', pattern: 'connector', status })
    .returning({ id: schema.integration.id });
  return row!.id;
}

/** Seed one `linked` (mirrored) cycle for a team, sourced from the given integration. */
async function makeLinkedCycle(orgId: string, teamId: string, integrationId: string, number = 1) {
  await db.insert(schema.cycle).values({
    organizationId: orgId,
    teamId,
    number,
    source: 'linked',
    sourceIntegrationId: integrationId,
    externalId: `lin-cycle-${teamId}-${number}`,
    startsAt: new Date('2026-01-01T00:00:00.000Z'),
    endsAt: new Date('2026-01-08T00:00:00.000Z'),
    status: 'active',
  });
}

describe('cycle auto-roll defers to an active linked (mirrored) provider', () => {
  it('a team with a linked cycle from an ACTIVE integration never gets a native auto-rolled cycle', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await makeIntegration(orgId, 'connected');
    await makeLinkedCycle(orgId, teamId, integrationId);

    const writer = appWithActor(cycles, orgId, ['view'], humanActorId);
    const body = await json<WindowDto>(await writer.request(`/current?teamId=${teamId}`));

    // Only the seeded linked cycle exists — the native roll inserted nothing.
    expect(body.cycles).toHaveLength(1);
    expect(await countCycles(orgId, teamId)).toBe(1);
  });

  it('an `error` integration ALSO defers cadence (not just `connected`)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await makeIntegration(orgId, 'error');
    await makeLinkedCycle(orgId, teamId, integrationId);

    const writer = appWithActor(cycles, orgId, ['view'], humanActorId);
    const body = await json<WindowDto>(await writer.request(`/current?teamId=${teamId}`));
    expect(body.cycles).toHaveLength(1);
    expect(await countCycles(orgId, teamId)).toBe(1);
  });

  it('a DISCONNECTED integration does NOT defer cadence — the team reverts to native auto-roll', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const integrationId = await makeIntegration(orgId, 'disconnected');
    await makeLinkedCycle(orgId, teamId, integrationId);

    const writer = appWithActor(cycles, orgId, ['view'], humanActorId);
    const body = await json<WindowDto>(await writer.request(`/current?teamId=${teamId}`));

    // The native window rolled normally alongside the (now-orphaned) linked cycle.
    expect(body.cycles.length).toBeGreaterThan(1);
  });

  it('a sibling team in the same org with no linked cycles is unaffected and still rolls', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const otherTeamId = await makeTeam(orgId, 1);
    const integrationId = await makeIntegration(orgId, 'connected');
    await makeLinkedCycle(orgId, teamId, integrationId);

    const writer = appWithActor(cycles, orgId, ['view'], humanActorId);
    const linkedWindow = await json<WindowDto>(await writer.request(`/current?teamId=${teamId}`));
    expect(linkedWindow.cycles).toHaveLength(1);

    const otherWindow = await json<WindowDto>(
      await writer.request(`/current?teamId=${otherTeamId}`),
    );
    expect(otherWindow.cycles.length).toBeGreaterThan(1);
  });
});

describe('cycle list surfaces isCurrent', () => {
  it('flags the date-current cycle in the GET / list', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(cycles, orgId, ['view'], humanActorId);

    // Generate the rolling window first, then list.
    await writer.request(`/current?teamId=${teamId}`);
    const list = await json<{ items: CycleDto[] }>(await writer.request('/'));

    const current = list.items.filter((c) => c.isCurrent === true);
    expect(current).toHaveLength(1);
    const now = Date.now();
    expect(now).toBeGreaterThanOrEqual(new Date(current[0]!.startsAt).getTime());
    expect(now).toBeLessThanOrEqual(new Date(current[0]!.endsAt).getTime());
  });
});
