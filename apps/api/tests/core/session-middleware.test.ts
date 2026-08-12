/**
 * The session middleware — the read every authenticated request pays before any handler runs.
 *
 * @remarks
 * Session resolution is served from a signed cookie (see `SESSION_COOKIE_CACHE_MAX_AGE_S` in
 * `packages/auth/src/auth-builder.ts`). Two behaviors keep that cache worth having, and both are
 * easy to lose in a refactor, so they are pinned here: the middleware must forward the refreshed
 * cookie Better Auth hands back — otherwise the cache expires once and every later request falls
 * back to the database forever — and it must not re-resolve on Better Auth's own routes, which
 * resolve and set their session cookies themselves.
 */
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppEnv } from '../../src/context';

const getSession = vi.fn();

vi.mock('@docket/auth', () => ({
  auth: {
    api: {
      get getSession() {
        return getSession;
      },
    },
  },
}));

const { authoritativeSessionMiddleware, readAuthoritativeSession, sessionMiddleware } =
  await import('../../src/auth/session-middleware');

/** A resolved session shaped like Better Auth's, with only the fields under test. */
const SESSION = { session: { id: 's1' }, user: { id: 'u1' } };

/** Build a bare app carrying only the middleware, echoing what it resolved. */
function app(): Hono<AppEnv> {
  const server = new Hono<AppEnv>();
  server.use('*', sessionMiddleware);
  server.all('*', (c) =>
    c.json({ userId: (c.get('session') as unknown as typeof SESSION | null)?.user.id }),
  );
  return server;
}

beforeEach(() => {
  getSession.mockReset();
});

describe('sessionMiddleware', () => {
  it('resolves the session and exposes it to handlers', async () => {
    getSession.mockResolvedValue({ headers: new Headers(), response: SESSION });

    const res = await app().request('/v1/orgs/o1/projects');

    expect(await res.json()).toEqual({ userId: 'u1' });
  });

  it('forwards the refreshed session cookie so the cache does not expire once and stay cold', async () => {
    const headers = new Headers();
    headers.append('set-cookie', 'session_data=refreshed; Path=/; HttpOnly');
    getSession.mockResolvedValue({ headers, response: SESSION });

    const res = await app().request('/v1/orgs/o1/projects');

    expect(res.headers.getSetCookie()).toContain('session_data=refreshed; Path=/; HttpOnly');
  });

  it('leaves Better Auth its own routes rather than resolving them a second time', async () => {
    const res = await app().request('/api/auth/get-session');

    expect(getSession).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ userId: undefined });
  });

  it('carries a null session through when nothing is signed in', async () => {
    getSession.mockResolvedValue({ headers: new Headers(), response: null });

    const res = await app().request('/v1/orgs/o1/projects');

    expect(await res.json()).toEqual({ userId: undefined });
  });
});

describe('readAuthoritativeSession', () => {
  it('bypasses the cookie cache so a revoked session cannot answer for it', async () => {
    getSession.mockResolvedValue(null);
    const server = new Hono<AppEnv>();
    server.all('*', async (c) => c.json({ session: await readAuthoritativeSession(c) }));

    const res = await server.request('/v1/me/sessions/s1/revoke', { method: 'POST' });

    expect(await res.json()).toEqual({ session: null });
    expect(getSession).toHaveBeenCalledWith(
      expect.objectContaining({ query: { disableCookieCache: true } }),
    );
  });

  it('returns the live session when the row is still there', async () => {
    getSession.mockResolvedValue(SESSION);
    const server = new Hono<AppEnv>();
    server.all('*', async (c) => c.json({ session: await readAuthoritativeSession(c) }));

    const res = await server.request('/v1/me/account');

    expect(await res.json()).toEqual({ session: SESSION });
  });
});

describe('authoritativeSessionMiddleware', () => {
  /** Build a bare app carrying only the authoritative middleware, echoing what it resolved. */
  function guarded(): Hono<AppEnv> {
    const server = new Hono<AppEnv>();
    server.use('*', authoritativeSessionMiddleware);
    server.all('*', (c) =>
      c.json({ userId: (c.get('session') as unknown as typeof SESSION | null)?.user.id }),
    );
    return server;
  }

  it('replaces a cached session with the live one so a revoked caller is refused', async () => {
    getSession.mockResolvedValue(null);

    const res = await guarded().request('/v1/me/sessions');

    expect(await res.json()).toEqual({ userId: undefined });
  });

  it('leaves a still-valid caller signed in', async () => {
    getSession.mockResolvedValue(SESSION);

    const res = await guarded().request('/v1/me/sessions');

    expect(await res.json()).toEqual({ userId: 'u1' });
  });
});
