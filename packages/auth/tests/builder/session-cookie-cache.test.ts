/**
 * Session cookie response safety for requests that can race an account replacement.
 *
 * @remarks
 * Better Auth 1.6.19 caches user data under a cookie name shared by every account, but it does not
 * bind that payload to the current session-token cookie. These tests keep session reads
 * authoritative and keep read responses from mutating the browser's identity after a newer
 * sign-in response has arrived.
 */
import { resolve } from 'node:path';

import type { Mailer, OutboundMessage } from '@docket/mail';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';
import { assertDefined } from '@docket/test-utils';

// The API env contract rejects a missing turn budget at process validation, and the auth module
// pulls in the fully configured instance. Declare the same test-only budget the sibling builder
// suites do, before that import can happen.
process.env['AGENT_MAX_TURNS'] = '8';
process.env['ATHENA_ASYNC_RUNNER_ENABLED'] = 'false';

/** Swallows verification mail; these flows send, but nothing here reads the outbox. */
const captureMailer: Mailer = {
  send: async (_message: OutboundMessage) => undefined,
};

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
 * The same approach the passkey-guard suite uses: a valid session cookie cannot be
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
  const codes = await generateRecoveryCodes(assertDefined(created).id);

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
    userId: assertDefined(created).id,
    cookie: verified.headers
      .getSetCookie()
      .map((entry) => entry.split(';')[0])
      .join('; '),
  };
}

/**
 * Apply response cookies to a browser-style cookie header in response-arrival order.
 *
 * @param currentCookie - The cookie jar before the response arrives.
 * @param setCookies - The response's individual `Set-Cookie` values.
 * @returns The cookie header after the response has been applied.
 */
function applySetCookieHeaders(currentCookie: string, setCookies: readonly string[]): string {
  const jar = new Map<string, string>();
  for (const pair of currentCookie.split('; ')) {
    const separator = pair.indexOf('=');
    if (separator < 1) continue;
    jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
  for (const setCookie of setCookies) {
    const pair = setCookie.split(';', 1)[0] ?? '';
    const separator = pair.indexOf('=');
    if (separator < 1) continue;
    const name = pair.slice(0, separator);
    if (/;\s*max-age=0(?:;|$)/i.test(setCookie)) jar.delete(name);
    else jar.set(name, pair.slice(separator + 1));
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

/** Return only the signed session-token pair from an auth cookie header. */
function sessionTokenCookie(cookie: string): string {
  return (
    cookie.split('; ').find((pair) => pair.slice(0, pair.indexOf('=')).endsWith('session_token')) ??
    ''
  );
}

describe('session cookie response safety', () => {
  it('does not let a late session payload overwrite a replacement account', async () => {
    const { auth } = await import('../../src/index');
    const accountA = await signIn('late-session-owner-a@example.com');
    const accountB = await signIn('late-session-owner-b@example.com');

    const staleResponse = await auth.handler(
      new Request('http://localhost:4000/api/auth/get-session', {
        headers: { cookie: sessionTokenCookie(accountA.cookie) },
      }),
    );
    expect(staleResponse.status).toBe(200);

    const replacementCookie = applySetCookieHeaders(
      accountB.cookie,
      staleResponse.headers.getSetCookie(),
    );
    const observed = await auth.handler(
      new Request('http://localhost:4000/api/auth/get-session', {
        headers: { cookie: replacementCookie },
      }),
    );

    await expect(observed.json()).resolves.toMatchObject({ user: { id: accountB.userId } });
  });

  it('does not let a late missing-session response delete a replacement account', async () => {
    const { auth } = await import('../../src/index');
    const { db, session: sessionTable } = await import('@docket/db');
    const { eq } = await import('drizzle-orm');
    const accountA = await signIn('late-missing-session-owner-a@example.com');
    const accountB = await signIn('late-missing-session-owner-b@example.com');
    await db.delete(sessionTable).where(eq(sessionTable.userId, accountA.userId));

    const staleResponse = await auth.handler(
      new Request('http://localhost:4000/api/auth/get-session?disableCookieCache=true', {
        headers: { cookie: accountA.cookie },
      }),
    );
    await expect(staleResponse.json()).resolves.toBeNull();

    const replacementCookie = applySetCookieHeaders(
      accountB.cookie,
      staleResponse.headers.getSetCookie(),
    );
    await expect(
      auth.api.getSession({
        headers: new Headers({ cookie: replacementCookie }),
        query: { disableCookieCache: true },
      }),
    ).resolves.toMatchObject({ user: { id: accountB.userId } });
  });

  it('issues no independently replaceable session payload at sign-in', async () => {
    const { auth } = await import('../../src/index');
    const { cookie } = await signIn('cache-issued@example.com');

    expect(cookie).not.toContain('session_data');

    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.user.email).toBe('cache-issued@example.com');
  });

  it('does not authenticate from a cookie after the session row is gone', async () => {
    const { auth } = await import('../../src/index');
    const { db, session: sessionTable, user } = await import('@docket/db');
    const { eq } = await import('drizzle-orm');
    const { userId, cookie } = await signIn('cache-hit@example.com');

    // Delete the row the read would otherwise have to find. A cache miss cannot survive this;
    // a cache hit answers without touching it, which is exactly the request cost being removed.
    await db.delete(sessionTable).where(eq(sessionTable.userId, userId));

    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });

    expect(session).toBeNull();
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

  it('keeps session reads authoritative and free of sliding cookie refreshes', async () => {
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
    expect(cookieCache?.enabled).toBe(false);
    expect(options.session?.disableSessionRefresh).toBe(true);
  });
});
