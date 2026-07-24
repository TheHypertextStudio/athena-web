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

describe('POST /cron/expired-sessions-sweep', () => {
  it('401s without the cron secret', async () => {
    const { cron } = await setup();
    expect((await cron.request('/expired-sessions-sweep', { method: 'POST' })).status).toBe(401);
  });

  it('deletes only session rows past their expiresAt', async () => {
    const { db, schema, cron } = await setup();
    const userId = await seedUserWithHub(db, schema, 'sweep-target');
    const expired = one(
      await db
        .insert(schema.session)
        .values({
          userId,
          token: `tok-expired-${Math.random().toString(36).slice(2)}`,
          expiresAt: new Date(Date.now() - 3600_000),
        })
        .returning({ id: schema.session.id }),
    );
    const live = one(
      await db
        .insert(schema.session)
        .values({
          userId,
          token: `tok-live-${Math.random().toString(36).slice(2)}`,
          expiresAt: new Date(Date.now() + 3600_000),
        })
        .returning({ id: schema.session.id }),
    );

    const res = await cron.request('/expired-sessions-sweep', { method: 'POST', headers: AUTH });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { swept: boolean; deleted: number };
    expect(body.swept).toBe(true);
    expect(body.deleted).toBeGreaterThanOrEqual(1);

    expect(
      await db.select().from(schema.session).where(eq(schema.session.id, expired.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(schema.session).where(eq(schema.session.id, live.id)),
    ).toHaveLength(1);
  });

  it('is idempotent — a second sweep with nothing new to delete still succeeds', async () => {
    const { cron } = await setup();
    const first = await cron.request('/expired-sessions-sweep', { method: 'POST', headers: AUTH });
    expect(first.status).toBe(200);
    const second = await cron.request('/expired-sessions-sweep', { method: 'POST', headers: AUTH });
    expect(second.status).toBe(200);
    const body = (await second.json()) as { swept: boolean };
    expect(body.swept).toBe(true);
  });
});
