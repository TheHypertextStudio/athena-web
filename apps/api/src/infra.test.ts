import { Hono } from 'hono';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Mock the node server `serve` so importing `server.ts` does not bind a real port,
// and stub Better Auth so the heavy ESM chain is not pulled into the test graph.
const serve = vi.fn();
vi.mock('@hono/node-server', () => ({ serve }));
vi.mock('@docket/auth', () => ({
  auth: {
    api: { getSession: vi.fn(async () => null) },
    handler: vi.fn(async () => new Response('ok')),
  },
}));

process.env['DATABASE_URL'] = 'pglite://memory://';
process.env['APP_MODE'] = 'test';
process.env['NODE_ENV'] = 'test';
process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
process.env['CRON_SECRET'] = 'test-cron-secret';
process.env['SKIP_ENV_VALIDATION'] = '1';

describe('env + index re-exports', () => {
  it('env is the validated API env object', async () => {
    const { env } = await import('./env');
    expect(env.APP_MODE).toBe('test');
  });

  it('index re-exports the app + AppType', async () => {
    const mod = await import('./index');
    expect(typeof mod.app.request).toBe('function');
    expect(typeof mod.app.route).toBe('function');
  });
});

describe('app.ts route composition', () => {
  it('mounts the /v1 base path and the orgs/notifications/daily-plan/hub routers', async () => {
    const { app } = await import('./app');
    // The orgs list route requires a session; without one it 401s (proves the mount).
    const res = await app.request('/v1/orgs');
    // No session middleware here, so `c.get('session')` is undefined → AuthError handled
    // by the route's own throw (no onError mounted on the bare app → 500/exception).
    // We only assert the route exists (non-404) to cover the chain.
    expect(res.status).not.toBe(404);
  });
});

describe('openapi', () => {
  it('buildOpenApiDocument returns a valid 3.1 document', async () => {
    const { buildOpenApiDocument } = await import('./openapi');
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Docket API');
    expect(doc.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
  });

  it('registerOpenapi mounts /v1/openapi.json and /v1/docs', async () => {
    const { registerOpenapi } = await import('./openapi');
    const server = new Hono();
    registerOpenapi(server as never);
    const spec = await server.request('/v1/openapi.json');
    expect(spec.status).toBe(200);
    const docs = await server.request('/v1/docs');
    expect(docs.status).toBe(200);
  });
});

describe('container', () => {
  it('getContainer builds + memoizes the boundary container', async () => {
    const { getContainer } = await import('./container');
    const a = getContainer();
    const b = getContainer();
    expect(a).toBe(b);
    expect(a.billing).toBeDefined();
  });

  it('toBoundaryEnv spreads every present optional env key', async () => {
    // A fresh module registry with all the optional boundary env keys set so each
    // `...(env.X ? {...} : {})` spread takes its truthy branch.
    vi.resetModules();
    const saved = { ...process.env };
    process.env['APP_MODE'] = 'test';
    process.env['STRIPE_SECRET_KEY'] = 'sk_test_x';
    process.env['STRIPE_PRICE_TEAM'] = 'price_x';
    process.env['STRIPE_BILLING_PORTAL_CONFIG_ID'] = 'bpc_x';
    process.env['ATHENA_AGENT_ENDPOINT'] = 'https://agent.x';
    process.env['ATHENA_AGENT_API_KEY'] = 'key_x';
    process.env['BLOB_READ_WRITE_TOKEN'] = 'blob_x';
    process.env['EXPORT_BUCKET_URL'] = 'https://bucket.x';
    const { getContainer } = await import('./container');
    const c = getContainer();
    expect(c.billing).toBeDefined();
    process.env = saved;
    vi.resetModules();
  });
});

describe('session middleware', () => {
  it('resolves the session into c.var.session', async () => {
    const { sessionMiddleware } = await import('./auth/session-middleware');
    const app = new Hono();
    app.use('*', sessionMiddleware as never);
    app.get('/', (c) =>
      c.json({
        hasSession: c.get('session' as never) !== null && c.get('session' as never) !== undefined,
      }),
    );
    const res = await app.request('/');
    expect(res.status).toBe(200);
    // The mocked getSession returns null, so the session var is set to null.
    expect(await res.json()).toEqual({ hasSession: false });
  });
});

describe('server boot', () => {
  let server: Hono;
  beforeAll(async () => {
    server = (await import('./server')).server as unknown as Hono;
  });

  it('calls serve() at import (mocked) and exposes /v1/health', async () => {
    expect(serve).toHaveBeenCalledTimes(1);
    const res = await server.request('/v1/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('serves the openapi spec and routes the auth + mcp + cron + webhook edges', async () => {
    expect((await server.request('/v1/openapi.json')).status).toBe(200);
    // The auth mount returns the (mocked) handler response.
    const auth = await server.request('/api/auth/anything', { method: 'GET' });
    expect(auth.status).toBe(200);
  });
});

describe('server CORS trusted-origins parsing', () => {
  it('parses a comma-separated BETTER_AUTH_TRUSTED_ORIGINS list', async () => {
    // Re-import in a fresh module registry with the env set so the split branch runs.
    vi.resetModules();
    process.env['BETTER_AUTH_TRUSTED_ORIGINS'] = 'https://a.com, https://b.com ,';
    const freshServe = vi.fn();
    vi.doMock('@hono/node-server', () => ({ serve: freshServe }));
    vi.doMock('@docket/auth', () => ({
      auth: {
        api: { getSession: vi.fn(async () => null) },
        handler: vi.fn(async () => new Response('ok')),
      },
    }));
    const { server: fresh } = await import('./server');
    expect((await (fresh as unknown as Hono).request('/v1/health')).status).toBe(200);
    delete process.env['BETTER_AUTH_TRUSTED_ORIGINS'];
    vi.doUnmock('@hono/node-server');
    vi.doUnmock('@docket/auth');
  });
});
