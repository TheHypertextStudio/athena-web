import { Hono } from 'hono';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, expectTypeOf, it, vi } from 'vitest';
import ts from 'typescript';

import type { AdminAppType as SourceAdminAppType, AppType as SourceAppType } from '../../src/app';
import type { AppEnv } from '../../src/context';
import type { server as ApiServer } from '../../src/server';
import type {
  AdminAppType as RpcContractAdminAppType,
  AppType as RpcContractAppType,
} from '@docket/api/rpc-contract';

/* eslint-disable @typescript-eslint/no-unused-vars -- Compiler-only package-export assertion. */
// @ts-expect-error The API package root is not exported.
import type * as ApiRootModule from '@docket/api';
/* eslint-enable @typescript-eslint/no-unused-vars */

const requireFromTest = createRequire(import.meta.url);
const apiRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const appsRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const compiledContractPath = `${apiRoot}/dist/rpc-contract.d.ts`;

/** Read the direct command lifecycle for one workspace package. */
function packageScripts(packageRoot: string): Record<string, string | undefined> {
  const manifest = JSON.parse(readFileSync(`${packageRoot}/package.json`, 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return manifest.scripts ?? {};
}

/** Read one task's explicit dependency edges from a delivery application's Turbo config. */
function turboDependencies(packageRoot: string, task: string): readonly string[] {
  const configPath = `${packageRoot}/turbo.json`;
  const parsed = ts.parseConfigFileTextToJson(configPath, readFileSync(configPath, 'utf8'));
  if (parsed.error) {
    throw new Error(
      ts.formatDiagnostic(parsed.error, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => packageRoot,
        getNewLine: () => '\n',
      }),
    );
  }

  const config = parsed.config as {
    tasks?: Record<string, { dependsOn?: string[] }>;
  };
  return config.tasks?.[task]?.dependsOn ?? [];
}

/** Resolve the contract exactly as a delivery application's TypeScript project does. */
function resolveContractFromDeliveryApp(app: 'admin' | 'web'): string | undefined {
  const appRoot = `${appsRoot}/${app}`;
  const configPath = `${appRoot}/tsconfig.json`;
  const config = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));
  if (config.error) {
    throw new Error(
      ts.formatDiagnostic(config.error, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => appRoot,
        getNewLine: () => '\n',
      }),
    );
  }

  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    appRoot,
    undefined,
    configPath,
  );
  return ts.resolveModuleName(
    '@docket/api/rpc-contract',
    `${appRoot}/src/lib/api.ts`,
    parsed.options,
    ts.sys,
  ).resolvedModule?.resolvedFileName;
}

// Mock the node server `serve` so importing `server.ts` does not bind a real port,
// while the shared auth mock keeps the heavy ESM chain out of the test graph.
import { authHandler, fakeAsMetadata } from '../support/auth-mock';

const serve = vi.fn();
vi.mock('@hono/node-server', () => ({ serve }));

describe('env + RPC transport contract', () => {
  it('env is the validated API env object', async () => {
    const { env } = await import('../../src/env');
    expect(env.APP_MODE).toBe('test');
  });

  it('publishes only the named RPC transport subpath', () => {
    let rootResolutionError: unknown;
    try {
      requireFromTest.resolve('@docket/api');
    } catch (error) {
      rootResolutionError = error;
    }

    expect(rootResolutionError).toMatchObject({ code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
    expect(requireFromTest.resolve('@docket/api/rpc-contract')).toMatch(/rpc-contract\.ts$/);
  });

  it('resolves the type contract from API declarations, not route source', () => {
    for (const app of ['admin', 'web'] as const) {
      expect(resolveContractFromDeliveryApp(app)).toBe(compiledContractPath);
    }
  });

  it('builds declarations before direct API and delivery-app workflows', () => {
    expect(packageScripts(apiRoot)['pretest']).toBe('tsc -p tsconfig.build.json');
    expect(packageScripts(apiRoot)['pretest:coverage']).toBe('tsc -p tsconfig.build.json');
    expect(turboDependencies(apiRoot, 'test')).toContain('build');
    expect(turboDependencies(apiRoot, 'test:coverage')).toContain('build');

    for (const app of ['admin', 'web']) {
      const scripts = packageScripts(`${appsRoot}/${app}`);
      for (const workflow of ['build', 'dev', 'lint', 'typecheck']) {
        expect(scripts[`pre${workflow}`]).toBe('pnpm --filter @docket/api build');
      }

      expect(turboDependencies(`${appsRoot}/${app}`, 'dev')).toContain('@docket/api#build');
      expect(turboDependencies(`${appsRoot}/${app}`, 'typecheck')).toContain('@docket/api#build');
    }
  });

  it('exposes API-owned RPC types through a side-effect-free named subpath', async () => {
    // Compared by identity rather than structurally. `toEqualTypeOf` walks both `AppType`s, and
    // the router surface has grown large enough that doing so exceeds the compiler's
    // instantiation budget — `tsc` reported TS2589 and then gave up, which fails the gate without
    // saying anything about the contract. Deferring the comparison into a conditional signature
    // resolves to a plain boolean without instantiating either structure, and is the stricter
    // check: it holds only if the two are the same type, not merely mutually assignable.
    expectTypeOf<Identical<RpcContractAppType, SourceAppType>>().toEqualTypeOf<true>();
    expectTypeOf<Identical<RpcContractAdminAppType, SourceAdminAppType>>().toEqualTypeOf<true>();

    expect(Object.keys(await import('@docket/api/rpc-contract'))).toEqual([]);
  });
});

/**
 * Whether two types are the same type, decided without instantiating either.
 *
 * @remarks
 * The two conditional signatures are only mutually assignable when `A` and `B` are identical, and
 * TypeScript defers both rather than expanding them — so this answers the question a structural
 * comparison of two large Hono `AppType`s cannot answer without running out of depth.
 */
type Identical<A, B> =
  // Each `T` appearing once is the mechanism, not an oversight: the comparison works precisely
  // because both signatures stay generic and unresolved, which is what defers the instantiation.
  /* eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- see above */
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe('app.ts route composition', () => {
  it('mounts the /v1 base path and the orgs/notifications/daily-plan/hub routers', async () => {
    const { app } = await import('../../src/app');
    const { onError } = await import('../../src/error');
    app.onError(onError);
    // The orgs list route requires a session; without one it 401s (proves the mount).
    const res = await app.request('/v1/orgs');
    expect(res.status).toBe(401);
  });
});

describe('openapi', () => {
  it('registerOpenapi serves a valid generated 3.1 document at /v1/openapi.json', async () => {
    const { registerOpenapi } = await import('../../src/openapi');
    const { app, adminApp } = await import('../../src/app');
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
    const { registerOpenapi } = await import('../../src/openapi');
    const { app, adminApp } = await import('../../src/app');
    const server = new Hono();
    registerOpenapi(server as never, app, adminApp);
    const docs = await server.request('/v1/docs');
    expect(docs.status).toBe(200);
  });
});

describe('container', () => {
  it('getContainer builds + memoizes the boundary container', async () => {
    const { getContainer } = await import('../../src/container');
    const a = getContainer();
    const b = getContainer();
    expect(a).toBe(b);
    expect(a.billing).toBeDefined();
  });

  it('constructs only the production service that a caller accesses', async () => {
    const { buildAppContainer } = await import('../../src/container');
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
    const { sessionMiddleware } = await import('../../src/auth/session-middleware');
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
    // `env` is captured once at first import, not read live — a sibling test file importing
    // `../../src/server` (and therefore `../env`) before this `beforeAll` runs would otherwise
    // freeze WEB_URL as whatever it was at THAT import, this stub notwithstanding. Force a
    // fresh module registry so this describe block's own env stub is what actually lands.
    vi.resetModules();
    vi.stubEnv('WEB_URL', 'https://docket.test');
    server = (await import('../../src/server')).server;
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

  it('mounts AS metadata at the RFC 8414 path-aware location, not only the bare root', async () => {
    // Regression coverage for a production incident: the official MCP SDK's
    // discoverAuthorizationServerMetadata (and therefore Claude Desktop / claude.ai / any
    // spec-compliant client) inserts the well-known segment BEFORE the issuer's path
    // (`/api/auth`) — it never probes the bare root when the issuer has a path component. That
    // location 404d in production, so no compliant client could ever learn the real
    // registration_endpoint and DCR failed before it ever reached `/oauth2/register`.
    // A fresh Response per call: the two requests below each consume a body via `.json()`, and
    // a Response's body stream can only be read once — `mockResolvedValue` would hand the
    // second call an already-consumed instance.
    authHandler.mockImplementation(
      async () => new Response(JSON.stringify(fakeAsMetadata('https://docket.test'))),
    );
    const bare = await server.request('/.well-known/oauth-authorization-server');
    const pathAware = await server.request('/.well-known/oauth-authorization-server/api/auth');
    expect(bare.status).toBe(200);
    expect(pathAware.status).toBe(200);
    const bareBody = (await bare.json()) as Record<string, unknown>;
    const pathAwareBody = (await pathAware.json()) as Record<string, unknown>;
    expect(bareBody).toEqual(pathAwareBody);
    // Regression coverage for the follow-up incident: authorization_endpoint must be the web
    // origin (the caller's session cookie is only ever valid on its same-origin /api/auth
    // rewrite), while every other endpoint stays on the API origin exactly as Better Auth
    // generated it.
    expect(bareBody['authorization_endpoint']).toBe(
      'https://docket.test/api/auth/oauth2/authorize',
    );
    expect(bareBody['registration_endpoint']).toBe('https://docket.test/api/auth/oauth2/register');
    authHandler.mockReset();
    authHandler.mockResolvedValue(new Response('ok'));
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
      const { server: fresh } = await import('../../src/server');
      expect((await fresh.request('/v1/health')).status).toBe(200);
    } finally {
      log.mockRestore();
      vi.doUnmock('@hono/node-server');
    }
  });
});
