import type { WorkTemplateAssignmentSource } from '@docket/work/work-template-reference';
import { sql } from 'drizzle-orm';
import { foreignKey, index, text, timestamp, type AnyPgColumn } from 'drizzle-orm/pg-core';

import { template, workTypeVersion } from './work-template';

/** Fresh column builders for a work item's template association, nullable during expansion. */
export function workTemplateColumns() {
  return {
    workTypeId: text('work_type_id')
      .notNull()
      .default(sql`NULL`),
    workTypeVersionId: text('work_type_version_id')
      .notNull()
      .default(sql`NULL`),
    workTypeAssignedAt: timestamp('work_type_assigned_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    workTypeAssignmentSource: text('work_type_assignment_source')
      .$type<WorkTemplateAssignmentSource>()
      .notNull()
      .default('created'),
  };
}

/** Add scope-safe identity constraints and the index used by template filters and grouping. */
export function workTemplateConstraints(
  table: {
    organizationId: AnyPgColumn;
    workTypeId: AnyPgColumn;
    workTypeVersionId: AnyPgColumn;
  },
  name: string,
) {
  return [
    index(`${name}_work_type_idx`).on(table.organizationId, table.workTypeId),
    foreignKey({
      name: `${name}_work_type_tenant_fk`,
      columns: [table.workTypeId, table.organizationId],
      foreignColumns: [template.id, template.organizationId],
    }).onDelete('restrict'),
    foreignKey({
      name: `${name}_work_type_version_fk`,
      columns: [table.workTypeVersionId, table.workTypeId, table.organizationId],
      foreignColumns: [
        workTypeVersion.id,
        workTypeVersion.workTypeId,
        workTypeVersion.organizationId,
      ],
    }).onDelete('restrict'),
  ];
}
