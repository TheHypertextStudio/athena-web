import { sql, type SQL } from 'drizzle-orm';

import type { RelationFilterCompiler, ScalarFilterCompiler } from './filter-sql';

/** Static metadata for one organization-scoped scalar relation. */
export interface TenantScalarRelationDefinition {
  /** Related entity table whose organization must match the row. */
  readonly valueTable: string;
}

/** Tenant-scoped scalar relation definitions shared by filters, contexts, grants, and projections. */
export const WORK_VIEW_SCALAR_RELATIONS = {
  actor: { valueTable: 'actor' },
  team: { valueTable: 'team' },
  project: { valueTable: 'project' },
  program: { valueTable: 'program' },
  cycle: { valueTable: 'cycle' },
  milestone: { valueTable: 'milestone' },
  task: { valueTable: 'task' },
} as const satisfies Record<string, TenantScalarRelationDefinition>;

/** Static metadata for one organization-scoped many-to-many relation. */
export interface TenantRelationDefinition {
  /** Edge table name. */
  readonly edgeTable: string;
  /** Edge column that references the work-view row. */
  readonly ownerColumn: string;
  /** Edge column that references the related entity. */
  readonly valueColumn: string;
  /** Related entity table whose organization must match the row. */
  readonly valueTable: string;
  /** Related entity column used as a group label. */
  readonly labelColumn: string;
}

/** Static tenant-scoped work relation definitions shared by filters, groups, and projections. */
export const WORK_VIEW_RELATIONS = {
  taskLabels: {
    edgeTable: 'task_label',
    ownerColumn: 'task_id',
    valueColumn: 'label_id',
    valueTable: 'label',
    labelColumn: 'name',
  },
  projectLabels: {
    edgeTable: 'project_label',
    ownerColumn: 'project_id',
    valueColumn: 'label_id',
    valueTable: 'label',
    labelColumn: 'name',
  },
  programLabels: {
    edgeTable: 'program_label',
    ownerColumn: 'program_id',
    valueColumn: 'label_id',
    valueTable: 'label',
    labelColumn: 'name',
  },
  initiativeLabels: {
    edgeTable: 'initiative_label',
    ownerColumn: 'initiative_id',
    valueColumn: 'label_id',
    valueTable: 'label',
    labelColumn: 'name',
  },
  projectMembers: {
    edgeTable: 'project_member',
    ownerColumn: 'project_id',
    valueColumn: 'actor_id',
    valueTable: 'actor',
    labelColumn: 'display_name',
  },
  projectInitiatives: {
    edgeTable: 'initiative_project',
    ownerColumn: 'project_id',
    valueColumn: 'initiative_id',
    valueTable: 'initiative',
    labelColumn: 'name',
  },
  programInitiatives: {
    edgeTable: 'initiative_program',
    ownerColumn: 'program_id',
    valueColumn: 'initiative_id',
    valueTable: 'initiative',
    labelColumn: 'name',
  },
} as const satisfies Record<string, TenantRelationDefinition>;

/**
 * Resolve a scalar relation id only when the related entity belongs to the row organization.
 *
 * @param definition - Static related-entity metadata.
 * @param relatedId - Foreign-key expression stored on the work-view row.
 * @param organizationId - Work-view row organization expression.
 * @returns A nullable scalar id expression.
 */
export function compileTenantScalarRelationIdSql(
  definition: TenantScalarRelationDefinition,
  relatedId: SQL,
  organizationId: SQL,
): SQL {
  return sql`(select related.id::text from ${sql.raw(definition.valueTable)} related
    where related.id=${relatedId} and related.organization_id=${organizationId})`;
}

/**
 * Test whether a scalar relation resolves inside the work-view row organization.
 *
 * @param definition - Static related-entity metadata.
 * @param relatedId - Foreign-key expression stored on the work-view row.
 * @param organizationId - Work-view row organization expression.
 * @returns An `EXISTS` predicate for one valid tenant-local reference.
 */
export function compileTenantScalarRelationExistsSql(
  definition: TenantScalarRelationDefinition,
  relatedId: SQL,
  organizationId: SQL,
): SQL {
  return sql`exists (select 1 from ${sql.raw(definition.valueTable)} related
    where related.id=${relatedId} and related.organization_id=${organizationId})`;
}

/**
 * Compile a tenant-checked scalar relation match.
 *
 * @param definition - Static related-entity metadata.
 * @param relatedId - Foreign-key expression stored on the work-view row.
 * @param organizationId - Work-view row organization expression.
 * @param operand - Related entity id to match.
 * @returns An `EXISTS` predicate that cannot match a foreign related entity.
 */
export function compileTenantScalarRelationHasValueSql(
  definition: TenantScalarRelationDefinition,
  relatedId: SQL,
  organizationId: SQL,
  operand: unknown,
): SQL {
  return sql`exists (select 1 from ${sql.raw(definition.valueTable)} related
    where related.id=${relatedId} and related.id=${operand}
      and related.organization_id=${organizationId})`;
}

/**
 * Build a relation-one filter compiler from tenant-scoped scalar metadata.
 *
 * @param definition - Static related-entity metadata.
 * @param relatedId - Foreign-key expression stored on work-view alias `e`.
 * @returns A relation-one compiler whose value is null for foreign references.
 */
export function tenantScalarRelationFilter(
  definition: TenantScalarRelationDefinition,
  relatedId: SQL,
): ScalarFilterCompiler {
  return {
    kind: 'relation-one',
    value: compileTenantScalarRelationIdSql(definition, relatedId, sql`e.organization_id`),
  };
}

/**
 * Compile tenant-checked memberships for one row and relation.
 *
 * @param definition - Static edge and related-entity metadata.
 * @param entityId - Work-view row id expression.
 * @param organizationId - Work-view row organization expression.
 * @returns A query yielding deduplicated `value_id` and `value_label` columns.
 */
export function compileTenantRelationMembershipSql(
  definition: TenantRelationDefinition,
  entityId: SQL,
  organizationId: SQL,
): SQL {
  return sql`select distinct related.id::text as value_id,
      related.${sql.raw(definition.labelColumn)}::text as value_label
    from ${sql.raw(definition.edgeTable)} edge
    join ${sql.raw(definition.valueTable)} related
      on related.id=edge.${sql.raw(definition.valueColumn)}
      and related.organization_id=${organizationId}
    where edge.${sql.raw(definition.ownerColumn)}=${entityId}
      and edge.organization_id=${organizationId}`;
}

/**
 * Compile an operand match over one tenant-checked relation.
 *
 * @param definition - Static edge and related-entity metadata.
 * @param entityId - Work-view row id expression.
 * @param organizationId - Work-view row organization expression.
 * @param operand - Related entity id to match.
 * @returns A correlated `EXISTS` predicate.
 */
export function compileTenantRelationHasValueSql(
  definition: TenantRelationDefinition,
  entityId: SQL,
  organizationId: SQL,
  operand: unknown,
): SQL {
  return sql`exists (
    select 1 from (${compileTenantRelationMembershipSql(
      definition,
      entityId,
      organizationId,
    )}) relation_memberships
    where relation_memberships.value_id=${operand}
  )`;
}

/**
 * Build a relation-many filter compiler from tenant-scoped membership metadata.
 *
 * @param definition - Static edge and related-entity metadata.
 * @returns A filter compiler correlated to work-view alias `e`.
 */
export function tenantRelationFilter(definition: TenantRelationDefinition): RelationFilterCompiler {
  const memberships = compileTenantRelationMembershipSql(
    definition,
    sql`e.id`,
    sql`e.organization_id`,
  );
  return {
    kind: 'relation-many',
    exists: (operand) =>
      compileTenantRelationHasValueSql(definition, sql`e.id`, sql`e.organization_id`, operand),
    isEmpty: sql`not exists (select 1 from (${memberships}) relation_memberships)`,
  };
}

/**
 * Compile one JSON array of tenant-checked related ids.
 *
 * @param definition - Static edge and related-entity metadata.
 * @param entityId - Work-view row id expression.
 * @param organizationId - Work-view row organization expression.
 * @returns A scalar JSON array expression ordered by related id.
 */
export function compileTenantRelationArraySql(
  definition: TenantRelationDefinition,
  entityId: SQL,
  organizationId: SQL,
): SQL {
  return sql`coalesce((select json_agg(relation_memberships.value_id order by relation_memberships.value_id)
    from (${compileTenantRelationMembershipSql(
      definition,
      entityId,
      organizationId,
    )}) relation_memberships), '[]'::json)`;
}
