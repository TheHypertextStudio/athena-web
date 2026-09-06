/**
 * `@docket/api` — the derived `CycleOut.displayName` a cycle is rendered by.
 *
 * @remarks
 * Auto-rolled cycles are inserted with no `name` (see `ensureCycleWindow`) and carry an
 * epoch-anchored `number` in the 1,000,000s — the idempotency key of the roll, not a label. Every
 * surface used to fall back to `` `Cycle ${number}` ``, which is where "Cycle 1000137" came from.
 * `toOut` now derives `displayName` on read (author name, else the window), so no cycle row is
 * rewritten and no migration is involved. These tests pin that derivation end-to-end through the
 * real routes, including the auto-rolled rows the roster actually renders.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { defaultCycleName } from '@docket/work/cycle-contract';

import {
  addMember,
  appWithActor,
  appWithSession,
  fakeSession,
  getDb,
  one,
  seedBaseOrg,
  seedOrg,
  seedStatuses,
  seedUserWithHub,
} from '../support/routes-harness';
import type cyclesRouter from '../../src/routes/cycles';
import type timeRouter from '../../src/routes/time';
import type { loadEntityRows as LoadEntityRows } from '../../src/routes/notion-mirror-entities';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let cycles!: typeof cyclesRouter;
let time!: typeof timeRouter;
let loadEntityRows!: typeof LoadEntityRows;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  cycles = (await import('../../src/routes/cycles')).default;
  time = (await import('../../src/routes/time')).default;
  loadEntityRows = (await import('../../src/routes/notion-mirror-entities')).loadEntityRows;
});

/** The meaningless-name shape the requirement forbids anywhere in a rendered payload. */
const RAW_NUMBER_NAME = /Cycle \d{5,}/;

interface CycleDto {
  id: string;
  number: number;
  name: string | null;
  displayName: string;
  startsAt: string;
  endsAt: string;
  isCurrent?: boolean;
}
interface ListDto {
  items: CycleDto[];
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe('cycle displayName', () => {
  it('names every auto-rolled cycle by its window, never by its auto-roll number', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(cycles, orgId, ['view'], humanActorId);

    const body = await json<ListDto>(await app.request('/?roll=true'));
    expect(body.items.length).toBeGreaterThan(1);

    for (const cycle of body.items) {
      // These are the rows the audit found rendering as "Cycle 1000133"–"Cycle 1000141".
      expect(cycle.name).toBeNull();
      expect(cycle.number).toBeGreaterThan(1_000_000);
      expect(cycle.displayName).toBe(defaultCycleName(cycle.startsAt, cycle.endsAt));
      expect(cycle.displayName).not.toMatch(RAW_NUMBER_NAME);
      expect(cycle.displayName).not.toContain(String(cycle.number));
    }

    // Nothing anywhere in the serialized list reads as a raw cycle number.
    expect(JSON.stringify(body)).not.toMatch(RAW_NUMBER_NAME);
  });

  it('reads three consecutive cycles as three distinct, human-meaningful windows', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(cycles, orgId, ['view'], humanActorId);

    const body = await json<ListDto>(await app.request('/?roll=true'));
    const ordered = body.items
      .filter((c) => c.id)
      .sort((a, b) => a.number - b.number)
      .slice(0, 3);
    expect(ordered).toHaveLength(3);

    const names = ordered.map((c) => c.displayName);
    expect(new Set(names).size).toBe(3);
    for (const name of names) {
      // e.g. "Aug 3 – Aug 9" — a month, a day, a spaced en dash, a month, a day.
      expect(name).toMatch(/^[A-Z][a-z]{2} \d{1,2}(, \d{4})? – [A-Z][a-z]{2} \d{1,2}(, \d{4})?$/);
    }
  });

  it('prefers the author-set name and returns to the window when the name is cleared', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(cycles, orgId, ['view', 'contribute'], humanActorId);

    const list = await json<ListDto>(await app.request('/?roll=true'));
    const target = list.items[0];
    if (!target) throw new Error('auto-roll produced no cycles to rename');

    const renamed = await json<CycleDto>(
      await app.request(`/${target.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Launch week' }),
      }),
    );
    expect(renamed.name).toBe('Launch week');
    expect(renamed.displayName).toBe('Launch week');

    const cleared = await json<CycleDto>(
      await app.request(`/${target.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: null }),
      }),
    );
    expect(cleared.name).toBeNull();
    expect(cleared.displayName).toBe(defaultCycleName(cleared.startsAt, cleared.endsAt));
    expect(cleared.displayName).not.toMatch(RAW_NUMBER_NAME);

    // The stored `number` is untouched by any of this — it is the auto-roll's uniqueness key.
    const [row] = await db
      .select({ number: schema.cycle.number })
      .from(schema.cycle)
      .where(and(eq(schema.cycle.id, target.id), eq(schema.cycle.organizationId, orgId)));
    expect(row?.number).toBe(target.number);
  });
});

interface TimeCyclePeriodDto {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string;
}
interface TimeCyclePeriodListDto {
  items: TimeCyclePeriodDto[];
}

describe('GET /v1/time/cycles displayName', () => {
  it('names an unnamed personal time cycle by its window, never by its auto-roll number', async () => {
    const userId = await seedUserWithHub(db, schema, 'TimeCycleDisplayName');
    const orgId = await seedOrg(db, schema);
    await seedStatuses(db, schema, orgId);
    const actorId = await addMember(db, schema, orgId, userId);
    await db.insert(schema.grant).values({
      organizationId: orgId,
      subjectKind: 'actor',
      subjectId: actorId,
      resourceKind: 'organization',
      resourceId: orgId,
      capabilities: ['contribute'],
      effect: 'allow',
      cascades: true,
    });
    const teamId = one(
      await db
        .insert(schema.team)
        .values({
          organizationId: orgId,
          name: 'Core',
          key: `K${Math.random().toString(36).slice(2, 6)}`,
        })
        .returning({ id: schema.team.id }),
    ).id;
    const startsAt = new Date('2026-07-27T00:00:00.000Z');
    const endsAt = new Date('2026-08-02T23:59:59.999Z');
    await db.insert(schema.cycle).values({
      organizationId: orgId,
      teamId,
      number: 1_000_140,
      name: null,
      startsAt,
      endsAt,
      source: 'native',
    });

    const app = appWithSession(time, fakeSession(userId));
    const body = (await (await app.request('/cycles')).json()) as TimeCyclePeriodListDto;

    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.name).toBe(defaultCycleName(startsAt, endsAt));
    expect(JSON.stringify(body)).not.toMatch(RAW_NUMBER_NAME);
  });
});

describe('Notion mirror cycle projection displayName', () => {
  it('names an unnamed cycle by its window in the projected mirror value', async () => {
    const base = await seedBaseOrg(db, schema);
    const integration = one(
      await db
        .insert(schema.integration)
        .values({ organizationId: base.orgId, provider: 'notion', pattern: 'connector' })
        .returning(),
    );
    const startsAt = new Date('2026-12-28T00:00:00.000Z');
    const endsAt = new Date('2027-01-03T23:59:59.999Z');
    const cycleRow = one(
      await db
        .insert(schema.cycle)
        .values({
          organizationId: base.orgId,
          teamId: base.teamId,
          number: 1_000_141,
          name: null,
          startsAt,
          endsAt,
          source: 'native',
        })
        .returning(),
    );

    const rows = await loadEntityRows(base.orgId, integration.id, 'cycle');
    const row = rows.find((candidate) => candidate.entityId === cycleRow.id);
    if (!row) throw new Error('no cycle record projected for the seeded cycle');
    const nameValue = row.values['name'];
    if (nameValue?.kind !== 'text') throw new Error('cycle name projected as a non-text value');

    expect(nameValue.value).toBe(defaultCycleName(startsAt, endsAt));
    expect(nameValue.value).not.toMatch(RAW_NUMBER_NAME);
  });
});
