import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { expect, it } from 'vitest';
import { fullSchema, type Database } from '../../src/client';
import { genId } from '../../src/id';
import { withMigrationPrefix } from '../../src/migration-prefix';
import { backfillWorkTemplateBlueprints } from '../../src/work-template-blueprint-backfill';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';
import {
  prepareBlueprintRetainedFixture,
  type BlueprintRetainedFixture,
} from '../fixtures/work-template-blueprint-migration';
import { requiredRow } from '../fixtures/required-row';

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

it('rejects foreign literal teams before copying source bodies or publishing anything', async () =>
  fixtureCase(async (database, fixture) => {
    const other = genId();
    const team = genId();
    await database.execute(
      sql`insert into organization(id,name,slug) values(${other},'Foreign','foreign-rejection')`,
    );
    await database.execute(
      sql`insert into team(id,organization_id,name,key) values(${team},${other},'Foreign','FOREIGN')`,
    );
    await database.execute(
      sql`update process_task_spec set team_id=${team} where step_id=${fixture.forestTaskStepId}`,
    );
    const before = await migrationRows(database, sql`select id from template`);
    await expect(backfillWorkTemplateBlueprints(database)).rejects.toThrow('foreign team');
    expect(await migrationRows(database, sql`select id from template`)).toEqual(before);
    expect(
      await migrationRows(
        database,
        sql`select legacy_process_revision_id from work_template_blueprint_conversion`,
      ),
    ).toHaveLength(0);
  }));

it('rejects an oversized forest with no truncated invocation or partial publication', async () =>
  fixtureCase(async (database, fixture) => {
    const definitionId = genId();
    const revisionId = '00000000000000000000000001';
    await database.execute(
      sql`insert into process_definition(id,organization_id,name,status) values(${definitionId},${fixture.organizationId},'Oversized source','published')`,
    );
    await database.execute(
      sql`insert into process_revision(id,organization_id,definition_id,number,published_at) values(${revisionId},${fixture.organizationId},${definitionId},1,now())`,
    );
    await database.execute(
      sql`insert into process_step(id,organization_id,revision_id,key,kind) select 's'||lpad(i::text,25,'0'),${fixture.organizationId},${revisionId},'step_'||i,'task' from generate_series(1,501) i`,
    );
    await database.execute(
      sql`insert into process_task_spec(step_id,organization_id,title,team_id) select id,${fixture.organizationId},'Bounded Task',${fixture.teamId} from process_step where revision_id=${revisionId}`,
    );
    const before = await migrationRows(database, sql`select id from template`);
    await expect(backfillWorkTemplateBlueprints(database)).rejects.toThrow('bounded graph limit');
    expect(await migrationRows(database, sql`select id from template`)).toEqual(before);
    expect(
      await migrationRows(database, sql`select id from work_template_blueprint_invocation`),
    ).toHaveLength(0);
  }));

it('keeps an explicit retained Task version pinned and preserves drafts even with stray publication timestamps', async () =>
  fixtureCase(async (database, fixture) => {
    const templateId = genId();
    const versionId = genId();
    const laterVersionId = genId();
    const definition = {
      name: 'Selected Task type',
      description: null,
      icon: null,
      defaultStatusKey: null,
      payload: { targetType: 'task' },
    };
    await database.execute(
      sql`insert into template(id,organization_id,target_type,name,scope,payload,draft_definition,publication_state) values(${templateId},${fixture.organizationId},'task',${definition.name},'organization',${JSON.stringify(definition.payload)}::jsonb,${JSON.stringify(definition)}::jsonb,'draft')`,
    );
    await database.execute(
      sql`insert into work_type_version(id,organization_id,work_type_id,number,definition) values(${versionId},${fixture.organizationId},${templateId},1,${JSON.stringify(definition)}::jsonb),(${laterVersionId},${fixture.organizationId},${templateId},2,${JSON.stringify(definition)}::jsonb)`,
    );
    await database.execute(
      sql`update template set publication_state='published',latest_published_version_id=${laterVersionId} where id=${templateId}`,
    );
    await database.execute(
      sql`update process_task_spec set work_type_id=${templateId},work_type_version_id=${versionId} where step_id in(select id from process_step where revision_id=${fixture.genericRevisionId})`,
    );
    await database.execute(
      sql`update process_revision set published_at=now() where id=${fixture.draftRevisionId}`,
    );
    const before = await migrationRows(database, sql`select id from template`);
    await backfillWorkTemplateBlueprints(database);
    const [selected] = await migrationRows<{
      manifest: { roots: { workTypeId: string; workTypeVersionId: string }[] };
    }>(
      database,
      sql`select i.manifest from work_template_blueprint_invocation i join work_template_blueprint_conversion c on c.invocation_id=i.id where c.legacy_process_revision_id=${fixture.genericRevisionId}`,
    );
    expect(requiredRow(selected).manifest.roots[0]).toMatchObject({
      workTypeId: templateId,
      workTypeVersionId: versionId,
    });
    const [draft] = await migrationRows<{ manifest: { kind: string } }>(
      database,
      sql`select i.manifest from work_template_blueprint_invocation i join work_template_blueprint_conversion c on c.invocation_id=i.id where c.legacy_process_revision_id=${fixture.draftRevisionId}`,
    );
    expect(requiredRow(draft).manifest.kind).toBe('pending_draft');
    expect(await migrationRows(database, sql`select id from template`)).toHaveLength(
      before.length + 1,
    );
  }));
