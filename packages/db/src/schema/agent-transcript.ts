import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type { TurnMessage } from '../types';
import { user } from './auth';
import { organization } from './identity';
import { agentSession } from './agents';

/** Private persisted provider context, visible only to its actual session executor. */
export const agentSessionTranscript = pgTable(
  'agent_session_transcript',
  {
    sessionId: text('session_id')
      .primaryKey()
      .references(() => agentSession.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'cascade' }),
    messages: jsonb('messages').$type<TurnMessage[]>().notNull().default([]),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('session_transcript_executor_private', {
      for: 'all',
      using: sql`docket_session_transcript_access(${t.sessionId})`,
      withCheck: sql`docket_session_transcript_access(${t.sessionId})`,
    }),
    index('agent_session_transcript_owner_idx').on(t.ownerUserId),
    foreignKey({
      columns: [t.sessionId, t.ownerUserId],
      foreignColumns: [agentSession.id, agentSession.ownerUserId],
      name: 'agent_session_transcript_parent_owner_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.sessionId, t.organizationId],
      foreignColumns: [agentSession.id, agentSession.organizationId],
      name: 'agent_session_transcript_parent_org_fk',
    }).onDelete('cascade'),
    check(
      'agent_session_transcript_attribution_check',
      sql`(${t.ownerUserId} IS NOT NULL AND ${t.organizationId} IS NULL)
        OR (${t.ownerUserId} IS NULL AND ${t.organizationId} IS NOT NULL)`,
    ),
  ],
).enableRLS();
