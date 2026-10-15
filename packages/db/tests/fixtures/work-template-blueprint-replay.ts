import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import type { Database } from '../../src/client';
import { genId } from '../../src/id';
import { migrateWithWorkTemplateCheckpoint } from '../../src/migrate-work-templates';
import { withMigrationPrefix } from '../../src/migration-prefix';
import { backfillWorkTemplateIdentity } from '../../src/work-template-backfill';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';
import {
  seedRetainedSingleTask,
  type BlueprintFixtureMigration,
} from './work-template-blueprint-migration';

/** Exercise the full canonical runner from every populated retained checkpoint on an isolated DB. */
export async function exerciseBlueprintReplayStages(
  database: Database,
  options: BlueprintFixtureMigration,
  reset: () => Promise<void>,
): Promise<void> {
  for (const stage of ['legacy', 'identity_expanded', 'identity_enforced', 'blueprint_expanded']) {
    await reset();
    await withMigrationPrefix(
      options.migrationsFolder,
      '0150_personal_inbound_receipts',
      options.applySqlMigrations,
    );
    const organizationId = genId();
    const actorId = genId();
    const teamId = genId();
    await database.execute(
      sql`insert into organization(id,name,slug) values(${organizationId},'Retained replay stage',${`replay-${organizationId.toLowerCase()}`})`,
    );
    await database.execute(
      sql`insert into actor(id,organization_id,kind,display_name) values(${actorId},${organizationId},'human','Retained author')`,
    );
    await database.execute(
      sql`insert into team(id,organization_id,name,key) values(${teamId},${organizationId},'Retained team','REPLAY')`,
    );
    await seedRetainedSingleTask(database, { organizationId, actorId, teamId });
    if (stage !== 'legacy')
      await withMigrationPrefix(
        options.migrationsFolder,
        '0151_work_template_identity_expand',
        options.applySqlMigrations,
      );
    if (stage === 'identity_enforced' || stage === 'blueprint_expanded') {
      await backfillWorkTemplateIdentity(database);
      await withMigrationPrefix(
        options.migrationsFolder,
        '0153_process_task_template_identity',
        options.applySqlMigrations,
      );
    }
    if (stage === 'blueprint_expanded')
      await withMigrationPrefix(
        options.migrationsFolder,
        '0154_work_template_blueprints_expand',
        options.applySqlMigrations,
      );
    await migrateWithWorkTemplateCheckpoint(database, options);
    const publications = await migrationRows<{ definition: Record<string, unknown> }>(
      database,
      sql`select definition from work_type_version where organization_id=${organizationId}`,
    );
    assert.equal(publications.length, 4, stage);
    assert.ok(
      publications.every((row) => !Object.hasOwn(row.definition, 'blueprint')),
      `Historical JSON default changed at ${stage}`,
    );
    assert.equal(
      (
        await migrationRows(
          database,
          sql`select legacy_process_revision_id from work_template_blueprint_conversion`,
        )
      ).length,
      1,
      stage,
    );
    await migrateWithWorkTemplateCheckpoint(database, options);
    assert.equal(
      (await migrationRows(database, sql`select id from work_template_blueprint_invocation`))
        .length,
      1,
      stage,
    );
  }
}
