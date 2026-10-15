import { resolve } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { assertDefined } from '@docket/test-utils';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { fullSchema, type Database } from '../../src/client';
import { genId } from '../../src/id';
import { withMigrationPrefix } from '../../src/migration-prefix';
import {
  organization,
  processDefinition,
  processRevision,
  processStep,
  processTaskSpec,
  task,
  team,
  template,
  workTypeVersion,
} from '../../src/schema';
import { seedWorkspaceStatuses, statusLookupKey } from '../../src/seed-statuses';

let client: PGlite;
let database: Database;
let organizationId: string;
let teamId: string;
let revisionId: string;
let retainedStepId: string;
let statusId: string;
let taskBase: typeof template.$inferSelect;
let projectBase: typeof template.$inferSelect;
let foreignTaskBase: typeof template.$inferSelect;

async function step(): Promise<string> {
  return assertDefined(
    (
      await database
        .insert(processStep)
        .values({
          organizationId,
          revisionId,
          key: genId(),
          kind: 'task',
          timingKind: 'on_trigger',
        })
        .returning()
    )[0],
  ).id;
}

async function insertSpec(identity: {
  workTypeId: string | null;
  workTypeVersionId: string | null;
}): Promise<string> {
  const stepId = await step();
  await database.execute(sql`insert into process_task_spec
    (step_id, organization_id, title, team_id, work_type_id, work_type_version_id)
    values (${stepId}, ${organizationId}, 'Recurring task', ${teamId},
      ${identity.workTypeId}, ${identity.workTypeVersionId})`);
  return stepId;
}

beforeAll(async () => {
  client = new PGlite('memory://');
  const connection = drizzle(client, { schema: fullSchema });
  database = connection;
  const migrationsFolder = resolve(import.meta.dirname, '../../drizzle');
  const applySqlMigrations = (folder: string) => migrate(connection, { migrationsFolder: folder });
  await withMigrationPrefix(
    migrationsFolder,
    '0152_work_template_identity_enforce',
    applySqlMigrations,
  );
  organizationId = assertDefined(
    (
      await database
        .insert(organization)
        .values({ name: 'Recurring templates', slug: 'recurring-templates' })
        .returning()
    )[0],
  ).id;
  teamId = assertDefined(
    (
      await database.insert(team).values({ organizationId, name: 'Core', key: 'CORE' }).returning()
    )[0],
  ).id;
  const definition = assertDefined(
    (
      await database
        .insert(processDefinition)
        .values({ organizationId, name: 'Repeat' })
        .returning()
    )[0],
  );
  revisionId = assertDefined(
    (
      await database
        .insert(processRevision)
        .values({ organizationId, definitionId: definition.id, number: 1 })
        .returning()
    )[0],
  ).id;
  retainedStepId = await step();
  await database.execute(sql`insert into process_task_spec (step_id, organization_id, title, team_id)
    values (${retainedStepId}, ${organizationId}, 'Retained recurring task', ${teamId})`);
  statusId = assertDefined(
    (await seedWorkspaceStatuses(database, organizationId)).get(statusLookupKey('task', 'backlog')),
  );
  const foreignId = assertDefined(
    (
      await database
        .insert(organization)
        .values({ name: 'Elsewhere', slug: 'elsewhere-recurring' })
        .returning()
    )[0],
  ).id;
  await seedWorkspaceStatuses(database, foreignId);
  const bases = await database.select().from(template);
  taskBase = assertDefined(
    bases.find((row) => row.organizationId === organizationId && row.targetType === 'task'),
  );
  projectBase = assertDefined(
    bases.find((row) => row.organizationId === organizationId && row.targetType === 'project'),
  );
  foreignTaskBase = assertDefined(
    bases.find((row) => row.organizationId === foreignId && row.targetType === 'task'),
  );
  await applySqlMigrations(migrationsFolder);
});

afterAll(async () => {
  await client.close();
});

it('retains unspecified steps as NULL and lets generated work receive the current base', async () => {
  const retained = assertDefined(
    (
      await database
        .select()
        .from(processTaskSpec)
        .where(eq(processTaskSpec.stepId, retainedStepId))
    )[0],
  );
  expect(retained).toMatchObject({
    workTypeId: null,
    workTypeVersionId: null,
    title: 'Retained recurring task',
  });
  const generated = assertDefined(
    (
      await database
        .insert(task)
        .values({
          organizationId,
          teamId,
          title: retained.title,
          statusId,
          state: 'backlog',
        })
        .returning()
    )[0],
  );
  expect(generated.workTypeId).toBe(taskBase.id);
  expect(generated.workTypeVersionId).toBe(taskBase.latestPublishedVersionId);
});

it('keeps a pinned publication after the template publishes a newer version', async () => {
  const versionId = assertDefined(taskBase.latestPublishedVersionId);
  const stepId = await insertSpec({ workTypeId: taskBase.id, workTypeVersionId: versionId });
  const newer = assertDefined(
    (
      await database
        .insert(workTypeVersion)
        .values({
          organizationId,
          workTypeId: taskBase.id,
          number: 2,
          definition: taskBase.draftDefinition,
        })
        .returning()
    )[0],
  );
  await database
    .update(template)
    .set({ latestPublishedVersionId: newer.id })
    .where(eq(template.id, taskBase.id));
  const selected = assertDefined(
    (await database.select().from(processTaskSpec).where(eq(processTaskSpec.stepId, stepId)))[0],
  );
  expect(selected).toMatchObject({ workTypeId: taskBase.id, workTypeVersionId: versionId });
  const generated = assertDefined(
    (
      await database
        .insert(task)
        .values({
          organizationId,
          teamId,
          title: selected.title,
          statusId,
          state: 'backlog',
          workTypeId: taskBase.id,
          workTypeVersionId: versionId,
        })
        .returning()
    )[0],
  );
  expect(generated.workTypeVersionId).toBe(versionId);
});

it.each(['template', 'version'] as const)('rejects a partial %s selection', async (field) => {
  await expect(
    insertSpec({
      workTypeId: field === 'template' ? taskBase.id : null,
      workTypeVersionId: field === 'version' ? taskBase.latestPublishedVersionId : null,
    }),
  ).rejects.toMatchObject({ cause: { constraint: 'process_task_spec_work_type_pair' } });
});

it('rejects a publication from a different definition', async () => {
  await expect(
    insertSpec({
      workTypeId: taskBase.id,
      workTypeVersionId: projectBase.latestPublishedVersionId,
    }),
  ).rejects.toMatchObject({ cause: { constraint: 'process_task_spec_work_type_version_fk' } });
});

it('rejects a task template from another workspace', async () => {
  await expect(
    insertSpec({
      workTypeId: foreignTaskBase.id,
      workTypeVersionId: foreignTaskBase.latestPublishedVersionId,
    }),
  ).rejects.toMatchObject({ cause: { constraint: 'process_task_spec_work_type_tenant_fk' } });
});

it('rejects a published template of a different work kind', async () => {
  await expect(
    insertSpec({
      workTypeId: projectBase.id,
      workTypeVersionId: projectBase.latestPublishedVersionId,
    }),
  ).rejects.toMatchObject({ cause: { constraint: 'process_task_spec_work_type_kind' } });
});
