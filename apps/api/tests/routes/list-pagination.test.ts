/**
 * `@docket/api` — keyset cursor pagination across the org-scoped list endpoints
 * (cycles, programs, initiatives).
 *
 * @remarks
 * Mirrors `harness.test.ts` (pglite + injected actor context). Each endpoint adopted the shared
 * `lib/list-cursor` keyset helper with a default page size of 50 and maximum of 100. A
 * `nextCursor` walks the remainder without gaps or duplicates and is absent at exhaustion.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, seedBaseOrg } from '../support/routes-harness';
import type cyclesRouter from '../../src/routes/cycles';
import type initiativesRouter from '../../src/routes/initiatives';
import type programsRouter from '../../src/routes/programs';
import type projectsRouter from '../../src/routes/projects';
import type tasksRouter from '../../src/routes/tasks';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let cycles!: typeof cyclesRouter;
let programs!: typeof programsRouter;
let initiatives!: typeof initiativesRouter;
let projects!: typeof projectsRouter;
let tasks!: typeof tasksRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  cycles = (await import('../../src/routes/cycles')).default;
  programs = (await import('../../src/routes/programs')).default;
  initiatives = (await import('../../src/routes/initiatives')).default;
  projects = (await import('../../src/routes/projects')).default;
  tasks = (await import('../../src/routes/tasks')).default;
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

/** Walk default-sized pages from the first response and return every encountered id. */
async function walkDefaultPages(app: ReturnType<typeof appWithActor>): Promise<string[]> {
  const walked: string[] = [];
  let cursor: string | undefined;
  let guard = 0;
  do {
    const page = await json<Page>(
      await app.request(cursor ? `/?cursor=${encodeURIComponent(cursor)}` : '/'),
    );
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.length).toBeLessThanOrEqual(50);
    walked.push(...page.items.map((item) => item.id));
    cursor = page.nextCursor;
    if (++guard > 20) throw new Error('default pagination did not terminate');
  } while (cursor);
  return walked;
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
      ids.push(assertDefined(row).id);
    }
    // Newest-first: most-recent start (index 2) leads.
    const newestFirst = [assertDefined(ids[2]), assertDefined(ids[1]), assertDefined(ids[0])];
    await assertPagesCover(appWithActor(cycles, orgId, ['view'], humanActorId), 2, newestFirst);
  });

  it('programs: the omitted limit defaults to 50 and timestamp ties use id descending', async () => {
    const { orgId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const createdAt = new Date('2026-09-01T00:00:00.000Z');
    const rows = await db
      .insert(schema.program)
      .values(
        Array.from({ length: 101 }, (_, index) => ({
          organizationId: orgId,
          name: `P${index.toString().padStart(3, '0')}`,
          createdBy: humanActorId,
          createdAt,
          status: 'active',
          statusId: statusId('program', 'active'),
        })),
      )
      .returning({ id: schema.program.id });
    const expected = rows.map((row) => row.id).sort((left, right) => right.localeCompare(left));
    const app = appWithActor(programs, orgId, ['view'], humanActorId);

    const first = await json<Page>(await app.request('/'));
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).toEqual(expect.any(String));
    expect(await walkDefaultPages(app)).toEqual(expected);

    const tooLarge = await app.request('/?limit=101');
    expect(tooLarge.status).toBe(422);

    const malformed = await app.request('/?cursor=not-a-real-cursor');
    expect(malformed.status).toBe(422);
    expect(await json<{ code: string }>(malformed)).toMatchObject({ code: 'validation_error' });
  });

  it('initiatives: optional limit pages the list newest-first', async () => {
    const { orgId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const [row] = await db
        .insert(schema.initiative)
        .values({
          organizationId: orgId,
          name: `I${i}`,
          createdBy: humanActorId,
          createdAt: new Date(Date.UTC(2026, i, 1)),
          status: 'active',
          statusId: statusId('initiative', 'active'),
        })
        .returning({ id: schema.initiative.id });
      ids.push(assertDefined(row).id);
    }
    const newestFirst = [assertDefined(ids[2]), assertDefined(ids[1]), assertDefined(ids[0])];
    await assertPagesCover(
      appWithActor(initiatives, orgId, ['view'], humanActorId),
      2,
      newestFirst,
    );
  });

  it('projects: optional limit pages the list newest-first', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const [row] = await db
        .insert(schema.project)
        .values({
          organizationId: orgId,
          name: `Proj${i}`,
          teamId,
          createdBy: humanActorId,
          createdAt: new Date(Date.UTC(2026, i, 1)),
          status: 'planned',
          statusId: statusId('project', 'planned'),
        })
        .returning({ id: schema.project.id });
      ids.push(assertDefined(row).id);
    }
    const newestFirst = [assertDefined(ids[2]), assertDefined(ids[1]), assertDefined(ids[0])];
    await assertPagesCover(appWithActor(projects, orgId, ['view'], humanActorId), 2, newestFirst);
  });

  it('tasks: optional limit pages the active-task list newest-first', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const [row] = await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          title: `T${i}`,
          teamId,
          state: 'todo',
          createdBy: humanActorId,
          createdAt: new Date(Date.UTC(2026, i, 1)),
          statusId: statusId('task', 'todo'),
        })
        .returning({ id: schema.task.id });
      ids.push(assertDefined(row).id);
    }
    const newestFirst = [assertDefined(ids[2]), assertDefined(ids[1]), assertDefined(ids[0])];
    await assertPagesCover(appWithActor(tasks, orgId, ['view'], humanActorId), 2, newestFirst);
  });
});
