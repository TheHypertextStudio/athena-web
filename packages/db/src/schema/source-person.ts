/** Source attribution remains available even before a workspace person is identified. */
import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { genId } from '../id';
import { actor, organization } from './identity';
import { externalActor } from './crosscutting';

/** A provider identity attached to an entity field, independently of its current person link. */
export const sourcePersonReference = pgTable(
  'source_person_reference',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    externalActorId: text('external_actor_id')
      .notNull()
      .references(() => externalActor.id, { onDelete: 'cascade' }),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    field: text('field').notNull(),
    actorId: text('actor_id').references(() => actor.id, { onDelete: 'set null' }),
    sourceDisplayName: text('source_display_name').notNull(),
    detachedAt: timestamp('detached_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('source_person_reference_uq').on(
      t.subjectType,
      t.subjectId,
      t.field,
      t.externalActorId,
    ),
    index('source_person_reference_subject_idx').on(t.organizationId, t.subjectType, t.subjectId),
  ],
);
