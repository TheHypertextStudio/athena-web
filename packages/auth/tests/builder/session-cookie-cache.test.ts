/**
 * Session cookie cache — the read path every authenticated API request pays.
 *
 * @remarks
 * Without the cache, `auth.api.getSession` hits the database on *every* request. That cost is
 * paid per-request, so it multiplies by a page's request fan-out: one entity detail screen issues
 * a dozen parallel reads and therefore a dozen session lookups before any handler runs.
 *
 * Caching the session in a signed cookie removes those lookups, and the trade it makes is
 * explicit and bounded: a session revoked elsewhere keeps validating from the cookie until the
 * cache expires. These tests pin both halves — that the cache genuinely serves reads without the
 * row, and that the authoritative path still refuses a revoked session — so the window is a
 * decision the suite protects rather than an accident.
 */
import { resolve } from 'node:path';

import type { Mailer, OutboundMessage } from '@docket/mail';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';

// The API env contract rejects a missing turn budget at process validation, and the auth module
// pulls in the fully configured instance. Declare the same test-only budget the sibling builder
// suites do, before that import can happen.
process.env['AGENT_MAX_TURNS'] = '8';
process.env['ATHENA_ASYNC_RUNNER_ENABLED'] = 'false';

/** Swallows verification mail; these flows send, but nothing here reads the outbox. */
const captureMailer: Mailer = {
  send: async (_message: OutboundMessage) => undefined,
};
void captureMailer;

beforeAll(async () => {
  const { db } = await import('@docket/db');
  await migrate(db as never, {
    migrationsFolder: resolve(import.meta.dirname, '../../../db/drizzle'),
  });
});

/**
 * Sign a fresh user in through the real recovery-code HTTP flow.
 *
 * @remarks
 * The same approach the passkey-guard suite uses: a genuinely valid session cookie cannot be
 * fabricated for a hand-inserted row, so this drives the already-proven ceremony instead of
 * hand-rolling cookie signing.
 *
 * @param email - The address to create the account under.
 * @returns The user id and the `Cookie` header value for the signed-in session.
 */
async function signIn(email: string): Promise<{ userId: string; cookie: string }> {
  const { auth, generateRecoveryCodes } = await import('../../src/index');
  const { db, user } = await import('@docket/db');

  const [created] = await db.insert(user).values({ name: 'Cached', email }).returning();
  const codes = await generateRecoveryCodes(created!.id);

  const post = (path: string, body: unknown, cookie?: string): Promise<Response> =>
    auth.handler(
      new Request(`http://localhost:4000/api/auth${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost:4000',
          ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify(body),
      }),
    );

  const armed = await post('/two-factor/recovery-challenge', { email });
  const challengeCookie = armed.headers
    .getSetCookie()
    .map((entry) => entry.split(';')[0])
    .join('; ');
  const verified = await post(
    '/two-factor/verify-backup-code',
    { code: codes[0] },
    challengeCookie,
  );

  return {
    userId: created!.id,
    cookie: verified.headers
      .getSetCookie()
      .map((entry) => entry.split(';')[0])
      .join('; '),
  };
}

describe('session cookie cache', () => {
  it('issues a cached session payload alongside the session token at sign-in', async () => {
    const { auth } = await import('../../src/index');
    const { cookie } = await signIn('cache-issued@example.com');

    // The cached payload rides its own cookie; without it every read falls back to the database.
    expect(cookie).toContain('session_data');

    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.email).toBe('cache-issued@example.com');
  });

  it('serves a read from the cookie after the session row is gone', async () => {
    const { auth } = await import('../../src/index');
    const { db, session: sessionTable, user } = await import('@docket/db');
    const { eq } = await import('drizzle-orm');
    const { userId, cookie } = await signIn('cache-hit@example.com');

    // Delete the row the read would otherwise have to find. A cache miss cannot survive this;
    // a cache hit answers without touching it, which is exactly the request cost being removed.
    await db.delete(sessionTable).where(eq(sessionTable.userId, userId));

    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });

    expect(session?.user.id).toBe(userId);
    // Proving the row is genuinely absent, so the read above cannot have come from it.
    const rows = await db.select().from(sessionTable).where(eq(sessionTable.userId, userId));
    expect(rows).toHaveLength(0);
    await db.delete(user).where(eq(user.id, userId));
  });

  it('refuses a revoked session on the authoritative path', async () => {
    const { auth } = await import('../../src/index');
    const { db, session: sessionTable } = await import('@docket/db');
    const { eq } = await import('drizzle-orm');
    const { userId, cookie } = await signIn('cache-bypassed@example.com');

    await db.delete(sessionTable).where(eq(sessionTable.userId, userId));

    // What a revocation-sensitive operation asks for: skip the cache and consult the row.
    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
      query: { disableCookieCache: true },
    });

    expect(session).toBeNull();
  });

  it('bounds the cache window so a revocation cannot go unnoticed for long', async () => {
    const { buildAuthOptions } = await import('../../src/auth-builder');
    const options = buildAuthOptions(
      {
        APP_MODE: 'test',
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_URL: 'http://localhost:4000',
        BETTER_AUTH_PASSKEY_RP_ID: 'localhost',
        BETTER_AUTH_PASSKEY_RP_NAME: 'Docket',
        WEB_URL: 'http://localhost:3000',
      } as never,
      { mailer: captureMailer },
    );

    const cookieCache = options.session?.cookieCache;
    expect(cookieCache?.enabled).toBe(true);
    // A revoked device keeps working for at most this long. Kept tight deliberately: the win is
    // collapsing a page's parallel fan-out onto one lookup, which a short window already achieves.
    expect(cookieCache?.maxAge).toBeLessThanOrEqual(60);
  });
});
