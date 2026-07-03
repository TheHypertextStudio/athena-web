import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { enqueueSearchIndexJob } from '../../src/search/enqueue';
import { getDb, one, seedBaseOrg } from './harness.test';

const AUTH = { authorization: 'Bearer test-cron-secret' };

/** The migrated db module + the lazily-imported cron router. */
async function setup() {
  const schema = await getDb();
  const cron = (await import('../../src/routes/cron')).default;
  return { schema, db: schema.db, cron };
}

beforeAll(async () => {
  await setup();
});

describe('POST /cron/search-index', () => {
  it('401s without the cron secret', async () => {
    const { cron } = await setup();
    expect((await cron.request('/search-index', { method: 'POST' })).status).toBe(401);
  });

  it('processes pending search-index jobs when authorized', async () => {
    const { db, schema, cron } = await setup();
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const taskRow = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Cron indexed task',
          description: 'Cron search body',
          state: 'todo',
          visibility: 'public',
        })
        .returning(),
    );
    await enqueueSearchIndexJob({
      organizationId: orgId,
      sourceTable: 'task',
      entityId: taskRow.id,
      operation: 'upsert',
      reason: 'entity_write',
    });

    const res = await cron.request('/search-index', { method: 'POST', headers: AUTH });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { swept: boolean; processed: number; succeeded: number };
    expect(body).toMatchObject({ swept: true, processed: 1, succeeded: 1 });
    const docs = await db
      .select()
      .from(schema.searchDocument)
      .where(eq(schema.searchDocument.entityId, taskRow.id));
    expect(docs).toHaveLength(1);
  });
});
