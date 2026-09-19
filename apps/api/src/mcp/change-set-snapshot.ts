/**
 * `@docket/api` — reading a change-set entry's recorded snapshot back into a row.
 *
 * @remarks
 * Shared by both reversal modes in `./change-set-undo`. A snapshot is JSON on the way out and on
 * the way back, so every date, enum and list in it needs converting before it can be compared with
 * a live row or written over one.
 */
import { db } from '@docket/db';
import type { changeSetEntry, task } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';

import {
  RECORDABLE,
  RELATIONS,
  TRACKED,
  type RecordableKind,
  type RecordableTable,
  type RelationKind,
  type Tx,
  type UndoOutcome,
} from './change-set-tables';

/** One persisted change-set entry, as the reverse replay reads it. */
export type ChangeSetEntryRow = typeof changeSetEntry.$inferSelect;

/** One task row, as the atomic reversal locks it. */
export type TaskRow = typeof task.$inferSelect;

/** What a reversal reports back. */
export interface UndoResult {
  readonly summary: string;
  readonly outcomes: UndoOutcome[];
}

/** What an atomic reversal hands its caller inside the transaction, before it commits. */
export interface RevertedChangeSet {
  readonly tx: Tx;
  readonly entries: readonly ChangeSetEntryRow[];
  readonly outcomes: readonly UndoOutcome[];
}

/**
 * The single refusal an atomic reversal reports.
 *
 * @remarks
 * Every drift it can detect means the same thing to the caller — the change set is no longer the
 * last word on these rows — and naming which row moved would tell them nothing they can act on.
 */
export const UNDO_CONFLICT = 'Expansion can no longer be undone';

/** Whether a recorded value is the list of label ids a task-labels entry must carry. */
export function isLabelIdList(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((id) => typeof id === 'string');
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
export function unchangedSince(
  current: Record<string, unknown>,
  after: Record<string, unknown>,
): boolean {
  return Object.entries(after).every(([key, value]) => {
    const now = current[key];
    // Dates and enums round-trip through JSON as strings; compare on that footing.
    const normalize = (v: unknown): unknown => (v instanceof Date ? v.toISOString() : v);
    return normalize(now) === normalize(value);
  });
}

/** Load one recordable row by id, or null when it is gone. */
export async function loadRow(
  kind: RecordableKind,
  orgId: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const table = RECORDABLE[kind] as RecordableTable;
  const rows = await db
    .select()
    .from(table)
    .where(and(eq(table.id, id), eq(table.organizationId, orgId)))
    .limit(1);
  return rows[0] ?? null;
}

/** The endpoint columns for a relation, named as the join table spells them. */
export function endpointValues(
  kind: RelationKind,
  from: string,
  to: string,
): Record<string, string> {
  switch (kind) {
    case 'blocks':
      return { blockingTaskId: from, blockedTaskId: to };
    case 'project_blocks':
      return { blockingProjectId: from, blockedProjectId: to };
    case 'task_has_label':
      return { taskId: from, labelId: to };
    case 'project_has_label':
      return { projectId: from, labelId: to };
    case 'related_task':
      return { taskId: from, relatedTaskId: to };
    case 'project_contributes_to':
      return { projectId: from, initiativeId: to };
    case 'program_contributes_to':
      return { programId: from, initiativeId: to };
  }
}

/** The join table a relation lives in, narrowed to the columns a reversal filters on. */
export function relationTable(kind: RelationKind): PgTable & { organizationId: AnyPgColumn } {
  return RELATIONS[kind].table;
}

/** Parse a JSON round-tripped nullable date from a recorded row. */
export function restoredDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value !== 'string') throw new Error('Recorded task timestamp is invalid');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Recorded task timestamp is invalid');
  return date;
}

/** Turn a tracked task snapshot back into a Drizzle task patch. */
export function taskPatchFromSnapshot(snapshot: Record<string, unknown>): Record<string, unknown> {
  return {
    title: snapshot['title'],
    description: snapshot['description'],
    state: snapshot['state'],
    statusId: snapshot['statusId'],
    priority: snapshot['priority'],
    assigneeId: snapshot['assigneeId'],
    delegateId: snapshot['delegateId'],
    projectId: snapshot['projectId'],
    programId: snapshot['programId'],
    milestoneId: snapshot['milestoneId'],
    cycleId: snapshot['cycleId'],
    parentTaskId: snapshot['parentTaskId'],
    teamId: snapshot['teamId'],
    templateId: snapshot['templateId'],
    estimate: snapshot['estimate'],
    estimateMinutes: snapshot['estimateMinutes'],
    startDate: restoredDate(snapshot['startDate']),
    dueDate: restoredDate(snapshot['dueDate']),
    completedAt: restoredDate(snapshot['completedAt']),
    canceledAt: restoredDate(snapshot['canceledAt']),
    autoCompletedBySubtasks: snapshot['autoCompletedBySubtasks'] === true,
    archivedAt: restoredDate(snapshot['archivedAt']),
  };
}

/** Columns in the snapshot that a state transition owns, rather than a plain update. */
const STATE_OWNED_TASK_FIELDS = [
  'state',
  'statusId',
  'completedAt',
  'canceledAt',
  'autoCompletedBySubtasks',
];

/** The snapshot's non-state columns, which are restored by a plain update. */
export function restoredMetadata(snapshot: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    TRACKED.task
      .filter((key) => !STATE_OWNED_TASK_FIELDS.includes(key))
      .map((key) => [key, snapshot[key]]),
  );
}
