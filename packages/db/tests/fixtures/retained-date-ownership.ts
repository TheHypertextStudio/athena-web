import assert from 'node:assert/strict';
import { genId } from '../../src/id';
import { sql } from 'drizzle-orm';
import type { Database } from '../../src/client';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';
import { backfillRetainedDateOwnership } from '../../src/retained-date-ownership-backfill';
import type { BlueprintRetainedFixture } from './work-template-blueprint-migration';

/** Real-engine checks for conservative private timing ownership and immutable exact mapping. */
export async function exerciseRetainedDateOwnership(
  database: Database,
  fixture: BlueprintRetainedFixture,
): Promise<void> {
  const rows = await migrationRows<{
    manual: boolean;
    last_derived_date: string | null;
    work_kind: string;
    work_id: string;
  }>(
    database,
    sql`select manual,last_derived_date,work_kind,work_id from work_template_retained_date_ownership where organization_id=${fixture.organizationId}`,
  );
  assert.equal(rows.length, 4);
  assert.ok(rows.every((row) => row.manual && row.last_derived_date === null));
  assert.ok(rows.some((row) => row.work_kind === 'task' && row.work_id === fixture.taskId));
  await assert.rejects(
    database.execute(
      sql`update work_template_retained_date_ownership set work_id=${fixture.projectId} where source_step_id=${fixture.forestTaskStepId}`,
    ),
  );
  await database.execute(
    sql`update work_template_retained_date_ownership set manual=false,last_derived_date='2026-11-01' where source_step_id=${fixture.forestTaskStepId}`,
  );
  assert.equal(await backfillRetainedDateOwnership(database), 0);
  assert.equal(
    (
      await migrationRows<{ manual: boolean }>(
        database,
        sql`select manual from work_template_retained_date_ownership where source_step_id=${fixture.forestTaskStepId}`,
      )
    )[0]?.manual,
    false,
  );
}
/** Interrupt after a committed batch and prove exact missing-key replay preserves work JSON. */
export async function exerciseRetainedDateResume(
  database: Database,
  fixture: BlueprintRetainedFixture,
): Promise<void> {
  const before = (
    await migrationRows<{ row: unknown }>(
      database,
      sql`select to_jsonb(t) as row from task t where id=${fixture.taskId}`,
    )
  )[0]?.row;
  await database.execute(
    sql`delete from work_template_retained_date_ownership where organization_id=${fixture.organizationId}`,
  );
  await assert.rejects(
    backfillRetainedDateOwnership(database, {
      retainedDateBatchSize: 1,
      onRetainedDateBatch: () => {
        throw new Error('retained date checkpoint interrupted');
      },
    }),
    /checkpoint interrupted/,
  );
  assert.equal(
    (
      await migrationRows<{ count: number }>(
        database,
        sql`select count(*)::integer as count from work_template_retained_date_ownership where organization_id=${fixture.organizationId}`,
      )
    )[0]?.count,
    1,
  );
  assert.equal(await backfillRetainedDateOwnership(database, { retainedDateBatchSize: 1 }), 3);
  assert.equal(await backfillRetainedDateOwnership(database), 0);
  const after = (
    await migrationRows<{ row: unknown }>(
      database,
      sql`select to_jsonb(t) as row from task t where id=${fixture.taskId}`,
    )
  )[0]?.row;
  assert.deepEqual(after, before);
}

/** Late older occurrence IDs are discovered and a changed existing mapping fails closed on replay. */
export async function exerciseRetainedDateLateMapping(
  database: Database,
  fixture: BlueprintRetainedFixture,
): Promise<void> {
  const taskId = genId(),
    instanceId = genId(),
    occurrenceId = '00000000000000000000000002';
  await database.execute(
    sql`insert into task(id,organization_id,team_id,title,state,status_id,work_type_id,work_type_version_id) select ${taskId},organization_id,team_id,'Late retained work',state,status_id,work_type_id,work_type_version_id from task where id=${fixture.taskId}`,
  );
  await database.execute(
    sql`insert into process_occurrence(id,organization_id,series_id,series_revision_id,scheduled_for,external_occurrence_key,blueprint_invocation_id) select ${occurrenceId},organization_id,series_id,series_revision_id,scheduled_for,'late-private-date',blueprint_invocation_id from process_occurrence where organization_id=${fixture.organizationId} limit 1`,
  );
  await database.execute(
    sql`insert into process_instance(id,organization_id,definition_id,revision_id,occurrence_id) select ${instanceId},organization_id,definition_id,revision_id,${occurrenceId} from process_instance where organization_id=${fixture.organizationId} limit 1`,
  );
  await database.execute(
    sql`insert into process_instance_task(id,organization_id,instance_id,step_id,task_id) values(${genId()},${fixture.organizationId},${instanceId},${fixture.forestTaskStepId},${taskId})`,
  );
  assert.equal(await backfillRetainedDateOwnership(database, { retainedDateBatchSize: 1 }), 1);
  assert.equal(
    (
      await migrationRows<{ manual: boolean }>(
        database,
        sql`select manual from work_template_retained_date_ownership where occurrence_id=${occurrenceId}`,
      )
    )[0]?.manual,
    true,
  );
  const otherTaskId = genId();
  await database.execute(
    sql`insert into task(id,organization_id,team_id,title,state,status_id,work_type_id,work_type_version_id) select ${otherTaskId},organization_id,team_id,'Different retained work',state,status_id,work_type_id,work_type_version_id from task where id=${fixture.taskId}`,
  );
  await database.execute(
    sql`update process_instance_task set task_id=${otherTaskId} where instance_id=${instanceId}`,
  );
  await assert.rejects(
    backfillRetainedDateOwnership(database),
    (error: unknown) =>
      error instanceof Error &&
      error.cause !== null &&
      typeof error.cause === 'object' &&
      'code' in error.cause &&
      error.cause.code === '23514',
  );
  await database.execute(
    sql`update process_instance_task set task_id=${taskId} where instance_id=${instanceId}`,
  );
  await database.execute(sql`delete from task where id=${taskId}`);
  assert.equal(
    (
      await migrationRows<{ count: number }>(
        database,
        sql`select count(*)::integer as count from work_template_retained_date_ownership where occurrence_id=${occurrenceId}`,
      )
    )[0]?.count,
    0,
  );
}
