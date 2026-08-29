import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { buildCorsMiddleware } from '../../src/cors';

/** Build a bare Hono app carrying only the CORS middleware under test, plus a stub route. */
function appWith(trustedOrigins: readonly string[]): Hono {
  const app = new Hono();
  app.use('*', buildCorsMiddleware(trustedOrigins));
  app.all('*', (c) => c.text('ok'));
  return app;
}

describe('buildCorsMiddleware — session-cookie routes', () => {
  it('allows a trusted origin and marks the response credentialed', async () => {
    const app = appWith(['https://docket.hypertext.studio']);
    const res = await app.request('/api/auth/session', {
      headers: { origin: 'https://docket.hypertext.studio' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://docket.hypertext.studio');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('omits Access-Control-Allow-Origin for an origin outside the allowlist', async () => {
    const app = appWith(['https://docket.hypertext.studio']);
    const res = await app.request('/api/auth/session', {
      headers: { origin: 'https://claude.ai' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    // Reproduces the original bug shape if it ever regresses: Allow-Credentials without
    // Allow-Origin is exactly what made the browser discard a valid response.
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('applies the browser Origin policy to /mcp without treating it as client authorization', async () => {
    const app = appWith(['https://docket.hypertext.studio']);
    const res = await app.request('/mcp', { headers: { origin: 'https://claude.ai' } });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('allows a trusted browser to preflight the replay-owner header', async () => {
    const app = appWith(['https://docket.hypertext.studio']);
    const res = await app.request('/v1/orgs/o1/object-commands', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://docket.hypertext.studio',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'X-Docket-Replay-Owner',
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://docket.hypertext.studio');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(res.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).toContain(
      'x-docket-replay-owner',
    );
  });

  it.each([
    ['a non-command route', '/v1/orgs/o1/tasks', 'POST'],
    ['the wrong method on the command route', '/v1/orgs/o1/object-commands', 'PATCH'],
  ])('does not advertise the replay-owner header for %s', async (_case, path, requestedMethod) => {
    const app = appWith(['https://docket.hypertext.studio']);
    const res = await app.request(path, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://docket.hypertext.studio',
        'access-control-request-method': requestedMethod,
        'access-control-request-headers': 'X-Docket-Replay-Owner',
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://docket.hypertext.studio');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(res.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).not.toContain(
      'x-docket-replay-owner',
    );
  });

  it('denies an untrusted browser that preflights the replay-owner header', async () => {
    const app = appWith(['https://docket.hypertext.studio']);
    const res = await app.request('/v1/orgs/o1/object-commands', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://attacker.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'X-Docket-Replay-Owner',
      },
    });

    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('allows a trusted browser to bind sign-out to its captured session owner', async () => {
    const app = appWith(['https://docket.hypertext.studio']);
    const res = await app.request('/api/auth/sign-out', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://docket.hypertext.studio',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'X-Docket-Session-Owner',
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://docket.hypertext.studio');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(res.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).toContain(
      'x-docket-session-owner',
    );
  });

  it.each([
    ['a different auth route', '/api/auth/get-session', 'POST'],
    ['the wrong method on sign-out', '/api/auth/sign-out', 'GET'],
  ])('does not advertise the session-owner header for %s', async (_case, path, requestedMethod) => {
    const app = appWith(['https://docket.hypertext.studio']);
    const res = await app.request(path, {
      method: 'OPTIONS',
      headers: {
        origin: 'https://docket.hypertext.studio',
        'access-control-request-method': requestedMethod,
        'access-control-request-headers': 'X-Docket-Session-Owner',
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).not.toContain(
      'x-docket-session-owner',
    );
  });

  it('denies an untrusted browser that preflights the session-owner header', async () => {
    const app = appWith(['https://docket.hypertext.studio']);
    const res = await app.request('/api/auth/sign-out', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://attacker.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'X-Docket-Session-Owner',
      },
    });

    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('buildCorsMiddleware — public OAuth AS surface', () => {
  const publicPaths = [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-authorization-server/api/auth',
    '/.well-known/mcp-client.json',
    '/api/auth/oauth2/register',
    '/api/auth/oauth2/token',
    '/api/auth/oauth2/introspect',
    '/api/auth/oauth2/revoke',
    '/api/auth/jwks',
  ];

  it.each(publicPaths)(
    'allows any origin on %s with no allowlist entry, and no Allow-Credentials',
    async (path) => {
      const app = appWith(['https://docket.hypertext.studio']);
      const res = await app.request(path, { headers: { origin: 'https://claude.ai' } });
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    },
  );

  it('works even with an empty trusted-origins list (no vendor has to be remembered)', async () => {
    const app = appWith([]);
    const res = await app.request('/api/auth/oauth2/register', {
      headers: { origin: 'https://some-other-mcp-client.example' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('leaves /api/auth/oauth2/authorize on the strict policy (it is reached by top-level redirect, not fetch)', async () => {
    const app = appWith(['https://docket.hypertext.studio']);
    const res = await app.request('/api/auth/oauth2/authorize', {
      headers: { origin: 'https://claude.ai' },
    });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('does not advertise the session-only replay-owner header on the open policy', async () => {
    const app = appWith(['https://docket.hypertext.studio']);
    const res = await app.request('/api/auth/oauth2/token', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://some-other-mcp-client.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'X-Docket-Replay-Owner',
      },
    });

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).not.toContain(
      'x-docket-replay-owner',
    );
  });

  it('does not advertise the session-owner header on the open policy', async () => {
    const app = appWith(['https://docket.hypertext.studio']);
    const res = await app.request('/api/auth/oauth2/token', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://some-other-mcp-client.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'X-Docket-Session-Owner',
      },
    });

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).not.toContain(
      'x-docket-session-owner',
    );
  });
});
