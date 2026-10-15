import assert from 'node:assert/strict';

import {
  DEFAULT_WORK_STATUSES,
  type WorkStatusEntityType,
} from '@docket/work/work-status-contract';
import { eq, isNotNull, sql } from 'drizzle-orm';

import type { Database } from '../../src/client';
import { genId } from '../../src/id';
import { withMigrationPrefix } from '../../src/migration-prefix';
import { backfillWorkTemplateIdentity } from '../../src/work-template-backfill';
import { task, template, workStatus, workTypeVersion } from '../../src/schema';

async function stampRetainedAuditFields(database: Database): Promise<void> {
  for (const tableName of ['template', 'task', 'initiative', 'program', 'project']) {
    await database.execute(
      sql`update ${sql.identifier(tableName)} set updated_at = '2001-02-03 04:05:06'`,
    );
  }
}

/** Seed the pre-expansion columns, without invoking new workspace provisioning prematurely. */
async function legacyFixture(database: Database) {
  const orgId = genId();
  const actorId = genId();
  const teamId = genId();
  await database.execute(
    sql`insert into organization (id, name, slug) values (${orgId}, 'Retained workspace', 'retained-template-work')`,
  );
  await database.execute(
    sql`insert into actor (id, organization_id, kind, display_name) values (${actorId}, ${orgId}, 'human', 'Draft author')`,
  );
  await database.execute(
    sql`insert into team (id, organization_id, name, key) values (${teamId}, ${orgId}, 'Core', 'CORE')`,
  );
  const statuses = new Map<string, string>();
  for (const [kind, rows] of Object.entries(DEFAULT_WORK_STATUSES)) {
    for (const row of rows) {
      const id = genId();
      await database
        .insert(workStatus)
        .values({ id, organizationId: orgId, entityType: kind as WorkStatusEntityType, ...row });
      statuses.set(`${kind}:${row.key}`, id);
    }
  }
  const statusId = (key: string): string => {
    const id = statuses.get(key);
    assert.ok(id);
    return id;
  };
  const publishedId = genId();
  const personalId = genId();
  const teamTemplateId = genId();
  const taskPayload = JSON.stringify({
    targetType: 'task',
    description: '## Outcome\nExplain the intended result.',
  });
  const projectPayload = JSON.stringify({
    targetType: 'project',
    description: '## Private team outline\nKeep this with the team.',
  });
  await database.execute(
    sql`insert into template (id, organization_id, target_type, name, scope, payload) values (${publishedId}, ${orgId}, 'task', 'Task brief', 'organization', ${taskPayload}::jsonb)`,
  );
  await database.execute(
    sql`insert into template (id, organization_id, target_type, name, scope, owner_actor_id, payload) values (${personalId}, ${orgId}, 'task', 'Personal brief', 'personal', ${actorId}, ${taskPayload}::jsonb)`,
  );
  await database.execute(
    sql`insert into template (id, organization_id, target_type, name, scope, owner_actor_id, team_id, payload) values (${teamTemplateId}, ${orgId}, 'project', 'Team event', 'team', ${actorId}, ${teamId}, ${projectPayload}::jsonb)`,
  );
  const taskIds: string[] = [];
  for (let index = 0; index < 4; index++) {
    const id = genId();
    taskIds.push(id);
    const legacyTemplate = index === 0 ? publishedId : index === 1 ? personalId : null;
    await database.execute(
      sql`insert into task (id, organization_id, team_id, title, description, state, status_id, template_id) values (${id}, ${orgId}, ${teamId}, ${`Retained task ${index}`}, 'Existing authored body', 'backlog', ${statusId('task:backlog')}, ${legacyTemplate})`,
    );
  }
  await database.execute(
    sql`insert into initiative (id, organization_id, name, status, status_id) values (${genId()}, ${orgId}, 'Community connections', 'active', ${statusId('initiative:active')})`,
  );
  await database.execute(
    sql`insert into program (id, organization_id, name, status, status_id) values (${genId()}, ${orgId}, 'Community dinners', 'active', ${statusId('program:active')})`,
  );
  await database.execute(
    sql`insert into project (id, organization_id, name, description, status, status_id) values (${genId()}, ${orgId}, 'October dinner', 'Retained project body', 'planned', ${statusId('project:planned')})`,
  );
  await stampRetainedAuditFields(database);
  return {
    orgId,
    actorId,
    teamId,
    publishedId,
    personalId,
    teamTemplateId,
    taskIds,
    taskStatusId: statusId('task:backlog'),
  };
}

async function assertRetainedData(
  database: Database,
  retained: Awaited<ReturnType<typeof legacyFixture>>,
): Promise<void> {
  const definitions = await database
    .select()
    .from(template)
    .where(eq(template.organizationId, retained.orgId));
  const personal = definitions.find((row) => row.id === retained.personalId);
  const teamDraft = definitions.find((row) => row.id === retained.teamTemplateId);
  const published = definitions.find((row) => row.id === retained.publishedId);
  assert.ok(personal && teamDraft && published);
  assert.equal(personal.scope, 'personal');
  assert.equal(personal.ownerActorId, retained.actorId);
  assert.equal(personal.publicationState, 'draft');
  assert.equal(personal.latestPublishedVersionId, null);
  assert.equal(teamDraft.scope, 'team');
  assert.equal(teamDraft.teamId, retained.teamId);
  assert.equal(teamDraft.publicationState, 'draft');
  assert.equal(teamDraft.latestPublishedVersionId, null);
  assert.equal(published.publicationState, 'published');
  const retainedBase = definitions.find((row) => row.isBase && row.targetType === 'task');
  assert.equal(retainedBase?.updatedAt.toISOString(), '2001-02-03T04:05:06.000Z');
  for (const tableName of ['template', 'task', 'initiative', 'program', 'project']) {
    const result = await database
      .select({ changed: sql<number>`count(*)::int` })
      .from(sql`${sql.identifier(tableName)}`).where(sql`updated_at <> '2001-02-03 04:05:06'
        ${tableName === 'template' ? sql`and not is_base` : sql`and id <> '01ARZ3NDEKTSV4RRFFQ69G5FAV'`}`);
    assert.equal(result[0]?.changed, 0, `${tableName} retained audit timestamps`);
  }
  const tasks = await database
    .select({
      id: task.id,
      description: task.description,
      workTypeId: task.workTypeId,
      workTypeVersionId: task.workTypeVersionId,
      source: task.workTypeAssignmentSource,
    })
    .from(task)
    .orderBy(task.id);
  assert.equal(tasks.length, 5);
  for (const row of tasks) {
    assert.equal(row.description, 'Existing authored body');
    assert.equal(row.source, 'migration_baseline');
    assert.ok(row.workTypeId && row.workTypeVersionId);
  }
  assert.equal(
    tasks.find((row) => row.id === retained.taskIds[0])?.workTypeId,
    retained.publishedId,
  );
  assert.notEqual(
    tasks.find((row) => row.id === retained.taskIds[1])?.workTypeId,
    retained.personalId,
  );
}

/** Exercise the same retained-data migration against embedded or real PostgreSQL. */
export async function exerciseWorkTemplateMigration(
  database: Database,
  options: {
    readonly migrationsFolder: string;
    readonly applySqlMigrations: (folder: string) => Promise<void>;
  },
): Promise<{ workItems: number; privateDrafts: number; publishedBaselines: number }> {
  await withMigrationPrefix(
    options.migrationsFolder,
    '0150_personal_inbound_receipts',
    options.applySqlMigrations,
  );
  const retained = await legacyFixture(database);
  await withMigrationPrefix(
    options.migrationsFolder,
    '0151_work_template_identity_expand',
    options.applySqlMigrations,
  );
  await database.execute(sql`insert into template
    (id, organization_id, target_type, name, scope, payload, is_base, publication_state, updated_at)
    values (${genId()}, ${retained.orgId}, 'task', 'Blank task', 'organization',
      '{"targetType":"task"}'::jsonb, true, 'draft', '2001-02-03 04:05:06')`);
  await assert.rejects(
    backfillWorkTemplateIdentity(database, {
      batchSize: 2,
      onBatch: (progress) => {
        if (progress.phase === 'task')
          throw new Error('Simulated interruption after committed batch');
      },
    }),
    /Simulated interruption/,
  );
  const partial = await database
    .select({ count: sql<number>`count(*)::int` })
    .from(task)
    .where(isNotNull(task.workTypeId));
  assert.equal(partial[0]?.count, 2);
  // A delayed import has an older ULID than the last committed batch; a cursor must not miss it.
  await database.execute(
    sql`insert into task (id, organization_id, team_id, title, description, state, status_id) values ('01ARZ3NDEKTSV4RRFFQ69G5FAV', ${retained.orgId}, ${retained.teamId}, 'Delayed imported work', 'Existing authored body', 'backlog', ${retained.taskStatusId})`,
  );
  await assert.rejects(options.applySqlMigrations(options.migrationsFolder));
  const versionsBefore = await database.select().from(workTypeVersion).orderBy(workTypeVersion.id);
  await backfillWorkTemplateIdentity(database, { batchSize: 2 });
  await database.execute(
    sql`update template set name = 'Concurrent legacy edit' where id = ${retained.publishedId}`,
  );
  await assert.rejects(options.applySqlMigrations(options.migrationsFolder));
  await database.execute(
    sql`update template set name = 'Task brief' where id = ${retained.publishedId}`,
  );
  await options.applySqlMigrations(options.migrationsFolder);
  assert.deepEqual(
    await database.select().from(workTypeVersion).orderBy(workTypeVersion.id),
    versionsBefore,
  );
  await assertRetainedData(database, retained);
  const repeat = await backfillWorkTemplateIdentity(database, { batchSize: 2 });
  assert.equal(
    Object.values(repeat).reduce((total, count) => total + count, 0),
    0,
  );
  return { workItems: 8, privateDrafts: 2, publishedBaselines: 1 };
}
