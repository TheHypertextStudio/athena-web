import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fullSchema } from '../../src/client';
import { genId } from '../../src/id';
import { migrateWithWorkTemplateCheckpoint } from '../../src/migrate-work-templates';
import {
  prepareBlueprintRetainedFixture,
  type BlueprintRetainedFixture,
} from '../fixtures/work-template-blueprint-migration';
import { withMigrationPrefix } from '../../src/migration-prefix';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';

const client = new PGlite('memory://');
const database = drizzle(client, { schema: fullSchema });
let fixture: BlueprintRetainedFixture;
beforeAll(async () => {
  const options = {
    migrationsFolder: resolve(import.meta.dirname, '../../drizzle'),
    applySqlMigrations: (folder: string) => migrate(database, { migrationsFolder: folder }),
  };
  fixture = await prepareBlueprintRetainedFixture(database, options);
  await withMigrationPrefix(
    options.migrationsFolder,
    '0159_retained_root_resolutions',
    async (folder) =>
      migrateWithWorkTemplateCheckpoint(database, { ...options, migrationsFolder: folder }),
  );
  for (const migration of [
    '0160_schedule_invocation_heads_expand',
    '0161_schedule_private_scope',
  ]) {
    const expansion = await readFile(
      resolve(import.meta.dirname, `../../drizzle/${migration}.sql`),
      'utf8',
    );
    for (const statement of expansion.split('--> statement-breakpoint'))
      if (statement.trim()) await database.execute(sql.raw(statement));
  }
});
afterAll(async () => client.close());

describe('canonical schedule storage expansion', () => {
  it('stores a private definition head without creating visible wrapper work', async () => {
    const id = genId();
    const [before] = await migrationRows<{ count: number }>(
      database,
      sql`select count(*)::integer as count from program where organization_id=${fixture.organizationId}`,
    );
    await database.execute(
      sql`insert into work_template_invocation_head(id,organization_id,owner_actor_id,name,status) values(${id},${fixture.organizationId},${fixture.actorId},'Private forest','draft')`,
    );
    const [saved] = await migrationRows<{ revision: number }>(
      database,
      sql`select revision from work_template_invocation_head where id=${id}`,
    );
    expect(saved?.revision).toBe(1);
    await expect(
      database.execute(
        sql`update work_template_invocation_head set name='Stale edit' where id=${id}`,
      ),
    ).rejects.toThrow();
    await database.execute(
      sql`update work_template_invocation_head set name='Accepted edit',revision=2 where id=${id} and revision=1`,
    );
    await expect(
      database.execute(sql`update work_template_invocation_head set revision=1 where id=${id}`),
    ).rejects.toThrow();
    const [after] = await migrationRows<{ count: number }>(
      database,
      sql`select count(*)::integer as count from program where organization_id=${fixture.organizationId}`,
    );
    expect(after).toEqual(before);
  });
  it('retains accepted claims across failure and refuses stale attempts', async () => {
    const { exerciseScheduleClaims } = await import('../fixtures/work-schedule-storage');
    await exerciseScheduleClaims(database, fixture);
  });
  it('refuses foreign owners and false published pointers', async () => {
    const foreign = genId(),
      owner = genId();
    await database.execute(
      sql`insert into organization(id,name,slug) values(${foreign},'Foreign',${foreign.toLowerCase()})`,
    );
    await database.execute(
      sql`insert into actor(id,organization_id,kind,display_name) values(${owner},${foreign},'human','Foreign owner')`,
    );
    await expect(
      database.execute(
        sql`insert into work_template_invocation_head(id,organization_id,owner_actor_id,name,status) values(${genId()},${fixture.organizationId},${owner},'Foreign owner','draft')`,
      ),
    ).rejects.toThrow();
    await expect(
      database.execute(
        sql`insert into work_template_invocation_head(id,organization_id,owner_actor_id,name,status) values(${genId()},${fixture.organizationId},${fixture.actorId},'Unpublished','published')`,
      ),
    ).rejects.toThrow();
  });
  it('does not turn a pending private invocation into a published head', async () => {
    const [pending] = await migrationRows<{ invocation_id: string }>(
      database,
      sql`select invocation_id from work_template_blueprint_conversion where legacy_process_revision_id=${fixture.draftRevisionId}`,
    );
    if (!pending) throw new Error('Missing pending fixture invocation.');
    await expect(
      database.execute(sql`insert into work_template_invocation_head(
      id,organization_id,owner_actor_id,name,status,published_invocation_id
    ) values(${genId()},${fixture.organizationId},${fixture.actorId},'Pending source','published',${pending.invocation_id})`),
    ).rejects.toThrow();
  });
});

describe('nonexecuting historical pagination', () => {
  it('retains more than 500 historical references without scheduler eligibility', async () => {
    const { hashScheduleArchive } = await import('../../src/work-schedule-archive');
    const { readScheduleHistoricalReferences } = await import('../../src/work-schedule-history');
    const id = genId(),
      legacy = genId();
    const references = Array.from({ length: 601 }, (_, index) => ({
      sourceStepId: `historical-${index}`,
      kind: 'task',
      workId: `deleted-${index}`,
      deleted: true,
    }));
    const archive = { revision: 1, instance: { id: legacy, created_by: null }, references };
    await database.execute(
      sql`insert into process_occurrence(id,organization_id,scheduled_for,run_kind,legacy_instance_id,status,historical_archive,historical_archive_hash) values(${id},${fixture.organizationId},'2001-01-01','historical',${legacy},'completed',${JSON.stringify(archive)}::jsonb,${hashScheduleArchive(archive)})`,
    );
    const first = await readScheduleHistoricalReferences(database, {
      organizationId: fixture.organizationId,
      occurrenceId: id,
      limit: 500,
    });
    expect(first.references).toEqual(references.slice(0, 500));
    expect(first.nextOffset).toBe(500);
    const final = await readScheduleHistoricalReferences(database, {
      organizationId: fixture.organizationId,
      occurrenceId: id,
      offset: 500,
      limit: 500,
    });
    expect(final.references).toEqual(references.slice(500));
    expect(final.nextOffset).toBeNull();
  });
});

describe('private schedule scopes', () => {
  it('requires live creator or actual scope Manage in the restricted database role', async () => {
    const { exerciseSchedulePrivacy, exerciseOwnedSchedulePrivacy } =
      await import('../fixtures/work-schedule-privacy');
    await exerciseSchedulePrivacy(database, fixture);
    await exerciseOwnedSchedulePrivacy(database, fixture);
  });
});

describe('immutable source and historical archives', () => {
  it('preserves every original immutable invocation and original fingerprint across resumable conversion', async () => {
    const { backfillWorkScheduleArchives, verifyWorkScheduleArchives } =
      await import('../../src/work-schedule-archive');
    const original = await migrationRows(
      database,
      sql`select c.legacy_process_revision_id,c.source_fingerprint,i.manifest,i.overrides from work_template_blueprint_conversion c join work_template_blueprint_invocation i on i.id=c.invocation_id order by c.legacy_process_revision_id`,
    );
    await expect(
      backfillWorkScheduleArchives(database, {
        batchSize: 1,
        onScheduleArchiveBatch: () => {
          throw new Error('Interrupted after commit.');
        },
      }),
    ).rejects.toThrow('Interrupted after commit.');
    const [committed] = await migrationRows<{ count: number }>(
      database,
      sql`select count(*)::integer as count from work_template_blueprint_conversion where source_archive is not null`,
    );
    expect(committed?.count).toBe(1);
    await backfillWorkScheduleArchives(database, { batchSize: 1 });
    await verifyWorkScheduleArchives(database);
    expect(
      await migrationRows(
        database,
        sql`select c.legacy_process_revision_id,c.source_fingerprint,i.manifest,i.overrides from work_template_blueprint_conversion c join work_template_blueprint_invocation i on i.id=c.invocation_id order by c.legacy_process_revision_id`,
      ),
    ).toEqual(original);
    await expect(
      database.execute(
        sql`update work_template_blueprint_conversion set source_fingerprint='forged' where legacy_process_revision_id=${fixture.forestRevisionId}`,
      ),
    ).rejects.toThrow();
    await expect(
      database.execute(
        sql`update work_template_blueprint_conversion set source_archive='{}'::jsonb where legacy_process_revision_id=${fixture.forestRevisionId}`,
      ),
    ).rejects.toThrow();
    await database.execute(
      sql`update process_definition set description='Changed source' where id=(select definition_id from process_revision where id=${fixture.forestRevisionId})`,
    );
    await expect(verifyWorkScheduleArchives(database)).rejects.toThrow('stale');
  });
});
