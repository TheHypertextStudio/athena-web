import {
  DEFAULT_WORK_STATUSES,
  type WorkStatusEntityType,
} from '@docket/work/work-status-contract';
import { sql } from 'drizzle-orm';
import type { Database } from '../../src/client';
import { genId } from '../../src/id';
import { withMigrationPrefix } from '../../src/migration-prefix';
import { workStatus } from '../../src/schema';
import { backfillWorkTemplateIdentity } from '../../src/work-template-backfill';

/** Retained workspace/process IDs shared by PGlite and real PostgreSQL acceptance. */
export interface BlueprintRetainedFixture {
  readonly organizationId: string;
  readonly actorId: string;
  readonly teamId: string;
  readonly projectId: string;
  readonly taskId: string;
  readonly milestoneId: string;
  readonly forestRevisionId: string;
  readonly draftRevisionId: string;
  readonly genericRevisionId: string;
  readonly forestTaskStepId: string;
  readonly privateTemplateId: string;
}
/** Standard migration callback; fixture setup never touches a dev/shared database. */
export interface BlueprintFixtureMigration {
  readonly migrationsFolder: string;
  readonly applySqlMigrations: (folder: string) => Promise<void>;
}

/** Add one ordinary retained standalone Task source with literals kept in its normalized spec. */
export async function seedRetainedSingleTask(
  database: Database,
  input: {
    organizationId: string;
    actorId: string;
    teamId: string;
    revisionId?: string;
    published?: boolean;
  },
): Promise<string> {
  const definitionId = genId();
  const revisionId = input.revisionId ?? genId();
  const stepId = genId();
  await database.execute(
    sql`insert into process_definition(id,organization_id,name,status,created_by) values(${definitionId},${input.organizationId},'Retained repeat',${input.published === false ? 'draft' : 'published'},${input.actorId})`,
  );
  await database.execute(
    sql`insert into process_revision(id,organization_id,definition_id,number,published_at) values(${revisionId},${input.organizationId},${definitionId},1,${input.published === false ? null : '2001-01-01'}::timestamp)`,
  );
  await database.execute(
    sql`insert into process_step(id,organization_id,revision_id,key,kind) values(${stepId},${input.organizationId},${revisionId},'0legacy-task','task')`,
  );
  await database.execute(
    sql`insert into process_task_spec(step_id,organization_id,title,description,team_id,assignee_id,start_offset_days,due_offset_days) values(${stepId},${input.organizationId},'Repeat privately','Restricted source body',${input.teamId},${input.actorId},0,2)`,
  );
  return revisionId;
}

async function seedWorkspace(database: Database): Promise<{
  organizationId: string;
  actorId: string;
  teamId: string;
  statuses: Map<string, string>;
  privateTemplateId: string;
}> {
  const organizationId = genId();
  const actorId = genId();
  const teamId = genId();
  const privateTemplateId = genId();
  await database.execute(
    sql`insert into organization(id,name,slug) values(${organizationId},'Retained blueprint workspace',${`blueprint-${organizationId.toLowerCase()}`})`,
  );
  await database.execute(
    sql`insert into actor(id,organization_id,kind,display_name) values(${actorId},${organizationId},'human','Source author')`,
  );
  await database.execute(
    sql`insert into team(id,organization_id,name,key) values(${teamId},${organizationId},'Core','CORE')`,
  );
  const statuses = new Map<string, string>();
  for (const [kind, seeds] of Object.entries(DEFAULT_WORK_STATUSES))
    for (const seed of seeds) {
      const id = genId();
      await database
        .insert(workStatus)
        .values({ id, organizationId, entityType: kind as WorkStatusEntityType, ...seed });
      statuses.set(`${kind}:${seed.key}`, id);
    }
  await database.execute(
    sql`insert into template(id,organization_id,target_type,name,scope,owner_actor_id,payload) values(${privateTemplateId},${organizationId},'task','Private image outline','personal',${actorId},'{"targetType":"task","description":"Private ![image](library-file:private-image)"}'::jsonb)`,
  );
  await database.execute(
    sql`insert into template(id,organization_id,target_type,name,scope,owner_actor_id,team_id,payload) values(${genId()},${organizationId},'project','Team image outline','team',${actorId},${teamId},'{"targetType":"project","description":"Team private ![image](library-file:team-image)"}'::jsonb)`,
  );
  return { organizationId, actorId, teamId, statuses, privateTemplateId };
}

async function seedForest(
  database: Database,
  input: Awaited<ReturnType<typeof seedWorkspace>> & {
    projectId: string;
    milestoneId: string;
    taskId: string;
  },
): Promise<{ forestRevisionId: string; forestTaskStepId: string }> {
  const { organizationId, actorId, teamId, projectId } = input;
  const definitionId = genId();
  const forestRevisionId = genId();
  const projectStep = genId();
  const milestoneStep = genId();
  const forestTaskStepId = genId();
  const pendingStep = genId();
  const standaloneStep = genId();
  await database.execute(
    sql`insert into process_definition(id,organization_id,name,status,created_by) values(${definitionId},${organizationId},'Published retained forest','published',${actorId})`,
  );
  await database.execute(
    sql`insert into process_revision(id,organization_id,definition_id,number,creation_mode,published_at) values(${forestRevisionId},${organizationId},${definitionId},1,'when_ready','2001-01-01')`,
  );
  for (const [id, key, kind] of [
    [projectStep, 'project', 'project'],
    [milestoneStep, 'checkpoint', 'milestone'],
    [forestTaskStepId, 'task', 'task'],
    [pendingStep, 'pending', 'task'],
    [standaloneStep, 'standalone', 'task'],
  ])
    await database.execute(
      sql`insert into process_step(id,organization_id,revision_id,key,kind) values(${id},${organizationId},${forestRevisionId},${key},${kind}::process_step_kind)`,
    );
  await database.execute(
    sql`insert into process_project_spec(step_id,organization_id,name,description,team_id,lead_id,target_offset_days) values(${projectStep},${organizationId},'Source Project','Restricted Project body',${teamId},${actorId},10)`,
  );
  await database.execute(
    sql`insert into process_milestone_spec(step_id,organization_id,project_step_id,name,description,target_offset_days) values(${milestoneStep},${organizationId},${projectStep},'Source checkpoint','Restricted checkpoint body',7)`,
  );
  await database.execute(
    sql`insert into process_task_spec(step_id,organization_id,title,description,team_id,project_step_id,milestone_step_id,assignee_id,due_offset_days,state) values(${forestTaskStepId},${organizationId},'Source Task','Restricted Task body',${teamId},${projectStep},${milestoneStep},${actorId},5,'in_progress')`,
  );
  await database.execute(
    sql`insert into process_task_spec(step_id,organization_id,title,team_id,project_step_id,parent_task_step_id,due_offset_days) values(${pendingStep},${organizationId},'Still missing',${teamId},${projectStep},${forestTaskStepId},8)`,
  );
  await database.execute(
    sql`insert into process_task_spec(step_id,organization_id,title,description,team_id,project_id,assignee_id,due_offset_days) values(${standaloneStep},${organizationId},'Independent root','Restricted standalone body',${teamId},${projectId},${actorId},3)`,
  );
  await database.execute(
    sql`insert into process_dependency(revision_id,organization_id,blocking_step_id,blocked_step_id) values(${forestRevisionId},${organizationId},${forestTaskStepId},${standaloneStep})`,
  );
  await seedOccurrence(database, {
    ...input,
    definitionId,
    forestRevisionId,
    projectStep,
    milestoneStep,
    forestTaskStepId,
  });
  return { forestRevisionId, forestTaskStepId };
}

async function seedOccurrence(
  database: Database,
  input: {
    organizationId: string;
    definitionId: string;
    forestRevisionId: string;
    projectStep: string;
    milestoneStep: string;
    forestTaskStepId: string;
    projectId: string;
    milestoneId: string;
    taskId: string;
  },
): Promise<void> {
  const {
    organizationId,
    definitionId,
    forestRevisionId,
    projectStep,
    milestoneStep,
    forestTaskStepId,
    projectId,
    milestoneId,
    taskId,
  } = input;
  const seriesId = genId();
  const seriesRevisionId = genId();
  const occurrenceId = genId();
  const instanceId = genId();
  await database.execute(
    sql`insert into recurrence_series(id,organization_id,definition_id,name) values(${seriesId},${organizationId},${definitionId},'Retained cadence')`,
  );
  await database.execute(
    sql`insert into recurrence_series_revision(id,organization_id,series_id,process_revision_id,number,effective_from,trigger_kind) values(${seriesRevisionId},${organizationId},${seriesId},${forestRevisionId},1,'2026-10-01','manual')`,
  );
  await database.execute(
    sql`insert into process_occurrence(id,organization_id,series_id,series_revision_id,scheduled_for,external_occurrence_key) values(${occurrenceId},${organizationId},${seriesId},${seriesRevisionId},'2026-10-20','retained-calendar-key')`,
  );
  await database.execute(
    sql`insert into process_instance(id,organization_id,definition_id,revision_id,occurrence_id) values(${instanceId},${organizationId},${definitionId},${forestRevisionId},${occurrenceId})`,
  );
  await database.execute(
    sql`insert into process_instance_project(id,organization_id,instance_id,step_id,project_id) values(${genId()},${organizationId},${instanceId},${projectStep},${projectId})`,
  );
  await database.execute(
    sql`insert into process_instance_milestone(id,organization_id,instance_id,step_id,milestone_id) values(${genId()},${organizationId},${instanceId},${milestoneStep},${milestoneId})`,
  );
  await database.execute(
    sql`insert into process_instance_task(id,organization_id,instance_id,step_id,task_id) values(${genId()},${organizationId},${instanceId},${forestTaskStepId},${taskId})`,
  );
}

/** Prepare populated pre-identity data plus a retained forest/partial occurrence before0154. */
export async function prepareBlueprintRetainedFixture(
  database: Database,
  options: BlueprintFixtureMigration,
): Promise<BlueprintRetainedFixture> {
  await withMigrationPrefix(
    options.migrationsFolder,
    '0150_personal_inbound_receipts',
    options.applySqlMigrations,
  );
  const fixture = await seedWorkspace(database);
  const { organizationId, teamId, statuses } = fixture;
  const projectId = genId();
  const milestoneId = genId();
  const taskId = genId();
  await database.execute(
    sql`insert into project(id,organization_id,name,description,status,status_id,target_date) values(${projectId},${organizationId},'Edited root','Edited root body','planned',${statuses.get('project:planned')},'2026-10-30')`,
  );
  await database.execute(
    sql`insert into milestone(id,organization_id,project_id,name,target_date) values(${milestoneId},${organizationId},${projectId},'Edited checkpoint','2026-10-27')`,
  );
  await database.execute(
    sql`insert into task(id,organization_id,team_id,project_id,milestone_id,title,description,state,status_id,due_date,completed_at) values(${taskId},${organizationId},${teamId},${projectId},${milestoneId},'Edited terminal Task','Edited terminal body','done',${statuses.get('task:done')},'2026-10-25','2026-10-24')`,
  );
  for (const table of ['template', 'project', 'milestone', 'task'])
    await database.execute(
      sql`update ${sql.identifier(table)} set updated_at='2001-02-03 04:05:06'`,
    );
  await withMigrationPrefix(
    options.migrationsFolder,
    '0151_work_template_identity_expand',
    options.applySqlMigrations,
  );
  await backfillWorkTemplateIdentity(database);
  await withMigrationPrefix(
    options.migrationsFolder,
    '0153_process_task_template_identity',
    options.applySqlMigrations,
  );
  const { forestRevisionId, forestTaskStepId } = await seedForest(database, {
    ...fixture,
    projectId,
    milestoneId,
    taskId,
  });
  const genericRevisionId = await seedRetainedSingleTask(database, fixture);
  const draftRevisionId = await seedRetainedSingleTask(database, { ...fixture, published: false });
  return {
    ...fixture,
    projectId,
    milestoneId,
    taskId,
    forestRevisionId,
    forestTaskStepId,
    genericRevisionId,
    draftRevisionId,
  };
}
