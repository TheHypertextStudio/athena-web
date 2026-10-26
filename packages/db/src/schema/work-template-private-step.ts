import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { organization } from './identity';
import { blueprintInvocation } from './work-template-blueprint';

const privateStepContext = sql`organization_id=nullif(current_setting('docket.organization_id',true),'') and exists(select 1 from work_template_blueprint_invocation i where i.id=work_template_private_step.invocation_id and i.organization_id=work_template_private_step.organization_id)`;

/**
 * Immutable authored step registered with its private invocation, never with the template library.
 * Rows are checked against the invocation's source mappings and kept until the invocation is deleted.
 */
export const privateStep = pgTable(
  'work_template_private_step',
  {
    invocationId: text('invocation_id').notNull(),
    stepAlias: text('step_alias').notNull(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    rootKey: text('root_key').notNull(),
    path: text('path').array().notNull(),
    kind: text('kind').$type<'project' | 'milestone' | 'task'>().notNull(),
    parentAlias: text('parent_alias'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      name: 'private_step_identity',
      columns: [t.invocationId, t.stepAlias, t.organizationId],
    }),
    foreignKey({
      name: 'private_step_invocation_fk',
      columns: [t.invocationId, t.organizationId],
      foreignColumns: [blueprintInvocation.id, blueprintInvocation.organizationId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'private_step_parent_fk',
      columns: [t.invocationId, t.parentAlias, t.organizationId],
      foreignColumns: [t.invocationId, t.stepAlias, t.organizationId],
    }),
    check('private_step_kind', sql`${t.kind} in ('project','milestone','task')`),
    check(
      'private_step_path_shape',
      sql`cardinality(${t.path})<=499 and (cardinality(${t.path})=0)=(${t.parentAlias} is null)`,
    ),
    pgPolicy('private_step_private', {
      for: 'all',
      using: privateStepContext,
      withCheck: privateStepContext,
    }),
  ],
).enableRLS();

/** Private authored origin for generated Tasks, Projects and Milestones. */
export function workPrivateOriginColumns() {
  return {
    privateInvocationId: text('private_invocation_id'),
    privateStepAlias: text('private_step_alias'),
  };
}

/** Pair, exclusivity and same-tenant registry reference for a private authored origin. */
export function workPrivateOriginConstraints(
  t: {
    organizationId: AnyPgColumn;
    blueprintStepId: AnyPgColumn;
    privateInvocationId: AnyPgColumn;
    privateStepAlias: AnyPgColumn;
  },
  name: 'task' | 'project' | 'milestone',
) {
  return [
    foreignKey({
      name: `${name}_private_origin_fk`,
      columns: [t.privateInvocationId, t.privateStepAlias, t.organizationId],
      foreignColumns: [privateStep.invocationId, privateStep.stepAlias, privateStep.organizationId],
    }),
    check(
      `${name}_private_origin_pair`,
      sql`(${t.privateInvocationId} is null)=(${t.privateStepAlias} is null)`,
    ),
    check(
      `${name}_private_origin_exclusive`,
      sql`${t.privateStepAlias} is null or ${t.blueprintStepId} is null`,
    ),
    index(`${name}_private_origin_idx`)
      .on(t.organizationId, t.privateInvocationId, t.privateStepAlias)
      .where(sql`${t.privateInvocationId} is not null`),
  ];
}
