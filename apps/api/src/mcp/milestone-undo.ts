/**
 * `@docket/api` — reversing a recorded milestone change.
 *
 * @remarks
 * Milestones are deleted outright rather than archived, so they cannot share the archive-based
 * reversal the other recorded kinds use: undoing a create deletes the row, and undoing a delete
 * re-inserts it under its original id. The Tasks a delete detached are recorded on the milestone's
 * own entry and relinked in the same transaction as the re-insert, so the reversal never depends
 * on the order undo reads a change set's entries in.
 */
import { db, milestone, project, task } from '@docket/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import { restoredDate, unchangedSince } from './change-set-values';

/** One recorded milestone entry, as undo reads it back. */
export interface MilestoneEntry {
  readonly entityId: string;
  readonly op: string;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
}

/** What reverting one milestone entry did. */
export interface MilestoneUndoOutcome {
  readonly kind: 'milestone';
  readonly id: string;
  readonly reverted: boolean;
  readonly reason?: string;
}

/** The milestone columns a recorded snapshot restores. */
interface MilestonePatch {
  readonly name: string;
  readonly description: string | null;
  readonly targetDate: Date | null;
  readonly sort: number;
}

/** Turn a recorded milestone snapshot back into column values. */
function patchFromSnapshot(snapshot: Record<string, unknown>): MilestonePatch {
  const description = snapshot['description'];
  return {
    name: String(snapshot['name']),
    description: typeof description === 'string' ? description : null,
    targetDate: restoredDate(snapshot['targetDate']),
    sort: Number(snapshot['sort']),
  };
}

/** Put a deleted milestone back under its original id, when its Project still exists. */
async function restoreDeleted(
  entry: MilestoneEntry,
  orgId: string,
  exists: boolean,
): Promise<MilestoneUndoOutcome> {
  const ref = { kind: 'milestone', id: entry.entityId } as const;
  if (exists) return { ...ref, reverted: false, reason: 'already_present' };
  const prior = entry.before;
  const projectId = prior?.['projectId'];
  if (!prior || typeof projectId !== 'string') {
    return { ...ref, reverted: false, reason: 'no_prior_state' };
  }
  const [parent] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.organizationId, orgId)))
    .limit(1);
  if (!parent) return { ...ref, reverted: false, reason: 'gone' };
  const createdBy = prior['createdBy'];
  const detached = prior['detachedTaskIds'];
  const taskIds = Array.isArray(detached)
    ? detached.filter((id): id is string => typeof id === 'string')
    : [];
  await db.transaction(async (tx) => {
    await tx.insert(milestone).values({
      id: entry.entityId,
      organizationId: orgId,
      projectId,
      ...patchFromSnapshot(prior),
      createdBy: typeof createdBy === 'string' ? createdBy : null,
      createdAt: restoredDate(prior['createdAt']) ?? new Date(),
    });
    // Relink only Tasks still in the project with no milestone; one given a new milestone or moved
    // since the delete keeps what someone chose for it.
    if (taskIds.length === 0) return;
    await tx
      .update(task)
      .set({ milestoneId: entry.entityId })
      .where(
        and(
          eq(task.organizationId, orgId),
          eq(task.projectId, projectId),
          isNull(task.milestoneId),
          inArray(task.id, taskIds),
        ),
      );
  });
  return { ...ref, reverted: true };
}

/** Whether any active Task points at the milestone. */
async function inUse(orgId: string, milestoneId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: task.id })
    .from(task)
    .where(
      and(
        eq(task.organizationId, orgId),
        eq(task.milestoneId, milestoneId),
        isNull(task.archivedAt),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Reverse one recorded milestone change.
 *
 * @remarks
 * A created milestone that active Tasks now use is left alone rather than deleted out from under
 * them; the Tasks a create set itself filed there are archived by the same undo before this runs.
 *
 * @param entry - The recorded change.
 * @param orgId - The organization it happened in.
 * @returns what happened to it.
 */
export async function revertMilestone(
  entry: MilestoneEntry,
  orgId: string,
): Promise<MilestoneUndoOutcome> {
  const ref = { kind: 'milestone', id: entry.entityId } as const;
  const where = and(eq(milestone.id, entry.entityId), eq(milestone.organizationId, orgId));
  const [current] = await db.select().from(milestone).where(where).limit(1);

  if (entry.op === 'delete') return restoreDeleted(entry, orgId, current !== undefined);
  if (!current) return { ...ref, reverted: false, reason: 'gone' };
  if (entry.after && !unchangedSince(current, entry.after)) {
    return { ...ref, reverted: false, reason: 'changed_since' };
  }
  if (entry.op === 'create') {
    if (await inUse(orgId, entry.entityId)) return { ...ref, reverted: false, reason: 'in_use' };
    await db.delete(milestone).where(where);
    return { ...ref, reverted: true };
  }
  if (entry.op === 'update' && entry.before) {
    await db.update(milestone).set(patchFromSnapshot(entry.before)).where(where);
    return { ...ref, reverted: true };
  }
  return { ...ref, reverted: false, reason: 'no_prior_state' };
}
