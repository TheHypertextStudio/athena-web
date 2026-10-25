import type { BlueprintStep } from '@docket/work/work-template-blueprint';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import type {
  StoredBlueprintInvocationManifest,
  BlueprintInvocationOverride,
} from '../blueprint-invocation';
import type { ScheduleSourceArchive } from './work-schedule-storage';
import { genId } from '../id';
import { actor, organization } from './identity';
import { workTypeVersion } from './work-template';

/** Immutable FK/index projection of one published blueprint step. */
export const blueprintStep = pgTable(
  'blueprint_step',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    versionId: text('version_id').notNull(),
    key: text('key').notNull(),
    kind: text('kind').$type<BlueprintStep['kind']>().notNull(),
    parentStepKey: text('parent_step_key'),
    sort: integer('sort').notNull(),
    step: jsonb('step').$type<BlueprintStep>().notNull(),
  },
  (t) => [
    uniqueIndex('blueprint_step_identity_unique').on(t.id, t.versionId, t.organizationId),
    uniqueIndex('blueprint_step_version_key_unique').on(t.versionId, t.key),
    foreignKey({
      name: 'blueprint_step_version_tenant_fk',
      columns: [t.versionId, t.organizationId],
      foreignColumns: [workTypeVersion.id, workTypeVersion.organizationId],
    }).onDelete('cascade'),
    check('blueprint_step_key_valid', sql`${t.key} ~ '^[a-z][a-z0-9_-]{0,63}$'`),
    check('blueprint_step_kind_valid', sql`${t.kind} in ('program','project','task','milestone')`),
    check('blueprint_step_sort_nonnegative', sql`${t.sort} >= 0`),
    pgPolicy('blueprint_step_tenant', {
      for: 'all',
      using: sql`${t.organizationId} = nullif(current_setting('docket.organization_id', true),'') and exists(select 1 from work_type_version v where v.id=${t.versionId} and v.organization_id=${t.organizationId})`,
      withCheck: sql`${t.organizationId} = nullif(current_setting('docket.organization_id', true),'')`,
    }),
  ],
).enableRLS();

/** Immutable same-publication Task dependency projection. */
export const blueprintDependency = pgTable(
  'blueprint_dependency',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    versionId: text('version_id').notNull(),
    blockerStepId: text('blocker_step_id').notNull(),
    blockedStepId: text('blocked_step_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.versionId, t.blockerStepId, t.blockedStepId] }),
    foreignKey({
      name: 'blueprint_dependency_blocker_fk',
      columns: [t.blockerStepId, t.versionId, t.organizationId],
      foreignColumns: [blueprintStep.id, blueprintStep.versionId, blueprintStep.organizationId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'blueprint_dependency_blocked_fk',
      columns: [t.blockedStepId, t.versionId, t.organizationId],
      foreignColumns: [blueprintStep.id, blueprintStep.versionId, blueprintStep.organizationId],
    }).onDelete('cascade'),
    check('blueprint_dependency_not_self', sql`${t.blockerStepId} <> ${t.blockedStepId}`),
    pgPolicy('blueprint_dependency_tenant', {
      for: 'all',
      using: sql`${t.organizationId} = nullif(current_setting('docket.organization_id', true),'') and exists(select 1 from work_type_version v where v.id=${t.versionId} and v.organization_id=${t.organizationId})`,
      withCheck: sql`${t.organizationId} = nullif(current_setting('docket.organization_id', true),'')`,
    }),
  ],
).enableRLS();

const privateContext = sql`docket_schedule_private_scope(organization_id,NULL,owner_actor_id)`;

/** Restricted immutable schedule/legacy invocation context with literal destinations and actors. */
export const blueprintInvocation = pgTable(
  'work_template_blueprint_invocation',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    ownerActorId: text('owner_actor_id').references(() => actor.id, { onDelete: 'set null' }),
    manifest: jsonb('manifest').$type<StoredBlueprintInvocationManifest>().notNull(),
    overrides: jsonb('overrides').$type<readonly BlueprintInvocationOverride[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('blueprint_invocation_identity_unique').on(t.id, t.organizationId),
    index('blueprint_invocation_owner_idx').on(t.organizationId, t.ownerActorId),
    pgPolicy('blueprint_invocation_private', {
      for: 'all',
      using: privateContext,
      withCheck: privateContext,
    }),
  ],
).enableRLS();

/** Unique source-revision receipt for resumable conversion, not a work execution table. */
export const blueprintConversion = pgTable(
  'work_template_blueprint_conversion',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    legacyProcessRevisionId: text('legacy_process_revision_id').primaryKey(),
    invocationId: text('invocation_id').notNull(),
    sourceFingerprint: text('source_fingerprint').notNull(),
    sourceArchive: jsonb('source_archive').$type<ScheduleSourceArchive>(),
    sourceArchiveHash: text('source_archive_hash'),
    sourceArchiveHashVersion: integer('source_archive_hash_version'),
    convertedAt: timestamp('converted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'blueprint_conversion_invocation_fk',
      columns: [t.invocationId, t.organizationId],
      foreignColumns: [blueprintInvocation.id, blueprintInvocation.organizationId],
    }).onDelete('cascade'),
    pgPolicy('blueprint_conversion_private', {
      for: 'all',
      using: sql`${t.organizationId}=nullif(current_setting('docket.organization_id',true),'') and exists(select 1 from work_template_blueprint_invocation i where i.id=${t.invocationId} and i.organization_id=${t.organizationId})`,
      withCheck: sql`${t.organizationId}=nullif(current_setting('docket.organization_id',true),'') and exists(select 1 from work_template_blueprint_invocation i where i.id=${t.invocationId} and i.organization_id=${t.organizationId})`,
    }),
  ],
).enableRLS();
