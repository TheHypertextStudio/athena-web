/** Provider calls outside canonical agent session runs; no prompt or response content. */
import { bigint, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { genId } from '../id';
import { user } from './auth';
import { organization } from './identity';

/** Immutable measurements retained for deterministic daily cost rollups. */
export const aiCallUsage = pgTable(
  'ai_call_usage',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    source: text('source').notNull(),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    model: text('model'),
    backend: text('backend').$type<'lattice'>(),
    inputTokens: bigint('input_tokens', { mode: 'number' }),
    outputTokens: bigint('output_tokens', { mode: 'number' }),
    cacheReadTokens: bigint('cache_read_tokens', { mode: 'number' }),
    cacheWriteTokens: bigint('cache_write_tokens', { mode: 'number' }),
  },
  (t) => [index('ai_call_usage_occurred_idx').on(t.occurredAt)],
);
