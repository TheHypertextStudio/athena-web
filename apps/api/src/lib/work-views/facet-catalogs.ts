import { WORK_VIEW_SQL_CONTRACTS } from './contracts';
import type { WorkViewFacetRequest } from '@docket/work/work-view-contract';
import { sql, type SQL } from 'drizzle-orm';
import { compileAuthorizationSql } from './authorization-sql';
import { cycleDisplayNameSql } from './cycle-label-sql';
import { workTemplateFacetCatalogSql } from './work-template-sql';

function staticEnumCatalog(
  target: WorkViewFacetRequest['target'],
  field: string,
): readonly string[] {
  const catalogs: Readonly<Record<string, readonly string[]>> = {
    'task.priority': ['urgent', 'high', 'medium', 'low', 'none'],
    'project.priority': ['urgent', 'high', 'medium', 'low', 'none'],
    'initiative.priority': ['high', 'medium', 'low', 'none'],
    'project.health': ['off_track', 'at_risk', 'on_track'],
    'program.health': ['off_track', 'at_risk', 'on_track'],
    'initiative.health': ['off_track', 'at_risk', 'on_track'],
    'program.visibility': ['public', 'private'],
    'initiative.updateCadence': ['weekly', 'biweekly', 'monthly', 'quarterly', 'none'],
  };
  return catalogs[`${target}.${field}`] ?? [];
}

function initiativeRelationCatalog(
  field: string,
  organizationId: string,
  actorId: string,
  userId: string | null,
): SQL | null {
  switch (field) {
    case 'parent':
      return sql`select option.id::text key, option.name::text label
        from initiative_catalog option`;
    case 'owner':
      return sql`select option.id::text key, option.display_name::text label
        from initiative_catalog e
        join actor option on option.id=e.owner_id and option.organization_id=e.organization_id
        where option.status='active' and option.archived_at is null`;
    case 'leadTeam':
      return sql`select option.id::text key, option.name::text label
        from initiative_catalog e
        join team option on option.id=e.lead_team_id and option.organization_id=e.organization_id
        where option.archived_at is null`;
    case 'labels':
      return sql`select option.id::text key, option.name::text label
        from initiative_catalog e
        join initiative_label membership on membership.initiative_id=e.id
          and membership.organization_id=e.organization_id
        join label option on option.id=membership.label_id
          and option.organization_id=membership.organization_id
        where option.team_id is null or exists (
          select 1 from team_member team_membership
          join actor viewer on viewer.id=team_membership.actor_id
            and viewer.organization_id=team_membership.organization_id
          where team_membership.organization_id=option.organization_id
            and team_membership.team_id=option.team_id
            and viewer.kind='human' and viewer.status='active' and viewer.archived_at is null
            and ((viewer.id=${actorId} and viewer.organization_id=${organizationId})
              or (${userId}::text is not null and viewer.user_id=${userId}))
        )`;
    case 'organization':
      return sql`select option.id::text key, option.name::text label
        from initiative_catalog e
        join organization option on option.id=e.organization_id`;
    default:
      return null;
  }
}

function specializedRelationCatalog(
  target: WorkViewFacetRequest['target'],
  field: string,
  organizationId: string,
  actorId: string,
  userId: string | null,
): SQL | null {
  if (field === 'workTypeId')
    return workTemplateFacetCatalogSql(target, organizationId, actorId, userId);
  if (target === 'initiative') {
    const catalog = initiativeRelationCatalog(field, organizationId, actorId, userId);
    if (catalog) return catalog;
  }
  return null;
}

function relationCatalog(
  target: WorkViewFacetRequest['target'],
  field: string,
  organizationId: string,
  actorId: string,
  userId: string | null,
): SQL | null {
  const specialized = specializedRelationCatalog(target, field, organizationId, actorId, userId);
  if (specialized) return specialized;
  const relation = (
    table: string,
    labelColumn: string,
    extra: SQL = sql`true`,
  ): SQL => sql`select option.id::text key, option.${sql.raw(labelColumn)}::text label
      from ${sql.raw(table)} option
      where option.organization_id=${organizationId} and ${extra}`;
  const workRelation = (
    relationTarget: 'task' | 'project' | 'program' | 'initiative',
    table: string,
    labelColumn: string,
  ): SQL => sql`select e.id::text key, e.${sql.raw(labelColumn)}::text label
      from ${sql.raw(table)} e
      where e.organization_id=${organizationId}
        and ${compileAuthorizationSql(relationTarget, organizationId, actorId, userId)}`;
  const key = `${target}.${field}`;
  if (
    [
      'task.assignee',
      'task.delegate',
      'task.creator',
      'project.lead',
      'project.members',
      'project.creator',
      'program.owner',
      'program.creator',
      'initiative.owner',
    ].includes(key)
  ) {
    return relation(
      'actor',
      'display_name',
      sql`option.status='active' and option.archived_at is null`,
    );
  }
  if (['task.team', 'project.teams', 'initiative.leadTeam'].includes(key)) {
    return relation('team', 'name', sql`option.archived_at is null`);
  }
  if (key === 'task.project') return workRelation('project', 'project', 'name');
  if (['task.program', 'project.program'].includes(key)) {
    return workRelation('program', 'program', 'name');
  }
  if (key === 'task.cycle') {
    return sql`select option.id::text key,
        ${cycleDisplayNameSql('option')}::text label
      from cycle option
      where option.organization_id=${organizationId}`;
  }
  if (key === 'task.milestone') return relation('milestone', 'name');
  if (key === 'task.parent') return workRelation('task', 'task', 'title');
  if (['project.initiatives', 'program.initiatives', 'initiative.parent'].includes(key)) {
    return workRelation('initiative', 'initiative', 'name');
  }
  if (['task.labels', 'project.labels', 'program.labels', 'initiative.labels'].includes(key)) {
    return relation(
      'label',
      'name',
      sql`(option.team_id is null or exists (
        select 1 from team_member membership
        where membership.organization_id=option.organization_id
          and membership.team_id=option.team_id and membership.actor_id=${actorId}
      ))`,
    );
  }
  if (key === 'initiative.organization') {
    return sql`select option.id::text key, option.name::text label from organization option
      where option.id=${organizationId}`;
  }
  return null;
}

/** Build one bounded, tenant-authorized choice catalog for the existing facet query. */
export function optionCatalog(input: {
  target: WorkViewFacetRequest['target'];
  field: string;
  organizationId: string;
  actorId: string;
  userId: string | null;
  search: string | null;
  cursorKey: string | null;
  limit: number;
}): SQL {
  const boundedRelation = (
    catalog: SQL,
  ): SQL => sql`select bounded_catalog.key, bounded_catalog.label
    from (
      select candidate.key, min(candidate.label)::text label
      from (${catalog}) candidate
      where (${input.search}::text is null or candidate.label ilike ('%' || ${input.search} || '%'))
        and (${input.cursorKey}::text is null or candidate.key > ${input.cursorKey})
      group by candidate.key
      order by candidate.key limit ${input.limit + 1}
    ) bounded_catalog`;
  if (input.field === 'status') {
    if (input.target === 'initiative') {
      return boundedRelation(sql`select option.key::text key, option.name::text label
          from initiative_catalog e
          join work_status option on option.id=e.status_id
            and option.organization_id=e.organization_id
            and option.entity_type='initiative'`);
    }
    return boundedRelation(sql`select option.key::text key, option.name::text label from work_status option
        where option.organization_id=${input.organizationId} and option.entity_type=${input.target}
          and (option.team_id is null or exists (
            select 1 from team_member membership
            where membership.organization_id=option.organization_id
              and membership.team_id=option.team_id and membership.actor_id=${input.actorId}
          ))`);
  }
  const relation = relationCatalog(
    input.target,
    input.field,
    input.organizationId,
    input.actorId,
    input.userId,
  );
  if (relation) return boundedRelation(relation);
  const values = staticEnumCatalog(input.target, input.field);
  if (values.length > 0) {
    return sql`select catalog.key::text key, catalog.key::text label
      from (values ${sql.join(
        values.map((value) => sql`(${value})`),
        sql`, `,
      )}) catalog(key)`;
  }
  const declarations = WORK_VIEW_SQL_CONTRACTS[input.target].contract.fields as Readonly<
    Record<string, { readonly kind: string }>
  >;
  const declaration = declarations[input.field];
  if (declaration?.kind === 'boolean') {
    return sql`select catalog.key::text key, catalog.key::text label
      from (values ('false'), ('true')) catalog(key)`;
  }
  return sql`select null::text key, null::text label where false`;
}
