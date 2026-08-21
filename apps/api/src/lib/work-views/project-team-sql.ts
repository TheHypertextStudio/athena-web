import { sql, type SQL } from 'drizzle-orm';

/**
 * Compile the deduplicated and tenant-safe Team memberships for one Project.
 *
 * The compatibility `project.team_id` remains readable until all Project writers create the
 * matching `project_team` edge. `UNION` prevents a migrated primary Team from appearing twice.
 * Both storage paths must resolve to a Team owned by the Project organization.
 *
 * @param projectId - Project id expression.
 * @param projectOrganizationId - Organization that owns the Project and every valid Team edge.
 * @param primaryTeamId - Compatibility primary-Team expression.
 * @returns A query with one `team_id` column and no duplicate or cross-tenant Team ids.
 */
export function compileProjectTeamMembershipSql(
  projectId: SQL,
  projectOrganizationId: SQL,
  primaryTeamId: SQL,
): SQL {
  return sql`select primary_team.id::text as team_id from team primary_team
    where primary_team.id=${primaryTeamId}
      and primary_team.organization_id=${projectOrganizationId}
    union
    select edge_team.id::text as team_id from project_team pt
    join team edge_team on edge_team.id=pt.team_id
    where pt.project_id=${projectId}
      and pt.organization_id=${projectOrganizationId}
      and edge_team.organization_id=${projectOrganizationId}`;
}

/**
 * Compile a tenant-safe Project Team-membership predicate across compatibility and edge storage.
 *
 * @param projectId - Project id expression.
 * @param projectOrganizationId - Organization that owns the Project and valid Teams.
 * @param primaryTeamId - Compatibility primary-Team expression.
 * @param teamId - Team id value or correlated expression to match.
 * @returns A correlated `EXISTS` predicate over deduplicated tenant-safe memberships.
 */
export function compileProjectHasTeamSql(
  projectId: SQL,
  projectOrganizationId: SQL,
  primaryTeamId: SQL,
  teamId: unknown,
): SQL {
  return sql`exists (
    select 1 from (${compileProjectTeamMembershipSql(
      projectId,
      projectOrganizationId,
      primaryTeamId,
    )}) project_teams
    where project_teams.team_id=${teamId}
  )`;
}
