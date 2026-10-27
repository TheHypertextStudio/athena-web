import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { fileUpload } from '../../src/schema/file-upload';
import { resourceWriteReceipt } from '../../src/schema/resource-write';
import { aiCallUsage } from '../../src/schema/ai-call-usage';

const resources = readFileSync(
  resolve(import.meta.dirname, '../../drizzle/0189_mcp_resource_writes.sql'),
  'utf8',
);
const uploads = readFileSync(
  resolve(import.meta.dirname, '../../drizzle/0190_resumable_file_uploads.sql'),
  'utf8',
);

describe('resumable upload migration adoption', () => {
  it('preserves cleanup reservations independently of deleted work and retains usage attribution', () => {
    const uploads = getTableConfig(fileUpload);
    expect(uploads.foreignKeys).toHaveLength(0);
    expect(uploads.enableRLS).toBe(true);
    expect(uploads.indexes.map((index) => index.config.name)).toContain('file_upload_cleanup_idx');
    const receipts = getTableConfig(resourceWriteReceipt);
    expect(
      receipts.foreignKeys.map((key) => [getTableName(key.reference().foreignTable), key.onDelete]),
    ).toEqual([
      ['organization', 'cascade'],
      ['actor', 'cascade'],
    ]);
    const usage = getTableConfig(aiCallUsage);
    expect(
      usage.foreignKeys.map((key) => [getTableName(key.reference().foreignTable), key.onDelete]),
    ).toEqual([
      ['user', 'set null'],
      ['organization', 'set null'],
    ]);
  });
  it('adopts an already-created staging schema without losing reservations or relaxing the file limit', async () => {
    const db = new PGlite();
    try {
      await db.exec(`CREATE TYPE attachment_subject_type AS ENUM ('task');
        CREATE TABLE organization (id text PRIMARY KEY);
        CREATE TABLE actor (id text PRIMARY KEY);`);
      await db.exec(resources);
      await db.exec(uploads);
      await db.exec(`INSERT INTO file_upload
        (id, organization_id, actor_id, owner_key, performer_kind, request_id, request_hash,
         subject_type, file_name, mime_type, title, byte_size, crc32c, attachment_id, blob_key, expires_at)
        VALUES ('owned', 'org', 'actor', 'owner', 'person', 'request', 'hash', 'task',
                'report.bin', 'application/octet-stream', 'Report', 104857600, 'AAAAAA==', 'file', 'key', now());`);
      await db.exec(resources);
      await db.exec(uploads);
      const rows = await db.query('SELECT id, byte_size, state FROM file_upload');
      expect(rows.rows).toEqual([{ id: 'owned', byte_size: 104857600, state: 'pending' }]);
      await expect(db.exec('UPDATE file_upload SET byte_size = 104857601')).rejects.toMatchObject({
        code: '23514',
      });
      await expect(db.exec("UPDATE file_upload SET state = 'unknown'")).rejects.toMatchObject({
        code: '23514',
      });
    } finally {
      await db.close();
    }
  });
});
