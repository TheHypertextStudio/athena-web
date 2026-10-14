/**
 * `@docket/api` — the task-to-task relations: `subtask_of` and `relates_to`.
 *
 * @remarks
 * Both ends of either relation are tasks, named by id. `subtask_of` is a column on the child, so it
 * is single-valued: linking a task to a new parent moves it there. `relates_to` is undirected and
 * stored once, under the canonical endpoint order the REST edit path also writes.
 */
import { db, task, taskRelatedTask } from '@docket/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

import { CycleError, NotFoundError } from '../error';
import { serializableTx } from '../lib/serializable-tx';
import {
  applySubtaskCompletionPolicyForParents,
  finishTaskStateTransition,
} from '../lib/task-state';
import { relatedTaskPair } from '../routes/task-related-replace';
import { wouldCreateSubtaskCycle } from '../routes/task-helpers';
import { trackedFields } from './change-set';
import { isUlid } from './descriptors';
import { resolveTaskEndpoint } from './link-endpoints';
import { rejectSelf, unchanged, type RelationRequest, type RelationResult } from './link-types';

/**
 * Resolve both ends of a task relation.
 *
 * @remarks
 * Taking a relation back names the far end by id without requiring it to be active, so a task can
 * still be detached from a parent or a related task that has since been archived.
 */
async function taskEnds(
  request: RelationRequest,
): Promise<{ from: string; to: string; fromKind: 'task'; toKind: 'task' }> {
  const from = await resolveTaskEndpoint(request.orgId, request.from, 'from');
  const to =
    request.remove && isUlid(request.to)
      ? request.to
      : await resolveTaskEndpoint(request.orgId, request.to, 'to');
  if (from === to) rejectSelf('to', request.to);
  return { from, to, fromKind: 'task', toKind: 'task' };
}

/**
 * `relates_to`: two tasks bear on each other, in no particular direction.
 *
 * @param request - The call; `from` and `to` may be named in either order.
 * @returns what was written, recorded under the stored endpoint order.
 */
export async function applyRelatesTo(request: RelationRequest): Promise<RelationResult> {
  const ends = await taskEnds(request);
  await request.guard('task', ends.from);
  await request.guard('task', ends.to);
  const pair = relatedTaskPair(ends.from, ends.to);
  const where = and(
    eq(taskRelatedTask.organizationId, request.orgId),
    eq(taskRelatedTask.taskId, pair.taskId),
    eq(taskRelatedTask.relatedTaskId, pair.relatedTaskId),
  );
  const changed = await db.transaction(async (tx) => {
    if (request.remove) {
      const deleted = await tx
        .delete(taskRelatedTask)
        .where(where)
        .returning({ id: taskRelatedTask.taskId });
      return deleted.length > 0;
    }
    const inserted = await tx
      .insert(taskRelatedTask)
      .values({ organizationId: request.orgId, ...pair })
      .onConflictDoNothing()
      .returning({ id: taskRelatedTask.taskId });
    return inserted.length > 0;
  });
  if (!changed) return unchanged(ends);
  return {
    ...ends,
    changed: true,
    changes: [
      { kind: 'related_task', from: pair.taskId, to: pair.relatedTaskId, linked: !request.remove },
    ],
    reindex: [],
  };
}

/**
 * `subtask_of`: a column on the child, not a join.
 *
 * @remarks
 * Recorded as an ordinary update rather than a link, so undo restores the previous parent instead
 * of merely detaching — a task moved from one parent to another must go back where it came from.
 * Removing takes the task out from under the parent named, and leaves a task that sits under a
 * different parent where it is: "no longer a subtask of A" says nothing about B.
 *
 * @param request - The call; `from` is the child and `to` the parent.
 * @returns what was written.
 * @throws {CycleError} When the parent already sits under the child.
 */
export async function applySubtaskOf(request: RelationRequest): Promise<RelationResult> {
  const { orgId, remove } = request;
  const ends = await taskEnds(request);
  const { from, to } = ends;
  await request.guard('task', from);
  const result = await serializableTx(async (tx) => {
    // Lock both endpoints in stable id order. Reciprocal links otherwise lock A then B and B
    // then A, which turns the cycle race into a database deadlock before SERIALIZABLE can retry.
    const endpoints = await tx
      .select()
      .from(task)
      .where(
        and(inArray(task.id, [from, to]), eq(task.organizationId, orgId), isNull(task.archivedAt)),
      )
      .orderBy(asc(task.id))
      .for('update');
    const child = endpoints.find((row) => row.id === from);
    if (!child || (!remove && !endpoints.some((row) => row.id === to))) {
      throw new NotFoundError('Task not found');
    }

    if (remove ? child.parentTaskId !== to : child.parentTaskId === to) {
      return { child, row: child, cascades: [], changed: false };
    }
    if (!remove && (await wouldCreateSubtaskCycle(tx, orgId, from, to))) throw new CycleError();

    const updated = await tx
      .update(task)
      .set({ parentTaskId: remove ? null : to })
      .where(and(eq(task.id, from), eq(task.organizationId, orgId), isNull(task.archivedAt)))
      .returning();
    const row = updated[0];
    /* v8 ignore next -- @preserve the locked active row above cannot disappear */
    if (!row) throw new NotFoundError('Task not found');
    return {
      child,
      row,
      cascades: await applySubtaskCompletionPolicyForParents(tx, orgId, [
        child.parentTaskId,
        row.parentTaskId,
      ]),
      changed: true,
    };
  });
  if (!result.changed) return unchanged(ends);
  for (const cascade of result.cascades) {
    await finishTaskStateTransition({ actorId: null }, cascade);
  }

  return {
    ...ends,
    changed: true,
    changes: [
      {
        kind: 'task',
        id: from,
        op: 'update',
        before: trackedFields('task', result.child),
        after: trackedFields('task', result.row),
      },
    ],
    reindex: [from],
  };
}
