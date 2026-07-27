/**
 * `@docket/db` — change-set island: what an agent did, and how to take it back.
 *
 * @remarks
 * Two questions turn out to need the same record. "Undo that" needs the prior state of everything
 * a call touched. "Where did this come from?" — asked months later about a task nobody remembers
 * creating — needs the same rows, read from the other end. Recording them once means an undo
 * window and a provenance trail cannot disagree about what happened.
 *
 * Deliberately its own island with no foreign key into the work tables. Entities do not carry a
 * `changeSetId` column: origin is answered by querying the entries for a `create` on that id, so
 * adding this costs the work schema nothing and removing it would leave no orphan columns behind.
 *
 * This does NOT extend `provenance_source`. Its `native|linked` values encode *sync semantics* —
 * whether a row mirrors an external system — and drive the `task_source_uq`/`project_source_uq`
 * partial indexes and the connector reconcile paths. A task an agent created is still `native`.
 * Authorship is a different axis and lives here.
 */
import { index, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

import { changeSetOp } from '../enums';
import { actor, organization } from './identity';

/** Where a change came from, recorded once per change set. */
export interface ChangeOrigin {
  /** The MCP client that made the call, when it identified itself (`clientInfo.name`). */
  readonly client?: string;
  /** The MCP session the call arrived on, when it held one. */
  readonly sessionId?: string;
  /** The tool that produced the change. */
  readonly tool: string;
}

/**
 * One tool call's worth of change, undoable as a unit.
 *
 * @remarks
 * `summary` is a human-readable line for the change report ("Reassigned 12 tasks to Ada"), not a
 * machine field — nothing branches on it.
 */
export const changeSet = pgTable(
  'change_set',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    // The actor whose permissions the change ran under. For a proxy call that is the human, which
    // is what makes "who did this" answerable even when an agent typed it.
    actorId: text('actor_id')
      .notNull()
      .references(() => actor.id, { onDelete: 'cascade' }),
    origin: jsonb('origin').$type<ChangeOrigin>().notNull(),
    summary: text('summary').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    undoneAt: timestamp('undone_at'),
  },
  (t) => [
    index('change_set_org_created_idx').on(t.organizationId, t.createdAt),
    index('change_set_actor_idx').on(t.actorId),
  ],
);

/**
 * One entity touched by a change set, with enough state to reverse it.
 *
 * @remarks
 * `before` is null for a create and `after` is null for an archive; both are present for an
 * update. Undo replays entries in reverse, and compares current state against `after` first — a
 * row someone else has since edited is reported as skipped rather than silently clobbered.
 *
 * Keyed by `(changeSetId, entityKind, entityId)` so one call touching the same row twice collapses
 * to the last write, which is what reversing it needs.
 */
export const changeSetEntry = pgTable(
  'change_set_entry',
  {
    changeSetId: text('change_set_id')
      .notNull()
      .references(() => changeSet.id, { onDelete: 'cascade' }),
    entityKind: text('entity_kind').notNull(),
    entityId: text('entity_id').notNull(),
    op: changeSetOp('op').notNull(),
    before: jsonb('before').$type<Record<string, unknown>>(),
    after: jsonb('after').$type<Record<string, unknown>>(),
  },
  (t) => [
    primaryKey({ columns: [t.changeSetId, t.entityKind, t.entityId] }),
    // The provenance lookup is entity-first ("where did THIS come from?"), so this index is what
    // keeps that question off a sequential scan of every change ever made.
    index('change_set_entry_entity_idx').on(t.entityKind, t.entityId),
  ],
);
