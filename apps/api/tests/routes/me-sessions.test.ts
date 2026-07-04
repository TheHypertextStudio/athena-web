import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type { AuthSession } from '../../src/context';
import { appWithSession, fakeSession, getDb, seedUserWithHub } from './harness.test';

/** The migrated db module + the lazily-imported me-sessions router (both memoized). */
async function setup() {
  const schema = await getDb();
  const meSessions = (await import('../../src/routes/me-sessions')).default;
  return { schema, db: schema.db, meSessions };
}

beforeAll(async () => {
  await setup(); // migrate + import once up front
});

/**
 * A {@link fakeSession} with a unique token instead of the harness's fixed `'tok'` — the
 * `session.token` column is globally unique, so a shared-DB test file needs a distinct token per
 * test whenever it seeds a real row backing the "current" session.
 */
function currentSession(userId: string): NonNullable<AuthSession> {
  const base = fakeSession(userId)!;
  return {
    ...base,
    session: { ...base.session, token: `tok-${Math.random().toString(36).slice(2)}` },
  };
}

/** Insert an extra session row for a user (the fake current session isn't a real DB row). */
async function seedSessionRow(
  db: Awaited<ReturnType<typeof setup>>['db'],
  schema: Awaited<ReturnType<typeof setup>>['schema'],
  userId: string,
  overrides: Partial<{ token: string; ipAddress: string; userAgent: string }> = {},
): Promise<string> {
  const [row] = await db
    .insert(schema.session)
    .values({
      userId,
      token: overrides.token ?? `tok-${Math.random().toString(36).slice(2)}`,
      expiresAt: new Date(Date.now() + 3600_000),
      ipAddress: overrides.ipAddress ?? '203.0.113.5',
      userAgent: overrides.userAgent ?? 'Mozilla/5.0 (Macintosh) Chrome/120.0 Safari/537.36',
    })
    .returning({ id: schema.session.id });
  return row!.id;
}

describe('GET /me/sessions', () => {
  it('lists every session for the caller, marking the current one', async () => {
    const { db, schema, meSessions } = await setup();
    const userId = await seedUserWithHub(db, schema, 'lister');
    const current = currentSession(userId);
    // The fake session's token isn't a real row until we seed one that matches it.
    await seedSessionRow(db, schema, userId, { token: current.session.token });
    await seedSessionRow(db, schema, userId);

    const app = appWithSession(meSessions, current);
    const res = await app.request('/', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string; current: boolean }[] };
    expect(body.items).toHaveLength(2);
    expect(body.items.filter((s) => s.current)).toHaveLength(1);
  });

  it('never returns another user’s sessions', async () => {
    const { db, schema, meSessions } = await setup();
    const userId = await seedUserWithHub(db, schema, 'me');
    const otherId = await seedUserWithHub(db, schema, 'other');
    await seedSessionRow(db, schema, otherId);

    const app = appWithSession(meSessions, fakeSession(userId));
    const body = (await (await app.request('/', { method: 'GET' })).json()) as {
      items: unknown[];
    };
    expect(body.items).toEqual([]);
  });

  it('401s without a session', async () => {
    const { meSessions } = await setup();
    const app = appWithSession(meSessions, null);
    expect((await app.request('/', { method: 'GET' })).status).toBe(401);
  });
});

describe('POST /me/sessions/:id/revoke', () => {
  it('revokes another of the caller’s sessions', async () => {
    const { db, schema, meSessions } = await setup();
    const userId = await seedUserWithHub(db, schema, 'revoker');
    const current = currentSession(userId);
    await seedSessionRow(db, schema, userId, { token: current.session.token });
    const otherId = await seedSessionRow(db, schema, userId);

    const app = appWithSession(meSessions, current);
    const res = await app.request(`/${otherId}/revoke`, { method: 'POST' });
    expect(res.status).toBe(200);

    const remaining = await db
      .select()
      .from(schema.session)
      .where(eq(schema.session.userId, userId));
    expect(remaining.map((r) => r.id)).not.toContain(otherId);
  });

  it('409s trying to revoke the current session', async () => {
    const { db, schema, meSessions } = await setup();
    const userId = await seedUserWithHub(db, schema, 'self-revoker');
    const current = currentSession(userId);
    const currentId = await seedSessionRow(db, schema, userId, { token: current.session.token });

    const app = appWithSession(meSessions, current);
    const res = await app.request(`/${currentId}/revoke`, { method: 'POST' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('current_session');
  });

  it('404s for an unknown or cross-user session id', async () => {
    const { db, schema, meSessions } = await setup();
    const userId = await seedUserWithHub(db, schema, 'guesser');
    const otherId = await seedUserWithHub(db, schema, 'victim');
    const victimSessionId = await seedSessionRow(db, schema, otherId);

    const app = appWithSession(meSessions, fakeSession(userId));
    const res = await app.request(`/${victimSessionId}/revoke`, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});

describe('POST /me/sessions/revoke-others', () => {
  it('revokes every session except the current one', async () => {
    const { db, schema, meSessions } = await setup();
    const userId = await seedUserWithHub(db, schema, 'sweeper');
    const current = currentSession(userId);
    await seedSessionRow(db, schema, userId, { token: current.session.token });
    await seedSessionRow(db, schema, userId);
    await seedSessionRow(db, schema, userId);

    const app = appWithSession(meSessions, current);
    const res = await app.request('/revoke-others', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { current: boolean }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.current).toBe(true);

    const remaining = await db
      .select()
      .from(schema.session)
      .where(eq(schema.session.userId, userId));
    expect(remaining).toHaveLength(1);
  });
});
