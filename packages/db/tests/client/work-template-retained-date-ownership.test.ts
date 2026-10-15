import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import {
  exerciseRetainedDateResume,
  exerciseRetainedDateLateMapping,
} from '../fixtures/retained-date-ownership';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { fullSchema } from '../../src/client';
import { migrateWithWorkTemplateCheckpoint } from '../../src/migrate-work-templates';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';
import {
  prepareBlueprintRetainedFixture,
  type BlueprintRetainedFixture,
} from '../fixtures/work-template-blueprint-migration';

const client = new PGlite('memory://');
const database = drizzle(client, { schema: fullSchema });
let fixture: BlueprintRetainedFixture;
beforeAll(async () => {
  const options = {
    migrationsFolder: resolve(import.meta.dirname, '../../drizzle'),
    applySqlMigrations: (folder: string) => migrate(database, { migrationsFolder: folder }),
  };
  fixture = await prepareBlueprintRetainedFixture(database, options);
  await database.execute(sql`update task set due_date=null where id=${fixture.taskId}`);
  await database.execute(
    sql`update process_task_spec set due_offset_days=null where step_id=${fixture.forestTaskStepId}`,
  );
  await migrateWithWorkTemplateCheckpoint(database, options);
});
afterAll(async () => client.close());
it('preserves an ambiguous historical null as privately manual without public fake origin', async () => {
  const rows = await migrationRows<{
    manual: boolean;
    last_derived_date: string | null;
    work_id: string;
  }>(
    database,
    sql`select manual,last_derived_date,work_id from work_template_retained_date_ownership where organization_id=${fixture.organizationId} and source_step_id=${fixture.forestTaskStepId} and field='dueDate'`,
  );
  expect(rows).toEqual([{ manual: true, last_derived_date: null, work_id: fixture.taskId }]);
  expect(
    (
      await migrationRows<{ due_date: null }>(
        database,
        sql`select due_date from task where id=${fixture.taskId}`,
      )
    )[0]?.due_date,
  ).toBeNull();
});
it('retains exact mapped Project and Milestone ownership alongside Task timing', async () => {
  const rows = await migrationRows<{ work_kind: string; field: string; manual: boolean }>(
    database,
    sql`select work_kind,field,manual from work_template_retained_date_ownership where organization_id=${fixture.organizationId} order by work_kind,field`,
  );
  expect(rows).toEqual([
    { work_kind: 'milestone', field: 'targetDate', manual: true },
    { work_kind: 'project', field: 'startDate', manual: true },
    { work_kind: 'project', field: 'targetDate', manual: true },
    { work_kind: 'task', field: 'dueDate', manual: true },
  ]);
});
it('refuses a forged physical work identity or unsupported date field', async () => {
  await expect(
    database.execute(
      sql`update work_template_retained_date_ownership set work_id=${fixture.projectId} where source_step_id=${fixture.forestTaskStepId}`,
    ),
  ).rejects.toThrow();
  await expect(
    database.execute(
      sql`insert into work_template_retained_date_ownership select organization_id,occurrence_id,source_step_id,'targetDate',invocation_id,work_kind,work_id,false,null from work_template_retained_date_ownership where source_step_id=${fixture.forestTaskStepId}`,
    ),
  ).rejects.toThrow();
});
it('allows an explicit managed adoption and preserves immutable invocation identity', async () => {
  await database.execute(
    sql`update work_template_retained_date_ownership set manual=false,last_derived_date='2026-11-01' where source_step_id=${fixture.forestTaskStepId}`,
  );
  expect(
    (
      await migrationRows<{ manual: boolean; last_derived_date: string }>(
        database,
        sql`select manual,last_derived_date::text from work_template_retained_date_ownership where source_step_id=${fixture.forestTaskStepId}`,
      )
    )[0],
  ).toEqual({ manual: false, last_derived_date: '2026-11-01' });
  await expect(
    database.execute(
      sql`update work_template_retained_date_ownership set invocation_id='00000000000000000000000000' where source_step_id=${fixture.forestTaskStepId}`,
    ),
  ).rejects.toThrow();
});

it('resumes interrupted private ownership batches without changing work or duplicating rows', async () => {
  await exerciseRetainedDateResume(database, fixture);
});

it('discovers late older occurrences, rejects changed mappings, and cleans deleted work ownership', async () => {
  await exerciseRetainedDateLateMapping(database, fixture);
});
