import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { API_REVISION, API_VERSION } from '../../src/api-version';
import { registerPublicApiBoundary } from '../../src/api-version-middleware';
import type { AppEnv } from '../../src/context';
import { ApiError, onError } from '../../src/error';
import { unmatchedRoute } from '../../src/lib/unmatched-route';

const effects = {
  session: vi.fn(),
  oauth: vi.fn(),
  body: vi.fn(),
  idempotency: vi.fn(),
  database: vi.fn(),
  queue: vi.fn(),
  external: vi.fn(),
};

function compose() {
  const app = new Hono<AppEnv>();
  registerPublicApiBoundary(app, ['https://docket.localhost']);
  app.use('*', async (_c, next) => {
    effects.session();
    effects.oauth();
    await next();
  });
  app.post('/v1/mutate', async (c) => {
    effects.body();
    await c.req.json();
    effects.idempotency();
    effects.database();
    effects.queue();
    effects.external();
    return c.json({ ok: true });
  });
  app.get('/v1/json', (c) => c.json({ ok: true }));
  for (const path of [
    '/v1/stream/sse',
    '/v1/me/account/exports/:exportId/file',
    '/v1/public/briefs/:workspaceSlug/:slug',
    '/v1/public/time/status',
  ]) {
    app.get(path, (c) => c.text('business edge'));
  }
  app.get('/v1/problem', () => {
    throw new ApiError(403, 'forbidden', 'private');
  });
  app.get('/v1/absent', () => {
    throw new ApiError(404, 'not_found', 'missing');
  });
  app.get('/v1/redirect', (c) => c.redirect('/v1/json'));
  app.get('/v1/empty', (c) => c.body(null, 204));
  app.get('/v1/cached', (c) => c.body(null, 304));
  app.get('/v1/binary', () => new Response(new Uint8Array([1, 2, 3])));
  app.get('/v1/stream', (c) =>
    stream(c, async (s) => {
      await s.write('event');
    }),
  );
  for (const path of [
    '/v1/docs',
    '/v1/openapi.json',
    '/v1/docs/assets/main.js',
    '/v1/health',
    '/mcp',
    '/api/auth/session',
    '/.well-known/oauth-authorization-server',
    '/webhooks/calendar',
    '/internal/cron',
    '/admin/users',
  ]) {
    app.get(path, (c) => c.text('control'));
  }
  app.notFound(unmatchedRoute(app));
  app.onError(onError);
  return app;
}

beforeEach(() => vi.clearAllMocks());

describe('composed public REST boundary', () => {
  it.each([undefined, API_VERSION])(
    'allows a mutation with version %s to reach every effect seam',
    async (version) => {
      const response = await compose().request('/v1/mutate', {
        method: 'POST',
        headers: version ? { 'Docket-Version': version } : {},
        body: '{}',
      });
      expect(response.status).toBe(200);
      for (const effect of Object.values(effects)) expect(effect).toHaveBeenCalledOnce();
    },
  );

  it('rejects a mutation before authentication, body consumption, or side effects', async () => {
    const request = new Request('http://localhost/v1/mutate', {
      method: 'POST',
      headers: { 'Docket-Version': 'latest', Origin: 'https://docket.localhost' },
      body: '{broken',
    });
    const response = await compose().request(request);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      type: 'https://docket.localhost/problems/unsupported_api_version',
      title: 'The requested API version is not supported.',
      status: 400,
      code: 'unsupported_api_version',
      requestedVersion: 'latest',
      supportedVersions: [API_VERSION],
    });
    expect(response.headers.get('Content-Type')).toBe('application/problem+json');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://docket.localhost');
    expect(request.bodyUsed).toBe(false);
    for (const effect of Object.values(effects)) expect(effect).not.toHaveBeenCalled();
  });

  it.each([API_VERSION, '9.0.0'])(
    'rejects repeated headers even when the second value is %s',
    async (second) => {
      const headers = new Headers([
        ['Docket-Version', API_VERSION],
        ['Docket-Version', second],
      ]);
      const response = await compose().request('/v1/json', { headers });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        requestedVersion: `${API_VERSION}, ${second}`,
      });
    },
  );

  it.each([
    '/v1/stream/sse',
    '/v1/me/account/exports/123/file',
    '/v1/public/briefs/example/example',
    '/v1/public/time/status',
  ])('protects the root-mounted business edge %s', async (path) => {
    expect(await (await compose().request(path)).text()).toBe('business edge');
    vi.clearAllMocks();
    expect(
      (await compose().request(path, { headers: { 'Docket-Version': 'latest' } })).status,
    ).toBe(400);
    expect(effects.session).not.toHaveBeenCalled();
  });

  it.each([
    ['json', 200],
    ['problem', 403],
    ['redirect', 302],
    ['empty', 204],
    ['cached', 304],
    ['binary', 200],
    ['stream', 200],
    ['docs', 200],
    ['openapi.json', 200],
    ['health', 200],
    ['absent', 404],
  ] as const)(
    'identifies the %s response without changing its status or body',
    async (path, status) => {
      const response = await compose().request(`/v1/${path}`);
      expect(response.status).toBe(status);
      expect(response.headers.get('Docket-Version')).toBe(API_VERSION);
      expect(response.headers.get('Docket-Revision')).toBe(API_REVISION);
      if (path === 'binary')
        expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
      if (path === 'stream') expect(await response.text()).toBe('event');
    },
  );

  it('identifies method rejection and allows browser contract assertions and stream resume', async () => {
    const app = compose();
    const rejected = await app.request('/v1/json', { method: 'POST' });
    expect(rejected.status).toBe(405);
    expect(rejected.headers.get('Docket-Version')).toBe(API_VERSION);
    const preflight = await app.request('/v1/json', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://docket.localhost',
        'Docket-Version': 'latest',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'Docket-Version,Last-Event-ID',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Docket-Revision')).toBe(API_REVISION);
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('Docket-Version');
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('Last-Event-ID');
    const response = await app.request('/v1/json', {
      headers: { Origin: 'https://docket.localhost' },
    });
    for (const name of [
      'Docket-Version',
      'Docket-Revision',
      'X-Request-Id',
      'Location',
      'ETag',
      'Retry-After',
      'WWW-Authenticate',
      'Allow',
      'Idempotency-Replayed',
    ]) {
      expect(response.headers.get('Access-Control-Expose-Headers')).toContain(name);
    }
  });

  it.each([
    '/v1/docs',
    '/v1/openapi.json',
    '/v1/docs/assets/main.js',
    '/v1/health',
    '/mcp',
    '/api/auth/session',
    '/.well-known/oauth-authorization-server',
    '/webhooks/calendar',
    '/internal/cron',
    '/admin/users',
  ])('keeps the control surface %s reachable with an unsupported assertion', async (path) => {
    const response = await compose().request(path, { headers: { 'Docket-Version': 'latest' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('Docket-Version')).toBe(
      path.startsWith('/v1/') ? API_VERSION : null,
    );
  });
});
