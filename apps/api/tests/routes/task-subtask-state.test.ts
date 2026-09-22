/**
 * `@docket/api` — the workflow state a new subtask starts in.
 *
 * @remarks
 * Mirrors `routes-harness` (pglite + injected actor context). The rest of the subtask route's
 * coverage lives in `tasks-detail.test.ts`.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, seedTaskAccessOrg as seedBaseOrg } from '../support/routes-harness';
import type tasksRouter from '../../src/routes/tasks';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let tasks!: typeof tasksRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  tasks = (await import('../../src/routes/tasks')).default;
});

/** The slice of a task response these tests read. */
interface StateOut {
  readonly id: string;
  readonly state: string;
}

/** POST a JSON body through the router and return the parsed 201 response. */
async function postCreated(
  app: ReturnType<typeof appWithActor>,
  path: string,
  body: Record<string, unknown>,
): Promise<StateOut> {
  const res = await app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as StateOut;
}

describe('POST /:id/subtasks state', () => {
  it("lands a new subtask in the team's first state, not the parent's", async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const reference = await postCreated(writer, '/', { title: 'Reference', teamId });
    const parent = await postCreated(writer, '/', { title: 'Parent', teamId, state: 'done' });

    const sub = await postCreated(writer, `/${parent.id}/subtasks`, { title: 'Sub' });

    expect(sub.state).toBe(reference.state);
    expect(sub.state).not.toBe(parent.state);
  });

  it('creates a subtask in an explicitly requested state', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const parent = await postCreated(writer, '/', { title: 'Parent', teamId });

    const sub = await postCreated(writer, `/${parent.id}/subtasks`, {
      title: 'Sub',
      state: 'in_progress',
    });

    expect(sub.state).toBe('in_progress');
  });
});
