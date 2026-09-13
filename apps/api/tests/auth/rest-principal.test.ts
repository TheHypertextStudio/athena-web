import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppEnv } from '../../src/context';

const verifyRestBearer = vi.fn();
const getSession = vi.fn();

vi.mock('@docket/auth', () => ({ auth: { api: { getSession } } }));

vi.mock('../../src/auth/oauth-bearer', () => ({ verifyRestBearer }));

const { requireAuth } = await import('../../src/permissions/require-auth');
const { requireSessionForNonGet } = await import('../../src/auth/principal-middleware');
const { principalMiddleware } = await import('../../src/auth/principal-middleware');
const { authoritativeSessionMiddleware, replayOwnerSessionMiddleware, sessionMiddleware } =
  await import('../../src/auth/session-middleware');
const { onError } = await import('../../src/error');

const SESSION = {
  session: {
    id: 'session_1',
    userId: 'user_1',
    token: 'secret',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    ipAddress: null,
    userAgent: null,
  },
  user: {
    id: 'user_1',
    name: 'Ada',
    email: 'ada@example.test',
    emailVerified: true,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};

function probe(session: typeof SESSION | null): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('session', session);
    c.set(
      'principal',
      session
        ? { kind: 'session', userId: session.user.id, user: session.user, session: session.session }
        : null,
    );
    await next();
  });
  app.use('*', requireAuth);
  app.all('*', (c) =>
    c.json({ kind: c.get('principal')?.kind, userId: c.get('principal')?.userId }),
  );
  app.onError(onError);
  return app;
}

function sharedTimerMethodProbe(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', sessionMiddleware);
  app.use('*', principalMiddleware);
  app.use('/v1/public/time/status', requireSessionForNonGet);
  app.on('HEAD', '/v1/public/time/status', (c) => c.body(null, 200));
  app.get('/v1/public/time/status', (c) => c.json({ state: 'idle' }));
  app.all('*', (c) => c.json({ fallback: true }));
  app.onError(onError);
  return app;
}

beforeEach(() => {
  verifyRestBearer.mockReset();
  getSession.mockReset();
});

describe('REST caller principal', () => {
  it('selects a valid bearer on the OAuth canary even when a cookie session is present', async () => {
    verifyRestBearer.mockResolvedValue({
      kind: 'oauth',
      userId: 'oauth_user',
      user: { ...SESSION.user, id: 'oauth_user' },
      clientId: 'client_1',
      scopes: ['work:read'],
    });

    const response = await probe(SESSION).request('/v1/orgs', {
      headers: { authorization: 'Bearer valid', cookie: 'must-not-win' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: 'oauth', userId: 'oauth_user' });
  });

  it('does not fall back to a cookie after an invalid bearer', async () => {
    verifyRestBearer.mockRejectedValue(new Error('invalid_access_token'));

    const response = await probe(SESSION).request('/v1/orgs', {
      headers: { authorization: 'Bearer invalid', cookie: 'must-not-win' },
    });

    expect(response.status).toBe(401);
    expect(((await response.json()) as { code: string }).code).toBe('unauthorized');
    expect(response.headers.get('www-authenticate')).toBe(
      'Bearer realm="docket", error="invalid_token", resource_metadata="https://api.docket.localhost/.well-known/oauth-protected-resource/v1"',
    );
  });

  it('advertises REST OAuth without an error when the canary has no credential', async () => {
    const response = await probe(null).request('/v1/orgs');

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(
      'Bearer realm="docket", resource_metadata="https://api.docket.localhost/.well-known/oauth-protected-resource/v1", scope="work:read"',
    );
  });

  it('reports the exact missing scope without exposing diagnostics', async () => {
    verifyRestBearer.mockResolvedValue({
      kind: 'oauth',
      userId: 'oauth_user',
      user: { ...SESSION.user, id: 'oauth_user' },
      clientId: 'client_1',
      scopes: ['work:write'],
    });

    const response = await probe(null).request('/v1/orgs', {
      headers: { authorization: 'Bearer valid' },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      code: 'insufficient_scope',
      requiredScope: 'work:read',
    });
    expect(response.headers.get('www-authenticate')).toContain('error="insufficient_scope"');
    expect(response.headers.get('www-authenticate')).toContain('scope="work:read"');
    expect(response.headers.get('www-authenticate')).toContain(
      'resource_metadata="https://api.docket.localhost/.well-known/oauth-protected-resource/v1"',
    );
  });

  it('advertises only the first-party Docket session on a session-only route', async () => {
    const response = await probe(null).request('/v1/me/account');

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('DocketSession realm="docket"');
  });

  it('advertises the share token on public time status without claiming a session', async () => {
    const response = await probe(null).request('/v1/public/time/status');

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('DocketShareToken realm="docket"');
  });

  it('advertises only the first-party session on the staff surface', async () => {
    const response = await probe(null).request('/admin/session');

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('DocketSession realm="docket"');
  });

  it('rejects a valid OAuth caller from a session-only operation as forbidden', async () => {
    verifyRestBearer.mockResolvedValue({
      kind: 'oauth',
      userId: 'oauth_user',
      user: { ...SESSION.user, id: 'oauth_user' },
      clientId: 'client_1',
      scopes: ['work:read'],
    });

    const response = await probe(null).request('/v1/me/account', {
      headers: { authorization: 'Bearer valid' },
    });

    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe('forbidden');
    expect(response.headers.get('www-authenticate')).toBeNull();
  });

  it('uses the Docket session challenge for passkey step-up', async () => {
    const { ReauthRequiredError } = await import('../../src/error');
    const app = new Hono<AppEnv>();
    app.get('/v1/me/account', () => {
      throw new ReauthRequiredError();
    });
    app.onError(onError);

    const response = await app.request('/v1/me/account');

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(
      'DocketSession realm="docket", error="reauth_required"',
    );
  });

  it('rejects a malformed presented credential even on the public config operation', async () => {
    const response = await probe(null).request('/v1/config', {
      headers: { authorization: 'Basic client-secret' },
    });

    expect(response.status).toBe(401);
    expect(verifyRestBearer).not.toHaveBeenCalled();
  });

  it('keeps HEAD config session-only while GET config remains public', async () => {
    const app = probe(null);

    expect((await app.request('/v1/config')).status).toBe(200);
    const head = await app.request('/v1/config', { method: 'HEAD' });

    expect(head.status).toBe(401);
    expect(head.headers.get('www-authenticate')).toBe('DocketSession realm="docket"');
    expect(await head.text()).toBe('');
  });

  it('keeps implicit HEAD on the root-mounted shared timer session-only', async () => {
    const headers = new Headers();
    getSession.mockResolvedValue({ headers, response: null });
    const anonymous = await sharedTimerMethodProbe().request('/v1/public/time/status', {
      method: 'HEAD',
    });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('www-authenticate')).toBe('DocketSession realm="docket"');

    verifyRestBearer.mockResolvedValue({
      kind: 'oauth',
      userId: 'oauth_user',
      user: { ...SESSION.user, id: 'oauth_user' },
      clientId: 'client_1',
      scopes: ['work:read'],
    });
    getSession.mockClear();
    const oauth = await sharedTimerMethodProbe().request('/v1/public/time/status', {
      method: 'HEAD',
      headers: {
        authorization: 'Bearer valid',
        cookie: 'better-auth.session_token=must-not-be-read',
      },
    });
    expect(oauth.status).toBe(403);
    expect(getSession).not.toHaveBeenCalled();
    expect(oauth.headers.getSetCookie()).toEqual([]);

    getSession.mockResolvedValue({ headers, response: SESSION });
    const session = await sharedTimerMethodProbe().request('/v1/public/time/status', {
      method: 'HEAD',
      headers: { cookie: 'better-auth.session_token=valid' },
    });
    expect(session.status).toBe(200);
    expect(await session.text()).toBe('');
  });

  it.each(['/v1/config', '/v1/health', '/v1/openapi.json', '/v1/docs'])(
    'keeps unsupported POST %s fail-closed instead of inheriting GET access',
    async (path) => {
      const response = await probe(null).request(path, { method: 'POST' });

      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toBe('DocketSession realm="docket"');
    },
  );

  it.each(['/v1/config', '/v1/health', '/v1/openapi.json', '/v1/docs'])(
    'rejects OAuth on unsupported POST %s as a session-only operation',
    async (path) => {
      verifyRestBearer.mockResolvedValue({
        kind: 'oauth',
        userId: 'oauth_user',
        user: { ...SESSION.user, id: 'oauth_user' },
        clientId: 'client_1',
        scopes: ['work:read'],
      });

      const response = await probe(null).request(path, {
        method: 'POST',
        headers: { authorization: 'Bearer valid' },
      });

      expect(response.status).toBe(403);
      expect(((await response.json()) as { code: string }).code).toBe('forbidden');
    },
  );

  it.each(['/v1/health', '/v1/openapi.json', '/v1/docs', '/v1/docs/assets/reference.js'])(
    'validates Authorization on the %s control surface without resolving the cookie',
    async (path) => {
      const headers = new Headers();
      headers.append('set-cookie', 'better-auth.session_token=refreshed');
      getSession.mockResolvedValue({ headers, response: SESSION });
      verifyRestBearer.mockRejectedValue(new Error('invalid_access_token'));
      const app = new Hono<AppEnv>();
      app.use('*', sessionMiddleware);
      app.use('*', principalMiddleware);
      app.all('*', (c) => c.json({ ok: true }));
      app.onError(onError);

      const response = await app.request(path, {
        headers: {
          authorization: 'Bearer invalid',
          cookie: 'better-auth.session_token=must-not-be-read',
        },
      });

      expect(response.status).toBe(401);
      expect(getSession).not.toHaveBeenCalled();
      expect(response.headers.getSetCookie()).toEqual([]);
    },
  );

  it.each([
    {
      path: '/v1/me/sessions/session_1/revoke',
      middleware: authoritativeSessionMiddleware,
      headers: {},
    },
    {
      path: '/v1/orgs/org_1/object-commands',
      middleware: replayOwnerSessionMiddleware,
      headers: { 'X-Docket-Replay-Owner': 'oauth_user' },
    },
  ])(
    'rejects OAuth with forbidden before the $path session helper runs',
    async ({ path, middleware, headers }) => {
      verifyRestBearer.mockResolvedValue({
        kind: 'oauth',
        userId: 'oauth_user',
        user: { ...SESSION.user, id: 'oauth_user' },
        clientId: 'client_1',
        scopes: ['work:read', 'work:write', 'agents:run', 'connectors:link'],
      });
      const app = new Hono<AppEnv>();
      app.use('*', sessionMiddleware);
      app.use('*', principalMiddleware);
      app.use('*', requireAuth);
      app.use('*', middleware);
      app.all('*', (c) => c.json({ ok: true }));
      app.onError(onError);

      const response = await app.request(path, {
        method: 'POST',
        headers: {
          authorization: 'Bearer valid',
          cookie: 'better-auth.session_token=must-not-win',
          ...headers,
        },
      });

      expect(response.status).toBe(403);
      expect(((await response.json()) as { code: string }).code).toBe('forbidden');
      expect(response.headers.get('www-authenticate')).toBeNull();
      expect(getSession).not.toHaveBeenCalled();
      expect(response.headers.getSetCookie()).toEqual([]);
    },
  );
});
