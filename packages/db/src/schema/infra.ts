/**
 * `@docket/db` — infrastructure schema island (data-model §8).
 *
 * @remarks
 * The idempotency-key table backing the `Idempotency-Key` middleware on POST create
 * routes: user-scoped, 24h TTL, storing the request hash + cached response so a
 * replay returns the original result and a hash mismatch is a conflict.
 */
import {
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
