import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { expect, it } from 'vitest';
import { fullSchema } from '../../src/client';
import { migrateWithWorkTemplateCheckpoint } from '../../src/migrate-work-templates';
import { withMigrationPrefix } from '../../src/migration-prefix';
import { verifyWorkScheduleArchives } from '../../src/work-schedule-archive';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';
import { prepareBlueprintRetainedFixture } from '../fixtures/work-template-blueprint-migration';

async function fixture() {
  const client = new PGlite('memory://');
  const database = drizzle(client, { schema: fullSchema });
  const options = {
    migrationsFolder: resolve(import.meta.dirname, '../../drizzle'),
    applySqlMigrations: (folder: string) => migrate(database, { migrationsFolder: folder }),
  };
  const source = await prepareBlueprintRetainedFixture(database, options);
  await withMigrationPrefix(
    options.migrationsFolder,
    '0159_retained_root_resolutions',
    async (folder) =>
      migrateWithWorkTemplateCheckpoint(database, { ...options, migrationsFolder: folder }),
  );
  return { client, database, options, source };
}
it('ordinary upgrades accept legitimate legacy rename/completion without rewriting frozen evidence', async () => {
  const f = await fixture();
  try {
    // Exercise the real pre-canonical ownership upgrade boundary: legacy metadata
    // remains editable until 0165 takes ownership, then canonical heads own it.
    await withMigrationPrefix(
      f.options.migrationsFolder,
      '0164_schedule_native_date_undo',
      (folder) =>
        migrateWithWorkTemplateCheckpoint(f.database, { ...f.options, migrationsFolder: folder }),
    );
    const before = await migrationRows(
      f.database,
      sql`select c.legacy_process_revision_id,c.source_fingerprint,c.source_archive,c.source_archive_hash,i.manifest,i.overrides from work_template_blueprint_conversion c join work_template_blueprint_invocation i on i.id=c.invocation_id order by c.legacy_process_revision_id`,
    );
    const history = await migrationRows(
      f.database,
      sql`select id,historical_archive,historical_archive_hash from process_occurrence where historical_archive is not null order by id`,
    );
    await f.database.execute(
      sql`update process_definition set name='Legitimate renamed dinner' where id=(select definition_id from process_revision where id=${f.source.forestRevisionId})`,
    );
    await f.database.execute(
      sql`update process_instance set status='completed',completed_at=now() where organization_id=${f.source.organizationId}`,
    );
    await expect(migrateWithWorkTemplateCheckpoint(f.database, f.options)).resolves.toBeUndefined();
    expect(
      await migrationRows(
        f.database,
        sql`select c.legacy_process_revision_id,c.source_fingerprint,c.source_archive,c.source_archive_hash,i.manifest,i.overrides from work_template_blueprint_conversion c join work_template_blueprint_invocation i on i.id=c.invocation_id order by c.legacy_process_revision_id`,
      ),
    ).toEqual(before);
    expect(
      await migrationRows(
        f.database,
        sql`select id,historical_archive,historical_archive_hash from process_occurrence where historical_archive is not null order by id`,
      ),
    ).toEqual(history);
    await expect(verifyWorkScheduleArchives(f.database)).rejects.toThrow(/stale|changed/);
  } finally {
    await f.client.close();
  }
});
it('ordinary first archival defers unproved source order while strict retirement still refuses it', async () => {
  const f = await fixture();
  try {
    await f.options.applySqlMigrations(f.options.migrationsFolder);
    const before = await migrationRows(
      f.database,
      sql`select c.legacy_process_revision_id,c.source_fingerprint,i.manifest,i.overrides from work_template_blueprint_conversion c join work_template_blueprint_invocation i on i.id=c.invocation_id order by c.legacy_process_revision_id`,
    );
    await f.database.execute(
      sql`update process_definition set name='Header edit with no independent root-order proof' where id=(select definition_id from process_revision where id=${f.source.forestRevisionId})`,
    );
    let deferred = 0;
    await expect(
      migrateWithWorkTemplateCheckpoint(f.database, {
        ...f.options,
        onScheduleArchiveBatch: (progress) => {
          deferred += progress.deferredRevisions ?? 0;
        },
      }),
    ).resolves.toBeUndefined();
    expect(deferred).toBeGreaterThan(0);
    const [row] = await migrationRows<{ archived: boolean; retained: number }>(
      f.database,
      sql`select c.source_archive is not null as archived,(select count(*)::integer from process_step where revision_id=c.legacy_process_revision_id) as retained from work_template_blueprint_conversion c where c.legacy_process_revision_id=${f.source.forestRevisionId}`,
    );
    expect(row?.archived).toBe(false);
    expect(row?.retained).toBeGreaterThan(0);
    expect(
      await migrationRows(
        f.database,
        sql`select c.legacy_process_revision_id,c.source_fingerprint,i.manifest,i.overrides from work_template_blueprint_conversion c join work_template_blueprint_invocation i on i.id=c.invocation_id order by c.legacy_process_revision_id`,
      ),
    ).toEqual(before);
    await expect(verifyWorkScheduleArchives(f.database)).rejects.toThrow(
      /incomplete|ordering|stale/,
    );
  } finally {
    await f.client.close();
  }
});

it('ordinary upgrades resume committed batches after interruption without restamping changed sources', async () => {
  const f = await fixture();
  try {
    const interruption = new Error('Interrupted after a committed archive batch');
    await expect(
      migrateWithWorkTemplateCheckpoint(f.database, {
        ...f.options,
        batchSize: 1,
        onScheduleArchiveBatch: () => {
          throw interruption;
        },
      }),
    ).rejects.toBe(interruption);
    const [archived] = await migrationRows<{ id: string; archive: unknown; hash: string }>(
      f.database,
      sql`select legacy_process_revision_id as id,source_archive as archive,source_archive_hash as hash from work_template_blueprint_conversion where source_archive is not null`,
    );
    if (!archived) throw new Error('Missing committed source archive');
    await f.database.execute(
      sql`update process_definition set name='Renamed between checkpoint attempts' where id=(select definition_id from process_revision where id=${archived.id})`,
    );
    await expect(migrateWithWorkTemplateCheckpoint(f.database, f.options)).resolves.toBeUndefined();
    const [after] = await migrationRows<{ id: string; archive: unknown; hash: string }>(
      f.database,
      sql`select legacy_process_revision_id as id,source_archive as archive,source_archive_hash as hash from work_template_blueprint_conversion where legacy_process_revision_id=${archived.id}`,
    );
    expect(after).toEqual(archived);
    const [remaining] = await migrationRows<{ count: number }>(
      f.database,
      sql`select count(*)::integer as count from work_template_blueprint_conversion where source_archive is null`,
    );
    expect(remaining?.count).toBe(0);
    await expect(verifyWorkScheduleArchives(f.database)).rejects.toThrow(/stale|changed/);
  } finally {
    await f.client.close();
  }
});
