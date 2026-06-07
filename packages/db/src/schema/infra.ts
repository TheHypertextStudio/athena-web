/**
 * `@docket/db` — infrastructure schema island (data-model §8).
 *
 * @remarks
 * The idempotency-key table backing the `Idempotency-Key` middleware on POST create
 * routes: user-scoped, 24h TTL, storing the request hash + cached response so a
 * replay returns the original result and a hash mismatch is a conflict.
 */
import { index, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

import { idempotencyStatus } from '../enums';
import { organization } from './identity';

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
