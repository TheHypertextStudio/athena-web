import { requiredRow } from '../fixtures/required-row';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { expect, it } from 'vitest';
import { fullSchema, type Database } from '../../src/client';
import { migrateWithWorkTemplateCheckpoint } from '../../src/migrate-work-templates';
import { withMigrationPrefix } from '../../src/migration-prefix';
import { backfillWorkTemplateBlueprints } from '../../src/work-template-blueprint-backfill';
import { genId } from '../../src/id';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';
import {
  prepareBlueprintRetainedFixture,
  seedRetainedSingleTask,
  type BlueprintRetainedFixture,
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

async function fixtureCase(
  run: (database: Database, fixture: BlueprintRetainedFixture) => Promise<void>,
): Promise<void> {
  const client = new PGlite('memory://');
  const database = drizzle(client, { schema: fullSchema });
  const options = {
    migrationsFolder: resolve(import.meta.dirname, '../../drizzle'),
    applySqlMigrations: (folder: string) => migrate(database, { migrationsFolder: folder }),
  };
  try {
    const fixture = await prepareBlueprintRetainedFixture(database, options);
    await withMigrationPrefix(
      options.migrationsFolder,
      '0154_work_template_blueprints_expand',
      options.applySqlMigrations,
    );
    await run(database, fixture);
  } finally {
    await client.close();
  }
}

it('converts sibling completion timing, labels and pinned child selections without publishing literal placement', async () =>
  fixtureCase(async (database, fixture) => {
    const after = genId();
    const labelId = genId();
    const [source] = await migrationRows<{ project_step_id: string; milestone_step_id: string }>(
      database,
      sql`select project_step_id,milestone_step_id from process_task_spec where step_id=${fixture.forestTaskStepId}`,
    );
    const [base] = await migrationRows<{ id: string; version_id: string }>(
      database,
      sql`select id,latest_published_version_id as version_id from template where organization_id=${fixture.organizationId} and target_type='task' and is_base`,
    );
    await database.execute(
      sql`insert into label(id,organization_id,name,color) values(${labelId},${fixture.organizationId},'Retained label','blue')`,
    );
    await database.execute(
      sql`insert into process_step(id,organization_id,revision_id,key,kind,timing_kind,after_step_id,offset_days) values(${after},${fixture.organizationId},${fixture.forestRevisionId},'after','task','after_step_completion',${fixture.forestTaskStepId},2)`,
    );
    await database.execute(
      sql`insert into process_task_spec(step_id,organization_id,title,team_id,project_step_id,milestone_step_id,due_offset_days,estimate_minutes,work_type_id,work_type_version_id) values(${after},${fixture.organizationId},'After completion',${fixture.teamId},${requiredRow(source).project_step_id},${requiredRow(source).milestone_step_id},3,25,${requiredRow(base).id},${requiredRow(base).version_id})`,
    );
    await database.execute(
      sql`insert into process_task_label_spec(task_step_id,organization_id,label_id) values(${after},${fixture.organizationId},${labelId})`,
    );
    await database.execute(
      sql`insert into process_project_label_spec(project_step_id,organization_id,label_id) values(${requiredRow(source).project_step_id},${fixture.organizationId},${labelId})`,
    );
    await database.execute(
      sql`insert into process_dependency(revision_id,organization_id,blocking_step_id,blocked_step_id) values(${fixture.forestRevisionId},${fixture.organizationId},${fixture.forestTaskStepId},${after})`,
    );
    await backfillWorkTemplateBlueprints(database);
    const [publication] = await migrationRows<{ definition: unknown }>(
      database,
      sql`select v.definition from work_type_version v join template t on t.id=v.work_type_id where t.organization_id=${fixture.organizationId} and t.target_type='project' and not t.is_base`,
    );
    const definition = WorkTemplateDefinition.parse(requiredRow(publication).definition);
    expect(definition.blueprint.steps.find((step) => step.key === 'after')).toMatchObject({
      parentStepKey: 'checkpoint',
      teamRule: 'creation_team',
      actorRule: 'unassigned',
      cycleRule: 'none',
      template: {
        workTypeId: requiredRow(base).id,
        selection: { kind: 'pinned', workTypeVersionId: requiredRow(base).version_id },
      },
      fields: { title: 'After completion', estimateMinutes: 25, labelIds: [labelId] },
      dates: {
        dueDate: {
          kind: 'after_completion',
          stepKeys: ['task'],
          offset: { days: 5, unit: 'calendar' },
        },
      },
    });
    expect(definition.blueprint.dependencies).toEqual([
      { blockerStepKey: 'task', blockedStepKey: 'after' },
    ]);
    expect(JSON.stringify(definition)).not.toContain(fixture.teamId);
    const [invocation] = await migrationRows<{
      overrides: { sourceStepId: string; fields: Record<string, unknown>; timing: unknown }[];
    }>(
      database,
      sql`select i.overrides from work_template_blueprint_invocation i join work_template_blueprint_conversion c on c.invocation_id=i.id where c.legacy_process_revision_id=${fixture.forestRevisionId}`,
    );
    expect(
      requiredRow(invocation).overrides.find((entry) => entry.sourceStepId === after),
    ).toMatchObject({
      fields: { team_id: fixture.teamId, labelIds: [labelId] },
      timing: {
        kind: 'after_step_completion',
        offsetDays: 2,
        afterStepId: fixture.forestTaskStepId,
      },
    });
    expect(
      requiredRow(invocation).overrides.find(
        (entry) => entry.sourceStepId === requiredRow(source).project_step_id,
      )?.fields['labelIds'],
    ).toEqual([labelId]);
  }));

it('publishes an archived retained Task tree while preserving single-root recurrence and an unmaterialized occurrence', async () =>
  fixtureCase(async (database, fixture) => {
    const [root] = await migrationRows<{ id: string; definition_id: string }>(
      database,
      sql`select s.id,r.definition_id from process_step s join process_revision r on r.id=s.revision_id where s.revision_id=${fixture.genericRevisionId}`,
    );
    const childId = genId();
    const seriesId = genId();
    const seriesRevisionId = genId();
    const occurrenceId = genId();
    await database.execute(
      sql`update process_definition set status='archived' where id=${requiredRow(root).definition_id}`,
    );
    await database.execute(
      sql`insert into process_step(id,organization_id,revision_id,key,kind) values(${childId},${fixture.organizationId},${fixture.genericRevisionId},'nested','task')`,
    );
    await database.execute(
      sql`insert into process_task_spec(step_id,organization_id,title,team_id,parent_task_step_id,due_offset_days) values(${childId},${fixture.organizationId},'Nested Task',${fixture.teamId},${requiredRow(root).id},3)`,
    );
    await database.execute(
      sql`insert into recurrence_series(id,organization_id,definition_id,name) values(${seriesId},${fixture.organizationId},${requiredRow(root).definition_id},'Retained Task cadence')`,
    );
    await database.execute(
      sql`insert into recurrence_series_revision(id,organization_id,series_id,process_revision_id,number,effective_from,trigger_kind) values(${seriesRevisionId},${fixture.organizationId},${seriesId},${fixture.genericRevisionId},1,'2026-10-01','manual')`,
    );
    await database.execute(
      sql`insert into process_occurrence(id,organization_id,series_id,series_revision_id,scheduled_for) values(${occurrenceId},${fixture.organizationId},${seriesId},${seriesRevisionId},'2026-10-20')`,
    );
    await backfillWorkTemplateBlueprints(database);
    const [publication] = await migrationRows<{
      id: string;
      version_id: string;
      definition: unknown;
      publication_state: string;
      archived_at: unknown;
    }>(
      database,
      sql`select t.id,v.id as version_id,v.definition,t.publication_state,t.archived_at from template t join work_type_version v on v.id=t.latest_published_version_id where t.organization_id=${fixture.organizationId} and t.target_type='task' and not t.is_base and t.publication_state='archived'`,
    );
    expect(requiredRow(publication).archived_at).not.toBeNull();
    const definition = WorkTemplateDefinition.parse(requiredRow(publication).definition);
    expect(definition.payload).toMatchObject({ targetType: 'task', title: 'Repeat privately' });
    expect(definition.blueprint.steps).toMatchObject([
      {
        key: 'nested',
        parentStepKey: null,
        dates: {
          dueDate: {
            kind: 'anchor',
            anchor: { kind: 'parent' },
            offset: { days: 1, unit: 'calendar' },
          },
        },
      },
    ]);
    expect(
      await migrationRows(
        database,
        sql`select work_type_id,work_type_version_id from recurrence_series_revision where id=${seriesRevisionId}`,
      ),
    ).toEqual([
      {
        work_type_id: requiredRow(publication).id,
        work_type_version_id: requiredRow(publication).version_id,
      },
    ]);
    const [occurrence] = await migrationRows<{
      blueprint_root_refs: unknown;
      scheduled_for: string;
    }>(
      database,
      sql`select blueprint_root_refs,scheduled_for::text from process_occurrence where id=${occurrenceId}`,
    );
    expect(occurrence).toEqual({ blueprint_root_refs: [], scheduled_for: '2026-10-20' });
  }));
