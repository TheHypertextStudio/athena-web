/**
 * How the saved-views routes behave when a stored row outlives the contract that wrote it.
 *
 * @remarks
 * Three tables store work-view definitions as JSON against `.strict()` schemas whose field enums are
 * built from the contract literal, so a field rename makes every row that referenced it unparseable
 * the moment the new code deploys. The list route is unpaginated and org-wide, which made one such
 * row an outage for every member who could see it. These pin the agreed answer: a row the current
 * contract cannot represent is treated as absent everywhere, consistently, and is never deleted —
 * a backfill can only repair bytes that still exist.
 */
import { and, eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, seedBaseOrg } from '../support/routes-harness';
import { projectRequest } from '../work-views/request-fixtures';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let savedViews!: unknown;

const J = { 'content-type': 'application/json' };

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  savedViews = (await import('../../src/routes/saved-views')).default;
});

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/** Create a valid Project view, then rewrite its stored definition the way a rename leaves it. */
async function seedStaleView(
  app: ReturnType<typeof appWithActor>,
  position: string,
): Promise<string> {
  const response = await app.request('/', {
    method: 'POST',
    headers: J,
    body: JSON.stringify({
      name: 'Stale project view',
      target: 'project',
      context: { kind: 'organization' },
      position,
      definition: projectRequest().definition,
    }),
  });
  expect(response.status).toBe(201);
  const { id } = await body<{ id: string }>(response);
  await db.execute(sql`
    update saved_view
    set definition = ${JSON.stringify({ ...projectRequest().definition, retiredField: 'gone' })}::jsonb
    where id = ${id}
  `);
  return id;
}

describe('saved views with a stale stored definition', () => {
  it('lists the views that still parse instead of failing the whole list', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(savedViews, orgId, ['contribute'], humanActorId);
    const createResponse = await writer.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        name: 'Current project view',
        target: 'project',
        context: { kind: 'organization' },
        position: 'p0',
        definition: projectRequest().definition,
      }),
    });
    expect(createResponse.status).toBe(201);
    const current = await body<{ id: string }>(createResponse);
    await seedStaleView(writer, 'p1');

    const listResponse = await writer.request('/');
    expect(listResponse.status).toBe(200);
    const list = await body<{ items: { id: string }[] }>(listResponse);
    expect(list.items.map((item) => item.id)).toEqual([current.id]);
  });

  it('answers as absent by id rather than blaming the caller for the stored row', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(savedViews, orgId, ['contribute'], humanActorId);
    const staleId = await seedStaleView(writer, 'p0');

    // 422 here told a client holding a bookmarked id that *it* had sent something wrong, about a
    // row the list had already stopped admitting exists.
    expect((await writer.request(`/${staleId}`)).status).toBe(404);
  });

  it('keeps the stored row when a delete cannot be represented', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(savedViews, orgId, ['contribute'], humanActorId);
    const staleId = await seedStaleView(writer, 'p0');

    expect((await writer.request(`/${staleId}`, { method: 'DELETE' })).status).toBe(404);

    // Serializing after the delete removed the row and the search entry and *then* answered 422,
    // so the caller was told the delete failed while it had already happened.
    const remaining = await db
      .select({ id: schema.savedView.id })
      .from(schema.savedView)
      .where(and(eq(schema.savedView.id, staleId), eq(schema.savedView.organizationId, orgId)));
    expect(remaining).toHaveLength(1);
  });
});
