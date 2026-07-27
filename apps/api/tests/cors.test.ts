import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { buildCorsMiddleware } from '../src/cors';

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

  it('gates /mcp behind the same strict allowlist (it authenticates via session/bearer, not client credentials)', async () => {
    const app = appWith(['https://docket.hypertext.studio']);
    const res = await app.request('/mcp', { headers: { origin: 'https://claude.ai' } });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('buildCorsMiddleware — public OAuth AS surface', () => {
  const publicPaths = [
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
    '/.well-known/oauth-authorization-server',
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
});
