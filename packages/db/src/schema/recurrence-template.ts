import { sql } from 'drizzle-orm';
import { check, foreignKey, text, type AnyPgColumn } from 'drizzle-orm/pg-core';

import { template, workTypeVersion } from './work-template';

/** Optional publication pinned for every occurrence; retained unspecified steps select the base. */
export function taskTemplateColumns() {
  return { workTypeId: text('work_type_id'), workTypeVersionId: text('work_type_version_id') };
}

/** Keep recurring task parent references and optional workspace publication references valid. */
export function taskSpecConstraints(table: {
  stepId: AnyPgColumn;
  parentTaskStepId: AnyPgColumn;
  organizationId: AnyPgColumn;
  workTypeId: AnyPgColumn;
  workTypeVersionId: AnyPgColumn;
}) {
  return [
    foreignKey({
      columns: [table.parentTaskStepId],
      foreignColumns: [table.stepId],
      name: 'process_task_spec_parent_fk',
    }).onDelete('set null'),
    foreignKey({
      name: 'process_task_spec_work_type_tenant_fk',
      columns: [table.workTypeId, table.organizationId],
      foreignColumns: [template.id, template.organizationId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'process_task_spec_work_type_version_fk',
      columns: [table.workTypeVersionId, table.workTypeId, table.organizationId],
      foreignColumns: [
        workTypeVersion.id,
        workTypeVersion.workTypeId,
        workTypeVersion.organizationId,
      ],
    }).onDelete('restrict'),
    check(
      'process_task_spec_work_type_pair',
      sql`(${table.workTypeId} is null) = (${table.workTypeVersionId} is null)`,
    ),
  ];
}
