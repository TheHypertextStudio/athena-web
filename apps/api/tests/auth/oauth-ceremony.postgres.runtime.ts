import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { resolve } from 'node:path';

import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, expect } from 'vitest';

import { API_TEST_ENV } from '../support/env';
import type { AppEnv } from '../../src/context';

const databaseUrl = process.env['DATABASE_URL'] ?? '';
const migrationsDirectory = resolve(import.meta.dirname, '../../../../packages/db/drizzle');

export class CookieJar {
  readonly #values = new Map<string, string>();

  absorb(response: Response): void {
    for (const value of response.headers.getSetCookie()) {
      const pair = value.split(';', 1)[0] ?? '';
      const separator = pair.indexOf('=');
      if (separator <= 0) continue;
      const name = pair.slice(0, separator);
      const cookieValue = pair.slice(separator + 1);
      if (cookieValue) this.#values.set(name, cookieValue);
      else this.#values.delete(name);
    }
  }

  header(): string {
    return [...this.#values].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

export interface RegisteredClient {
  readonly clientId: string;
}

export interface ConfidentialRegisteredClient extends RegisteredClient {
  readonly clientSecret: string;
}

export function isConfidentialClient(
  client: RegisteredClient,
): client is ConfidentialRegisteredClient {
  return 'clientSecret' in client && typeof client.clientSecret === 'string';
}

export interface IssuedTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly scope: string;
}

export interface AccessClaims {
  readonly aud: string;
  readonly azp: string;
  readonly exp: number;
  readonly jti: string;
  readonly sub: string;
  readonly 'https://clearthedocket.com/oauth/grant': string;
}

export interface OAuthAdapterTraceEntry {
  readonly adapter: object;
  readonly kind: 'base' | 'savepoint' | 'transaction';
  readonly method: string;
  readonly model?: string;
}

const oauthAdapterTraceSymbol = Symbol.for('docket:test:oauth-adapter-trace');
let activeOAuthAdapterTrace: OAuthAdapterTraceEntry[] | null = null;

export let sql: Sql;
export let controlA: Sql;
export let controlB: Sql;
let nodeServer: Server;
export let origin = '';
export let userId = '';
export let orgId = '';
export let sessionCookies: CookieJar;
export const cimdDocuments = new Map<string, Record<string, unknown>>();

export function setActiveOAuthAdapterTrace(trace: OAuthAdapterTraceEntry[] | null): void {
  activeOAuthAdapterTrace = trace;
}

export function required<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolveListen();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('The OAuth test server did not bind.');
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolveClose();
    });
  });
}

async function applyMigrations(client: Sql): Promise<void> {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();
  for (const file of files) {
    await client.unsafe(await readFile(resolve(migrationsDirectory, file), 'utf8'));
  }
}

export async function request(
  path: string,
  init: RequestInit = {},
  cookies?: CookieJar,
): Promise<Response> {
  const headers = new Headers(init.headers);
  const cookie = cookies?.header();
  if (cookie) headers.set('cookie', cookie);
  const response = await fetch(`${origin}${path}`, { ...init, headers, redirect: 'manual' });
  cookies?.absorb(response);
  return response;
}

export async function jsonRequest(
  path: string,
  body: unknown,
  cookies?: CookieJar,
): Promise<Response> {
  return request(
    path,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify(body),
    },
    cookies,
  );
}

async function signInWithRecoveryCode(): Promise<CookieJar> {
  const identity = await createRecoveryUser('PostgreSQL OAuth owner');
  userId = identity.userId;
  return signInRecoveryUser(identity);
}

export async function signInRecoveryUser(identity: {
  readonly code: string;
  readonly email: string;
}): Promise<CookieJar> {
  const cookies = new CookieJar();
  const challenge = await jsonRequest(
    '/api/auth/two-factor/recovery-challenge',
    { email: identity.email },
    cookies,
  );
  expect(challenge.status, await challenge.clone().text()).toBe(200);
  const verified = await jsonRequest(
    '/api/auth/two-factor/verify-backup-code',
    { code: identity.code },
    cookies,
  );
  expect(verified.status, await verified.clone().text()).toBe(200);
  expect(cookies.header()).toContain('better-auth.session_token=');
  return cookies;
}

export async function createRecoveryUser(label: string): Promise<{
  readonly code: string;
  readonly email: string;
  readonly userId: string;
}> {
  const { db, user } = await import('@docket/db');
  const { generateRecoveryCodes } = await import('@docket/auth');
  const suffix = randomUUID();
  const email = `postgres-oauth-${suffix}@example.test`;
  const [created] = await db.insert(user).values({ name: label, email }).returning({ id: user.id });
  if (!created) throw new Error('The OAuth ceremony user was not created.');
  const codes = await generateRecoveryCodes(created.id);
  const code = codes[0];
  if (!code) throw new Error('The OAuth ceremony recovery code was not generated.');
  return { code, email, userId: created.id };
}

async function seedOrganization(): Promise<void> {
  const { actor, db, organization } = await import('@docket/db');
  const suffix = randomUUID().slice(0, 8);
  const [created] = await db
    .insert(organization)
    .values({ name: 'OAuth acceptance workspace', slug: `oauth-acceptance-${suffix}` })
    .returning({ id: organization.id });
  if (!created) throw new Error('The OAuth ceremony organization was not created.');
  orgId = created.id;
  await db.insert(actor).values({
    organizationId: orgId,
    kind: 'human',
    displayName: 'PostgreSQL OAuth owner',
    userId,
  });
}

export async function registerPublicClient(): Promise<RegisteredClient> {
  const response = await jsonRequest('/api/auth/oauth2/register', {
    client_name: 'PostgreSQL OAuth ceremony',
    redirect_uris: ['http://127.0.0.1/callback'],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    type: 'native',
  });
  const text = await response.text();
  expect(response.status, text).toBe(200);
  const body = JSON.parse(text) as { client_id?: unknown; client_secret?: unknown };
  expect(body.client_id).toEqual(expect.any(String));
  expect(body.client_secret).toBeUndefined();
  return { clientId: body.client_id as string };
}

export async function registerConfidentialClient(): Promise<ConfidentialRegisteredClient> {
  const response = await jsonRequest(
    '/api/auth/oauth2/register',
    {
      client_name: 'PostgreSQL OAuth introspection',
      redirect_uris: ['http://127.0.0.1/callback'],
      token_endpoint_auth_method: 'client_secret_post',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      type: 'web',
      scope: 'work:read offline_access',
    },
    sessionCookies,
  );
  const text = await response.text();
  expect(response.status, text).toBe(200);
  const body = JSON.parse(text) as { client_id?: unknown; client_secret?: unknown };
  expect(body.client_id).toEqual(expect.any(String));
  expect(body.client_secret).toEqual(expect.any(String));
  return {
    clientId: body.client_id as string,
    clientSecret: body.client_secret as string,
  };
}

export async function redirectTarget(response: Response): Promise<URL> {
  const text = await response.clone().text();
  expect([200, 302], text).toContain(response.status);
  const location =
    response.status === 302
      ? response.headers.get('location')
      : ((JSON.parse(text) as { url?: unknown }).url ?? null);
  expect(location).toEqual(expect.any(String));
  return new URL(location as string, origin);
}

export async function waitForBlockedBackends(observer: Sql, minimum: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const [row] = await observer<{ blocked: number }[]>`
      select count(*)::int as blocked
      from pg_stat_activity
      where datname = current_database()
        and cardinality(pg_blocking_pids(pid)) > 0
    `;
    if ((row?.blocked ?? 0) >= minimum) return;
    await new Promise<void>((resolveImmediate) => setImmediate(resolveImmediate));
  }
  throw new Error(`Only ${String(minimum - 1)} PostgreSQL backends reached the row-lock barrier.`);
}

export async function raceBehindClientLock<T>(
  clientId: string,
  start: () => readonly Promise<T>[],
): Promise<readonly T[]> {
  let pending: readonly Promise<T>[] = [];
  await controlA.begin(async (locked) => {
    await locked`select client_id from oauth_client where client_id = ${clientId} for update`;
    pending = start();
    await waitForBlockedBackends(controlB, pending.length);
  });
  return Promise.all(pending);
}

async function configureRuntime(): Promise<void> {
  expect(databaseUrl).toMatch(/^postgres(?:ql)?:/);
  const databaseName = new URL(databaseUrl).pathname.slice(1);
  expect(databaseName).toMatch(/^docket_oauth_task2_/);
  nodeServer = createServer();
  const port = await listen(nodeServer);
  origin = `http://127.0.0.1:${String(port)}`;
  Object.assign(process.env, {
    ...API_TEST_ENV,
    DATABASE_URL: databaseUrl,
    DATABASE_URL_UNPOOLED: databaseUrl,
    API_URL: origin,
    WEB_URL: origin,
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_TRUSTED_ORIGINS: origin,
    BETTER_AUTH_PASSKEY_RP_ID: '127.0.0.1',
    MCP_ISSUER_URL: origin,
    MCP_RESOURCE_URL: `${origin}/mcp`,
    OIDC_LOGIN_PAGE_URL: `${origin}/sign-in`,
  });
  Reflect.set(globalThis, oauthAdapterTraceSymbol, (entry: OAuthAdapterTraceEntry) => {
    activeOAuthAdapterTrace?.push(entry);
  });
  sql = postgres(databaseUrl, { max: 2, prepare: false });
  controlA = postgres(databaseUrl, { max: 1, prepare: false });
  controlB = postgres(databaseUrl, { max: 1, prepare: false });
}

async function initializeDatabase(): Promise<void> {
  await sql.unsafe('drop schema public cascade; create schema public');
  await applyMigrations(sql);
  const [[backendA], [backendB]] = await Promise.all([
    controlA<{ pid: number }[]>`select pg_backend_pid()::int as pid`,
    controlB<{ pid: number }[]>`select pg_backend_pid()::int as pid`,
  ]);
  expect(backendA?.pid).toEqual(expect.any(Number));
  expect(backendB?.pid).toEqual(expect.any(Number));
  expect(backendA?.pid).not.toBe(backendB?.pid);
}

async function composeServer(): Promise<void> {
  const [{ getRequestListener }, { Hono }, { bodyLimit }, { requestId }, { secureHeaders }] =
    await Promise.all([
      import('@hono/node-server'),
      import('hono'),
      import('hono/body-limit'),
      import('hono/request-id'),
      import('hono/secure-headers'),
    ]);
  const [
    authModule,
    appModule,
    boundaryModule,
    cimdModule,
    contextModule,
    sessionModule,
    principalModule,
  ] = await Promise.all([
    import('@docket/auth'),
    import('../../src/app'),
    import('../../src/api-version-middleware'),
    import('../../src/mcp/cimd'),
    import('../../src/context'),
    import('../../src/auth/session-middleware'),
    import('../../src/auth/principal-middleware'),
  ]);
  void contextModule;
  const [{ MAX_REQUEST_BYTES, rejectOversizedBody }, { onError }, { mcpHandler }] =
    await Promise.all([
      import('../../src/lib/http-limits'),
      import('../../src/error'),
      import('../../src/mcp/server'),
    ]);
  const root = new Hono<AppEnv>();
  root.use('*', requestId());
  root.use('*', secureHeaders({ crossOriginResourcePolicy: 'cross-origin', xFrameOptions: false }));
  boundaryModule.registerPublicApiBoundary(root, [origin]);
  root.use(
    '/v1/*',
    bodyLimit({ maxSize: MAX_REQUEST_BYTES, onError: () => rejectOversizedBody() }),
  );
  root.use('*', sessionModule.sessionMiddleware);
  root.use('*', principalModule.principalMiddleware);
  root.use(
    '/api/auth/oauth2/authorize',
    cimdModule.createCimdAuthorizeMiddleware({
      resolveHost: async () => [{ address: '93.184.216.34', family: 4 }],
      fetchJson: async (url) => {
        const document = cimdDocuments.get(url.href);
        if (!document) throw new Error('The test CIMD document was not registered.');
        return document;
      },
    }),
  );
  root.on(['POST', 'GET'], '/api/auth/*', (c) => authModule.auth.handler(c.req.raw));
  root.on(['POST', 'GET', 'DELETE'], '/mcp', mcpHandler);
  root.route('/', appModule.app);
  root.onError(onError);
  nodeServer.on('request', (incoming, outgoing) => {
    void getRequestListener(root.fetch)(incoming, outgoing);
  });
}

async function setupCeremony(): Promise<void> {
  await configureRuntime();
  await initializeDatabase();
  await composeServer();
  sessionCookies = await signInWithRecoveryCode();
  await seedOrganization();
}

beforeAll(setupCeremony);

afterAll(async () => {
  Reflect.deleteProperty(globalThis, oauthAdapterTraceSymbol);
  const { closeDb } = await import('@docket/db');
  await closeDb();
  await controlA.end();
  await controlB.end();
  await sql.end();
  await closeServer(nodeServer);
});
