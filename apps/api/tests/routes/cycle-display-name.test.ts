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
import { defaultCycleName } from '@docket/types';

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
