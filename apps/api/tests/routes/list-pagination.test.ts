/**
 * `@docket/api` — keyset cursor pagination across the org-scoped list endpoints
 * (cycles, programs, initiatives).
 *
 * @remarks
 * Mirrors `harness.test.ts` (pglite + injected actor context). Each endpoint adopted the shared
 * `lib/list-cursor` keyset helper with the backward-compatible `CursorQuery` (optional `limit`):
 * no `limit` returns the full list with no cursor (legacy behavior), and a `limit` returns a
 * bounded page plus a `nextCursor` that walks the remainder without gaps or duplicates.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, seedBaseOrg } from './harness.test';
import type cyclesRouter from '../../src/routes/cycles';
import type initiativesRouter from '../../src/routes/initiatives';
import type programsRouter from '../../src/routes/programs';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let cycles!: typeof cyclesRouter;
let programs!: typeof programsRouter;
let initiatives!: typeof initiativesRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  cycles = (await import('../../src/routes/cycles')).default;
  programs = (await import('../../src/routes/programs')).default;
  initiatives = (await import('../../src/routes/initiatives')).default;
});

/** Parse a JSON response body as the given shape. */
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

interface Page {
  items: { id: string }[];
  nextCursor?: string;
}

/** Walk an endpoint with `limit` from the first page, asserting the union equals `expectedIds`. */
async function assertPagesCover(
  app: ReturnType<typeof appWithActor>,
  limit: number,
  expectedIds: readonly string[],
): Promise<void> {
  const all = await json<Page>(await app.request('/'));
  expect(all.items.map((i) => i.id)).toEqual([...expectedIds]);
  expect(all.nextCursor).toBeUndefined();

  const walked: string[] = [];
  let cursor: string | undefined;
  let guard = 0;
  do {
    const qs = cursor
      ? `/?limit=${limit}&cursor=${encodeURIComponent(cursor)}`
      : `/?limit=${limit}`;
    const page = await json<Page>(await app.request(qs));
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.length).toBeLessThanOrEqual(limit);
    walked.push(...page.items.map((i) => i.id));
    cursor = page.nextCursor;
    if (++guard > 20) throw new Error('pagination did not terminate');
  } while (cursor);

  // The walk reproduces the unpaginated order exactly — no gaps, no duplicates.
  expect(walked).toEqual([...expectedIds]);
}

describe('list pagination (keyset cursor)', () => {
  it('cycles: optional limit pages the roster newest-first', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const [row] = await db
        .insert(schema.cycle)
        .values({
          organizationId: orgId,
          teamId,
          number: i + 1,
          startsAt: new Date(Date.UTC(2026, i, 1)),
          endsAt: new Date(Date.UTC(2026, i, 14)),
          status: 'active',
          createdBy: humanActorId,
        })
        .returning({ id: schema.cycle.id });
      ids.push(row!.id);
    }
    // Newest-first: most-recent start (index 2) leads.
    const newestFirst = [ids[2]!, ids[1]!, ids[0]!];
    await assertPagesCover(appWithActor(cycles, orgId, ['view'], humanActorId), 2, newestFirst);
  });

  it('programs: optional limit pages the list newest-first', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const [row] = await db
        .insert(schema.program)
        .values({
          organizationId: orgId,
          name: `P${i}`,
          createdBy: humanActorId,
          createdAt: new Date(Date.UTC(2026, i, 1)),
        })
        .returning({ id: schema.program.id });
      ids.push(row!.id);
    }
    const newestFirst = [ids[2]!, ids[1]!, ids[0]!];
    await assertPagesCover(appWithActor(programs, orgId, ['view'], humanActorId), 2, newestFirst);
  });

  it('initiatives: optional limit pages the list newest-first', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const [row] = await db
        .insert(schema.initiative)
        .values({
          organizationId: orgId,
          name: `I${i}`,
          createdBy: humanActorId,
          createdAt: new Date(Date.UTC(2026, i, 1)),
        })
        .returning({ id: schema.initiative.id });
      ids.push(row!.id);
    }
    const newestFirst = [ids[2]!, ids[1]!, ids[0]!];
    await assertPagesCover(
      appWithActor(initiatives, orgId, ['view'], humanActorId),
      2,
      newestFirst,
    );
  });
});
