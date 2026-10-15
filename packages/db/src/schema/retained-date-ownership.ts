import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core';
import { organization } from './identity';
import { processOccurrence, processStep } from './recurrence';
import { blueprintInvocation } from './work-template-blueprint';

/** Private per-occurrence ownership for exact retained timing that cannot be a public step binding. */
export const retainedDateOwnership = pgTable(
  'work_template_retained_date_ownership',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    occurrenceId: text('occurrence_id')
      .notNull()
      .references(() => processOccurrence.id, { onDelete: 'cascade' }),
    sourceStepId: text('source_step_id')
      .notNull()
      .references(() => processStep.id, { onDelete: 'restrict' }),
    field: text('field').$type<'startDate' | 'dueDate' | 'targetDate'>().notNull(),
    invocationId: text('invocation_id').notNull(),
    workKind: text('work_kind').$type<'project' | 'task' | 'milestone'>().notNull(),
    workId: text('work_id').notNull(),
    manual: boolean('manual').notNull(),
    lastDerivedDate: date('last_derived_date'),
    sourceFingerprint: text('source_fingerprint').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.occurrenceId, t.sourceStepId, t.field] }),
    foreignKey({
      name: 'retained_date_invocation_tenant_fk',
      columns: [t.invocationId, t.organizationId],
      foreignColumns: [blueprintInvocation.id, blueprintInvocation.organizationId],
    }).onDelete('restrict'),
    index('retained_date_work_idx').on(t.organizationId, t.workKind, t.workId),
    check(
      'retained_date_field_kind',
      sql`(${t.workKind}='task' and ${t.field} in ('startDate','dueDate')) or (${t.workKind} in ('project','milestone') and ${t.field} in ('startDate','targetDate') and (${t.workKind}<>'milestone' or ${t.field}='targetDate'))`,
    ),
    check(
      'retained_date_range',
      sql`${t.lastDerivedDate} is null or ${t.lastDerivedDate} between '0001-01-01'::date and '9999-12-31'::date`,
    ),
    pgPolicy('retained_date_private', {
      for: 'all',
      using: sql`${t.organizationId}=nullif(current_setting('docket.organization_id',true),'') and exists(select 1 from work_template_blueprint_invocation i where i.id=${t.invocationId} and i.organization_id=${t.organizationId})`,
      withCheck: sql`${t.organizationId}=nullif(current_setting('docket.organization_id',true),'') and exists(select 1 from work_template_blueprint_invocation i where i.id=${t.invocationId} and i.organization_id=${t.organizationId})`,
    }),
  ],
).enableRLS();
