import type { CopySourceIdentity } from '@docket/work/template-copy';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { genId } from '../id';
import { templateTargetType } from '../enums';
import { actor, organization } from './identity';
import { changeSet } from './change-set';
import { template, workTypeVersion } from './work-template';

/** One trusted fixed-point undo result; no template bodies or source access authority are stored. */
export interface TemplateCopyUndoOutcome {
  readonly entryKey: string;
  readonly outcome: 'deleted' | 'archived' | 'retained_changed' | 'retained_in_use';
}

/** Acceptor-private idempotency and review metadata around the existing canonical template writer. */
export const workTemplateCopyBundle = pgTable(
  'work_template_copy_bundle',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    acceptingActorKey: text('accepting_actor_key').notNull(),
    acceptingActorId: text('accepting_actor_id').references(() => actor.id, {
      onDelete: 'set null',
    }),
    requestId: text('request_id').notNull(),
    requestFingerprint: text('request_fingerprint').notNull(),
    reviewFingerprint: text('review_fingerprint').notNull(),
    choicesFingerprint: text('choices_fingerprint').notNull(),
    mode: text('mode').$type<'private_drafts' | 'published'>().notNull(),
    rootEntryKeys: text('root_entry_keys').array().notNull(),
    receiptKey: text('receipt_key'),
    receiptId: text('receipt_id').references(() => changeSet.id, { onDelete: 'set null' }),
    state: text('state')
      .$type<'installing' | 'installed' | 'undone'>()
      .notNull()
      .default('installing'),
    undoOutcomes: jsonb('undo_outcomes').$type<readonly TemplateCopyUndoOutcome[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    installationTransactionId: text('installation_transaction_id'),
    installedAt: timestamp('installed_at', { withTimezone: true }),
    undoneAt: timestamp('undone_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('copy_bundle_tenant_identity').on(t.id, t.organizationId),
    uniqueIndex('copy_bundle_request_identity').on(
      t.organizationId,
      t.acceptingActorKey,
      t.requestId,
    ),
    uniqueIndex('copy_bundle_receipt_identity').on(t.receiptKey),
    foreignKey({
      name: 'copy_bundle_actor_tenant_fk',
      columns: [t.acceptingActorId, t.organizationId],
      foreignColumns: [actor.id, actor.organizationId],
    }),
    check('copy_bundle_mode', sql`${t.mode} in ('private_drafts','published')`),
    check('copy_bundle_state', sql`${t.state} in ('installing','installed','undone')`),
    check('copy_bundle_request', sql`length(${t.requestId}) between 1 and 128`),
    check(
      'copy_bundle_fingerprints',
      sql`${t.requestFingerprint} ~ '^sha256:[0-9a-f]{64}$' and ${t.reviewFingerprint} ~ '^sha256:[0-9a-f]{64}$' and ${t.choicesFingerprint} ~ '^sha256:[0-9a-f]{64}$'`,
    ),
    pgPolicy('copy_bundle_acceptor_private', {
      for: 'all',
      using: sql`docket_copy_acceptor_scope(${t.organizationId},${t.acceptingActorId})`,
      withCheck: sql`docket_copy_acceptor_scope(${t.organizationId},${t.acceptingActorId})`,
    }),
  ],
).enableRLS();

/** Immutable copied identity reservation and provenance; void rows remain permanent tenant tombstones. */
export const workTemplateCopyEntry = pgTable(
  'work_template_copy_entry',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    bundleId: text('bundle_id').notNull(),
    entryKey: text('entry_key').notNull(),
    targetType: templateTargetType('target_type').notNull(),
    ordinal: integer('ordinal').notNull(),
    destinationWorkTypeId: text('destination_work_type_id').notNull(),
    liveWorkTypeId: text('live_work_type_id'),
    reservedFirstVersionId: text('reserved_first_version_id').notNull(),
    sourceIdentity: jsonb('source_identity').$type<CopySourceIdentity>().notNull(),
    sourceFingerprint: text('source_fingerprint').notNull(),
    dependencyEntryKeys: text('dependency_entry_keys').array().notNull(),
    afterStateFingerprint: text('after_state_fingerprint'),
    reservationState: text('reservation_state')
      .$type<'pending' | 'consumed' | 'void'>()
      .notNull()
      .default('pending'),
    consumedVersionId: text('consumed_version_id'),
    /** Internal reference-write MVCC token; excluded from authored state and public projections. */
    referenceEpoch: bigint('reference_epoch', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    uniqueIndex('copy_entry_key_identity').on(t.bundleId, t.entryKey),
    uniqueIndex('copy_entry_order_identity').on(t.bundleId, t.ordinal),
    uniqueIndex('copy_entry_destination_identity').on(t.destinationWorkTypeId),
    uniqueIndex('copy_entry_reserved_identity').on(t.reservedFirstVersionId),
    index('copy_entry_bundle_idx').on(t.organizationId, t.bundleId),
    foreignKey({
      name: 'copy_entry_bundle_tenant_fk',
      columns: [t.bundleId, t.organizationId],
      foreignColumns: [workTemplateCopyBundle.id, workTemplateCopyBundle.organizationId],
    }).onDelete('cascade'),
    // Migration 0166 preserves these two NO ACTION keys as DEFERRABLE INITIALLY DEFERRED.
    foreignKey({
      name: 'copy_entry_live_destination_fk',
      columns: [t.liveWorkTypeId, t.organizationId],
      foreignColumns: [template.id, template.organizationId],
    }).onDelete('no action'),
    foreignKey({
      name: 'copy_entry_consumed_version_fk',
      columns: [t.consumedVersionId, t.liveWorkTypeId, t.organizationId],
      foreignColumns: [
        workTypeVersion.id,
        workTypeVersion.workTypeId,
        workTypeVersion.organizationId,
      ],
    }).onDelete('no action'),
    check('copy_entry_reference_epoch', sql`${t.referenceEpoch} >= 0`),
    check('copy_entry_order', sql`${t.ordinal} between 0 and 99`),
    check('copy_entry_state', sql`${t.reservationState} in ('pending','consumed','void')`),
    check(
      'copy_entry_live_identity',
      sql`${t.liveWorkTypeId} is null or ${t.liveWorkTypeId}=${t.destinationWorkTypeId}`,
    ),
    check(
      'copy_entry_version_identity',
      sql`${t.consumedVersionId} is null or ${t.consumedVersionId}=${t.reservedFirstVersionId}`,
    ),
    check(
      'copy_entry_fingerprint',
      sql`${t.sourceFingerprint} ~ '^sha256:[0-9a-f]{64}$' and (${t.afterStateFingerprint} is null or ${t.afterStateFingerprint} ~ '^sha256:[0-9a-f]{64}$')`,
    ),
    pgPolicy('copy_entry_acceptor_private', {
      for: 'all',
      using: sql`exists(select 1 from work_template_copy_bundle b where b.id=${t.bundleId} and b.organization_id=${t.organizationId} and docket_copy_acceptor_scope(b.organization_id,b.accepting_actor_id))`,
      withCheck: sql`exists(select 1 from work_template_copy_bundle b where b.id=${t.bundleId} and b.organization_id=${t.organizationId} and docket_copy_acceptor_scope(b.organization_id,b.accepting_actor_id))`,
    }),
  ],
).enableRLS();
