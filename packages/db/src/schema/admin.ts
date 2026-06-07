/**
 * `@docket/db` — service-admin (operator back-office) schema island (data-model §8).
 *
 * @remarks
 * Staff users span all orgs; these tables govern the hosted-service operators:
 * staff roles, time-boxed "View as" impersonation, lifecycle holds, and the operator
 * audit trail. Distinct from the per-org permission system.
 */
import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { staffRole } from '../enums';
import { genId } from '../id';
import { user } from './auth';
import { organization } from './identity';

/** A Docket-service operator (Support/Finance/Superadmin tiers), keyed to a global User. */
export const staffUser = pgTable(
  'staff_user',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: staffRole('role').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('staff_user_user_uq').on(t.userId)],
);

/** A time-boxed, reason-logged "View as" impersonation by support staff. */
export const impersonationSession = pgTable(
  'impersonation_session',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    staffUserId: text('staff_user_id')
      .notNull()
      .references(() => staffUser.id, { onDelete: 'cascade' }),
    targetUserId: text('target_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at').notNull(),
    endedAt: timestamp('ended_at'),
  },
  (t) => [index('impersonation_session_staff_idx').on(t.staffUserId)],
);

/** A hold pausing an org's data-lifecycle pipeline (e.g. dispute, manual review). */
export const lifecycleHold = pgTable(
  'lifecycle_hold',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    placedBy: text('placed_by').references(() => staffUser.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    releasedAt: timestamp('released_at'),
  },
  (t) => [index('lifecycle_hold_org_idx').on(t.organizationId)],
);

/** An audited operator action (billing change, hold, impersonation start, …). */
export const operatorAuditEvent = pgTable(
  'operator_audit_event',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    staffUserId: text('staff_user_id').references(() => staffUser.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('operator_audit_event_created_idx').on(t.createdAt)],
);
