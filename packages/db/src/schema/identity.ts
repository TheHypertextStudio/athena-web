/**
 * `@docket/db` — identity schema island (data-model §3).
 *
 * @remarks
 * Hub (personal command center, 1:1 User) · Organization (the shared tenant +
 * context boundary) · Actor (the org-scoped identity for every "who", folding in
 * human membership via `user_id` + `role_id`) · Team · TeamMember · Invitation.
 *
 * `organization_id` leads every org-scoped index (tenant isolation). The
 * {@link auditColumns} helper supplies the common id/tenant/audit columns reused by
 * every org-scoped work entity. Cross-file FKs (to `user` in `./auth`, `role` in
 * `./crosscutting`) use drizzle's lazy `() => table.col` references, so the ESM
 * import cycle resolves at query time, not module-init time.
 */
import { sql } from 'drizzle-orm';
import type { AccountExportScope } from '@docket/types';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import {
  accountDeletionState,
  accountExportStatus,
  actorKind,
  actorStatus,
  invitationStatus,
  orgLifecycleState,
  visibility,
} from '../enums';
import { genId } from '../id';
import type { ApprovalRouting, HubPreferences, VocabularySkin, WorkflowState } from '../types';
import { defaultWorkflowStates, presetStartup } from '../types';
import { user } from './auth';
import { role } from './crosscutting';

/**
 * The common columns for every org-scoped entity: ULID id, tenant FK, creator,
 * timestamps, soft-delete. Spread into a `pgTable` column config:
 * `pgTable('x', { ...auditColumns(), ... })`.
 */
export function auditColumns() {
  return {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    createdBy: text('created_by').references(() => actor.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    archivedAt: timestamp('archived_at'),
  };
}

/** The personal command center (1:1 with a User); gathers the orgs the user belongs to. */
export const hub = pgTable(
  'hub',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name'),
    preferences: jsonb('preferences').$type<HubPreferences>().notNull().default({}),
    /**
     * Account end-of-life state. `pending_deletion` is a recoverable 14-day grace window
     * (mirrors the org lifecycle on the user/account layer); the account-deletion cron
     * sweep hard-deletes the user once {@link hub.deleteAfterAt} elapses.
     */
    deletionState: accountDeletionState('deletion_state').notNull().default('active'),
    /** When the user scheduled deletion (for "scheduled on …" display); null when active. */
    deletionRequestedAt: timestamp('deletion_requested_at'),
    /** The instant the grace window closes and the purge becomes eligible; null when active. */
    deleteAfterAt: timestamp('delete_after_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('hub_user_id_uq').on(t.userId)],
);

/**
 * The asynchronous personal-data export queue (one row per requested export).
 *
 * @remarks
 * A request inserts a `pending` row; the export cron sweep generates a full cross-org
 * archive to blob storage, stamps `blobKey`/`readyAt`/`expiresAt`, and
 * advances it to `ready`. Cascade-deleted with the user, so a purged account leaves no
 * export rows behind.
 */
export const accountExport = pgTable(
  'account_export',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: accountExportStatus('status').notNull().default('pending'),
    /** The requested archive categories and workspace snapshot. Null means a pre-scope legacy job. */
    scope: jsonb('scope').$type<AccountExportScope>(),
    /** `manual` for a user request; `account_deletion` for the mandatory full archive. */
    origin: text('origin').notNull().default('manual'),
    blobKey: text('blob_key'),
    requestedAt: timestamp('requested_at').notNull().defaultNow(),
    readyAt: timestamp('ready_at'),
    expiresAt: timestamp('expires_at'),
    error: text('error'),
  },
  (t) => [
    index('account_export_user_idx').on(t.userId),
    index('account_export_status_idx').on(t.status),
  ],
);

/** The shared tenant + context boundary; `is_personal` orgs are an org-of-one. */
export const organization = pgTable(
  'organization',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    purpose: text('purpose'),
    avatar: text('avatar'),
    isPersonal: boolean('is_personal').notNull().default(false),
    vocabulary: jsonb('vocabulary').$type<VocabularySkin>().notNull().default(presetStartup),
    agentGuidance: text('agent_guidance'),
    approvalRouting: jsonb('approval_routing').$type<ApprovalRouting>(),
    initiativeMaxDepth: integer('initiative_max_depth').notNull().default(2),
    lifecycleState: orgLifecycleState('lifecycle_state').notNull().default('trialing'),
    exportReadyAt: timestamp('export_ready_at'),
    deleteAfterAt: timestamp('delete_after_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    archivedAt: timestamp('archived_at'),
  },
  (t) => [
    uniqueIndex('organization_slug_uq').on(t.slug),
    index('organization_lifecycle_idx').on(t.lifecycleState),
    check('organization_initiative_max_depth_check', sql`${t.initiativeMaxDepth} between 1 and 5`),
  ],
);

/** The org-scoped identity for every "who"; human Actors fold in membership (user_id + role_id). */
export const actor = pgTable(
  'actor',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    kind: actorKind('kind').notNull(),
    displayName: text('display_name').notNull(),
    avatar: text('avatar'),
    status: actorStatus('status').notNull().default('active'),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    roleId: text('role_id').references(() => role.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    archivedAt: timestamp('archived_at'),
  },
  (t) => [
    index('actor_org_idx').on(t.organizationId),
    uniqueIndex('actor_org_user_uq')
      .on(t.organizationId, t.userId)
      .where(sql`${t.userId} is not null`),
  ],
);

/** A within-org unit owning workflow states, Cycles, and Triage. */
export const team = pgTable(
  'team',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    key: text('key').notNull(),
    description: text('description'),
    summary: text('summary'),
    workflowStates: jsonb('workflow_states')
      .$type<WorkflowState[]>()
      .notNull()
      .default([...defaultWorkflowStates]),
    triageEnabled: boolean('triage_enabled').notNull().default(true),
    /**
     * Cycle cadence in weeks for this team's auto-rolled cycles (default 1 = weekly).
     *
     * @remarks
     * Cycles are team-scoped (`work.ts` `cycle.teamId`) and auto-generated on a rolling
     * window so users never create them by hand (DECISION: configurable cadence, weekly
     * default; weekly for personal). The Logic phase derives each cycle's
     * `starts_at`/`ends_at` from a week-aligned anchor stepping by this many weeks.
     */
    cycleCadenceWeeks: integer('cycle_cadence_weeks').notNull().default(1),
    agentGuidance: text('agent_guidance'),
    approvalRouting: jsonb('approval_routing').$type<ApprovalRouting>(),
    visibility: visibility('visibility').notNull().default('public'),
    ancestorPath: text('ancestor_path')
      .array()
      .notNull()
      .default(sql`'{}'`),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    archivedAt: timestamp('archived_at'),
  },
  (t) => [
    index('team_org_idx').on(t.organizationId),
    uniqueIndex('team_org_key_uq').on(t.organizationId, t.key),
    index('team_ancestor_path_gin').using('gin', t.ancestorPath),
  ],
);

/** The team↔actor membership join (retains org_id; no audit columns). */
export const teamMember = pgTable(
  'team_member',
  {
    teamId: text('team_id')
      .notNull()
      .references(() => team.id, { onDelete: 'cascade' }),
    actorId: text('actor_id')
      .notNull()
      .references(() => actor.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.teamId, t.actorId] }),
    index('team_member_actor_idx').on(t.actorId),
  ],
);

/** A pending/accepted org invitation (hand-built, not the Better Auth plugin table). */
export const invitation = pgTable(
  'invitation',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    roleId: text('role_id')
      .notNull()
      .references(() => role.id, { onDelete: 'restrict' }),
    asGuest: boolean('as_guest').notNull().default(false),
    token: text('token').notNull(),
    status: invitationStatus('status').notNull().default('pending'),
    invitedBy: text('invited_by').references(() => actor.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    acceptedAt: timestamp('accepted_at'),
  },
  (t) => [
    uniqueIndex('invitation_token_uq').on(t.token),
    uniqueIndex('invitation_org_email_pending_uq')
      .on(t.organizationId, t.email)
      .where(sql`${t.status} = 'pending'`),
    index('invitation_org_idx').on(t.organizationId),
  ],
);
