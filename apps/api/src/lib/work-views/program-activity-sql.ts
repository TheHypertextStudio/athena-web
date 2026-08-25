import { sql, type SQL } from 'drizzle-orm';

import { compileAuthorizationSql } from './authorization-sql';

/** Execution values that keep an activity window stable across cursor pages. */
export interface ProgramActivitySqlContext {
  /** Organization whose canonical events are eligible. */
  readonly organizationId: string;
  /** Actor who must be allowed to view every linked child entity. */
  readonly actorId: string;
  /** User identity that resolves cross-organization Initiative access. */
  readonly userId: string | null;
  /** Cursor-stable upper bound for the activity window. */
  readonly asOf: string;
}

function visibleProgramActivityEntities(context: ProgramActivitySqlContext): SQL {
  const visibleProject = compileAuthorizationSql(
    'project',
    context.organizationId,
    context.actorId,
    context.userId,
    'activity_project',
  );
  const visibleTask = compileAuthorizationSql(
    'task',
    context.organizationId,
    context.actorId,
    context.userId,
    'activity_task',
  );
  return sql`select e.id as entity_id
    union
    select activity_project.id as entity_id from project activity_project
    where activity_project.organization_id=e.organization_id
      and activity_project.program_id=e.id
      and activity_project.archived_at is null
      and ${visibleProject}
    union
    select activity_task.id as entity_id from task activity_task
    where activity_task.organization_id=e.organization_id
      and activity_task.program_id=e.id
      and ${visibleTask}
    union
    select activity_task.id as entity_id from task activity_task
    join project activity_project
      on activity_project.id=activity_task.project_id
      and activity_project.organization_id=activity_task.organization_id
    where activity_task.organization_id=e.organization_id
      and activity_task.program_id is distinct from e.id
      and activity_project.program_id=e.id
      and activity_project.archived_at is null
      and ${visibleProject}
      and ${visibleTask}`;
}

/**
 * Aggregate canonical activity for one visible Program and its visible attached work.
 *
 * The entity union removes the duplicate route for a Task linked directly to a Program and to one
 * of its Projects. The event join then counts the canonical row once, rather than treating that
 * relationship overlap as two actions.
 *
 * @param context - Cursor-stable execution scope and caller identity.
 * @returns A JSON activity summary with eight Monday-aligned UTC buckets.
 */
export function compileProgramActivitySql(context: ProgramActivitySqlContext): SQL {
  return sql`(select json_build_object(
      'weeks', json_build_array(
        count(*) filter (where activity_event.occurred_at >= activity_window.week_start
          and activity_event.occurred_at < activity_window.week_start + interval '1 week'),
        count(*) filter (where activity_event.occurred_at >= activity_window.week_start + interval '1 week'
          and activity_event.occurred_at < activity_window.week_start + interval '2 weeks'),
        count(*) filter (where activity_event.occurred_at >= activity_window.week_start + interval '2 weeks'
          and activity_event.occurred_at < activity_window.week_start + interval '3 weeks'),
        count(*) filter (where activity_event.occurred_at >= activity_window.week_start + interval '3 weeks'
          and activity_event.occurred_at < activity_window.week_start + interval '4 weeks'),
        count(*) filter (where activity_event.occurred_at >= activity_window.week_start + interval '4 weeks'
          and activity_event.occurred_at < activity_window.week_start + interval '5 weeks'),
        count(*) filter (where activity_event.occurred_at >= activity_window.week_start + interval '5 weeks'
          and activity_event.occurred_at < activity_window.week_start + interval '6 weeks'),
        count(*) filter (where activity_event.occurred_at >= activity_window.week_start + interval '6 weeks'
          and activity_event.occurred_at < activity_window.week_start + interval '7 weeks'),
        count(*) filter (where activity_event.occurred_at >= activity_window.week_start + interval '7 weeks'
          and activity_event.occurred_at <= ${context.asOf}::timestamptz)
      ),
      'latestOccurredAt', max(activity_event.occurred_at)
    ) from event activity_event
    cross join (select (date_trunc('week', ${context.asOf}::timestamptz at time zone 'UTC')
      at time zone 'UTC') - interval '7 weeks' as week_start) activity_window
    where activity_event.organization_id=e.organization_id
      and activity_event.docket_entity_id in (${visibleProgramActivityEntities(context)})
      and activity_event.occurred_at >= activity_window.week_start
      and activity_event.occurred_at <= ${context.asOf}::timestamptz)`;
}
