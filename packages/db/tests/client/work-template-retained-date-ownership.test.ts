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
  registerRetainedDateOwnership,
  markRetainedDatesManual,
  type RetainedDateSourceScope,
} from '../../src/retained-date-ownership';
import { retainedDateOwnership } from '../../src/schema/retained-date-ownership';
import { genId } from '../../src/id';
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
it('registers exact source dates, preserves replayed ownership, and returns only manual transitions', async () => {
  const rollback = new Error('Roll back ownership API fixture');
  await expect(
    database.transaction(async (tx) => {
      const scopes = await migrationRows<RetainedDateSourceScope>(
        tx,
        sql`select distinct organization_id as "organizationId",occurrence_id as "occurrenceId",invocation_id as "invocationId",source_step_id as "sourceStepId",work_kind as "workKind",work_id as "workId" from work_template_retained_date_ownership where organization_id=${fixture.organizationId} order by work_kind`,
      );
      await tx.execute(
        sql`delete from work_template_retained_date_ownership where organization_id=${fixture.organizationId}`,
      );
      for (const scope of scopes) {
        await registerRetainedDateOwnership(tx, {
          ...scope,
          dates: { startDate: '2026-11-02', targetDate: '2026-11-09' },
          ...(scope.workKind === 'project'
            ? { manualFields: new Set<'startDate'>(['startDate']) }
            : {}),
        });
      }
      const registered = await tx.select().from(retainedDateOwnership);
      expect(
        registered
          .map((row) => ({
            kind: row.workKind,
            field: row.field,
            manual: row.manual,
            date: row.lastDerivedDate,
          }))
          .sort((a, b) => `${a.kind}:${a.field}`.localeCompare(`${b.kind}:${b.field}`)),
      ).toEqual([
        { kind: 'milestone', field: 'targetDate', manual: false, date: '2026-11-09' },
        { kind: 'project', field: 'startDate', manual: true, date: '2026-11-02' },
        { kind: 'project', field: 'targetDate', manual: false, date: '2026-11-09' },
        { kind: 'task', field: 'dueDate', manual: false, date: null },
      ]);
      for (const scope of scopes) {
        await registerRetainedDateOwnership(tx, {
          ...scope,
          dates: { dueDate: '2027-01-01', targetDate: null },
          manualFields: new Set(['dueDate', 'targetDate']),
        });
        await registerRetainedDateOwnership(tx, { ...scope, organizationId: genId(), dates: {} });
        await registerRetainedDateOwnership(tx, { ...scope, workId: genId(), dates: {} });
      }
      expect(await tx.select().from(retainedDateOwnership)).toEqual(registered);
      const changes = await markRetainedDatesManual(tx, {
        organizationId: fixture.organizationId,
        workKind: 'project',
        workId: fixture.projectId,
        fields: ['startDate', 'targetDate', 'dueDate'],
      });
      const target = registered.find(
        (row) => row.workKind === 'project' && row.field === 'targetDate',
      );
      expect(target).toBeDefined();
      expect(changes).toEqual([{ before: target, after: { ...target, manual: true } }]);
      expect(
        await markRetainedDatesManual(tx, {
          organizationId: fixture.organizationId,
          workKind: 'project',
          workId: fixture.projectId,
          fields: ['startDate', 'targetDate'],
        }),
      ).toEqual([]);
      expect(
        await markRetainedDatesManual(tx, {
          organizationId: genId(),
          workKind: 'task',
          workId: fixture.taskId,
          fields: ['dueDate'],
        }),
      ).toEqual([]);
      expect(
        (await tx.select().from(retainedDateOwnership)).find((row) => row.workKind === 'task')
          ?.manual,
      ).toBe(false);
      throw rollback;
    }),
  ).rejects.toBe(rollback);
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
