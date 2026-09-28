/** Durable, person-owned chapter spans in Athena's persistent conversation. */
import { sql } from 'drizzle-orm';
import { foreignKey, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import { genId } from '../id';
import { agentSession, sessionActivity } from './agents';
import { user } from './auth';

/** One named span anchored to two messages, or an open start awaiting its end. */
export const athenaConversationChapter = pgTable(
  'athena_conversation_chapter',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    sessionId: text('session_id')
      .notNull()
      .references(() => agentSession.id, { onDelete: 'cascade' }),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    startActivityId: text('start_activity_id').notNull(),
    endActivityId: text('end_activity_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('athena_conversation_chapter_session_idx').on(t.sessionId, t.createdAt),
    uniqueIndex('athena_conversation_chapter_open_uq')
      .on(t.sessionId)
      .where(sql`${t.endActivityId} IS NULL`),
    foreignKey({
      columns: [t.sessionId, t.ownerUserId],
      foreignColumns: [agentSession.id, agentSession.ownerUserId],
      name: 'athena_conversation_chapter_owner_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.startActivityId, t.sessionId],
      foreignColumns: [sessionActivity.id, sessionActivity.sessionId],
      name: 'athena_conversation_chapter_start_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.endActivityId, t.sessionId],
      foreignColumns: [sessionActivity.id, sessionActivity.sessionId],
      name: 'athena_conversation_chapter_end_fk',
    }).onDelete('cascade'),
  ],
);
