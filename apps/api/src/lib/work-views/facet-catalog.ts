/**
 * `@docket/api` — the option catalogs a work-view facet picker lists.
 *
 * @remarks
 * A facet's options are not only the values the current view happens to contain. Every value the
 * caller could pick has to appear, or a filter's picker would hide a choice simply because nothing
 * matches it right now — so `./facets` unions these catalogs with the counted memberships. Each
 * catalog is one `select key, label` statement scoped to the caller's organization and, for work
 * entities, to what they may see.
 */
import type { WorkViewFacetRequest } from '@docket/work/work-view-contract';
import { sql, type SQL } from 'drizzle-orm';

import { compileAuthorizationSql } from './authorization-sql';
import { WORK_VIEW_SQL_CONTRACTS } from './contracts';
import { cycleDisplayNameSql } from './cycle-label-sql';

/** Return the fixed option values for an enum-backed facet. */
export function staticEnumCatalog(
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

function relationCatalog(
  target: WorkViewFacetRequest['target'],
  field: string,
  organizationId: string,
  actorId: string,
  userId: string | null,
): SQL | null {
  if (target === 'initiative') {
    const catalog = initiativeRelationCatalog(field, organizationId, actorId, userId);
    if (catalog) return catalog;
  }
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
  if (ACTOR_CATALOG_FIELDS.has(key)) {
    return relation(
      'actor',
      'display_name',
      sql`option.status='active' and option.archived_at is null`,
    );
  }
  if (TEAM_CATALOG_FIELDS.has(key)) {
    return relation('team', 'name', sql`option.archived_at is null`);
  }
  const workTarget = WORK_CATALOG_TARGETS[key];
  if (workTarget) return workRelation(workTarget.target, workTarget.table, workTarget.labelColumn);
  if (key === 'task.cycle') {
    return sql`select option.id::text key,
        ${cycleDisplayNameSql('option')}::text label
      from cycle option
      where option.organization_id=${organizationId}`;
  }
  if (key === 'task.milestone') return relation('milestone', 'name');
  if (LABEL_CATALOG_FIELDS.has(key)) {
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

/** `target.field` keys whose options are the workspace's active people. */
const ACTOR_CATALOG_FIELDS = new Set([
  'task.assignee',
  'task.delegate',
  'task.creator',
  'project.lead',
  'project.members',
  'project.creator',
  'program.owner',
  'program.creator',
  'initiative.owner',
]);

/** `target.field` keys whose options are the workspace's live teams. */
const TEAM_CATALOG_FIELDS = new Set(['task.team', 'project.teams', 'initiative.leadTeam']);

/** One work-entity option catalog: the authorized target it reads, and the column it labels by. */
interface WorkCatalogTarget {
  readonly target: 'task' | 'project' | 'program' | 'initiative';
  readonly table: string;
  readonly labelColumn: string;
}

/**
 * `target.field` keys whose options are work entities the caller may see.
 *
 * @remarks
 * Each of these reads its own table through the shared authorization predicate, so which table and
 * which label column is the only thing that varies between them.
 */
const WORK_CATALOG_TARGETS: Readonly<Record<string, WorkCatalogTarget | undefined>> = {
  'task.project': { target: 'project', table: 'project', labelColumn: 'name' },
  'task.program': { target: 'program', table: 'program', labelColumn: 'name' },
  'project.program': { target: 'program', table: 'program', labelColumn: 'name' },
  'task.parent': { target: 'task', table: 'task', labelColumn: 'title' },
  'project.initiatives': { target: 'initiative', table: 'initiative', labelColumn: 'name' },
  'program.initiatives': { target: 'initiative', table: 'initiative', labelColumn: 'name' },
  'initiative.parent': { target: 'initiative', table: 'initiative', labelColumn: 'name' },
};

/** `target.field` keys whose options are labels the caller's teams can apply. */
const LABEL_CATALOG_FIELDS = new Set([
  'task.labels',
  'project.labels',
  'program.labels',
  'initiative.labels',
]);

/** Compile the organization-scoped SQL catalog for a requested facet. */
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
