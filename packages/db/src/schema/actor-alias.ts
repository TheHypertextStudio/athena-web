import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { actor, organization } from './identity';

/** Historical person IDs survive consolidation and resolve to a canonical actor. */
export const actorAlias = pgTable('actor_alias', {
  actorId: text('actor_id')
    .primaryKey()
    .references(() => actor.id, { onDelete: 'restrict' }),
  canonicalActorId: text('canonical_actor_id')
    .notNull()
    .references(() => actor.id, { onDelete: 'restrict' }),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  mergedBy: text('merged_by')
    .notNull()
    .references(() => actor.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
