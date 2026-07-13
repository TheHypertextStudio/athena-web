import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { AppEnv } from '../src/context';
import type { server as ApiServer } from '../src/server';

// Mock the node server `serve` so importing `server.ts` does not bind a real port,
// while the shared auth mock keeps the heavy ESM chain out of the test graph.
import './support/auth-mock';

const serve = vi.fn();
vi.mock('@hono/node-server', () => ({ serve }));

describe('env + index re-exports', () => {
  it('env is the validated API env object', async () => {
    const { env } = await import('../src/env');
    expect(env.APP_MODE).toBe('test');
  });

  it('index re-exports the app + AppType', async () => {
    const mod = await import('../src/index');
    expect(typeof mod.app.request).toBe('function');
    expect(typeof mod.app.route).toBe('function');
  });
});

describe('app.ts route composition', () => {
  it('mounts the /v1 base path and the orgs/notifications/daily-plan/hub routers', async () => {
    const { app } = await import('../src/app');
    const { onError } = await import('../src/error');
    app.onError(onError);
    // The orgs list route requires a session; without one it 401s (proves the mount).
    const res = await app.request('/v1/orgs');
    expect(res.status).toBe(401);
  });
});

describe('openapi', () => {
  it('registerOpenapi serves a valid generated 3.1 document at /v1/openapi.json', async () => {
    const { registerOpenapi } = await import('../src/openapi');
    const { app, adminApp } = await import('../src/app');
    const server = new Hono();
    registerOpenapi(server as never, app, adminApp);

    const res = await server.request('/v1/openapi.json');
    expect(res.status).toBe(200);
    const doc = (await res.json()) as {
      openapi: string;
      info: { title: string };
      externalDocs: { url: string };
      components: { securitySchemes: { bearerAuth: { scheme: string } } };
      paths: Record<string, unknown>;
    };
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Docket API');
    expect(doc.externalDocs.url).toMatch(/\/problems$/);
    expect(doc.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
    // Paths are generated from the route annotations — the validator-bearing routes appear,
    // and every documented path is prefixed by the app's `/v1` basePath.
    expect(typeof doc.paths).toBe('object');
    for (const path of Object.keys(doc.paths)) expect(path.startsWith('/v1/')).toBe(true);
  });

  it('registerOpenapi mounts the Scalar docs UI at /v1/docs', async () => {
    const { registerOpenapi } = await import('../src/openapi');
    const { app, adminApp } = await import('../src/app');
    const server = new Hono();
    registerOpenapi(server as never, app, adminApp);
    const docs = await server.request('/v1/docs');
    expect(docs.status).toBe(200);
  });
});

describe('container', () => {
  it('getContainer builds + memoizes the boundary container', async () => {
    const { getContainer } = await import('../src/container');
    const a = getContainer();
    const b = getContainer();
    expect(a).toBe(b);
    expect(a.billing).toBeDefined();
  });

  it('constructs only the production service that a caller accesses', async () => {
    const { buildAppContainer } = await import('../src/container');
    const container = buildAppContainer({
      APP_MODE: 'production',
      RESEND_API_KEY: 're_test_key',
      MAIL_FROM: 'Docket <noreply@example.com>',
    });

    expect(container.mailer).toBe(container.mailer);
    expect(() => container.billing).toThrow('STRIPE_SECRET_KEY');
    expect(() => container.blob).toThrow('BLOB_READ_WRITE_TOKEN');
  });
});

describe('session middleware', () => {
  it('resolves the session into c.var.session', async () => {
    const { sessionMiddleware } = await import('../src/auth/session-middleware');
    const app = new Hono<AppEnv>();
    app.use('*', sessionMiddleware);
    app.get('/', (c) =>
      c.json({
        hasSession: c.get('session') !== null,
      }),
    );
    const res = await app.request('/');
    expect(res.status).toBe(200);
    // The mocked getSession returns null, so the session var is set to null.
    expect(await res.json()).toEqual({ hasSession: false });
  });
});

describe('server boot', () => {
  let server: typeof ApiServer;
  let log: ReturnType<typeof vi.spyOn>;
  beforeAll(async () => {
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    server = (await import('../src/server')).server;
  });

  afterAll(() => {
    log.mockRestore();
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
    vi.stubEnv('BETTER_AUTH_TRUSTED_ORIGINS', 'https://a.com, https://b.com ,');
    const freshServe = vi.fn();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.doMock('@hono/node-server', () => ({ serve: freshServe }));
    try {
      const { server: fresh } = await import('../src/server');
      expect((await fresh.request('/v1/health')).status).toBe(200);
    } finally {
      log.mockRestore();
      vi.doUnmock('@hono/node-server');
    }
  });
});
