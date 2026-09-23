/** `@docket/api` — replacing a task's related-task links inside a task edit. */
import { type db, task, taskRelatedTask } from '@docket/db';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';

import { NotFoundError } from '../error';
import { guardsInOrder } from '../lib/guards-in-order';
import type { RelatedTaskEdgeChange } from '../lib/provenance/task-change-sets';

import { assertTaskCapability, type TaskRow } from './task-helpers';

/** An open database transaction. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A canonically ordered related-task edge, as the join table stores it. */
export interface RelatedTaskPair {
  readonly taskId: string;
  readonly relatedTaskId: string;
}

/**
 * Store an undirected edge under its canonical endpoint ordering.
 *
 * @param taskId - One endpoint.
 * @param relatedTaskId - The other endpoint.
 * @returns the endpoints with the smaller id first.
 */
export function relatedTaskPair(taskId: string, relatedTaskId: string): RelatedTaskPair {
  return taskId < relatedTaskId
    ? { taskId, relatedTaskId }
    : { taskId: relatedTaskId, relatedTaskId: taskId };
}

/** A related-task link an edit added or removed, with the other task's title for activity. */
export interface RelatedTaskActivity extends RelatedTaskEdgeChange {
  readonly title: string;
}

/** Input to {@link replaceRelatedTasks}. */
export interface ReplaceRelatedTasksInput {
  readonly orgId: string;
  readonly actorId: string;
  /** The edited task. */
  readonly taskId: string;
  /** The complete new set of related task ids, sorted; undefined leaves links alone. */
  readonly relatedTaskIds: readonly string[] | undefined;
}

/** Load every endpoint the replacement touches, requiring each to be an active task. */
async function loadEndpoints(
  tx: Tx,
  orgId: string,
  taskIds: readonly string[],
): Promise<Map<string, TaskRow>> {
  const rows =
    taskIds.length === 0
      ? []
      : await tx
          .select()
          .from(task)
          .where(
            and(
              eq(task.organizationId, orgId),
              isNull(task.archivedAt),
              inArray(task.id, [...taskIds]),
            ),
          );
  if (rows.length !== taskIds.length) throw new NotFoundError('Task not found');
  return new Map(rows.map((row) => [row.id, row]));
}

/** The endpoint row for an id the replacement already loaded. */
function endpoint(byId: ReadonlyMap<string, TaskRow>, taskId: string): TaskRow {
  const row = byId.get(taskId);
  /* v8 ignore next -- @preserve defensive: `loadEndpoints` refused a missing endpoint already */
  if (!row) throw new NotFoundError('Task not found');
  return row;
}

/** The links an edit adds and removes, in request order and then stored order. */
function relatedActivity(
  next: readonly string[],
  current: readonly string[],
  byId: ReadonlyMap<string, TaskRow>,
): RelatedTaskActivity[] {
  const nextIds = new Set(next);
  const added = next.filter((taskId) => !current.includes(taskId));
  const removed = current.filter((taskId) => !nextIds.has(taskId));
  return [
    ...added.map((taskId) => ({ taskId, title: endpoint(byId, taskId).title, linked: true })),
    ...removed.map((taskId) => ({ taskId, title: endpoint(byId, taskId).title, linked: false })),
  ];
}

/**
 * Replace a task's related-task links with a new set.
 *
 * @remarks
 * The current links are locked before they are read, and every endpoint on either side of the
 * replacement must be one the caller can contribute to. A link added after this snapshot cannot
 * be deleted without being authorized on a retry.
 *
 * @param tx - The edit's serializable transaction.
 * @param input - The task, the caller, and the new link set.
 * @returns the links added and removed.
 * @throws {NotFoundError} When an endpoint is not an active task in the organization.
 */
export async function replaceRelatedTasks(
  tx: Tx,
  input: ReplaceRelatedTasksInput,
): Promise<RelatedTaskActivity[]> {
  const { orgId, taskId, relatedTaskIds } = input;
  if (relatedTaskIds === undefined) return [];
  const relationWhere = and(
    eq(taskRelatedTask.organizationId, orgId),
    or(eq(taskRelatedTask.taskId, taskId), eq(taskRelatedTask.relatedTaskId, taskId)),
  );
  const lockedRelationRows = await tx
    .select({ taskId: taskRelatedTask.taskId, relatedTaskId: taskRelatedTask.relatedTaskId })
    .from(taskRelatedTask)
    .where(relationWhere)
    .orderBy(asc(taskRelatedTask.taskId), asc(taskRelatedTask.relatedTaskId))
    .for('update');
  const currentRelatedIds = lockedRelationRows.map((edge) =>
    edge.taskId === taskId ? edge.relatedTaskId : edge.taskId,
  );
  const authorizationTaskIds = [...new Set([...relatedTaskIds, ...currentRelatedIds])];
  const byId = await loadEndpoints(tx, orgId, authorizationTaskIds);
  const activity = relatedActivity(relatedTaskIds, currentRelatedIds, byId);
  await guardsInOrder(
    authorizationTaskIds.map((relatedId) =>
      assertTaskCapability(orgId, input.actorId, endpoint(byId, relatedId), 'contribute', tx),
    ),
  );
  await tx.delete(taskRelatedTask).where(relationWhere);
  if (relatedTaskIds.length > 0) {
    await tx.insert(taskRelatedTask).values(
      relatedTaskIds.map((relatedId) => ({
        organizationId: orgId,
        ...relatedTaskPair(taskId, relatedId),
      })),
    );
  }
  return activity;
}
