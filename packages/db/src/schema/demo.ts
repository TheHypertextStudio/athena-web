/**
 * `@docket/db` — demo workspace schema island.
 *
 * @remarks
 * A demo is an operator-created entry point that provisions a normal workspace, copied from a
 * source workspace, for people with operator-issued reviewer links. Demo workspaces
 * are ordinary organizations; these tables record which demo made each one and when it expires.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { genId } from '../id';
import { staffUser } from './admin';
import { organization } from './identity';
import { user } from './auth';

/** How a demo provisions workspaces: one shared workspace, or one per allowed person. */
export const DEMO_MODES = ['shared', 'per_person'] as const;
/** One demo mode. */
export type DemoMode = (typeof DEMO_MODES)[number];

/** Whether a demo accepts sign-ins. A disabled demo keeps its workspaces but refuses new sessions. */
export const DEMO_STATUSES = ['active', 'disabled'] as const;
/** One demo status. */
export type DemoStatus = (typeof DEMO_STATUSES)[number];

/**
 * An operator-created demo: the public slug, the source workspace it copies, and who may enter.
 *
 * @remarks
 * `allowed_emails` and `allowed_domains` are stored lowercased. `reset_cron` applies to shared
 * demos only; `workspace_ttl_days` applies to per-person demos only. Both are enforced by the
 * demo service, not by the database.
 */
export const demo = pgTable(
  'demo',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    sourceOrganizationId: text('source_organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'restrict' }),
    mode: text('mode').$type<DemoMode>().notNull(),
    /** Email-bound SHA-256 digest of the operator-issued reviewer link; plaintext stays private. */
    signInTokenHash: text('sign_in_token_hash'),
    allowedEmails: text('allowed_emails')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    allowedDomains: text('allowed_domains')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    resetCron: text('reset_cron'),
    workspaceTtlDays: integer('workspace_ttl_days'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    status: text('status').$type<DemoStatus>().notNull().default('active'),
    createdByStaffId: text('created_by_staff_id').references(() => staffUser.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('demo_slug_uq').on(t.slug),
    check(
      'demo_slug_format_check',
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(${t.slug}) <= 64`,
    ),
    check('demo_mode_check', sql`${t.mode} IN ('shared', 'per_person')`),
    check('demo_status_check', sql`${t.status} IN ('active', 'disabled')`),
    check(
      'demo_workspace_ttl_check',
      sql`${t.workspaceTtlDays} IS NULL OR ${t.workspaceTtlDays} > 0`,
    ),
  ],
);

/**
 * One provisioned demo workspace: the organization a demo created and who it belongs to.
 *
 * @remarks
 * A shared demo has one row with `owner_user_id` null. A per-person demo has one row per
 * person. Deleting the organization removes its row; a converted workspace keeps the org and
 * loses its row, so expiry skips it.
 */
export const demoWorkspace = pgTable(
  'demo_workspace',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    demoId: text('demo_id')
      .notNull()
      .references(() => demo.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'cascade' }),
    provisionedAt: timestamp('provisioned_at', { withTimezone: true }).notNull().defaultNow(),
    lastResetAt: timestamp('last_reset_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('demo_workspace_org_uq').on(t.organizationId),
    index('demo_workspace_demo_idx').on(t.demoId),
    index('demo_workspace_expires_idx').on(t.expiresAt),
    uniqueIndex('demo_workspace_shared_uq')
      .on(t.demoId)
      .where(sql`${t.ownerUserId} IS NULL`),
    uniqueIndex('demo_workspace_owner_uq')
      .on(t.demoId, t.ownerUserId)
      .where(sql`${t.ownerUserId} IS NOT NULL`),
  ],
);

/** Fixed reviewer counters and expiring stream leases, isolated from auth's short-lived cleanup. */
export const demoBudget = pgTable('demo_budget', {
  id: text('id').primaryKey(),
  demoId: text('demo_id')
    .notNull()
    .references(() => demo.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});
