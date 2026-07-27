/**
 * `@docket/api` — recording and reversing MCP change sets.
 *
 * @remarks
 * The MCP surface executes writes immediately rather than proposing them, which is a bet on
 * velocity. That bet only holds if the caller can see what happened and take it back, so every
 * tool that mutates records what it touched and what the rows looked like first.
 *
 * Undo is a reverse replay with conflict detection, not a transaction rollback: by the time
 * someone asks, the transaction is long committed and other people have been working. An entry
 * whose current state no longer matches what this change set left is reported as skipped, never
 * clobbered — reversing your own change must not quietly discard someone else's.
 */
import {
  changeSet,
  changeSetEntry,
  type ChangeOrigin,
  db,
  genId,
  initiative,
  program,
  project,
  task,
} from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

import { NotFoundError } from '../error';

/** The entity kinds a change set can record, mapped to the table they live in. */
const RECORDABLE = { task, project, program, initiative } as const;

/** One recordable entity kind. */
export type RecordableKind = keyof typeof RECORDABLE;

/**
 * The columns a change set records per kind, and the only ones undo restores.
 *
 * @remarks
 * Recording the whole row would make undo refuse on any unrelated edit — `updatedAt` alone would
 * defeat it. Narrowing to the fields a tool can actually write is what lets undo work on a live
 * workspace rather than only an untouched one. `archivedAt` is here because archive is a recorded
 * op; the external-provenance columns are not, because no tool on this surface writes them.
 */
const TRACKED: Record<RecordableKind, readonly string[]> = {
  task: [
    'title',
    'description',
    'state',
    'priority',
    'assigneeId',
    'delegateId',
    'projectId',
    'programId',
    'teamId',
    'dueDate',
    'completedAt',
    'canceledAt',
    'archivedAt',
  ],
  project: [
    'name',
    'description',
    'status',
    'health',
    'leadId',
    'programId',
    'teamId',
    'startDate',
    'targetDate',
    'archivedAt',
  ],
  program: ['name', 'description', 'status', 'health', 'ownerId', 'archivedAt'],
  initiative: [
    'name',
    'description',
    'status',
    'health',
    'priority',
    'ownerId',
    'targetDate',
    'archivedAt',
  ],
};

/**
 * Project a row down to the fields a change set tracks for its kind.
 *
 * @param kind - The entity kind.
 * @param row - The full row.
 * @returns the tracked subset.
 */
export function trackedFields(
  kind: RecordableKind,
  row: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(TRACKED[kind].map((key) => [key, row[key]]));
}

/** A single recorded change, before it is written. */
export interface ChangeRecord {
  readonly kind: RecordableKind;
  readonly id: string;
  readonly op: 'create' | 'update' | 'archive' | 'link';
  /** The row as it was, for an update or archive. Absent on a create. */
  readonly before?: Record<string, unknown>;
  /** The row as it now is, for a create or update. Absent on an archive. */
  readonly after?: Record<string, unknown>;
}

/** What an undo did, per entity. */
export interface UndoOutcome {
  readonly kind: string;
  readonly id: string;
  readonly reverted: boolean;
  /** Why it was left alone, when it was. */
  readonly reason?: string;
}

/**
 * Record a completed tool call as an undoable change set.
 *
 * @remarks
 * Called after the writes commit, not inside them: a change set that rolled back with its own
 * transaction would leave a caller unable to undo a change that did happen, which is the wrong way
 * round. A failure to record is therefore a real failure — unlike a missed notification, losing
 * the record means losing the undo.
 *
 * @param input - The org, acting actor, origin, summary, and the entities touched.
 * @returns the new change-set id, or null when nothing was touched.
 */
export async function recordChangeSet(input: {
  orgId: string;
  actorId: string;
  origin: ChangeOrigin;
  summary: string;
  changes: readonly ChangeRecord[];
}): Promise<string | null> {
  if (input.changes.length === 0) return null;
  const id = genId();
  await db.transaction(async (tx) => {
    await tx.insert(changeSet).values({
      id,
      organizationId: input.orgId,
      actorId: input.actorId,
      origin: input.origin,
      summary: input.summary,
    });
    await tx
      .insert(changeSetEntry)
      .values(
        input.changes.map((change) => ({
          changeSetId: id,
          entityKind: change.kind,
          entityId: change.id,
          op: change.op,
          before: change.before ?? null,
          after: change.after ?? null,
        })),
      )
      // One call touching a row twice collapses to the last write, which is what reversing needs.
      .onConflictDoNothing();
  });
  return id;
}

/**
 * Whether a row still looks the way this change set left it.
 *
 * @remarks
 * Compares only the fields the change actually wrote. A change set that set `priority` should not
 * refuse to undo because someone edited the title afterwards — the narrow comparison is what makes
 * undo useful on a live workspace rather than only on an untouched one.
 *
 * @param current - The row as it is now.
 * @param after - The row as this change set left it.
 * @returns true when every field this change wrote is unchanged.
 */
function unchangedSince(current: Record<string, unknown>, after: Record<string, unknown>): boolean {
  return Object.entries(after).every(([key, value]) => {
    const now = current[key];
    // Dates and enums round-trip through JSON as strings; compare on that footing.
    const normalize = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : v);
    return normalize(now) === normalize(value);
  });
}

/** Load one recordable row by id, or null when it is gone. */
async function loadRow(
  kind: RecordableKind,
  orgId: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const table = RECORDABLE[kind] as PgTable & {
    id: typeof task.id;
    organizationId: typeof task.organizationId;
  };
  const rows = await db
    .select()
    .from(table)
    .where(and(eq(table.id, id), eq(table.organizationId, orgId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Reverse one recorded entry.
 *
 * @param entry - The recorded change.
 * @param orgId - The organization it happened in.
 * @returns what happened to it.
 */
async function revertEntry(
  entry: {
    entityKind: string;
    entityId: string;
    op: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  },
  orgId: string,
): Promise<UndoOutcome> {
  const kind = entry.entityKind as RecordableKind;
  const ref = { kind: entry.entityKind, id: entry.entityId };
  if (!(kind in RECORDABLE)) return { ...ref, reverted: false, reason: 'unsupported_kind' };

  const table = RECORDABLE[kind] as PgTable & {
    id: typeof task.id;
    organizationId: typeof task.organizationId;
    archivedAt: typeof task.archivedAt;
  };
  const current = await loadRow(kind, orgId, entry.entityId);
  if (!current) return { ...ref, reverted: false, reason: 'gone' };
  if (entry.after && !unchangedSince(current, entry.after)) {
    return { ...ref, reverted: false, reason: 'changed_since' };
  }

  const where = and(eq(table.id, entry.entityId), eq(table.organizationId, orgId));
  switch (entry.op) {
    case 'create':
      // Undoing a create archives rather than deletes: the row may already be referenced, and a
      // hard delete would take those references with it.
      await db.update(table).set({ archivedAt: new Date() }).where(where);
      return { ...ref, reverted: true };
    case 'archive':
      await db.update(table).set({ archivedAt: null }).where(where);
      return { ...ref, reverted: true };
    case 'update':
      if (!entry.before) return { ...ref, reverted: false, reason: 'no_prior_state' };
      await db.update(table).set(entry.before).where(where);
      return { ...ref, reverted: true };
    default:
      return { ...ref, reverted: false, reason: 'unsupported_op' };
  }
}

/**
 * Reverse a change set, reporting what it could not take back.
 *
 * @remarks
 * Entries revert in reverse insertion order so a call that created a project and then filed tasks
 * into it unwinds children-first. A partial undo is a normal outcome, not an error: the caller
 * gets a per-entity account and decides what to do about the remainder.
 *
 * @param orgId - The organization the change happened in.
 * @param changeSetId - The change set to reverse.
 * @returns the summary it reverses and the per-entity outcomes.
 * @throws {NotFoundError} When the change set is not this org's, or was already undone.
 */
export async function undoChangeSet(
  orgId: string,
  changeSetId: string,
): Promise<{ summary: string; outcomes: UndoOutcome[] }> {
  const sets = await db
    .select({ id: changeSet.id, summary: changeSet.summary })
    .from(changeSet)
    .where(
      and(
        eq(changeSet.id, changeSetId),
        eq(changeSet.organizationId, orgId),
        isNull(changeSet.undoneAt),
      ),
    )
    .limit(1);
  const set = sets[0];
  if (!set) throw new NotFoundError('Change set not found');

  const entries = await db
    .select()
    .from(changeSetEntry)
    .where(eq(changeSetEntry.changeSetId, changeSetId));

  const outcomes: UndoOutcome[] = [];
  for (const entry of [...entries].reverse()) {
    outcomes.push(await revertEntry(entry, orgId));
  }
  await db.update(changeSet).set({ undoneAt: new Date() }).where(eq(changeSet.id, changeSetId));
  return { summary: set.summary, outcomes };
}

/**
 * Where an entity came from, when a recorded change created it.
 *
 * @param kind - The entity kind.
 * @param id - The entity id.
 * @returns the origin and when it was created, or null for anything not created through a tool.
 */
export async function originOf(
  kind: string,
  id: string,
): Promise<{ origin: ChangeOrigin; at: Date; actorId: string } | null> {
  const rows = await db
    .select({ origin: changeSet.origin, at: changeSet.createdAt, actorId: changeSet.actorId })
    .from(changeSetEntry)
    .innerJoin(changeSet, eq(changeSetEntry.changeSetId, changeSet.id))
    .where(
      and(
        eq(changeSetEntry.entityKind, kind),
        eq(changeSetEntry.entityId, id),
        eq(changeSetEntry.op, 'create'),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}
