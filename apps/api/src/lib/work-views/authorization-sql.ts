import type { ViewTarget } from '@docket/work/view-contract';
import { sql, type SQL } from 'drizzle-orm';

import { compileProjectHasTeamSql } from './project-team-sql';
import { compileTenantScalarRelationHasValueSql, WORK_VIEW_SCALAR_RELATIONS } from './relation-sql';

function entityColumn(entityAlias: string, column: string): SQL {
  return sql`${sql.raw(entityAlias)}.${sql.raw(column)}`;
}

function grantResourceSql(target: ViewTarget, entityAlias: string): SQL {
  const direct = sql`(g.resource_kind=${target} and g.resource_id=${entityColumn(entityAlias, 'id')})`;
  const organization = sql`(g.resource_kind='organization' and g.resource_id=${entityColumn(entityAlias, 'organization_id')})`;
  switch (target) {
    case 'task':
      return sql`(${direct} or (g.cascades and (${organization}
        or (g.resource_kind='team' and ${compileTenantScalarRelationHasValueSql(
          WORK_VIEW_SCALAR_RELATIONS.team,
          entityColumn(entityAlias, 'team_id'),
          entityColumn(entityAlias, 'organization_id'),
          sql`g.resource_id`,
        )})
        or (g.resource_kind='project' and ${compileTenantScalarRelationHasValueSql(
          WORK_VIEW_SCALAR_RELATIONS.project,
          entityColumn(entityAlias, 'project_id'),
          entityColumn(entityAlias, 'organization_id'),
          sql`g.resource_id`,
        )})
        or (g.resource_kind='program' and ${compileTenantScalarRelationHasValueSql(
          WORK_VIEW_SCALAR_RELATIONS.program,
          entityColumn(entityAlias, 'program_id'),
          entityColumn(entityAlias, 'organization_id'),
          sql`g.resource_id`,
        )}))))`;
    case 'project':
      return sql`(${direct} or (g.cascades and (${organization}
        or (g.resource_kind='team' and ${compileProjectHasTeamSql(
          entityColumn(entityAlias, 'id'),
          entityColumn(entityAlias, 'organization_id'),
          entityColumn(entityAlias, 'team_id'),
          sql`g.resource_id`,
        )})
        or (g.resource_kind='program' and ${compileTenantScalarRelationHasValueSql(
          WORK_VIEW_SCALAR_RELATIONS.program,
          entityColumn(entityAlias, 'program_id'),
          entityColumn(entityAlias, 'organization_id'),
          sql`g.resource_id`,
        )}))))`;
    case 'program':
    case 'initiative':
      return sql`(${direct} or (g.cascades and ${organization}))`;
  }
}

/**
 * Compile the authorization predicate that precedes every work-view match operation.
 *
 * Initiative nodes may belong to another organization. The caller must have an active actor for
 * the same user in that owning organization. Other targets remain inside the requested workspace.
 *
 * @param target - Work-view target whose grant cascade rules apply.
 * @param organizationId - Requested organization boundary.
 * @param actorId - Authenticated actor in the requested organization.
 * @param userId - User identity used to resolve corresponding actors across organizations.
 * @param entityAlias - SQL alias that names the entity checked by this predicate.
 * @returns A correlated authorization condition for the supplied entity alias.
 */
export function compileAuthorizationSql(
  target: ViewTarget,
  organizationId: string,
  actorId: string,
  userId: string | null,
  entityAlias = 'e',
): SQL {
  const entityOrganization = entityColumn(entityAlias, 'organization_id');
  const visibility =
    target === 'initiative' ? sql`'public'` : entityColumn(entityAlias, 'visibility');
  const viewerOrganization = target === 'initiative' ? entityOrganization : sql`${organizationId}`;
  const viewerIdentity = sql`viewer.organization_id = ${viewerOrganization}
    and ((viewer.id = ${actorId} and viewer.organization_id=${organizationId})
      or (${userId}::text is not null and viewer.user_id=${userId}))
    and viewer.kind = 'human' and viewer.status = 'active'
    and viewer.archived_at is null
    and (viewer.role_id is null or viewer_role.id is not null)`;
  return sql`(
    (${visibility} = 'public' and exists (
      select 1 from actor viewer
      left join role viewer_role on viewer_role.id = viewer.role_id
        and viewer_role.organization_id = viewer.organization_id
      where ${viewerIdentity}
        and coalesce(viewer_role.default_visibility, 'public') = 'public'
    )) or exists (
      select 1 from actor viewer
      left join role viewer_role on viewer_role.id = viewer.role_id
        and viewer_role.organization_id = viewer.organization_id
      where ${viewerIdentity}
        and exists (
          select 1 from "grant" g
          where g.organization_id = ${entityOrganization}
            and ((g.subject_kind = 'actor' and g.subject_id = viewer.id)
              or (g.subject_kind = 'role' and g.subject_id = viewer_role.id))
            and ${grantResourceSql(target, entityAlias)}
            and g.effect = 'allow'
            and (g.expires_at is null or g.expires_at > now())
            and g.capabilities ?| array['view','comment','contribute','assign','manage','admin','owner']
        )
    ))`;
}
