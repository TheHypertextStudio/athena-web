/**
 * `@docket/db` — infrastructure schema island (data-model §8).
 *
 * @remarks
 * The current receipt table isolates retries by user, caller namespace, and API version for 48
 * hours. The legacy `(user_id, key)` table remains beside it only for bounded rollback and replay
 * compatibility while receipts written before the public contract expire.
 */
import { sql } from 'drizzle-orm';
import {
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

import { idempotencyStatus, objectCommandEffectStatus } from '../enums';
import { genId } from '../id';
import { actor, organization } from './identity';

/** The persistence boundary promised by one public REST idempotency receipt. */
export type ApiIdempotencyReceiptFormat = 'legacy-json' | 'json-receipt' | 'atomic-receipt';

/** A stored idempotent-request record, keyed by `(user_id, key)`. */
export const idempotencyKey = pgTable(
  'idempotency_key',
  {
    userId: text('user_id').notNull(),
    key: text('key').notNull(),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    method: text('method').notNull(),
    path: text('path').notNull(),
    requestHash: text('request_hash').notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body').$type<unknown>(),
    status: idempotencyStatus('status').notNull().default('in_progress'),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    index('idempotency_expires_idx').on(t.expiresAt),
  ],
);

/**
 * A public REST receipt isolated by caller, compatibility contract, and caller-selected key.
 *
 * @remarks
 * This table intentionally sits beside {@link idempotencyKey}. Old application revisions only
 * know the legacy `(user_id, key)` table. Keeping the new identity in a separate table prevents
 * an old broad update from changing OAuth or future-version receipts during a rollback.
 */
export const apiIdempotencyReceipt = pgTable(
  'api_idempotency_receipt',
  {
    userId: text('user_id').notNull(),
    callerNamespace: text('caller_namespace').notNull(),
    apiVersion: text('api_version').notNull(),
    key: text('key').notNull(),
    claimId: text('claim_id').notNull(),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    method: text('method').notNull(),
    path: text('path').notNull(),
    requestHash: text('request_hash').notNull(),
    receiptFormat: text('receipt_format').$type<ApiIdempotencyReceiptFormat>().notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body').$type<unknown>(),
    responseHeaders: jsonb('response_headers')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    status: idempotencyStatus('status').notNull().default('in_progress'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.callerNamespace, t.apiVersion, t.key] }),
    index('api_idempotency_receipt_expires_idx').on(t.expiresAt),
    check(
      'api_idempotency_receipt_namespace_nonempty',
      sql`length(trim(${t.callerNamespace})) > 0`,
    ),
    check('api_idempotency_receipt_version_nonempty', sql`length(trim(${t.apiVersion})) > 0`),
    check('api_idempotency_receipt_claim_nonempty', sql`length(trim(${t.claimId})) > 0`),
    check(
      'api_idempotency_receipt_format_check',
      sql`${t.receiptFormat} IN ('legacy-json', 'json-receipt', 'atomic-receipt')`,
    ),
  ],
);

/** Durable post-commit consequences for one canvas object command or replay. */
export const objectCommandEffectJob = pgTable(
  'object_command_effect_job',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    actorId: text('actor_id')
      .notNull()
      .references(() => actor.id, { onDelete: 'cascade' }),
    commandId: text('command_id').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    nextEffect: integer('next_effect').notNull().default(0),
    status: objectCommandEffectStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    runAfter: timestamp('run_after').notNull().defaultNow(),
    lockedAt: timestamp('locked_at'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    processedAt: timestamp('processed_at'),
  },
  (t) => [
    uniqueIndex('object_command_effect_job_command_uq').on(
      t.organizationId,
      t.actorId,
      t.commandId,
    ),
    index('object_command_effect_job_status_run_idx').on(t.status, t.runAfter, t.createdAt),
    index('object_command_effect_job_status_processed_idx').on(t.status, t.processedAt),
  ],
);
