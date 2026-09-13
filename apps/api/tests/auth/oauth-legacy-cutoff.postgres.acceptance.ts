import { execFile } from 'node:child_process';
import { createHash, generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import postgres, { type Sql } from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  composeOAuthHandler,
  renewLegacyRefresh,
  runFreshIssuance,
} from './oauth-legacy-cutoff.postgres.support';
import { API_TEST_ENV } from '../support/env';

const databaseUrl = process.env['DATABASE_URL'] ?? '';
const migrationsDirectory = resolve(import.meta.dirname, '../../../../packages/db/drizzle');
const repositoryRoot = resolve(import.meta.dirname, '../../../..');
const execFileAsync = promisify(execFile);

interface PublicJwk {
  readonly [key: string]: unknown;
  readonly alg: 'EdDSA';
  readonly kid: string;
  readonly use: 'sig';
}

let sql: Sql;
let nodeServer: Server;
let origin = '';
let publicJwk: PublicJwk;
let dispatchRequest = (request: IncomingMessage, response: ServerResponse): void => {
  if (request.url !== '/api/auth/jwks') {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ keys: [publicJwk] }));
};

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('The legacy-cutoff JWKS server did not bind.');
  }
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

async function applyMigrationsBefore0130(client: Sql): Promise<void> {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d{4}_.+\.sql$/.test(file) && file < '0130_')
    .sort();
  for (const file of files) {
    await client.unsafe(await readFile(resolve(migrationsDirectory, file), 'utf8'));
  }
}

async function recordMigrationsBefore0130(client: Sql): Promise<void> {
  const journal = JSON.parse(
    await readFile(resolve(migrationsDirectory, 'meta/_journal.json'), 'utf8'),
  ) as { entries: { idx: number; when: number }[] };
  const last = journal.entries.filter(({ idx }) => idx < 130).at(-1);
  if (!last) throw new Error('The migration journal has no pre-0130 entry.');
  await client.unsafe(`
    create schema drizzle;
    create table drizzle.__drizzle_migrations (
      id serial primary key,
      hash text not null,
      created_at bigint
    );
  `);
  await client`
    insert into drizzle.__drizzle_migrations (hash, created_at)
    values ('pre-0130-held-token-fixture', ${last.when})
  `;
}

async function runProductionMigrations(): Promise<void> {
  await execFileAsync('pnpm', ['--filter', '@docket/db', 'db:migrate'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DATABASE_URL_UNPOOLED: databaseUrl,
    },
  });
}

function claimlessMcpToken(input: {
  readonly clientId: string;
  readonly issuedAt: number;
  readonly keyId: string;
  readonly privateKey: KeyObject;
  readonly userId: string;
}): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'EdDSA', kid: input.keyId, typ: 'JWT' }),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: `${origin}/api/auth`,
      aud: `${origin}/mcp`,
      azp: input.clientId,
      sub: input.userId,
      iat: input.issuedAt,
      exp: input.issuedAt + 14 * 60,
      scope: 'work:read offline_access',
      jti: randomUUID(),
    }),
  ).toString('base64url');
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${sign(null, Buffer.from(signingInput), input.privateKey).toString(
    'base64url',
  )}`;
}

beforeAll(async () => {
  expect(databaseUrl).toMatch(/^postgres(?:ql)?:/);
  const databaseName = new URL(databaseUrl).pathname.slice(1);
  expect(databaseName).toMatch(/^docket_oauth_task2_/);

  const keyId = `held-token-${randomUUID()}`;
  const { publicKey } = generateKeyPairSync('ed25519');
  publicJwk = {
    ...publicKey.export({ format: 'jwk' }),
    alg: 'EdDSA',
    kid: keyId,
    use: 'sig',
  };
  nodeServer = createServer((request, response) => {
    dispatchRequest(request, response);
  });
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

  sql = postgres(databaseUrl, { max: 2, prepare: false });
  await sql.unsafe(
    'drop schema if exists drizzle cascade; drop schema public cascade; create schema public',
  );
  await applyMigrationsBefore0130(sql);
  await recordMigrationsBefore0130(sql);
});

afterAll(async () => {
  const { closeDb } = await import('@docket/db');
  await closeDb();
  await sql.end();
  await closeServer(nodeServer);
});

interface LegacyCredentialFixture {
  readonly clientId: string;
  readonly newToken: string;
  readonly nowSeconds: number;
  readonly oldRefreshToken: string;
  readonly oldToken: string;
  readonly userId: string;
}

async function seedLegacyCredentialFixture(): Promise<LegacyCredentialFixture> {
  const clientId = `held-client-${randomUUID()}`;
  const userId = `held-user-${randomUUID()}`;
  const sessionId = `held-session-${randomUUID()}`;
  const oldRefreshToken = `held-refresh-${randomUUID()}`;
  const signingKey = generateKeyPairSync('ed25519');
  publicJwk = {
    ...signingKey.publicKey.export({ format: 'jwk' }),
    alg: 'EdDSA',
    kid: publicJwk.kid,
    use: 'sig',
  };
  await sql`
    insert into "user" (id, name, email)
    values (${userId}, 'Held token owner', ${`${userId}@example.test`})
  `;
  await sql`
    insert into oauth_client (
      id, client_id, redirect_uris, skip_consent, scopes, disabled, public, type,
      require_pkce, token_endpoint_auth_method, grant_types, response_types
    )
    values (
      ${`row-${clientId}`}, ${clientId}, ${sql.array(['https://client.example.test/callback'])},
      true, ${sql.array(['work:read', 'offline_access'])}, false, true, 'public', true, 'none',
      ${sql.array(['authorization_code', 'refresh_token'])}, ${sql.array(['code'])}
    )
  `;
  await sql`
    insert into session (id, token, user_id, expires_at)
    values (
      ${sessionId}, ${`held-session-token-${randomUUID()}`}, ${userId},
      current_timestamp + interval '1 hour'
    )
  `;
  await sql`
    insert into oauth_refresh_token (
      id, token, client_id, session_id, user_id, expires_at, created_at, scopes
    ) values (
      ${`held-refresh-row-${randomUUID()}`},
      ${createHash('sha256').update(oldRefreshToken).digest('base64url')},
      ${clientId}, ${sessionId}, ${userId}, current_timestamp + interval '1 hour',
      current_timestamp, ${sql.array(['work:read', 'offline_access'])}
    )
  `;
  await sql`
    insert into jwks (id, public_key, private_key, created_at)
    values (${publicJwk.kid}, ${JSON.stringify(publicJwk)}, '{}', current_timestamp)
  `;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const tokenInput = { clientId, userId, keyId: publicJwk.kid, privateKey: signingKey.privateKey };
  return {
    clientId,
    userId,
    oldRefreshToken,
    nowSeconds,
    oldToken: claimlessMcpToken({ ...tokenInput, issuedAt: nowSeconds - 30 }),
    newToken: claimlessMcpToken({ ...tokenInput, issuedAt: nowSeconds + 30 }),
  };
}

async function assertMigratedAccessCutoff(fixture: LegacyCredentialFixture): Promise<string> {
  const [client] = await sql<{ cutoff: Date }[]>`
    select docket_legacy_before as cutoff
    from oauth_client where client_id = ${fixture.clientId}
  `;
  const cutoffSeconds = Math.floor((client?.cutoff.getTime() ?? 0) / 1000);
  expect(cutoffSeconds).toBeGreaterThan(fixture.nowSeconds - 30);
  expect(cutoffSeconds).toBeLessThan(fixture.nowSeconds + 30);
  const { OAuthBearerError, verifyMcpBearer } = await import('../../src/auth/oauth-bearer');
  await expect(verifyMcpBearer(fixture.oldToken)).resolves.toMatchObject({
    kind: 'oauth',
    clientId: fixture.clientId,
    userId: fixture.userId,
    scopes: ['work:read'],
  });
  await expect(verifyMcpBearer(fixture.newToken)).rejects.toBeInstanceOf(OAuthBearerError);
  const grants = await sql<
    { id: string; kind: string; resourceUri: string; revokedAt: Date | null }[]
  >`
    select id, authorization_kind as kind, resource_uri as "resourceUri",
      revoked_at as "revokedAt"
    from oauth_resource_grant
    where client_id = ${fixture.clientId} and user_id = ${fixture.userId}
  `;
  expect(grants).toHaveLength(1);
  expect(grants[0]).toMatchObject({
    kind: 'trusted_mcp',
    resourceUri: null,
    revokedAt: null,
  });
  const grantId = grants[0]?.id;
  if (!grantId) throw new Error('Migration did not create the trusted compatibility grant.');
  return grantId;
}

async function assertMigratedRefreshRenewal(
  fixture: LegacyCredentialFixture,
  grantId: string,
): Promise<void> {
  const renewed = await renewLegacyRefresh(origin, fixture.clientId, fixture.oldRefreshToken);
  const payload = JSON.parse(
    Buffer.from(renewed.accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
  expect(payload).toMatchObject({
    aud: `${origin}/mcp`,
    azp: fixture.clientId,
    sub: fixture.userId,
  });
  expect(typeof payload['https://clearthedocket.com/oauth/grant']).toBe('string');
  const { verifyMcpBearer } = await import('../../src/auth/oauth-bearer');
  await expect(verifyMcpBearer(renewed.accessToken)).resolves.toMatchObject({
    kind: 'oauth',
    clientId: fixture.clientId,
    userId: fixture.userId,
    scopes: ['work:read'],
  });
  const rows = await sql<{ docketGrantId: string | null; revoked: Date | null; token: string }[]>`
    select docket_grant_id as "docketGrantId", revoked, token
    from oauth_refresh_token where client_id = ${fixture.clientId}
    order by created_at nulls first, id
  `;
  expect(rows).toHaveLength(2);
  expect(rows.every(({ docketGrantId }) => docketGrantId === grantId)).toBe(true);
  expect(rows.filter(({ revoked }) => revoked === null)).toHaveLength(1);
  const oldDigest = createHash('sha256').update(fixture.oldRefreshToken).digest('base64url');
  const newDigest = createHash('sha256').update(renewed.refreshToken).digest('base64url');
  expect(rows.find(({ token }) => token === oldDigest)?.revoked).toBeInstanceOf(Date);
  expect(rows.find(({ token }) => token === newDigest)?.revoked).toBeNull();
  const [boundGrant] = await sql<{ resourceUri: string | null }[]>`
    select resource_uri as "resourceUri" from oauth_resource_grant where id = ${grantId}
  `;
  expect(boundGrant?.resourceUri).toBe(`${origin}/mcp`);
}

async function assertFreshPostMigrationIssuance(): Promise<void> {
  const issued = await runFreshIssuance(origin);
  const payload = JSON.parse(
    Buffer.from(issued.tokens.accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
  ) as Record<string, unknown>;
  expect(payload).toMatchObject({
    aud: `${origin}/v1`,
    azp: issued.clientId,
    sub: issued.userId,
  });
  expect(typeof payload['https://clearthedocket.com/oauth/grant']).toBe('string');
  const rows = await sql<{ consents: number; grants: number; refreshes: number }[]>`
    select
      (select count(*)::int from oauth_consent
        where client_id = ${issued.clientId} and user_id = ${issued.userId}) as consents,
      (select count(*)::int from oauth_resource_grant
        where client_id = ${issued.clientId} and user_id = ${issued.userId}) as grants,
      (select count(*)::int from oauth_refresh_token
        where client_id = ${issued.clientId} and user_id = ${issued.userId}) as refreshes
  `;
  expect(rows).toEqual([{ consents: 1, grants: 1, refreshes: 1 }]);
  expect(issued.tokens.refreshToken.length).toBeGreaterThan(0);
}

describe('OAuth migration compatibility cutoff on PostgreSQL', () => {
  it('accepts a held pre-cutover MCP token and rejects a post-cutover token', async () => {
    const fixture = await seedLegacyCredentialFixture();
    await runProductionMigrations();
    const grantId = await assertMigratedAccessCutoff(fixture);
    await sql`delete from jwks where id = ${publicJwk.kid}`;
    dispatchRequest = await composeOAuthHandler();
    await assertMigratedRefreshRenewal(fixture, grantId);
    await assertFreshPostMigrationIssuance();
  });
});
