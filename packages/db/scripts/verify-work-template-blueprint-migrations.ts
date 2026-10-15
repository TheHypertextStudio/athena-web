import { exerciseManagedDependencies } from '../tests/fixtures/work-template-managed-dependencies';
import assert from 'node:assert/strict';
import { exerciseRetainedRootResolution } from '../tests/fixtures/retained-root-resolution';
import { exerciseRetainedOccurrenceApplied } from '../tests/fixtures/retained-occurrence-applied';
import {
  exerciseRetainedDateOwnership,
  exerciseRetainedDateResume,
  exerciseRetainedDateLateMapping,
} from '../tests/fixtures/retained-date-ownership';
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fullSchema } from '../src/client';
import { exerciseBlueprintNearCap } from '../tests/fixtures/work-template-blueprint-scale';
import { exerciseBlueprintInvocationWrites } from '../tests/fixtures/work-template-blueprint-invocation';
import {
  exerciseBlueprintCanonicalFields,
  exerciseBlueprintRootState,
} from '../tests/fixtures/work-template-blueprint-root-state';
import { exerciseBlueprintReplayStages } from '../tests/fixtures/work-template-blueprint-replay';
import { genId } from '../src/id';
import { migrateWithWorkTemplateCheckpoint } from '../src/migrate-work-templates';
import { withMigrationPrefix } from '../src/migration-prefix';
import { backfillWorkTemplateBlueprints } from '../src/work-template-blueprint-backfill';
import { migrationRows } from '../src/work-template-blueprint-migration/query';
import {
  prepareBlueprintRetainedFixture,
  seedRetainedSingleTask,
} from '../tests/fixtures/work-template-blueprint-migration';

const connectionString = process.env['WORK_TEMPLATE_BLUEPRINT_PG_URL'];
assert.ok(
  connectionString,
  'Set WORK_TEMPLATE_BLUEPRINT_PG_URL to the task-owned PostgreSQL18 cluster16432 database.',
);
const target = new URL(connectionString);
assert.ok(
  target.hostname === '127.0.0.1' &&
    target.port === '16432' &&
    target.pathname === '/athena_identity_test',
  'Only the task-owned loopback16432/athena_identity_test database may be reset.',
);
const client = postgres(connectionString, { max: 1, prepare: false, onnotice: () => undefined });
const database = drizzle(client, { schema: fullSchema });
const options = {
  migrationsFolder: resolve(import.meta.dirname, '../drizzle'),
  applySqlMigrations: (folder: string) => migrate(database, { migrationsFolder: folder }),
};
try {
  await client.unsafe(
    'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;',
  );
  await migrateWithWorkTemplateCheckpoint(database, options);
  assert.equal(
    (await client`select count(*)::integer as count from drizzle.__drizzle_migrations`)[0]?.[
      'count'
    ],
    160,
  );
  await client.unsafe(
    'DROP SCHEMA public CASCADE; DROP SCHEMA drizzle CASCADE; CREATE SCHEMA public;',
  );
  await exerciseBlueprintReplayStages(database, options, async () => {
    await client.unsafe(
      'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;',
    );
  });
  await client.unsafe(
    'DROP SCHEMA public CASCADE; DROP SCHEMA drizzle CASCADE; CREATE SCHEMA public;',
  );
  const fixture = await prepareBlueprintRetainedFixture(database, options);
  const before = (
    await client`select to_jsonb(t) as row from task t where id=${fixture.taskId}`
  )[0]?.['row'] as Record<string, unknown>;
  await withMigrationPrefix(
    options.migrationsFolder,
    '0154_work_template_blueprints_expand',
    options.applySqlMigrations,
  );
  await assert.rejects(
    backfillWorkTemplateBlueprints(database, {
      batchSize: 1,
      onBlueprintBatch: () => {
        throw new Error('interrupted after commit');
      },
    }),
    /interrupted after commit/,
  );
  assert.equal(
    (await client`select count(*)::integer as count from work_template_blueprint_conversion`)[0]?.[
      'count'
    ],
    1,
  );
  await seedRetainedSingleTask(database, { ...fixture, revisionId: '00000000000000000000000001' });
  await assert.rejects(options.applySqlMigrations(options.migrationsFolder));
  await backfillWorkTemplateBlueprints(database, { batchSize: 1 });
  await client`update process_task_spec set title='concurrently changed retained title' where step_id=${fixture.forestTaskStepId}`;
  await assert.rejects(options.applySqlMigrations(options.migrationsFolder));
  await client`update process_task_spec set title='Source Task' where step_id=${fixture.forestTaskStepId}`;
  await migrateWithWorkTemplateCheckpoint(database, options);
  const after = (
    await client`select to_jsonb(t) as row from task t where id=${fixture.taskId}`
  )[0]?.['row'] as Record<string, unknown>;
  for (const [key, value] of Object.entries(before))
    assert.deepEqual(after[key], value, `Retained field changed: ${key}`);
  assert.equal(after['blueprint_ever_started'], true);
  assert.equal((await client`select count(*)::integer as count from program`)[0]?.['count'], 0);
  assert.equal((await client`select count(*)::integer as count from task`)[0]?.['count'], 1);
  assert.deepEqual(await backfillWorkTemplateBlueprints(database), {
    revisions: 0,
    publishedRoots: 0,
    preservedDrafts: 0,
  });
  const [privateDraft] =
    await client`select payload,scope,publication_state from template where id=${fixture.privateTemplateId}`;
  assert.ok(privateDraft);
  assert.equal(privateDraft['scope'], 'personal');
  assert.equal(privateDraft['publication_state'], 'draft');
  assert.match(JSON.stringify(privateDraft['payload']), /library-file:private-image/);
  const [foreign] =
    await client`insert into organization(id,name,slug) values(${genId()},'Foreign tenant','foreign-blueprint-tenant') returning id`;
  assert.ok(foreign);
  const reader = genId();
  const admin = genId();
  const role = genId();
  await client`insert into role(id,organization_id,key,name,capabilities) values(${role},${fixture.organizationId},'blueprint-admin','Blueprint admin','["manage"]'::jsonb)`;
  await client`insert into actor(id,organization_id,kind,display_name) values(${reader},${fixture.organizationId},'human','Ordinary reader')`;
  await client`insert into actor(id,organization_id,kind,display_name,role_id) values(${admin},${fixture.organizationId},'human','Administrator',${role})`;
  await client.unsafe(`DO $$ BEGIN IF NOT EXISTS(select 1 from pg_roles where rolname='athena_blueprint_reader') THEN CREATE ROLE athena_blueprint_reader NOLOGIN; END IF; END $$;
  GRANT USAGE ON SCHEMA public TO athena_blueprint_reader;
  GRANT SELECT(id,organization_id,scope,publication_state,target_type) ON template TO athena_blueprint_reader;
  GRANT SELECT(id,organization_id,role_id,status,archived_at) ON actor TO athena_blueprint_reader;
  GRANT SELECT(id,organization_id,base_capability,capabilities) ON role TO athena_blueprint_reader;
  GRANT SELECT ON work_type_version,blueprint_step,blueprint_dependency,work_template_blueprint_invocation,work_template_blueprint_conversion,work_template_retained_date_ownership,process_occurrence TO athena_blueprint_reader;`);
  const scoped = async (tenant: string | null, actorId: string | null) =>
    client.begin(async (tx) => {
      await tx.unsafe('SET LOCAL ROLE athena_blueprint_reader');
      if (tenant) await tx`select set_config('docket.organization_id',${tenant},true)`;
      if (actorId) await tx`select set_config('docket.actor_id',${actorId},true)`;
      const [counts] =
        await tx`select (select count(*)::integer from blueprint_step) as steps,(select count(*)::integer from work_template_blueprint_invocation) as invocations,(select count(*)::integer from work_template_retained_date_ownership) as private_dates,(select count(*)::integer from process_occurrence where blueprint_invocation_id is not null) as private_occurrences`;
      return counts;
    });
  assert.equal((await scoped(null, fixture.actorId))?.['steps'], 0);
  assert.equal((await scoped(fixture.organizationId, null))?.['invocations'], 0);
  assert.equal((await scoped(fixture.organizationId, fixture.actorId))?.['invocations'], 4);
  assert.equal((await scoped(fixture.organizationId, reader))?.['invocations'], 0);
  assert.equal((await scoped(fixture.organizationId, reader))?.['private_dates'], 0);
  assert.equal((await scoped(fixture.organizationId, reader))?.['private_occurrences'], 0);
  assert.equal((await scoped(null, fixture.actorId))?.['private_occurrences'], 0);
  assert.equal((await scoped(String(foreign['id']), fixture.actorId))?.['private_occurrences'], 0);
  assert.ok((await scoped(fixture.organizationId, fixture.actorId))?.['private_occurrences'] > 0);
  assert.ok((await scoped(fixture.organizationId, admin))?.['private_occurrences'] > 0);
  assert.equal((await scoped(fixture.organizationId, fixture.actorId))?.['private_dates'], 4);
  assert.equal((await scoped(fixture.organizationId, admin))?.['private_dates'], 4);
  assert.equal((await scoped(String(foreign['id']), fixture.actorId))?.['private_dates'], 0);
  assert.equal((await scoped(fixture.organizationId, admin))?.['invocations'], 4);
  assert.equal((await scoped(String(foreign['id']), fixture.actorId))?.['invocations'], 0);
  assert.equal((await scoped(fixture.organizationId, reader))?.['steps'], 3);
  await assert.rejects(
    client.begin(async (tx) => {
      await tx.unsafe('SET LOCAL ROLE athena_blueprint_reader');
      await tx`select payload from template where id=${fixture.privateTemplateId}`;
    }),
  );
  await assert.rejects(database.execute(sql`update blueprint_step set sort=sort+1`));
  await assert.rejects(database.execute(sql`delete from blueprint_step`));
  await assert.rejects(
    database.execute(
      sql`update task set blueprint_date_bindings='{"targetDate":{}}'::jsonb where id=${fixture.taskId}`,
    ),
  );
  await database.execute(
    sql`update task set blueprint_ever_started=false where id=${fixture.taskId}`,
  );
  assert.equal(
    (
      await migrationRows<{ value: boolean }>(
        database,
        sql`select blueprint_ever_started as value from task where id=${fixture.taskId}`,
      )
    )[0]?.value,
    true,
  );
  await migrateWithWorkTemplateCheckpoint(database, options);
  await exerciseBlueprintRootState(database, fixture);
  await exerciseManagedDependencies(database, fixture.organizationId);
  await exerciseBlueprintCanonicalFields(database, fixture);
  await exerciseBlueprintInvocationWrites(database, fixture);
  await exerciseRetainedRootResolution(database, fixture);
  await exerciseRetainedOccurrenceApplied(database, fixture);
  await exerciseRetainedDateOwnership(database, fixture);
  await exerciseRetainedDateResume(database, fixture);
  await exerciseRetainedDateLateMapping(database, fixture);
  await exerciseBlueprintNearCap(database, fixture.organizationId);
  await database.execute(sql`delete from organization where id=${fixture.organizationId}`);
  assert.equal(
    (
      await migrationRows<{ count: number }>(
        database,
        sql`select count(*)::integer as count from blueprint_step where organization_id=${fixture.organizationId}`,
      )
    )[0]?.count,
    0,
  );
  assert.equal(
    (
      await migrationRows<{ count: number }>(
        database,
        sql`select count(*)::integer as count from work_template_blueprint_invocation where organization_id=${fixture.organizationId}`,
      )
    )[0]?.count,
    0,
  );
  console.log(
    'PostgreSQL18 full journal from all retained stages, retained forest/privacy/audits, committed interruption, late older ID, stale-source refusal, immutable metadata, near-cap publication, authorized workspace purge and restricted-role tenant/privacy checks passed.',
  );
} finally {
  await client.end();
}
