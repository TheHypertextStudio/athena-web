import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/** The API's body anchor: the first 32 hex characters of SHA-256 over the description. */
function descriptionHash(description: string | null): string {
  return createHash('sha256')
    .update(description ?? '')
    .digest('hex')
    .slice(0, 32);
}

describe('task external body hash backfill migration', () => {
  let client: PGlite;

  beforeEach(async () => {
    client = new PGlite('memory://');
    await client.exec(`
      CREATE TABLE task (
        id text PRIMARY KEY,
        description text,
        source text NOT NULL,
        external_id text,
        external_updated_at timestamp,
        updated_at timestamp NOT NULL,
        external_body_hash text
      );
      INSERT INTO task VALUES
        ('clean', '## Brief — café ☕', 'linked', 'page-1', '2026-02-01', '2026-02-01', NULL),
        ('empty', NULL, 'linked', 'page-2', '2026-02-01', '2026-01-01', NULL),
        ('dirty', 'Unpushed edit', 'linked', 'page-3', '2026-02-01', '2026-03-01', NULL),
        ('anchored', 'Synced', 'linked', 'page-4', '2026-02-01', '2026-02-01', 'kept'),
        ('native', 'Native task', 'native', NULL, NULL, '2026-02-01', NULL);
    `);
  });

  afterEach(async () => {
    await client.close();
  });

  it('anchors in-step linked tasks to their descriptions and leaves the rest alone', async () => {
    const migration = await readFile(
      resolve(import.meta.dirname, '../../drizzle/0132_backfill_task_external_body_hash.sql'),
      'utf8',
    );

    await client.exec(migration);
    await client.exec(migration);

    const result = await client.query<{ id: string; external_body_hash: string | null }>(
      'SELECT id, external_body_hash FROM task ORDER BY id',
    );
    expect(result.rows).toEqual([
      { id: 'anchored', external_body_hash: 'kept' },
      { id: 'clean', external_body_hash: descriptionHash('## Brief — café ☕') },
      { id: 'dirty', external_body_hash: null },
      { id: 'empty', external_body_hash: descriptionHash(null) },
      { id: 'native', external_body_hash: null },
    ]);
  });
});
