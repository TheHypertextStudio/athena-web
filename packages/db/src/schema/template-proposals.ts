/** Restricted exact template proposal attached one-to-one to an existing session action. */
import type { WorkTemplateDefinition } from '@docket/work/work-template-contract';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { actor, organization } from './identity';
import { user } from './auth';
import { sessionActivity } from './agents';
import { notification } from './crosscutting';

/** Private review metadata; the canonical template writer remains the sole definition store. */
export const sessionTemplateProposal = pgTable(
  'session_template_proposal',
  {
    activityId: text('activity_id')
      .primaryKey()
      .references(() => sessionActivity.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').notNull(),
    toolUseId: text('tool_use_id').notNull(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    recipientActorId: text('recipient_actor_id').notNull(),
    recipientUserId: text('recipient_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    proposerActorId: text('proposer_actor_id').notNull(),
    definition: jsonb('definition').$type<WorkTemplateDefinition>().notNull(),
    input: jsonb('input').$type<Record<string, unknown>>().notNull(),
    revision: integer('revision').notNull().default(0),
    state: text('state')
      .$type<'pending' | 'kept' | 'dismissed' | 'undone'>()
      .notNull()
      .default('pending'),
    templateId: text('template_id'),
    templateRevision: integer('template_revision'),
    changeSetId: text('change_set_id'),
    notificationId: text('notification_id').references(() => notification.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('template_proposal_tool_use').on(t.sessionId, t.toolUseId),
    foreignKey({
      columns: [t.activityId, t.sessionId],
      foreignColumns: [sessionActivity.id, sessionActivity.sessionId],
      name: 'template_proposal_action_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.recipientActorId, t.organizationId],
      foreignColumns: [actor.id, actor.organizationId],
      name: 'template_proposal_recipient_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.proposerActorId, t.organizationId],
      foreignColumns: [actor.id, actor.organizationId],
      name: 'template_proposal_proposer_fk',
    }).onDelete('cascade'),
    check('template_proposal_state', sql`${t.state} in ('pending','kept','dismissed','undone')`),
    check('template_proposal_revision', sql`${t.revision} >= 0`),
    pgPolicy('template_proposal_private', {
      for: 'all',
      using: sql`docket_template_proposal_access(${t.organizationId},${t.recipientActorId},${t.proposerActorId})`,
      withCheck: sql`docket_template_proposal_access(${t.organizationId},${t.recipientActorId},${t.proposerActorId})`,
    }),
  ],
).enableRLS();
