import { requiredRow } from '../fixtures/required-row';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { expect, it } from 'vitest';
import { fullSchema } from '../../src/client';
import { migrateWithWorkTemplateCheckpoint } from '../../src/migrate-work-templates';
import { withMigrationPrefix } from '../../src/migration-prefix';
import { backfillWorkTemplateBlueprints } from '../../src/work-template-blueprint-backfill';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';
import {
  prepareBlueprintRetainedFixture,
  seedRetainedSingleTask,
} from '../fixtures/work-template-blueprint-migration';

it('preserves forest shape, private drafts and edited terminal work through interruption and late older IDs', async () => {
  const client = new PGlite('memory://');
  const database = drizzle(client, { schema: fullSchema });
  const options = {
    migrationsFolder: resolve(import.meta.dirname, '../../drizzle'),
    applySqlMigrations: (folder: string) => migrate(database, { migrationsFolder: folder }),
  };
  try {
    const fixture = await prepareBlueprintRetainedFixture(database, options);
    const before = await migrationRows<{ row: Record<string, unknown> }>(
      database,
      sql`select to_jsonb(t) as row from task t where id=${fixture.taskId}`,
    );
    const templateCount = await migrationRows<{ count: number }>(
      database,
      sql`select count(*)::integer as count from template`,
    );
    await withMigrationPrefix(
      options.migrationsFolder,
      '0154_work_template_blueprints_expand',
      options.applySqlMigrations,
    );
    await expect(
      backfillWorkTemplateBlueprints(database, {
        batchSize: 1,
        onBlueprintBatch: () => {
          throw new Error('Checkpoint interrupted after commit.');
        },
      }).catch((error: unknown) => {
        if (error instanceof Error && error.cause instanceof Error) throw error.cause;
        if (error instanceof Error) throw error;
        throw new Error('Unexpected test rejection.');
      }),
    ).rejects.toThrow('Checkpoint interrupted');
    expect(
      await migrationRows(
        database,
        sql`select legacy_process_revision_id from work_template_blueprint_conversion`,
      ),
    ).toHaveLength(1);
    const late = await seedRetainedSingleTask(database, {
      ...fixture,
      revisionId: '00000000000000000000000001',
    });
    await expect(options.applySqlMigrations(options.migrationsFolder)).rejects.toThrow();
    await migrateWithWorkTemplateCheckpoint(database, options);
    const [converted] = await migrationRows<{ definition: unknown }>(
      database,
      sql`select v.definition from work_type_version v join template t on t.id=v.work_type_id where t.organization_id=${fixture.organizationId} and t.target_type='project' and not t.is_base`,
    );
    expect(
      WorkTemplateDefinition.parse(requiredRow(converted).definition).blueprint.steps.find(
        (step) => step.key === 'task',
      )?.fields,
    ).toMatchObject({ state: 'in_progress' });
    expect(
      await migrationRows(
        database,
        sql`select legacy_process_revision_id from work_template_blueprint_conversion where legacy_process_revision_id=${late}`,
      ),
    ).toHaveLength(1);
    expect(
      await migrationRows(
        database,
        sql`select legacy_process_revision_id from work_template_blueprint_conversion`,
      ),
    ).toHaveLength(4);
    const [after] = await migrationRows<{ row: Record<string, unknown> }>(
      database,
      sql`select to_jsonb(t) as row from task t where id=${fixture.taskId}`,
    );
    for (const [key, value] of Object.entries(requiredRow(before[0]).row))
      expect(requiredRow(after).row[key]).toEqual(value);
    expect(requiredRow(after).row['blueprint_ever_started']).toBe(true);
    const bindings = requiredRow(after).row['blueprint_date_bindings'] as Record<
      string,
      { manual: boolean }
    >;
    expect(bindings['dueDate']?.manual).toBe(true);
    const [forest] = await migrationRows<{
      manifest: { roots: unknown[]; steps: unknown[] };
      overrides: unknown[];
    }>(
      database,
      sql`select i.manifest,i.overrides from work_template_blueprint_invocation i join work_template_blueprint_conversion c on c.invocation_id=i.id where c.legacy_process_revision_id=${fixture.forestRevisionId}`,
    );
    expect(requiredRow(forest).manifest.roots).toHaveLength(2);
    expect(requiredRow(forest).manifest.steps).toHaveLength(5);
    expect(JSON.stringify(requiredRow(forest).overrides)).toContain('Restricted Project body');
    const [draft] = await migrationRows<{
      manifest: { kind: string; roots: { workTypeVersionId: string | null }[] };
    }>(
      database,
      sql`select i.manifest from work_template_blueprint_invocation i join work_template_blueprint_conversion c on c.invocation_id=i.id where c.legacy_process_revision_id=${fixture.draftRevisionId}`,
    );
    expect(requiredRow(draft).manifest.kind).toBe('pending_draft');
    expect(requiredRow(draft).manifest.roots.every((root) => root.workTypeVersionId === null)).toBe(
      true,
    );
    const [countAfter] = await migrationRows<{ count: number }>(
      database,
      sql`select count(*)::integer as count from template`,
    );
    expect(requiredRow(countAfter).count).toBe(requiredRow(templateCount[0]).count + 1);
    expect(await migrationRows(database, sql`select id from program`)).toHaveLength(0);
    expect(await migrationRows(database, sql`select id from task`)).toHaveLength(1);
    const [privateDraft] = await migrationRows<{
      scope: string;
      publication_state: string;
      payload: unknown;
    }>(
      database,
      sql`select scope,publication_state,payload from template where id=${fixture.privateTemplateId}`,
    );
    expect(privateDraft).toMatchObject({ scope: 'personal', publication_state: 'draft' });
    expect(JSON.stringify(requiredRow(privateDraft).payload)).toContain(
      'library-file:private-image',
    );
    const versions = await migrationRows<{ definition: unknown }>(
      database,
      sql`select definition from work_type_version`,
    );
    expect(JSON.stringify(versions)).not.toContain('Restricted Project body');
    expect(await backfillWorkTemplateBlueprints(database)).toEqual({
      revisions: 0,
      publishedRoots: 0,
      preservedDrafts: 0,
    });
  } finally {
    await client.close();
  }
});
