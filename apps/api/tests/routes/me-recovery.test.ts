import { beforeAll, describe, expect, it } from 'vitest';

import {
  agedSession,
  appWithSession,
  captureOutbox,
  fakeSession,
  getDb,
  seedUserWithHub,
} from '../support/routes-harness';

/** The migrated db module + the lazily-imported me-recovery router (both memoized). */
async function setup() {
  const schema = await getDb();
  const meRecovery = (await import('../../src/routes/me-recovery')).default;
  return { schema, db: schema.db, meRecovery, outbox: await captureOutbox() };
}

beforeAll(async () => {
  await setup(); // migrate + import once up front
});

describe('GET /me/recovery-codes', () => {
  it('reports disabled with no codes for a fresh user', async () => {
    const { db, schema, meRecovery } = await setup();
    const userId = await seedUserWithHub(db, schema, 'fresh');
    const app = appWithSession(meRecovery, fakeSession(userId));
    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { enabled: boolean; remaining: number };
    expect(body).toEqual({ enabled: false, remaining: 0, generatedAt: null });
  });

  it('401s without a session', async () => {
    const { meRecovery } = await setup();
    const app = appWithSession(meRecovery, null);
    expect((await app.request('/', { method: 'GET' })).status).toBe(401);
  });
});

describe('POST /me/recovery-codes', () => {
  it('generates codes with a fresh session and emails a security notice', async () => {
    const { db, schema, meRecovery, outbox } = await setup();
    const userId = await seedUserWithHub(db, schema, 'Ivy');
    const before = outbox.length;

    const app = appWithSession(meRecovery, fakeSession(userId, 'Ivy', 'ivy@example.com'));
    const res = await app.request('/', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { codes: string[] };
    expect(body.codes.length).toBeGreaterThan(0);

    expect(outbox.length).toBe(before + 1);
    const sent = outbox[outbox.length - 1]!;
    expect(sent.to).toBe('ivy@example.com');
    expect(sent.subject).toContain('regenerated');
  });

  it('rejects a stale (non-fresh) session with reauth_required', async () => {
    const { db, schema, meRecovery } = await setup();
    const userId = await seedUserWithHub(db, schema, 'stale');
    const app = appWithSession(meRecovery, agedSession(userId, 10 * 60_000));
    const res = await app.request('/', { method: 'POST' });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('reauth_required');
  });

  it('401s without a session', async () => {
    const { meRecovery } = await setup();
    const app = appWithSession(meRecovery, null);
    expect((await app.request('/', { method: 'POST' })).status).toBe(401);
  });
});
