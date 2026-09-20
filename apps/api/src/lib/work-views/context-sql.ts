import type { ViewTarget } from '@docket/work/view-contract';
import { sql, type SQL } from 'drizzle-orm';

import { compileAuthorizationSql } from './authorization-sql';
import { WORK_VIEW_SQL_CONTRACTS } from './contracts';
import { compileProjectHasTeamSql } from './project-team-sql';
import {
  compileTenantRelationHasValueSql,
  compileTenantScalarRelationExistsSql,
  compileTenantScalarRelationHasValueSql,
  compileTenantScalarRelationIdSql,
  WORK_VIEW_RELATIONS,
  WORK_VIEW_SCALAR_RELATIONS,
} from './relation-sql';

/** Validated context shape used by target-specific SQL compilers. */
export interface WorkViewSqlContext extends Record<string, unknown> {
  /** Context discriminator from the request schema. */
  readonly kind: string;
}

/**
 * Compile the target membership predicate for a work-view context.
 *
 * @param target - Requested work-view target.
 * @param context - Validated organization, team, project, program, or Initiative context.
 * @param organizationId - Organization that owns the context and its hierarchy edges.
 * @returns A correlated context predicate for entity alias `e`.
 */
export function compileContextSql(
  target: ViewTarget,
  context: WorkViewSqlContext,
  organizationId: string,
): SQL {
  switch (context.kind) {
    case 'organization':
      return target === 'initiative' ? sql`e.organization_id=${organizationId}` : sql`true`;
    case 'team':
      return compileTeamContextSql(target, String(context['teamId']));
    case 'project':
      return target === 'task'
        ? compileTenantScalarRelationHasValueSql(
            WORK_VIEW_SCALAR_RELATIONS.project,
            sql`e.project_id`,
            sql`e.organization_id`,
            String(context['projectId']),
          )
        : sql`false`;
    case 'program':
      return compileProgramContextSql(target, String(context['programId']));
    case 'initiative':
      return compileInitiativeContextSql(target, String(context['initiativeId']), organizationId);
    default:
      return sql`false`;
  }
}

/**
 * The membership predicate for a team context.
 *
 * @param target - Requested work-view target.
 * @param teamId - The team the context names.
 * @returns A correlated context predicate for entity alias `e`.
 */
function compileTeamContextSql(target: ViewTarget, teamId: string): SQL {
  if (target === 'task') {
    return compileTenantScalarRelationHasValueSql(
      WORK_VIEW_SCALAR_RELATIONS.team,
      sql`e.team_id`,
      sql`e.organization_id`,
      teamId,
    );
  }
  if (target === 'project') {
    return compileProjectHasTeamSql(sql`e.id`, sql`e.organization_id`, sql`e.team_id`, teamId);
  }
  return sql`false`;
}

/**
 * The membership predicate for a program context.
 *
 * @remarks
 * A task belongs to a program either directly or through the project it is filed under, so both
 * paths are accepted rather than only the column the task itself carries.
 *
 * @param target - Requested work-view target.
 * @param programId - The program the context names.
 * @returns A correlated context predicate for entity alias `e`.
 */
function compileProgramContextSql(target: ViewTarget, programId: string): SQL {
  if (target === 'task') {
    return sql`(${compileTenantScalarRelationHasValueSql(
      WORK_VIEW_SCALAR_RELATIONS.program,
      sql`e.program_id`,
      sql`e.organization_id`,
      programId,
    )} or exists (
      select 1 from project p where p.id=e.project_id and p.organization_id=e.organization_id
        and ${compileTenantScalarRelationHasValueSql(
          WORK_VIEW_SCALAR_RELATIONS.program,
          sql`p.program_id`,
          sql`p.organization_id`,
          programId,
        )}))`;
  }
  return target === 'project'
    ? compileTenantScalarRelationHasValueSql(
        WORK_VIEW_SCALAR_RELATIONS.program,
        sql`e.program_id`,
        sql`e.organization_id`,
        programId,
      )
    : sql`false`;
}

/**
 * The membership predicate for an initiative context.
 *
 * @remarks
 * An initiative context reaches its whole subtree, so an initiative target walks the hierarchy
 * edges rather than matching the root alone.
 *
 * @param target - Requested work-view target.
 * @param initiativeId - The initiative the context names.
 * @param organizationId - Organization that owns the hierarchy edges.
 * @returns A correlated context predicate for entity alias `e`.
 */
function compileInitiativeContextSql(
  target: ViewTarget,
  initiativeId: string,
  organizationId: string,
): SQL {
  if (target === 'task') {
    return sql`(${compileTenantRelationHasValueSql(
      WORK_VIEW_RELATIONS.projectInitiatives,
      compileTenantScalarRelationIdSql(
        WORK_VIEW_SCALAR_RELATIONS.project,
        sql`e.project_id`,
        sql`e.organization_id`,
      ),
      sql`e.organization_id`,
      initiativeId,
    )} or ${compileTenantRelationHasValueSql(
      WORK_VIEW_RELATIONS.programInitiatives,
      compileTenantScalarRelationIdSql(
        WORK_VIEW_SCALAR_RELATIONS.program,
        sql`e.program_id`,
        sql`e.organization_id`,
      ),
      sql`e.organization_id`,
      initiativeId,
    )})`;
  }
  if (target === 'project') {
    return compileTenantRelationHasValueSql(
      WORK_VIEW_RELATIONS.projectInitiatives,
      sql`e.id`,
      sql`e.organization_id`,
      initiativeId,
    );
  }
  if (target === 'program') {
    return compileTenantRelationHasValueSql(
      WORK_VIEW_RELATIONS.programInitiatives,
      sql`e.id`,
      sql`e.organization_id`,
      initiativeId,
    );
  }
  return sql`(e.id=${initiativeId} or exists (
    with recursive descendants(id) as (
      select context_root.id from authorized context_root where context_root.id=${initiativeId}
      union
      select h.child_initiative_id from initiative_hierarchy_link h join descendants d on h.parent_initiative_id=d.id
      where h.context_organization_id=${organizationId}
    ) select 1 from descendants d where d.id=e.id))`;
}

function enrichmentSql(target: ViewTarget): SQL {
  const status = sql`case status_meta.category
      when 'backlog' then 0 when 'unstarted' then 1 when 'started' then 2
      when 'completed' then 3 when 'canceled' then 4 else 5 end as _status_category_rank,
    coalesce(status_meta.position, 2147483647) as _status_position_rank`;
  switch (target) {
    case 'task':
      return sql`${status},
        exists(select 1 from task_dependency d
          join task related on related.id=d.blocking_task_id and related.organization_id=e.organization_id
          where d.blocked_task_id=e.id and d.organization_id=e.organization_id) as _blocked,
        exists(select 1 from task_dependency d
          join task related on related.id=d.blocked_task_id and related.organization_id=e.organization_id
          where d.blocking_task_id=e.id and d.organization_id=e.organization_id) as _blocking,
        (not ${compileTenantScalarRelationExistsSql(
          WORK_VIEW_SCALAR_RELATIONS.project,
          sql`e.project_id`,
          sql`e.organization_id`,
        )} and not ${compileTenantScalarRelationExistsSql(
          WORK_VIEW_SCALAR_RELATIONS.program,
          sql`e.program_id`,
          sql`e.organization_id`,
        )}) as _unfiled,
        (e.archived_at is not null) as _archived`;
    case 'project':
      return sql`${status},
        coalesce((select count(*) filter(where t.completed_at is not null)::float/nullif(count(*),0)
          from task t where t.project_id=e.id and t.organization_id=e.organization_id),0) as _progress,
        (select count(*) from task t where t.project_id=e.id and t.organization_id=e.organization_id)::int as _task_count,
        (select count(*) from project_dependency d
          join project blocking on blocking.id=d.blocking_project_id and blocking.organization_id=e.organization_id
          join project blocked on blocked.id=d.blocked_project_id and blocked.organization_id=e.organization_id
          where d.organization_id=e.organization_id
            and (d.blocking_project_id=e.id or d.blocked_project_id=e.id))::int as _dependency_count`;
    case 'program':
      return sql`${status},
        (select count(*) from project p where p.program_id=e.id and p.organization_id=e.organization_id)::int as _project_count,
        ((select count(*) from task t where t.organization_id=e.organization_id
          and t.program_id=e.id) + (select count(*) from task t join project p
          on p.id=t.project_id and p.organization_id=t.organization_id
          where p.program_id=e.id and p.organization_id=e.organization_id
            and t.program_id is distinct from e.id))::int as _task_count`;
    case 'initiative':
      return sql`${status},
        (select max(u.created_at) from "update" u where u.subject_type='initiative'
          and u.subject_id=e.id and u.organization_id=e.organization_id) as _latest_update`;
  }
}

function baseColumns(target: ViewTarget): SQL {
  switch (target) {
    case 'task':
      return sql`e.organization_id, e.id, e.title, e.description, e.state, e.status_id, e.priority,
        e.assignee_id, e.delegate_id, e.team_id, e.project_id, e.program_id, e.cycle_id,
        e.milestone_id, e.parent_task_id, e.created_by, e.start_date, e.due_date,
        e.created_at, e.updated_at, e.estimate, e.estimate_minutes, e.archived_at`;
    case 'project':
      return sql`e.organization_id, e.id, e.name, e.summary, e.status, e.status_id, e.priority, e.health,
        e.lead_id, e.team_id, e.program_id, e.visibility, e.start_date, e.target_date,
        e.target_date_resolution, e.target_date_fiscal_year_start_month, e.created_by,
        e.created_at, e.updated_at`;
    case 'program':
      return sql`e.organization_id, e.id, e.name, e.summary, e.status, e.status_id, e.health,
        e.owner_id, e.visibility, e.created_by, e.updated_at`;
    case 'initiative':
      return sql`e.organization_id, e.id, e.name, e.summary, e.status, e.status_id, e.priority, e.health,
        e.owner_id, e.lead_team_id, e.target_date, e.update_cadence, e.updated_at`;
  }
}

function requiredScalarRelationsJoin(target: ViewTarget): SQL {
  return target === 'task'
    ? sql`join team required_team on required_team.id=e.team_id
      and required_team.organization_id=e.organization_id`
    : sql``;
}

/**
 * Compile the shared authorized, enriched, direct-match, and context-closure roster CTEs.
 *
 * @param target - Requested work-view target.
 * @param context - Validated context predicate input.
 * @param organizationId - Requested organization and hierarchy-edge boundary.
 * @param actorId - Authenticated actor in the requested organization.
 * @param userId - Caller identity used for foreign Initiative owners.
 * @param filter - Compiled direct-match filter.
 * @param authorizationScope - Optional indexed candidate restriction for point authorization.
 * @returns Materialized CTE definitions reused by page, count, and group projections.
 */
/** One roster compilation: the target, the context it is scoped to, and who is asking. */
export interface RosterCtesInput {
  readonly target: ViewTarget;
  readonly context: WorkViewSqlContext;
  readonly organizationId: string;
  readonly actorId: string;
  /** The acting person's Better Auth user id, when they have one. */
  readonly userId: string | null;
  /** The predicate that narrows the roster to the rows the caller asked for. */
  readonly filter: SQL;
  /** Narrows the authorized base before the context applies; defaults to the whole organization. */
  readonly authorizationScope?: SQL;
}

/** Compile the authorized and context-filtered roster CTEs for a work view. */
export function compileRosterCtes(input: RosterCtesInput): SQL {
  const {
    target,
    context,
    organizationId,
    actorId,
    userId,
    filter,
    authorizationScope = sql`true`,
  } = input;
  const table = WORK_VIEW_SQL_CONTRACTS[target].table;
  if (target === 'initiative') {
    return sql`authorized_base as materialized (
        select ${baseColumns('initiative')}, ${organizationId}::text as _context_organization_id from initiative e
        where ${authorizationScope}
          and ${compileAuthorizationSql('initiative', organizationId, actorId, userId)}
      ), authorized as materialized (
        select e.*, ${enrichmentSql('initiative')} from authorized_base e
        left join work_status status_meta on status_meta.id=e.status_id
          and status_meta.organization_id=e.organization_id
      ), direct_candidates as materialized (
        select e.* from authorized e
        where ${compileContextSql('initiative', context, organizationId)} and ${filter}
      ), direct_ancestor_chain(direct_id, ancestor_id) as (
        select d.id, d.id from direct_candidates d
        union
        select chain.direct_id, h.parent_initiative_id
        from initiative_hierarchy_link h
        join direct_ancestor_chain chain on chain.ancestor_id=h.child_initiative_id
        where h.context_organization_id=${organizationId}
      ), direct as materialized (
        select candidate.* from direct_candidates candidate
        where not exists (
          select 1 from direct_ancestor_chain chain
          left join authorized ancestor on ancestor.id=chain.ancestor_id
          where chain.direct_id=candidate.id and ancestor.id is null
        )
      ), ancestor_ids(id) as (
        select chain.ancestor_id from direct_ancestor_chain chain
        join direct d on d.id=chain.direct_id
      ), matched as materialized (
        select e.*, not exists(select 1 from direct d where d.id=e.id) as _is_context
        from authorized e join ancestor_ids a on a.id=e.id
      )`;
  }
  const activeProject = target === 'project' ? sql`and e.archived_at is null` : sql``;
  return sql`authorized_base as not materialized (
      select ${baseColumns(target)} from ${sql.raw(table)} e
      ${requiredScalarRelationsJoin(target)}
      where e.organization_id=${organizationId}
        ${activeProject}
        and ${authorizationScope}
        and ${compileAuthorizationSql(target, organizationId, actorId, userId)}
    ), authorized as not materialized (
      select e.*, ${enrichmentSql(target)} from authorized_base e
      left join work_status status_meta on status_meta.id=e.status_id
        and status_meta.organization_id=e.organization_id
    ), matched as not materialized (
      select e.*, false as _is_context from authorized e
      where ${compileContextSql(target, context, organizationId)} and ${filter}
    )`;
}
