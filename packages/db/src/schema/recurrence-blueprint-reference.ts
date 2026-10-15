import { sql } from 'drizzle-orm';
import { check, foreignKey, jsonb, text, timestamp, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { BlueprintOccurrenceRoot } from '../blueprint-invocation';
import { blueprintInvocation } from './work-template-blueprint';
import { scheduleOccurrencePrivatePolicy } from './work-schedule-privacy';
import { workTypeVersion } from './work-template';

/** Nullable canonical selection and restricted context pointer beside retained process revisions. */
export function seriesBlueprintColumns() {
  return {
    workTypeId: text('work_type_id'),
    workTypeVersionId: text('work_type_version_id'),
    blueprintInvocationId: text('blueprint_invocation_id'),
  };
}
/** Same-tenant exact selection/context constraints without changing legacy scheduler columns. */
export function seriesBlueprintConstraints(t: {
  organizationId: AnyPgColumn;
  workTypeId: AnyPgColumn;
  workTypeVersionId: AnyPgColumn;
  blueprintInvocationId: AnyPgColumn;
}) {
  return [
    check(
      'series_blueprint_selection_pair',
      sql`(${t.workTypeId} is null)=(${t.workTypeVersionId} is null)`,
    ),
    foreignKey({
      name: 'series_blueprint_selection_fk',
      columns: [t.workTypeVersionId, t.workTypeId, t.organizationId],
      foreignColumns: [
        workTypeVersion.id,
        workTypeVersion.workTypeId,
        workTypeVersion.organizationId,
      ],
    }).onDelete('restrict'),
    invocationConstraint(t, 'series'),
  ];
}
/** Concrete retained roots of one forest occurrence; no synthetic visible parent. */
export function occurrenceBlueprintColumns() {
  return {
    blueprintInvocationId: text('blueprint_invocation_id'),
    blueprintAppliedAt: timestamp('blueprint_applied_at', { withTimezone: true }),
    blueprintRootRefs: jsonb('blueprint_root_refs').$type<readonly BlueprintOccurrenceRoot[]>(),
  };
}
/** Same-tenant context pointer shared by canonical series and occurrence rows. */
export function invocationConstraint(
  t: { organizationId: AnyPgColumn; blueprintInvocationId: AnyPgColumn },
  prefix: 'series' | 'occurrence',
) {
  return foreignKey({
    name: `${prefix}_blueprint_invocation_fk`,
    columns: [t.blueprintInvocationId, t.organizationId],
    foreignColumns: [blueprintInvocation.id, blueprintInvocation.organizationId],
  }).onDelete('restrict');
}

/** Tenant occurrence reads preserve private invocation visibility while unbound legacy rows remain tenant-scoped. */
export function occurrenceBlueprintConstraints(t: {
  organizationId: AnyPgColumn;
  blueprintInvocationId: AnyPgColumn;
  seriesId: AnyPgColumn;
}) {
  return [invocationConstraint(t, 'occurrence'), scheduleOccurrencePrivatePolicy(t)];
}
