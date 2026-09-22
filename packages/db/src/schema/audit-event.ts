/**
 * `@docket/db` — the universal audit feed.
 *
 * @remarks
 * One row per recorded field change or lifecycle event on a subject. Agent actions carry
 * `actorId` = the agent and `initiatorId` = the human who authorized it. `origin` records where
 * the change came from — the app, Athena, an MCP client, a sync — in the same shape as a change
 * set's origin, so an activity row and the change set behind it cannot disagree.
 */
import type { ChangeOrigin } from '@docket/work/provenance-contract';
import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { auditEventType, auditSubjectType } from '../enums';
import { genId } from '../id';
import { actor, organization } from './identity';

/** The universal audit feed; agent actions carry `actorId`=agent + `initiatorId`=human. */
export const auditEvent = pgTable(
  'audit_event',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    actorId: text('actor_id').references(() => actor.id, { onDelete: 'set null' }),
    initiatorId: text('initiator_id').references(() => actor.id, { onDelete: 'set null' }),
    subjectType: auditSubjectType('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    type: auditEventType('type').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    /** Where the change came from. Null on rows written before provenance recording. */
    origin: jsonb('origin').$type<ChangeOrigin>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('audit_event_org_created_idx').on(t.organizationId, t.createdAt),
    index('audit_event_subject_idx').on(t.subjectType, t.subjectId),
  ],
);
