import { exerciseManagedDependencies } from '../fixtures/work-template-managed-dependencies';
import { requiredRow } from '../fixtures/required-row';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { fullSchema } from '../../src/client';
import { genId } from '../../src/id';
import { migrateWithWorkTemplateCheckpoint } from '../../src/migrate-work-templates';
import { persistBlueprintProjection } from '../../src/work-template-blueprint-projection';
import { migrationRows } from '../../src/work-template-blueprint-migration/query';
import { exerciseBlueprintInvocationWrites } from '../fixtures/work-template-blueprint-invocation';
import {
  exerciseBlueprintCanonicalFields,
  exerciseBlueprintRootState,
} from '../fixtures/work-template-blueprint-root-state';
import {
  prepareBlueprintRetainedFixture,
  type BlueprintRetainedFixture,
} from '../fixtures/work-template-blueprint-migration';

const client = new PGlite('memory://');
const database = drizzle(client, { schema: fullSchema });
let fixture: BlueprintRetainedFixture;
let publication: { id: string; work_type_id: string; definition: unknown };
beforeAll(async () => {
  const options = {
    migrationsFolder: resolve(import.meta.dirname, '../../drizzle'),
    applySqlMigrations: (folder: string) => migrate(database, { migrationsFolder: folder }),
  };
  fixture = await prepareBlueprintRetainedFixture(database, options);
  await migrateWithWorkTemplateCheckpoint(database, options);
  publication = requiredRow(
    (
      await migrationRows<typeof publication>(
        database,
        sql`select v.id,v.work_type_id,v.definition from work_type_version v join template t on t.id=v.work_type_id where t.target_type='project' and not t.is_base limit 1`,
      )
    )[0],
  );
});
afterAll(async () => client.close());

it('rejects missing publication projections at transaction commit', async () => {
  await expect(
    database.transaction(async (tx) => {
      await tx.execute(
        sql`insert into work_type_version(id,organization_id,work_type_id,number,definition) values(${genId()},${fixture.organizationId},${publication.work_type_id},2,${JSON.stringify(publication.definition)}::jsonb)`,
      );
    }),
  ).rejects.toThrow();
});
it('accepts strict optional dependency ownership while retaining historical states', async () => {
  await exerciseManagedDependencies(database, fixture.organizationId);
});
it('accepts populated valid root state and updates its persisted change receipt', async () => {
  await exerciseBlueprintRootState(database, fixture);
});
it('accepts valid nonempty published/draft invocations with private literal overrides after enforcement', async () => {
  await exerciseBlueprintInvocationWrites(database, fixture);
});
it('accepts the canonical Task starting state, nullable effort, and Project priority at publication', async () => {
  await exerciseBlueprintCanonicalFields(database, fixture);
});
it('persists an exact version and its projections atomically and supports exact replay', async () => {
  const versionId = genId();
  const definition = WorkTemplateDefinition.parse(publication.definition);
  await database.transaction(async (tx) => {
    await tx.execute(
      sql`insert into work_type_version(id,organization_id,work_type_id,number,definition) values(${versionId},${fixture.organizationId},${publication.work_type_id},2,${JSON.stringify(publication.definition)}::jsonb)`,
    );
    const first = await persistBlueprintProjection(tx, {
      organizationId: fixture.organizationId,
      versionId,
      blueprint: definition.blueprint,
    });
    expect(Object.keys(first)).toHaveLength(3);
    expect(
      await persistBlueprintProjection(tx, {
        organizationId: fixture.organizationId,
        versionId,
        blueprint: definition.blueprint,
      }),
    ).toEqual(first);
  });
});
it('rejects independent projection mutation and deletion', async () => {
  await expect(database.execute(sql`update blueprint_step set sort=sort+1`)).rejects.toThrow();
  await expect(database.execute(sql`delete from blueprint_step`)).rejects.toThrow();
});
it('rejects unsupported manual-date fields and malformed binding members', async () => {
  await expect(
    database.execute(
      sql`update task set blueprint_date_bindings='{"targetDate":{}}'::jsonb where id=${fixture.taskId}`,
    ),
  ).rejects.toThrow();
  await expect(
    database.execute(
      sql`update task set blueprint_date_bindings=jsonb_set(blueprint_date_bindings,'{dueDate,manual}','"false"'::jsonb) where id=${fixture.taskId}`,
    ),
  ).rejects.toThrow();
});
it('rejects wrong-kind source steps even when their version/tenant pair exists', async () => {
  const [source] = await migrationRows<{ id: string; version_id: string; key: string }>(
    database,
    sql`select id,version_id,key from blueprint_step where kind='milestone' limit 1`,
  );
  await expect(
    database.execute(
      sql`update task set blueprint_step_id=${requiredRow(source).id},blueprint_source_version_id=${requiredRow(source).version_id},blueprint_path=ARRAY[${requiredRow(source).key}] where id=${fixture.taskId}`,
    ),
  ).rejects.toThrow();
});
it('keeps origin immutable while the work accepts a later own-template version', async () => {
  const [original] = await migrationRows<{
    work_type_id: string;
    work_type_version_id: string;
    blueprint_step_id: string;
  }>(
    database,
    sql`select work_type_id,work_type_version_id,blueprint_step_id from task where id=${fixture.taskId}`,
  );
  const [base] = await migrationRows<{ definition: unknown }>(
    database,
    sql`select definition from work_type_version where id=${requiredRow(original).work_type_version_id}`,
  );
  const versionId = genId();
  await database.execute(
    sql`insert into work_type_version(id,organization_id,work_type_id,number,definition) values(${versionId},${fixture.organizationId},${requiredRow(original).work_type_id},2,${JSON.stringify(requiredRow(base).definition)}::jsonb)`,
  );
  await database.execute(
    sql`update task set work_type_version_id=${versionId} where id=${fixture.taskId}`,
  );
  const [after] = await migrationRows<{ blueprint_step_id: string; work_type_version_id: string }>(
    database,
    sql`select blueprint_step_id,work_type_version_id from task where id=${fixture.taskId}`,
  );
  expect(requiredRow(after).blueprint_step_id).toBe(requiredRow(original).blueprint_step_id);
  expect(requiredRow(after).work_type_version_id).toBe(versionId);
});
it('never clears ever-started evidence when requested to reset it', async () => {
  await database.execute(
    sql`update task set blueprint_ever_started=false where id=${fixture.taskId}`,
  );
  expect(
    (
      await migrationRows<{ value: boolean }>(
        database,
        sql`select blueprint_ever_started as value from task where id=${fixture.taskId}`,
      )
    )[0]?.value,
  ).toBe(true);
});
it.each([[], [1, 1], [2, 1], [0], [8]].map((days) => ({ days })))(
  'rejects invalid workspace weekdays $days',
  async ({ days }) => {
    await expect(
      database.execute(
        sql`update organization set working_weekdays=ARRAY(select jsonb_array_elements_text(${JSON.stringify(days)}::jsonb)::integer) where id=${fixture.organizationId}`,
      ),
    ).rejects.toThrow();
  },
);
it('accepts a custom sorted workspace calendar', async () => {
  await expect(
    database.execute(
      sql`update organization set working_weekdays=ARRAY[2,4,6] where id=${fixture.organizationId}`,
    ),
  ).resolves.toBeDefined();
});
it('keeps cross-workspace copy-origin IDs without resolving or claiming a local identity', async () => {
  const sourceType = genId();
  const sourceVersion = genId();
  await database.execute(
    sql`update template set origin_work_type_id=${sourceType},origin_work_type_version_id=${sourceVersion} where id=${fixture.privateTemplateId}`,
  );
  const [origin] = await migrationRows<{
    origin_work_type_id: string;
    origin_work_type_version_id: string;
  }>(
    database,
    sql`select origin_work_type_id,origin_work_type_version_id from template where id=${fixture.privateTemplateId}`,
  );
  expect(origin).toEqual({
    origin_work_type_id: sourceType,
    origin_work_type_version_id: sourceVersion,
  });
  await expect(
    database.execute(
      sql`update template set origin_work_type_id=null where id=${fixture.privateTemplateId}`,
    ),
  ).rejects.toThrow();
});

it('permits only exact archived versions authorized by the trusted transaction context', async () => {
  const [root] = await migrationRows<{ status_id: string }>(
    database,
    sql`select status_id from project where id=${fixture.projectId}`,
  );
  await database.execute(
    sql`update template set publication_state='archived',archived_at=now() where id=${publication.work_type_id}`,
  );
  const insert = (connection: Pick<typeof database, 'execute'>) =>
    connection.execute(
      sql`insert into project(id,organization_id,name,status,status_id,work_type_id,work_type_version_id) values(${genId()},${fixture.organizationId},'Retained schedule root','planned',${requiredRow(root).status_id},${publication.work_type_id},${publication.id})`,
    );
  await expect(insert(database)).rejects.toThrow();
  await expect(
    database.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('docket.work_template_authorized_archived_versions',${JSON.stringify([{ workTypeId: publication.work_type_id, versionId: genId() }])},true)`,
      );
      await insert(tx);
    }),
  ).rejects.toThrow();
  await expect(
    database.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('docket.work_template_authorized_archived_versions',${JSON.stringify([{ workTypeId: publication.work_type_id, versionId: publication.id }])},true)`,
      );
      await insert(tx);
    }),
  ).resolves.toBeUndefined();
  await expect(insert(database)).rejects.toThrow();
});
