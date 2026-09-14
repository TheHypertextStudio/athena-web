/**
 * `@docket/db` — personal plan drafts (the planning canvas's durable document).
 *
 * @remarks
 * A plan draft is what Athena and its owner edit together before anything reaches the workspace:
 * one initiative at the root, project containers under it, task rows inside them, and dependency
 * edges. The whole tree is one jsonb document governed by the pure reducer in
 * `@docket/work/plan-draft`, so the database never has to know a node from an edge.
 *
 * Ownership follows Athena sessions: a plan belongs to a user, targets one workspace, and is
 * visible to nobody else. The workspace is authorized at commit time, when the document's draft
 * nodes become real rows, never at read or edit time — a draft has no workspace consequence.
 *
 * Its own file rather than a member of `crosscutting.ts`: it references `agent_session`, and
 * `agents.ts` already depends on `crosscutting.ts` through `joins.ts`, so placing it beside
 * `template` would close an import cycle.
 */
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { PlanDocument } from '@docket/work/plan-draft-contract';

import { genId } from '../id';
import { agentSession } from './agents';
import { user } from './auth';
import { notBlank } from './constraints';
import { organization } from './identity';
import { initiative } from './work';

/**
 * A plan draft's lifecycle: `active` while it holds draft nodes, `committed` once every node has
 * been confirmed into a real object, and `archived` when the person walked away without creating
 * anything.
 */
export const planDraftStatus = pgEnum('plan_draft_status', ['active', 'committed', 'archived']);

/** A personal planning draft. */
export const planDraft = pgTable(
  'plan_draft',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    /** The person the plan belongs to. Plans are personal, like Athena sessions. */
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** The workspace the plan writes into. Fixed at creation. */
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** The Athena session hosting the conversation, when one has attached itself. */
    sessionId: text('session_id').references(() => agentSession.id, { onDelete: 'set null' }),
    /** The real initiative when planning an existing one. */
    rootInitiativeId: text('root_initiative_id').references(() => initiative.id, {
      onDelete: 'set null',
    }),
    title: text('title').notNull(),
    status: planDraftStatus('status').notNull().default('active'),
    /** Incremented on every document write; edits carry the revision they were written against. */
    revision: integer('revision').notNull().default(0),
    document: jsonb('document').$type<PlanDocument>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('plan_draft_owner_status_idx').on(t.ownerUserId, t.status),
    index('plan_draft_session_idx').on(t.sessionId),
    // One open plan per initiative per person, so "Plan with Athena" reopens rather than forks.
    uniqueIndex('plan_draft_owner_root_active_uq')
      .on(t.ownerUserId, t.rootInitiativeId)
      .where(sql`${t.status} = 'active' AND ${t.rootInitiativeId} IS NOT NULL`),
    notBlank('plan_draft_title_not_blank', t.title),
  ],
);
