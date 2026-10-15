import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { fullSchema } from '../../src/client';
import { migrateWithWorkTemplateCheckpoint } from '../../src/migrate-work-templates';
import { withMigrationPrefix } from '../../src/migration-prefix';
import { backfillWorkScheduleArchives, hashScheduleArchive } from '../../src/work-schedule-archive';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';
import { prepareBlueprintRetainedFixture } from '../fixtures/work-template-blueprint-migration';
import type { Database } from '../../src/client';

type Mutation =
  'unchanged' | 'child_sort' | 'root_sort' | 'header' | 'pending_sort' | 'prior_archive';
async function savePriorArchive(database: Database, revisionId: string): Promise<void> {
  // Reproduce a semantically unproved snapshot accepted by the earlier archiver.
  const [snapshot] = await migrationRows<{
    source: Record<string, unknown>;
    header: Record<string, unknown>;
    revisionAudit: Record<string, unknown>;
  }>(
    database,
    sql`select docket_blueprint_retained_source(r.id) as source,to_jsonb(d) as header,to_jsonb(r) as "revisionAudit" from process_revision r join process_definition d on d.id=r.definition_id where r.id=${revisionId}`,
  );
  if (!snapshot) throw new Error('Missing retained snapshot');
  const archive = { revision: 1, ...snapshot };
  await database.execute(
    sql`update work_template_blueprint_conversion set source_archive=${JSON.stringify(archive)}::jsonb,source_archive_hash=${hashScheduleArchive(archive)},source_archive_hash_version=1 where legacy_process_revision_id=${revisionId}`,
  );
}
async function mutateSource(
  database: Database,
  mutation: Mutation,
  revisionId: string,
  childId: string,
): Promise<void> {
  if (mutation === 'child_sort' || mutation === 'prior_archive')
    await database.execute(sql`update process_step set sort=sort+1 where id=${childId}`);
  if (mutation === 'root_sort')
    await database.execute(
      sql`update process_step set sort=sort+1 where revision_id=${revisionId} and kind='project'`,
    );
  if (mutation === 'header')
    await database.execute(
      sql`update process_definition set name='Renamed retained process' where id=(select definition_id from process_revision where id=${revisionId})`,
    );
  if (mutation === 'pending_sort')
    await database.execute(
      sql`update process_step set sort=sort+1 where revision_id=${revisionId}`,
    );
  if (mutation === 'prior_archive') await savePriorArchive(database, revisionId);
}
describe('first source archival original ordering', () => {
  it.each<Mutation>([
    'unchanged',
    'child_sort',
    'root_sort',
    'header',
    'pending_sort',
    'prior_archive',
  ])('proves original order or refuses %s without rewriting the original MD5', async (mutation) => {
    const client = new PGlite('memory://');
    const database = drizzle(client, { schema: fullSchema });
    try {
      const options = {
        migrationsFolder: resolve(import.meta.dirname, '../../drizzle'),
        applySqlMigrations: (folder: string) => migrate(database, { migrationsFolder: folder }),
      };
      const fixture = await prepareBlueprintRetainedFixture(database, options);
      await withMigrationPrefix(
        options.migrationsFolder,
        '0159_retained_root_resolutions',
        async (folder) =>
          migrateWithWorkTemplateCheckpoint(database, { ...options, migrationsFolder: folder }),
      );
      // Expand with the normal SQL migrator but intentionally leave the first archival checkpoint pending.
      await withMigrationPrefix(
        options.migrationsFolder,
        '0160_schedule_invocation_heads_expand',
        options.applySqlMigrations,
      );
      const revisionId =
        mutation === 'pending_sort' ? fixture.draftRevisionId : fixture.forestRevisionId;
      const original = await migrationRows<{ fingerprint: string }>(
        database,
        sql`select source_fingerprint as fingerprint from work_template_blueprint_conversion where legacy_process_revision_id=${revisionId}`,
      );
      await mutateSource(database, mutation, revisionId, fixture.forestTaskStepId);
      if (mutation === 'unchanged') await backfillWorkScheduleArchives(database);
      else
        await expect(backfillWorkScheduleArchives(database)).rejects.toThrow(
          mutation === 'child_sort' || mutation === 'prior_archive'
            ? 'ordering differs'
            : 'ordering cannot be proved',
        );
      const [saved] = await migrationRows<{ fingerprint: string; archived: boolean }>(
        database,
        sql`select source_fingerprint as fingerprint,source_archive is not null as archived from work_template_blueprint_conversion where legacy_process_revision_id=${revisionId}`,
      );
      expect(saved?.fingerprint).toBe(original[0]?.fingerprint);
      expect(saved?.archived).toBe(mutation === 'unchanged' || mutation === 'prior_archive');
      const [retained] = await migrationRows<{ count: number }>(
        database,
        sql`select count(*)::integer as count from process_step where revision_id=${revisionId}`,
      );
      expect(retained?.count).toBeGreaterThan(0);
    } finally {
      await client.close();
    }
  });
});
