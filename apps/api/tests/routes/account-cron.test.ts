import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { getDb, one, seedUserWithHub } from '../support/routes-harness';

const AUTH = { authorization: 'Bearer test-cron-secret' };

/** The migrated db module + the lazily-imported cron router (both memoized). */
async function setup() {
  const schema = await getDb();
  const cron = (await import('../../src/routes/cron')).default;
  return { schema, db: schema.db, cron };
}

beforeAll(async () => {
  await setup(); // migrate + import once up front
});

describe('POST /cron/account-deletion-sweep', () => {
  it('401s without the cron secret', async () => {
    const { cron } = await setup();
    expect((await cron.request('/account-deletion-sweep', { method: 'POST' })).status).toBe(401);
  });

  it('purges an account past its grace window', async () => {
    const { db, schema, cron } = await setup();
    const userId = await seedUserWithHub(db, schema, 'purgeme');
    await db
      .update(schema.hub)
      .set({ deletionState: 'pending_deletion', deleteAfterAt: new Date(Date.now() - 86_400_000) })
      .where(eq(schema.hub.userId, userId));

    const res = await cron.request('/account-deletion-sweep', { method: 'POST', headers: AUTH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { swept: boolean; purged: number };
    expect(body.swept).toBe(true);
    expect(body.purged).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(schema.user).where(eq(schema.user.id, userId))).toHaveLength(0);
  });
});

describe('POST /cron/account-export-sweep', () => {
  it('401s without the cron secret', async () => {
    const { cron } = await setup();
    expect((await cron.request('/account-export-sweep', { method: 'POST' })).status).toBe(401);
  });

  it('generates a pending export when authorized', async () => {
    const { db, schema, cron } = await setup();
    const userId = await seedUserWithHub(db, schema, 'exp');
    const job = one(
      await db
        .insert(schema.accountExport)
        .values({ userId })
        .returning({ id: schema.accountExport.id }),
    );

    const res = await cron.request('/account-export-sweep', { method: 'POST', headers: AUTH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { swept: boolean; generated: number };
    expect(body.swept).toBe(true);
    expect(body.generated).toBeGreaterThanOrEqual(1);

    const row = one(
      await db
        .select({ status: schema.accountExport.status })
        .from(schema.accountExport)
        .where(eq(schema.accountExport.id, job.id)),
    );
    expect(row.status).toBe('ready');
  });
});
