import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import postgres, { type Sql } from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

import { main as runMigrations } from '../../src/migrate';

const databaseUrl = process.env['DATABASE_URL'] ?? '';
const migrationsDirectory = resolve(import.meta.dirname, '../../drizzle');
const sql = postgres(databaseUrl, {
  connection: { TimeZone: 'UTC' },
  max: 2,
  prepare: false,
});

async function applyMigrationsBefore0131(client: Sql): Promise<void> {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d{4}_.+\.sql$/.test(file) && file < '0131_')
    .sort();
  for (const file of files) {
    await client.unsafe(await readFile(resolve(migrationsDirectory, file), 'utf8'));
  }
}

async function recordMigrationsBefore0131(client: Sql): Promise<void> {
  const journal = JSON.parse(
    await readFile(resolve(migrationsDirectory, 'meta/_journal.json'), 'utf8'),
  ) as { entries: { idx: number; when: number }[] };
  const last = journal.entries.filter(({ idx }) => idx < 131).at(-1);
  if (!last) throw new Error('The migration journal has no pre-0131 entry.');
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
    values ('pre-0131-http-contract-fixture', ${last.when})
  `;
}

async function initializeLegacySchema(): Promise<void> {
  expect(databaseUrl).toMatch(/^postgres(?:ql)?:/);
  await sql.unsafe(
    'drop schema if exists drizzle cascade; drop schema public cascade; create schema public',
  );
  await applyMigrationsBefore0131(sql);
  await recordMigrationsBefore0131(sql);
  await sql`
    insert into "user" (id, name, email)
    values ('http-storage-user', 'HTTP storage user', 'http-storage@example.test')
  `;
  await sql`
    insert into hub (id, user_id, name)
    values ('http-storage-hub', 'http-storage-user', 'HTTP storage Hub')
  `;
  await sql`
    insert into work_schedule_plan (
      id, hub_id, anchor_date, timezone, effective_from, cycle_days
    ) values (
      'http-storage-plan', 'http-storage-hub', '2026-09-07', 'UTC', '2026-09-07',
      '[{"segments":[]}]'::jsonb
    )
  `;
  await sql`
    insert into idempotency_key (
      user_id, key, method, path, request_hash, response_status, response_body,
      status, expires_at, created_at
    ) values (
      'http-storage-user', 'legacy-key', 'POST', '/v1/creates', 'legacy-hash', 201,
      '{"id":"legacy-result"}'::jsonb, 'completed',
      '2026-09-14T02:00:00.000Z'::timestamptz,
      '2026-09-12T02:00:00.000Z'::timestamptz
    )
  `;
}

async function resetToFreshMigratedDatabase(): Promise<void> {
  await sql.unsafe(
    'drop schema if exists drizzle cascade; drop schema public cascade; create schema public',
  );
  await runMigrations();
}

afterAll(async () => {
  await sql.end();
});

describe('public HTTP storage migration on PostgreSQL', () => {
  it('preserves legacy deadlines and advances one schedule revision for every row writer', async () => {
    await initializeLegacySchema();
    await runMigrations();

    const [receipt] = await sql<
      {
        apiVersion: string;
        callerNamespace: string;
        createdAt: Date;
        expiresAt: Date;
        format: string;
        headers: Record<string, string>;
        status: string;
        responseStatus: number;
      }[]
    >`
      select api_version as "apiVersion", caller_namespace as "callerNamespace",
        created_at as "createdAt", expires_at as "expiresAt", receipt_format as format,
        response_headers as headers, status, response_status as "responseStatus"
      from api_idempotency_receipt
      where user_id = 'http-storage-user' and key = 'legacy-key'
    `;
    expect(receipt).toEqual({
      apiVersion: '0.1.0',
      callerNamespace: 'session',
      createdAt: new Date('2026-09-12T02:00:00.000Z'),
      expiresAt: new Date('2026-09-14T02:00:00.000Z'),
      format: 'legacy-json',
      headers: {},
      responseStatus: 201,
      status: 'completed',
    });

    const revision = async (): Promise<number> => {
      const [row] = await sql<{ revision: number }[]>`
        select revision::int as revision from work_schedule_aggregate_revision
        where hub_id = 'http-storage-hub'
      `;
      if (!row) throw new Error('The work-schedule revision row is missing.');
      return row.revision;
    };
    expect(await revision()).toBe(1);
    await sql`
      update work_schedule_plan set timezone = 'America/Los_Angeles'
      where id = 'http-storage-plan'
    `;
    expect(await revision()).toBe(2);
    await sql`
      insert into work_schedule_exception (
        id, hub_id, plan_version_id, date, segments, origin
      ) values (
        'http-storage-exception', 'http-storage-hub', 'http-storage-plan',
        '2026-09-08', '[]'::jsonb, 'provider'
      )
    `;
    expect(await revision()).toBe(3);
    await sql`
      update work_schedule_exception set origin = 'docket'
      where id = 'http-storage-exception'
    `;
    expect(await revision()).toBe(4);
    await sql`delete from work_schedule_exception where id = 'http-storage-exception'`;
    expect(await revision()).toBe(5);
    await sql`delete from hub where id = 'http-storage-hub'`;
    const [deleted] = await sql<{ count: number }[]>`
      select count(*)::int as count from work_schedule_aggregate_revision
      where hub_id = 'http-storage-hub'
    `;
    expect(deleted?.count).toBe(0);

    await resetToFreshMigratedDatabase();
    const [fresh] = await sql<{ receipt: string | null; revision: string | null }[]>`
      select to_regclass('public.api_idempotency_receipt')::text as receipt,
        to_regclass('public.work_schedule_aggregate_revision')::text as revision
    `;
    expect(fresh).toEqual({
      receipt: 'api_idempotency_receipt',
      revision: 'work_schedule_aggregate_revision',
    });
  });
});
