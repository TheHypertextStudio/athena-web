import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/** Values stored as UTC wall clocks by the original reviewer schema. */
const legacy = '2026-11-01 08:30:00';

describe('reviewer timestamp migration', () => {
  let client: PGlite;
  beforeEach(async () => {
    client = new PGlite('memory://');
    await client.exec(`
      CREATE TABLE demo (
        id text PRIMARY KEY, expires_at timestamp,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      );
      CREATE TABLE demo_workspace (
        id text PRIMARY KEY, provisioned_at timestamp NOT NULL DEFAULT now(),
        last_reset_at timestamp, expires_at timestamp
      );
      CREATE INDEX demo_workspace_expires_idx ON demo_workspace (expires_at);
      INSERT INTO demo VALUES ('kept', '${legacy}', '${legacy}', '${legacy}');
      INSERT INTO demo VALUES ('nullable', NULL, '${legacy}', '${legacy}');
      INSERT INTO demo_workspace VALUES ('kept', '${legacy}', '${legacy}', '${legacy}');
      INSERT INTO demo_workspace VALUES ('nullable', '${legacy}', NULL, NULL);
      SET TIME ZONE 'America/Los_Angeles';
    `);
  });
  afterEach(async () => {
    await client.close();
  });

  it('preserves UTC instants and nulls even when the migration session uses another timezone', async () => {
    const migration = await readFile(
      resolve(import.meta.dirname, '../../drizzle/0186_demo_timestamp_instants.sql'),
      'utf8',
    );
    await client.exec(migration.replaceAll('--> statement-breakpoint', ''));
    const demo = await client.query<{ expires_at: Date; created_at: Date; updated_at: Date }>(
      "SELECT expires_at, created_at, updated_at FROM demo WHERE id = 'kept'",
    );
    const workspace = await client.query<{
      provisioned_at: Date;
      last_reset_at: Date;
      expires_at: Date;
    }>("SELECT provisioned_at, last_reset_at, expires_at FROM demo_workspace WHERE id = 'kept'");
    const times = [
      ...demo.rows.flatMap((row) => Object.values(row)),
      ...workspace.rows.flatMap((row) => Object.values(row)),
    ];
    expect(times.map((value) => value.toISOString())).toEqual(
      Array.from({ length: 6 }, () => '2026-11-01T08:30:00.000Z'),
    );
    expect((await client.query("SELECT expires_at FROM demo WHERE id = 'nullable'")).rows).toEqual([
      { expires_at: null },
    ]);
    expect(
      (
        await client.query(
          "SELECT last_reset_at, expires_at FROM demo_workspace WHERE id = 'nullable'",
        )
      ).rows,
    ).toEqual([{ last_reset_at: null, expires_at: null }]);
    const columns = await client.query<{ data_type: string }>(
      "SELECT data_type FROM information_schema.columns WHERE table_name IN ('demo','demo_workspace') AND column_name <> 'id'",
    );
    expect(columns.rows).toHaveLength(6);
    expect(columns.rows.every((column) => column.data_type === 'timestamp with time zone')).toBe(
      true,
    );
    const indexes = await client.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'demo_workspace' AND indexname = 'demo_workspace_expires_idx'",
    );
    expect(indexes.rows).toEqual([{ indexname: 'demo_workspace_expires_idx' }]);
    await client.exec(
      "INSERT INTO demo (id) VALUES ('fresh'); INSERT INTO demo_workspace (id) VALUES ('fresh')",
    );
    const defaults = await client.query<{ current: boolean }>(
      "SELECT abs(extract(epoch FROM created_at - now())) < 2 AND abs(extract(epoch FROM updated_at - now())) < 2 AS current FROM demo WHERE id = 'fresh' UNION ALL SELECT abs(extract(epoch FROM provisioned_at - now())) < 2 AS current FROM demo_workspace WHERE id = 'fresh'",
    );
    expect(defaults.rows).toEqual([{ current: true }, { current: true }]);
  });
});
