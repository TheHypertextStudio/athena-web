import { sql, type SQL } from 'drizzle-orm';

import type { ViewTarget } from '@docket/work/view-contract';

import { compileProjectTeamMembershipSql } from './project-team-sql';
import {
  compileTenantRelationArraySql,
  compileTenantScalarRelationIdSql,
  WORK_VIEW_RELATIONS,
  WORK_VIEW_SCALAR_RELATIONS,
  type TenantScalarRelationDefinition,
} from './relation-sql';

/** Context fields used by work-view rank and projection SQL. */
export type WorkViewSqlContext = { readonly kind: string } & Record<string, unknown>;

/**
 * Read the nullable contextual manual rank joined into the page candidate set.
 *
 * @returns The rank column that remains null for unranked rows.
 */
export function manualRankExpression(): SQL {
  return sql`e._manual_rank`;
}

function base(): SQL {
  return sql`e.organization_id, coalesce(${manualRankExpression()}, 'U') as manual_rank,
    e._is_context as is_context`;
}

function scalarRelation(definition: TenantScalarRelationDefinition, columnName: string): SQL {
  return compileTenantScalarRelationIdSql(
    definition,
    sql.raw(`e.${columnName}`),
    sql`e.organization_id`,
  );
}

const projections = {
  task: (): SQL => sql`${base()},
    e.id, e.title, e.state as status, e.priority,
    ${scalarRelation(WORK_VIEW_SCALAR_RELATIONS.actor, 'assignee_id')} as assignee,
    ${scalarRelation(WORK_VIEW_SCALAR_RELATIONS.actor, 'delegate_id')} as delegate,
    ${scalarRelation(WORK_VIEW_SCALAR_RELATIONS.team, 'team_id')} as team,
    ${scalarRelation(WORK_VIEW_SCALAR_RELATIONS.project, 'project_id')} as project,
    ${scalarRelation(WORK_VIEW_SCALAR_RELATIONS.program, 'program_id')} as program,
    ${scalarRelation(WORK_VIEW_SCALAR_RELATIONS.cycle, 'cycle_id')} as cycle,
    ${scalarRelation(WORK_VIEW_SCALAR_RELATIONS.milestone, 'milestone_id')} as milestone,
    ${scalarRelation(WORK_VIEW_SCALAR_RELATIONS.task, 'parent_task_id')} as parent,
    ${compileTenantRelationArraySql(
      WORK_VIEW_RELATIONS.taskLabels,
      sql`e.id`,
      sql`e.organization_id`,
    )} as labels, ${scalarRelation(WORK_VIEW_SCALAR_RELATIONS.actor, 'created_by')} as creator,
    e.start_date, e.due_date, e.created_at, e.updated_at, e.estimate, e.estimate_minutes,
    e._blocked as blocked, e._blocking as blocking, e._unfiled as unfiled,
    e._archived as archived`,
  project: (): SQL => sql`${base()},
    e.id, e.name, e.status, e.priority, e.health,
    ${scalarRelation(WORK_VIEW_SCALAR_RELATIONS.actor, 'lead_id')} as lead,
    ${compileTenantRelationArraySql(
      WORK_VIEW_RELATIONS.projectMembers,
      sql`e.id`,
      sql`e.organization_id`,
    )} members,
    coalesce((select json_agg(project_teams.team_id order by project_teams.team_id)
      from (${compileProjectTeamMembershipSql(
        sql`e.id`,
        sql`e.organization_id`,
        sql`e.team_id`,
      )}) project_teams), '[]'::json) teams,
    ${scalarRelation(WORK_VIEW_SCALAR_RELATIONS.program, 'program_id')} as program,
    ${compileTenantRelationArraySql(
      WORK_VIEW_RELATIONS.projectInitiatives,
      sql`e.id`,
      sql`e.organization_id`,
    )} initiatives,
    ${compileTenantRelationArraySql(
      WORK_VIEW_RELATIONS.projectLabels,
      sql`e.id`,
      sql`e.organization_id`,
    )} labels, e.start_date, e.target_date,
    ${scalarRelation(WORK_VIEW_SCALAR_RELATIONS.actor, 'created_by')} as creator,
    e.created_at, e.updated_at,
    e._progress progress, e._task_count::int task_count,
    e._dependency_count::int dependency_count,
    coalesce((select json_agg(json_build_object(
      'id', m.id, 'name', m.name,
      'targetDate', case when m.target_date is null then null
        else to_char(m.target_date at time zone 'UTC', 'YYYY-MM-DD') end
    ) order by m.sort,m.id) from milestone m
      where m.project_id=e.id and m.organization_id=e.organization_id), '[]'::json) milestones,
    coalesce((select json_agg(d.blocking_project_id order by d.blocking_project_id)
      from project_dependency d join authorized related on related.id=d.blocking_project_id
      where d.blocked_project_id=e.id and d.organization_id=e.organization_id), '[]'::json) blocked_by_ids,
    coalesce((select json_agg(d.blocked_project_id order by d.blocked_project_id)
      from project_dependency d join authorized related on related.id=d.blocked_project_id
      where d.blocking_project_id=e.id and d.organization_id=e.organization_id), '[]'::json) blocks_ids`,
  program: (): SQL => sql`${base()},
    e.id, e.name, e.status, e.health,
    ${scalarRelation(WORK_VIEW_SCALAR_RELATIONS.actor, 'owner_id')} as owner,
    ${compileTenantRelationArraySql(
      WORK_VIEW_RELATIONS.programInitiatives,
      sql`e.id`,
      sql`e.organization_id`,
    )} initiatives,
    ${compileTenantRelationArraySql(
      WORK_VIEW_RELATIONS.programLabels,
      sql`e.id`,
      sql`e.organization_id`,
    )} labels, e.visibility,
    ${scalarRelation(WORK_VIEW_SCALAR_RELATIONS.actor, 'created_by')} as creator, e.updated_at,
    e._project_count::int project_count, e._task_count::int task_count`,
  initiative: (_context: WorkViewSqlContext, organizationId: string): SQL => sql`${base()},
    e.id, e.name, e.status, e.priority, e.health,
    ${scalarRelation(WORK_VIEW_SCALAR_RELATIONS.actor, 'owner_id')} as owner,
    ${scalarRelation(WORK_VIEW_SCALAR_RELATIONS.team, 'lead_team_id')} as lead_team,
    ${compileTenantRelationArraySql(
      WORK_VIEW_RELATIONS.initiativeLabels,
      sql`e.id`,
      sql`e.organization_id`,
    )} labels,
    e.target_date, e.update_cadence,
    e._latest_update latest_update, e._active_project_count::int active_project_count,
    (select h.parent_initiative_id from initiative_hierarchy_link h
      join authorized parent on parent.id=h.parent_initiative_id
      where h.child_initiative_id=e.id
        and h.context_organization_id=${organizationId} limit 1) parent,
    e.organization_id as organization,
    coalesce((select json_agg(json_build_object(
      'id', p.id, 'name', p.name,
      'startDate', case when p.start_date is null then null
        else to_char(p.start_date at time zone 'UTC', 'YYYY-MM-DD') end,
      'targetDate', case when p.target_date is null then null
        else to_char(p.target_date at time zone 'UTC', 'YYYY-MM-DD') end,
      'progress', coalesce((select count(*) filter(where t.completed_at is not null)::float
        / nullif(count(*),0) from task t where t.project_id=p.id
          and t.organization_id=p.organization_id),0)
    ) order by p.name,p.id) from initiative_project ip join project p
      on p.id=ip.project_id and p.organization_id=ip.organization_id
      where ip.initiative_id=e.id and ip.organization_id=e.organization_id
        and p.archived_at is null), '[]'::json) contributing_projects`,
} satisfies Record<ViewTarget, (context: WorkViewSqlContext, organizationId: string) => SQL>;

/** Target-indexed projection builders used by the typed SQL registry. */
export const WORK_VIEW_PROJECTIONS = projections;

function timestampValue(value: unknown): unknown {
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'string') return value;
  const explicitZone = /(?:Z|[+-]\d\d(?::?\d\d)?)$/.test(value);
  const parsed = new Date(explicitZone ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

/**
 * Convert a database projection into camel-case transport scalars.
 *
 * @param target - Entity target discriminator.
 * @param row - Raw projected database row.
 * @returns A transport-shaped record ready for target row-schema parsing.
 */
export function transportWorkViewRow(
  target: ViewTarget,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { target };
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith('_cursor_') || key.startsWith('_page_')) continue;
    const camel = key.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());
    if (['start_date', 'due_date', 'target_date'].includes(key)) {
      const timestamp = timestampValue(value);
      result[camel] = typeof timestamp === 'string' ? timestamp.slice(0, 10) : timestamp;
    } else if (['created_at', 'updated_at', 'latest_update'].includes(key)) {
      result[camel] = timestampValue(value);
    } else {
      result[camel] = value;
    }
  }
  return result;
}
