import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import postgres, { type Sql } from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

import { main as runMigrations } from '../../src/migrate';
import { assertOAuthResourceGrantStorage } from './oauth-resource-grant-migration.assertions';

const databaseUrl = process.env['DATABASE_URL'] ?? '';
const migrationsDirectory = resolve(import.meta.dirname, '../../drizzle');
const sql = postgres(databaseUrl, {
  connection: { TimeZone: 'UTC' },
  max: 2,
  prepare: false,
});

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
    create schema if not exists drizzle;
    create table if not exists drizzle.__drizzle_migrations (
      id serial primary key,
      hash text not null,
      created_at bigint
    );
  `);
  await client`
    insert into drizzle.__drizzle_migrations (hash, created_at)
    values ('pre-0130-fixture', ${last.when})
  `;
}

async function seedUsersAndClients(client: Sql): Promise<void> {
  const users = [
    'u_normal',
    'u_duplicate',
    'u_reference',
    'u_mixed',
    'u_reference_refresh',
    'u_trusted',
    'u_trusted_single',
    'u_orphan',
    'u_held',
    'u_trusted_reference',
  ];
  for (const id of users) {
    await client`
      insert into "user" (id, name, email)
      values (${id}, ${id}, ${`${id}@example.test`})
    `;
  }

  const clients = [
    ['c_normal', false],
    ['c_duplicate', false],
    ['c_reference', false],
    ['c_mixed', false],
    ['c_reference_refresh', false],
    ['c_trusted', true],
    ['c_trusted_single', true],
    ['c_orphan', false],
    ['c_held', false],
    ['c_trusted_reference', true],
  ] as const;
  for (const [clientId, skipConsent] of clients) {
    await client`
      insert into oauth_client (id, client_id, redirect_uris, skip_consent, scopes)
      values (
        ${`row_${clientId}`},
        ${clientId},
        ${client.array(['https://client.example.test/callback'])},
        ${skipConsent},
        ${client.array(['work:read', 'offline_access'])}
      )
    `;
  }
}

async function seedConsents(client: Sql): Promise<void> {
  const consents = [
    ['consent_normal', 'c_normal', 'u_normal', null],
    ['consent_duplicate_a', 'c_duplicate', 'u_duplicate', null],
    ['consent_duplicate_b', 'c_duplicate', 'u_duplicate', null],
    ['consent_reference', 'c_reference', 'u_reference', 'workspace249'],
    ['consent_mixed_human', 'c_mixed', 'u_mixed', null],
    ['consent_mixed_reference', 'c_mixed', 'u_mixed', 'workspace249'],
    ['consent_reference_refresh', 'c_reference_refresh', 'u_reference_refresh', null],
    ['consent_trusted_human', 'c_trusted', 'u_trusted', null],
    ['consent_trusted_reference', 'c_trusted', 'u_trusted', 'workspace249'],
    ['consent_trusted_single', 'c_trusted_single', 'u_trusted_single', null],
    ['consent_held', 'c_held', 'u_held', null],
  ] as const;
  for (const [id, clientId, userId, referenceId] of consents) {
    await client`
      insert into oauth_consent (id, client_id, user_id, reference_id, scopes)
      values (
        ${id},
        ${clientId},
        ${userId},
        ${referenceId},
        ${client.array(['work:read', 'offline_access'])}
      )
    `;
  }
}

interface RefreshFixture {
  readonly id: string;
  readonly clientId: string;
  readonly userId: string;
  readonly referenceId: string | null;
  readonly expiresAt: string;
  readonly revoked: string | null;
  readonly scopes: readonly string[];
}

async function insertRefreshRows(client: Sql, refreshes: readonly RefreshFixture[]): Promise<void> {
  for (const refresh of refreshes) {
    await client`
      insert into oauth_refresh_token (
        id, token, client_id, user_id, reference_id, expires_at, created_at, revoked, scopes
      ) values (
        ${refresh.id},
        ${`token_${refresh.id}`},
        ${refresh.clientId},
        ${refresh.userId},
        ${refresh.referenceId},
        ${refresh.expiresAt}::timestamptz,
        ${'2025-01-01T00:00:00.000Z'}::timestamptz,
        ${refresh.revoked}::timestamptz,
        ${client.array([...refresh.scopes])}
      )
    `;
  }
}

async function seedFirstRefreshes(client: Sql): Promise<void> {
  const refreshes = [
    {
      id: 'refresh_normal_a',
      clientId: 'c_normal',
      userId: 'u_normal',
      referenceId: null,
      expiresAt: '2030-01-01T00:00:00.000Z',
      revoked: null,
      scopes: ['work:read', 'offline_access'],
    },
    {
      id: 'refresh_normal_b',
      clientId: 'c_normal',
      userId: 'u_normal',
      referenceId: null,
      expiresAt: '2099-01-01T00:00:00.000Z',
      revoked: '2026-01-01T00:00:00.000Z',
      scopes: ['work:write', 'offline_access'],
    },
    {
      id: 'refresh_normal_expired',
      clientId: 'c_normal',
      userId: 'u_normal',
      referenceId: null,
      expiresAt: '2025-01-02T00:00:00.000Z',
      revoked: '2025-01-01T12:00:00.000Z',
      scopes: ['work:read', 'offline_access'],
    },
    {
      id: 'refresh_duplicate',
      clientId: 'c_duplicate',
      userId: 'u_duplicate',
      referenceId: null,
      expiresAt: '2099-01-01T00:00:00.000Z',
      revoked: null,
      scopes: ['work:read', 'offline_access'],
    },
    {
      id: 'refresh_reference',
      clientId: 'c_reference',
      userId: 'u_reference',
      referenceId: 'workspace249',
      expiresAt: '2099-01-01T00:00:00.000Z',
      revoked: null,
      scopes: ['work:read', 'offline_access'],
    },
    {
      id: 'refresh_mixed',
      clientId: 'c_mixed',
      userId: 'u_mixed',
      referenceId: null,
      expiresAt: '2099-01-01T00:00:00.000Z',
      revoked: null,
      scopes: ['work:read', 'offline_access'],
    },
  ] as const;
  await insertRefreshRows(client, refreshes);
}

async function seedRemainingRefreshes(client: Sql): Promise<void> {
  const refreshes = [
    {
      id: 'refresh_reference_refresh',
      clientId: 'c_reference_refresh',
      userId: 'u_reference_refresh',
      referenceId: 'workspace249',
      expiresAt: '2099-01-01T00:00:00.000Z',
      revoked: null,
      scopes: ['work:read', 'offline_access'],
    },
    {
      id: 'refresh_trusted',
      clientId: 'c_trusted',
      userId: 'u_trusted',
      referenceId: null,
      expiresAt: '2099-01-01T00:00:00.000Z',
      revoked: null,
      scopes: ['work:read', 'offline_access'],
    },
    {
      id: 'refresh_trusted_single',
      clientId: 'c_trusted_single',
      userId: 'u_trusted_single',
      referenceId: null,
      expiresAt: '2099-01-01T00:00:00.000Z',
      revoked: null,
      scopes: ['work:read', 'offline_access'],
    },
    {
      id: 'refresh_orphan',
      clientId: 'c_orphan',
      userId: 'u_orphan',
      referenceId: null,
      expiresAt: '2099-01-01T00:00:00.000Z',
      revoked: null,
      scopes: ['work:read', 'offline_access'],
    },
    {
      id: 'refresh_trusted_reference',
      clientId: 'c_trusted_reference',
      userId: 'u_trusted_reference',
      referenceId: 'workspace249',
      expiresAt: '2099-01-01T00:00:00.000Z',
      revoked: null,
      scopes: ['work:read', 'offline_access'],
    },
  ] as const;
  await insertRefreshRows(client, refreshes);
}

async function seedPre0130Rows(client: Sql): Promise<void> {
  await seedUsersAndClients(client);
  await seedConsents(client);
  await seedFirstRefreshes(client);
  await seedRemainingRefreshes(client);
}

async function initializeLegacySchema(): Promise<void> {
  expect(databaseUrl).toMatch(/^postgres(?:ql)?:/);
  const [database] = await sql<{ name: string }[]>`
    select current_database() as name
  `;
  if (!database) throw new Error('The migration acceptance database was not resolved.');
  await sql`alter database ${sql(database.name)} set timezone to 'UTC'`;
  await applyMigrationsBefore0130(sql);
  await recordMigrationsBefore0130(sql);
  await seedPre0130Rows(sql);
}

async function assertMigrationRollback(): Promise<void> {
  await sql.unsafe(`
    create function fail_oauth_cutoff() returns trigger language plpgsql as $$
    begin
      raise exception 'injected cutoff failure';
    end
    $$;
    create trigger oauth_cutoff_failure after update on oauth_client
    for each statement execute function fail_oauth_cutoff();
  `);
  await expect(runMigrations()).rejects.toMatchObject({
    cause: { message: 'injected cutoff failure' },
  });
  const [rolledBack] = await sql<
    { grantTable: string | null; grantColumn: string | null; trustedColumn: string | null }[]
  >`
    select
      to_regclass('public.oauth_resource_grant')::text as "grantTable",
      (
        select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'oauth_client'
          and column_name = 'docket_legacy_before'
      ) as "grantColumn",
      (
        select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'oauth_client'
          and column_name = 'docket_legacy_trusted'
      ) as "trustedColumn"
  `;
  expect(rolledBack).toEqual({ grantTable: null, grantColumn: null, trustedColumn: null });
  await sql.unsafe(`
    drop trigger oauth_cutoff_failure on oauth_client;
    drop function fail_oauth_cutoff();
  `);
}

async function assertGrantBackfill(): Promise<void> {
  const grants = await sql<
    {
      clientId: string;
      kind: string;
      resourceUri: string | null;
      createdAt: Date;
      expiresAt: Date;
      legacyBefore: Date;
    }[]
  >`
    select client_id as "clientId", authorization_kind as kind,
      resource_uri as "resourceUri", created_at as "createdAt", expires_at as "expiresAt",
      legacy_before as "legacyBefore"
    from oauth_resource_grant order by client_id
  `;
  expect(grants.map(({ clientId, kind }) => [clientId, kind])).toEqual([
    ['c_held', 'consent'],
    ['c_normal', 'consent'],
    ['c_reference_refresh', 'consent'],
    ['c_trusted', 'trusted_mcp'],
    ['c_trusted_single', 'trusted_mcp'],
  ]);
  expect(grants.every((grant) => grant.resourceUri === null)).toBe(true);
  expect(grants.every((grant) => grant.createdAt.getTime() === grant.legacyBefore.getTime())).toBe(
    true,
  );
  expect(new Set(grants.map((grant) => grant.legacyBefore.getTime())).size).toBe(1);
  expect(grants.find((grant) => grant.clientId === 'c_normal')?.expiresAt).toEqual(
    new Date('2099-01-01T00:00:00.000Z'),
  );
}

async function assertRefreshBackfill(): Promise<string> {
  const refreshes = await sql<
    { id: string; grantId: string | null; revoked: Date | null; scopes: string[] }[]
  >`
    select id, docket_grant_id as "grantId", revoked at time zone 'UTC' as revoked, scopes
    from oauth_refresh_token order by id
  `;
  const byId = new Map(refreshes.map((refresh) => [refresh.id, refresh]));
  const normalGrantId = byId.get('refresh_normal_a')?.grantId;
  expect(normalGrantId).toEqual(expect.any(String));
  expect(byId.get('refresh_normal_b')?.grantId).toBe(normalGrantId);
  expect(byId.get('refresh_normal_b')?.revoked).toEqual(new Date('2026-01-01T00:00:00.000Z'));
  expect(byId.get('refresh_normal_b')?.scopes).toEqual(['work:write', 'offline_access']);
  expect(byId.get('refresh_normal_expired')?.grantId).toBe(normalGrantId);
  expect(byId.get('refresh_normal_expired')?.revoked).toEqual(new Date('2025-01-01T12:00:00.000Z'));
  expect(byId.get('refresh_trusted')?.grantId).toBeTruthy();
  expect(byId.get('refresh_trusted_single')?.grantId).toBeTruthy();
  for (const id of [
    'refresh_duplicate',
    'refresh_reference',
    'refresh_mixed',
    'refresh_reference_refresh',
    'refresh_orphan',
    'refresh_trusted_reference',
  ]) {
    expect(byId.get(id)?.grantId, id).toBeNull();
  }
  if (!normalGrantId) throw new Error('The ordinary migrated refresh did not receive a grant.');
  return normalGrantId;
}

async function assertClientCutoffs(): Promise<void> {
  const [summary] = await sql<
    { cutoffCount: number; missingCutoff: number; trustedClients: number }[]
  >`
    select count(distinct docket_legacy_before)::int as "cutoffCount",
      count(*) filter (where docket_legacy_before is null)::int as "missingCutoff",
      count(*) filter (where docket_legacy_trusted)::int as "trustedClients"
    from oauth_client
  `;
  expect(summary).toEqual({ cutoffCount: 1, missingCutoff: 0, trustedClients: 3 });
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  await client`
    insert into oauth_client (id, client_id, redirect_uris)
    values ('post_cutover_row', 'post_cutover_client', array['https://client.example.test/callback'])
  `;
  const [postCutover] = await client<{ cutoff: Date | null; trusted: boolean }[]>`
    select docket_legacy_before as cutoff, docket_legacy_trusted as trusted
    from oauth_client where client_id = 'post_cutover_client'
  `;
  await client.end();
  expect(postCutover).toEqual({ cutoff: null, trusted: false });
}

afterAll(async () => {
  await sql.end();
});

describe('OAuth resource grant migration on PostgreSQL', () => {
  it('backfills only unambiguous authority and enforces ownership constraints', async () => {
    await initializeLegacySchema();
    await assertMigrationRollback();
    await runMigrations();
    await assertGrantBackfill();
    const normalGrantId = await assertRefreshBackfill();
    await assertClientCutoffs();
    await assertOAuthResourceGrantStorage(sql, normalGrantId);
    await expect(runMigrations()).resolves.toBeUndefined();
  });
});
