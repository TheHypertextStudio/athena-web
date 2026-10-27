import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';

it('preserves existing receipt UTC instants, nulls, cleanup indexes and defaults outside UTC', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TYPE attachment_subject_type AS ENUM ('task');
      CREATE TABLE organization (id text PRIMARY KEY);
      CREATE TABLE actor (id text PRIMARY KEY);
      INSERT INTO organization VALUES ('org');
      INSERT INTO actor VALUES ('actor');
    `);
    const migration = (name: string) =>
      readFileSync(resolve(import.meta.dirname, '../../drizzle', name), 'utf8');
    await db.exec(migration('0189_mcp_resource_writes.sql'));
    await db.exec(`
      INSERT INTO resource_write_receipt
        (organization_id, actor_id, namespace, request_id, request_hash, attachment_id, completed_at, created_at)
      VALUES ('org', 'actor', 'resources', 'kept', 'hash', 'file', '2026-11-01 08:30:00', '2026-11-01 08:30:00'),
             ('org', 'actor', 'resources', 'pending', 'hash', 'file', NULL, '2026-11-01 08:30:00');
      SET TIME ZONE 'America/Los_Angeles';
    `);
    await db.exec(migration('0191_resource_receipt_timestamp_instants.sql'));
    const rows = await db.query<{
      request_id: string;
      completed_at: Date | null;
      created_at: Date;
    }>(
      'SELECT request_id, completed_at, created_at FROM resource_write_receipt ORDER BY request_id',
    );
    expect(
      rows.rows.map((row) => ({
        id: row.request_id,
        completed: row.completed_at?.toISOString() ?? null,
        created: row.created_at.toISOString(),
      })),
    ).toEqual([
      { id: 'kept', completed: '2026-11-01T08:30:00.000Z', created: '2026-11-01T08:30:00.000Z' },
      { id: 'pending', completed: null, created: '2026-11-01T08:30:00.000Z' },
    ]);
    const columns = await db.query<{ data_type: string }>(
      "SELECT data_type FROM information_schema.columns WHERE table_name = 'resource_write_receipt' AND column_name IN ('created_at', 'completed_at')",
    );
    expect(columns.rows).toEqual([
      { data_type: 'timestamp with time zone' },
      { data_type: 'timestamp with time zone' },
    ]);
    const indexes = await db.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename = 'resource_write_receipt' AND indexname IN ('resource_write_receipt_cleanup_idx', 'resource_write_receipt_rate_idx') ORDER BY indexname",
    );
    expect(indexes.rows).toEqual([
      { indexname: 'resource_write_receipt_cleanup_idx' },
      { indexname: 'resource_write_receipt_rate_idx' },
    ]);
    await db.exec(
      "INSERT INTO resource_write_receipt (organization_id, actor_id, namespace, request_id, request_hash, attachment_id) VALUES ('org', 'actor', 'resources', 'fresh', 'hash', 'file')",
    );
    const defaults = await db.query<{ current: boolean; completed_at: null }>(
      "SELECT abs(extract(epoch FROM created_at - now())) < 2 AS current, completed_at FROM resource_write_receipt WHERE request_id = 'fresh'",
    );
    expect(defaults.rows).toEqual([{ current: true, completed_at: null }]);
  } finally {
    await db.close();
  }
});
