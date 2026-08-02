/**
 * `@docket/api` — the anticipated start date, and what the API refuses to store as a date.
 *
 * @remarks
 * Two requirements meet here. ENT-20 asks that an anticipated start date be settable and that it
 * survive a round trip, distinct from the due date. MISS-02 asks that an invalid date be
 * impossible to persist. The second is what makes the first worth having: a start date you can set
 * to `2026-02-30` is not a field, it is a text box.
 *
 * The date defence has three layers and each is exercised here at the layer it belongs to:
 * the DTO (malformed, impossible, out of range, and a backwards window sent in one request), the
 * route (a backwards window assembled across two requests, which only the pre-image can catch),
 * and the CHECK constraints (see `packages/db/tests/schema/work-constraints.test.ts`, which writes
 * around the API entirely).
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, seedBaseOrg } from '../support/routes-harness';
import type tasksRouter from '../../src/routes/tasks';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let tasks!: typeof tasksRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  tasks = (await import('../../src/routes/tasks')).default;
});

/** The task shape these tests read back. */
interface TaskBody {
  readonly id: string;
  readonly startDate: string | null;
  readonly dueDate: string | null;
}

/** Create a task and return the parsed response body. */
async function createTask(
  app: ReturnType<typeof appWithActor>,
  teamId: string,
  body: Record<string, unknown> = {},
): Promise<TaskBody> {
  const res = await app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Dated work', teamId, ...body }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as TaskBody;
}

/** PATCH a task, returning the status and parsed body without asserting either. */
async function patch(
  app: ReturnType<typeof appWithActor>,
  id: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const res = await app.request(`/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

describe('anticipated start date', () => {
  it('persists, survives a re-fetch, and is distinct from the due date', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);

    const created = await createTask(app, teamId, {
      startDate: '2026-09-10',
      dueDate: '2026-09-30',
    });
    expect(created.startDate?.slice(0, 10)).toBe('2026-09-10');
    expect(created.dueDate?.slice(0, 10)).toBe('2026-09-30');

    // An independent read — the round trip ENT-20 asks for, not the create's own echo.
    const reread = (await (
      await app.request(`/${created.id}`, { method: 'GET' })
    ).json()) as TaskBody;
    expect(reread.startDate?.slice(0, 10)).toBe('2026-09-10');
    expect(reread.dueDate?.slice(0, 10)).toBe('2026-09-30');
  });

  it('can be set, moved and cleared independently of the due date', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const created = await createTask(app, teamId, { dueDate: '2026-09-30' });
    expect(created.startDate).toBeNull();

    expect((await patch(app, created.id, { startDate: '2026-09-01' })).status).toBe(200);
    expect((await patch(app, created.id, { startDate: '2026-09-05' })).status).toBe(200);
    const cleared = await patch(app, created.id, { startDate: null });
    expect(cleared.status).toBe(200);
    // Clearing the anticipated start must not disturb the due date.
    expect((cleared.body as TaskBody).startDate).toBeNull();
    expect((cleared.body as TaskBody).dueDate?.slice(0, 10)).toBe('2026-09-30');
  });
});

describe('an invalid date never reaches storage', () => {
  it.each([
    ['a day that does not exist', '2026-02-30'],
    ['a timestamp where a calendar day is meant', '2026-09-15T00:00:00.000Z'],
    ['a mistyped year', '0226-09-15'],
    ['free text', 'tomorrow'],
  ])('rejects %s with a 422 rather than coercing it', async (_label, value) => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const created = await createTask(app, teamId);

    const result = await patch(app, created.id, { startDate: value });
    expect(result.status).toBe(422);

    // …and the stored value is untouched, not silently coerced to some nearby day.
    const reread = (await (
      await app.request(`/${created.id}`, { method: 'GET' })
    ).json()) as TaskBody;
    expect(reread.startDate).toBeNull();
  });

  it('rejects a create whose window runs backwards, naming the due date', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);

    const res = await app.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Backwards',
        teamId,
        startDate: '2026-09-10',
        dueDate: '2026-09-01',
      }),
    });
    expect(res.status).toBe(422);
    const problem = (await res.json()) as { fieldErrors?: Record<string, unknown> };
    expect(Object.keys(problem.fieldErrors ?? {})).toContain('dueDate');
  });

  it('rejects a window assembled across two requests, which the DTO alone cannot see', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const created = await createTask(app, teamId, { dueDate: '2026-09-01' });

    // Only the route can judge this: the request carries one day and the row holds the other.
    const pushed = await patch(app, created.id, { startDate: '2026-09-10' });
    expect(pushed.status).toBe(422);
    expect(
      Object.keys((pushed.body as { fieldErrors?: Record<string, unknown> }).fieldErrors ?? {}),
    ).toContain('startDate');

    // The stored task is unchanged — a refused edit leaves nothing half-applied.
    const reread = (await (
      await app.request(`/${created.id}`, { method: 'GET' })
    ).json()) as TaskBody;
    expect(reread.startDate).toBeNull();
    expect(reread.dueDate?.slice(0, 10)).toBe('2026-09-01');
  });

  it('allows the same-day window and a widening edit', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const created = await createTask(app, teamId, {
      startDate: '2026-09-10',
      dueDate: '2026-09-10',
    });

    expect((await patch(app, created.id, { dueDate: '2026-10-01' })).status).toBe(200);
    // Clearing the due date lifts the ordering question entirely.
    expect((await patch(app, created.id, { dueDate: null })).status).toBe(200);
    expect((await patch(app, created.id, { startDate: '2027-01-01' })).status).toBe(200);
  });
});
