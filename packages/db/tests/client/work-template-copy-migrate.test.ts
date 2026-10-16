import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { openPglite } from '../../src/client';
import { main } from '../../src/migrate';

it('applies copy storage through the real canonical PGlite runner and preserves its journal on reentry', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'docket-copy-canonical-migrate-'));
  const url = `pglite://${dir}`;
  vi.stubEnv('DATABASE_URL', url);
  vi.stubEnv('DATABASE_URL_UNPOOLED', '');
  try {
    await main();
    const client = openPglite(url);
    let before: unknown;
    try {
      const journal = await client.query<{ hash: string; created_at: string }>(
        'select hash,created_at from drizzle.__drizzle_migrations order by id',
      );
      before = journal.rows;
      expect(journal.rows).toHaveLength(168);
      const sql = readFileSync(
        resolve(
          import.meta.dirname,
          '../../drizzle/0167_work_template_copy_reference_integrity.sql',
        ),
      );
      expect(journal.rows.at(-1)?.hash).toBe(createHash('sha256').update(sql).digest('hex'));
      const actual = await client.query<{ epoch: boolean; guard: boolean }>(
        `select exists(select 1 from information_schema.columns where table_name='work_template_copy_entry' and column_name='reference_epoch') as epoch,exists(select 1 from pg_proc where proname='docket_copy_bundle_member_in_use') as guard`,
      );
      expect(actual.rows).toEqual([{ epoch: true, guard: true }]);
    } finally {
      await client.close();
    }
    await main();
    const reopened = openPglite(url);
    try {
      expect(
        (
          await reopened.query(
            'select hash,created_at from drizzle.__drizzle_migrations order by id',
          )
        ).rows,
      ).toEqual(before);
    } finally {
      await reopened.close();
    }
  } finally {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);
