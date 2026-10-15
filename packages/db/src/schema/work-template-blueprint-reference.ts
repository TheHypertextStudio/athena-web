import type { BlueprintDateBindings, BlueprintState } from '@docket/work/work-template-blueprint';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  text,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { blueprintStep } from './work-template-blueprint';

/** Fresh typed origin/ownership builders shared by ordinary work and Milestone rows. */
export function workBlueprintColumns() {
  return {
    blueprintStepId: text('blueprint_step_id'),
    blueprintSourceVersionId: text('blueprint_source_version_id'),
    blueprintParentKind: text('blueprint_parent_kind').$type<
      'initiative' | 'program' | 'project' | 'task' | 'milestone'
    >(),
    blueprintParentId: text('blueprint_parent_id'),
    blueprintPath: text('blueprint_path').array(),
    blueprintDateBindings: jsonb('blueprint_date_bindings')
      .$type<BlueprintDateBindings>()
      .notNull()
      .default({}),
    blueprintState: jsonb('blueprint_state').$type<BlueprintState>(),
    blueprintEverStarted: boolean('blueprint_ever_started').notNull().default(false),
  };
}

/** Paired origin references and same-publication/tenant FK for every generated work kind. */
export function workBlueprintConstraints(
  t: {
    organizationId: AnyPgColumn;
    blueprintStepId: AnyPgColumn;
    blueprintSourceVersionId: AnyPgColumn;
    blueprintParentKind: AnyPgColumn;
    blueprintParentId: AnyPgColumn;
  },
  name: string,
) {
  return [
    foreignKey({
      name: `${name}_blueprint_origin_fk`,
      columns: [t.blueprintStepId, t.blueprintSourceVersionId, t.organizationId],
      foreignColumns: [blueprintStep.id, blueprintStep.versionId, blueprintStep.organizationId],
    }).onDelete('restrict'),
    check(
      `${name}_blueprint_origin_pair`,
      sql`(${t.blueprintStepId} is null)=(${t.blueprintSourceVersionId} is null)`,
    ),
    check(
      `${name}_blueprint_parent_pair`,
      sql`(${t.blueprintParentId} is null)=(${t.blueprintParentKind} is null)`,
    ),
    index(`${name}_blueprint_parent_idx`).on(
      t.organizationId,
      t.blueprintParentKind,
      t.blueprintParentId,
    ),
  ];
}
