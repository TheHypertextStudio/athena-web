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
  it('persists native forests and registers tenant-bound drafts and fallbacks exactly once', async () => {
    const { exerciseNativeScheduleStorage } = await import('../fixtures/work-schedule-storage');
    await exerciseNativeScheduleStorage(database, fixture);
  });
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
    const defaults = await readScheduleHistoricalReferences(database, {
      organizationId: fixture.organizationId,
      occurrenceId: id,
    });
    expect(defaults).toEqual({ references: references.slice(0, 100), nextOffset: 100 });
    expect(
      await readScheduleHistoricalReferences(database, {
        organizationId: genId(),
        occurrenceId: id,
      }),
    ).toEqual({ references: [], nextOffset: null });
    expect(
      await readScheduleHistoricalReferences(database, {
        organizationId: fixture.organizationId,
        occurrenceId: id,
        offset: 601,
      }),
    ).toEqual({ references: [], nextOffset: null });
    for (const pagination of [
      { offset: -1 },
      { offset: 0.5 },
      { limit: 0 },
      { limit: 501 },
      { limit: 1.5 },
    ])
      await expect(
        readScheduleHistoricalReferences(database, {
          organizationId: fixture.organizationId,
          occurrenceId: id,
          ...pagination,
        }),
      ).rejects.toThrow(RangeError);
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
  it('retains unmapped selected identities and avoids duplicating live mappings', async () => {
    const { archiveHistoricalSelections } =
      await import('../../src/work-schedule-archive-selections');
    expect(await archiveHistoricalSelections(database, null, [])).toEqual([]);
    const [occurrence] = await migrationRows<{
      id: string;
      roots: { key: string; kind: string; id: string }[];
    }>(
      database,
      sql`select id,blueprint_root_refs as roots from process_occurrence where organization_id=${fixture.organizationId} and blueprint_invocation_id is not null and blueprint_root_refs is not null order by id limit 1`,
    );
    if (!occurrence) throw new Error('Missing retained occurrence.');
    const retained = await archiveHistoricalSelections(database, occurrence.id, []);
    expect(retained).toEqual(
      occurrence.roots
        .map((root) => ({
          rootKey: root.key,
          selection: { path: [], kind: root.kind, id: root.id },
          deleted: false,
        }))
        .sort((a, b) => a.rootKey.localeCompare(b.rootKey)),
    );
    const mappings = occurrence.roots.map((root) => ({
      kind: root.kind,
      mapping: { [`${root.kind}_id`]: root.id },
    }));
    expect(await archiveHistoricalSelections(database, occurrence.id, mappings)).toEqual([]);
    const project = occurrence.roots.find((root) => root.kind === 'project');
    if (!project) throw new Error('Missing retained project.');
    const rollback = new Error('Roll back deleted selection fixture');
    await expect(
      database.transaction(async (tx) => {
        await tx.execute(sql`delete from project where id=${project.id}`);
        expect(await archiveHistoricalSelections(tx, occurrence.id, [])).toContainEqual({
          rootKey: project.key,
          selection: { path: [], kind: project.kind, id: project.id },
          deleted: true,
        });
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
  it('preserves every original immutable invocation and original fingerprint across resumable conversion', async () => {
    const { backfillWorkScheduleArchives, verifyWorkScheduleArchives } =
      await import('../../src/work-schedule-archive');
    const original = await migrationRows(
      database,
      sql`select c.legacy_process_revision_id,c.source_fingerprint,i.manifest,i.overrides from work_template_blueprint_conversion c join work_template_blueprint_invocation i on i.id=c.invocation_id order by c.legacy_process_revision_id`,
    );
    const historical: { id: string; status: string }[] = [];
    for (const status of ['completed', 'canceled', 'failed', 'pending', 'active']) {
      const id = genId();
      await database.execute(
        sql`insert into process_instance(id,organization_id,definition_id,revision_id,status) select ${id},organization_id,definition_id,id,${status}::process_instance_status from process_revision where id=${fixture.forestRevisionId}`,
      );
      historical.push({
        id,
        status: ['pending', 'active'].includes(status) ? 'needs_resolution' : status,
      });
    }
    for (const batchSize of [0, 1001, 1.5])
      await expect(backfillWorkScheduleArchives(database, { batchSize })).rejects.toThrow(
        RangeError,
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
    for (const expected of historical) {
      const [saved] = await migrationRows<{
        id: string;
        status: string;
        runKind: string;
        references: unknown;
      }>(
        database,
        sql`select legacy_instance_id as id,status,run_kind as "runKind",historical_archive->'references' as references from process_occurrence where legacy_instance_id=${expected.id}`,
      );
      expect(saved).toEqual({ ...expected, runKind: 'historical', references: [] });
    }
    const rollback = new Error('Roll back changed historical source');
    await expect(
      database.transaction(async (tx) => {
        await tx.execute(
          sql`update process_instance set status='failed' where id=${historical[0]?.id}`,
        );
        await expect(verifyWorkScheduleArchives(tx)).rejects.toThrow(
          'Historical instance source changed',
        );
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    await expect(
      database.transaction(async (tx) => {
        await tx.execute(
          sql`insert into process_instance(id,organization_id,definition_id,revision_id) select ${genId()},organization_id,definition_id,id from process_revision where id=${fixture.forestRevisionId}`,
        );
        await expect(verifyWorkScheduleArchives(tx)).rejects.toThrow(
          'Schedule instance archive is incomplete',
        );
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    const { verifyHistoricalMappingArchives } =
      await import('../../src/work-schedule-archive-selections');
    await expect(
      database.transaction(async (tx) => {
        await tx.execute(
          sql`delete from process_instance_task where organization_id=${fixture.organizationId}`,
        );
        await expect(verifyHistoricalMappingArchives(tx)).rejects.toThrow(
          'Historical instance mappings changed',
        );
        throw rollback;
      }),
    ).rejects.toBe(rollback);
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
