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

function contextId(context: WorkViewSqlContext, organizationId: string): string {
  return context.kind === 'organization'
    ? organizationId
    : String(
        context['teamId'] ??
          context['projectId'] ??
          context['programId'] ??
          context['initiativeId'],
      );
}

/**
 * Build the nullable contextual manual-rank expression for alias `e`.
 *
 * @param target - Entity target being ordered.
 * @param context - Active list context.
 * @param organizationId - Workspace that owns the ordering context.
 * @returns A correlated rank lookup that remains null for unranked rows.
 */
export function manualRankExpression(
  target: ViewTarget,
  context: WorkViewSqlContext,
  organizationId: string,
): SQL {
  return sql`(select w.rank from work_item_order w
    where w.organization_id=${organizationId} and w.context_type=${context.kind}
      and w.context_id=${contextId(context, organizationId)} and w.target=${target}
      and w.item_id=e.id)`;
}

function base(target: ViewTarget, context: WorkViewSqlContext, organizationId: string): SQL {
  return sql`e.organization_id, coalesce(${manualRankExpression(target, context, organizationId)}, 'U') as manual_rank,
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
  task: (
    context: WorkViewSqlContext,
    organizationId: string,
  ): SQL => sql`${base('task', context, organizationId)},
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
  project: (
    context: WorkViewSqlContext,
    organizationId: string,
  ): SQL => sql`${base('project', context, organizationId)},
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
    e._dependency_count::int dependency_count`,
  program: (
    context: WorkViewSqlContext,
    organizationId: string,
  ): SQL => sql`${base('program', context, organizationId)},
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
  initiative: (
    context: WorkViewSqlContext,
    organizationId: string,
  ): SQL => sql`${base('initiative', context, organizationId)},
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
    e.organization_id as organization`,
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
