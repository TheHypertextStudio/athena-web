/**
 * `@docket/api` — the shared task state-transition mutation.
 *
 * @remarks
 * One implementation of "move a task to a workflow state" shared by the HTTP route
 * (`POST /tasks/:id/status`) and the `task.setStatus` automation action, so terminal-state
 * timestamp derivation and event emission can never diverge between the two. Entering a
 * terminal state derives `completedAt`/`canceledAt`; leaving one clears them — these
 * timestamps are authoritative and never caller-set. Emits `completed` (terminal-completed)
 * or `status_change` with a `docket.state_change` detail; the automation engine's depth-1
 * cascade cap keeps a rule-triggered transition from re-firing rules.
 */
import { db, task } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';

import { resolveStateTransition } from '../routes/task-helpers';
import { emitEvent } from '../routes/event-emit';
import { enqueueSearchUpsert } from '../search/write-through';

import { diffTaskFields, recordTaskChanges, resolveTaskChangeLabels } from './task-audit';
import { advanceCompletedProcessTask } from './recurrence/advance';

/** The selected `task` row shape. */
export type TaskRow = typeof task.$inferSelect;

/** Input to {@link setTaskState}. */
export interface SetTaskStateInput {
  readonly organizationId: string;
  readonly taskId: string;
  /** The target workflow-state key (must exist in the owning team's `workflow_states`). */
  readonly state: string;
  /** The acting actor recorded on the emitted event (null for unattributed automation). */
  readonly actorId: string | null;
}

type TaskStateTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The committed before/after pair needed by task-state side effects. */
export interface TaskStateMutation {
  readonly before: TaskRow;
  readonly after: TaskRow;
}

/** Apply a resolved workflow transition through an existing transaction. */
export async function writeTaskStateTransition(
  tx: TaskStateTransaction,
  input: {
    readonly before: TaskRow;
    readonly statusId: string;
    readonly state: string;
    readonly completedAt: Date | null;
    readonly canceledAt: Date | null;
  },
): Promise<TaskStateMutation | null> {
  const updated = await tx
    .update(task)
    .set({
      // `statusId` is the authority and `state` its key; the composite foreign key refuses a
      // write where the two disagree, so they always move together.
      statusId: input.statusId,
      state: input.state,
      completedAt: input.completedAt,
      canceledAt: input.canceledAt,
    })
    .where(
      and(
        eq(task.id, input.before.id),
        eq(task.organizationId, input.before.organizationId),
        isNull(task.archivedAt),
      ),
    )
    .returning();
  const after = updated[0];
  return after ? { before: input.before, after } : null;
}

/** Publish the durable history, stream, search, and process consequences after commit. */
export async function finishTaskStateTransition(
  input: { readonly actorId: string | null; readonly enqueueSearch?: boolean },
  mutation: TaskStateMutation,
): Promise<void> {
  const { before, after } = mutation;
  await emitEvent({
    organizationId: after.organizationId,
    kind: after.completedAt ? 'completed' : 'status_change',
    actorId: input.actorId,
    title: after.title,
    subject: { type: 'task', id: after.id, title: after.title },
    detail: { schema: 'docket.state_change', fromState: before.state, toState: after.state },
  });
  await recordTaskChanges({
    organizationId: after.organizationId,
    taskId: after.id,
    title: after.title,
    actorId: input.actorId,
    changes: await resolveTaskChangeLabels(after.organizationId, diffTaskFields(before, after)),
  });
  if (input.enqueueSearch !== false) {
    await enqueueSearchUpsert(after.organizationId, 'task', after.id);
  }
  if (after.completedAt) {
    await advanceCompletedProcessTask(db, {
      organizationId: after.organizationId,
      actorId: input.actorId ?? undefined,
      completedTaskId: after.id,
      completedOn: after.completedAt.toISOString().slice(0, 10),
    });
  }
}

/**
 * Move a task to a new workflow state and emit the corresponding event.
 *
 * @param input - The org-scoped task, target state key, and acting actor.
 * @returns the updated row, or `null` when the task is missing/archived.
 * @throws When the state key doesn't exist in the owning team's workflow (the route surfaces
 *   this as an HTTP error; the automation handler catches it into a logged no-op).
 */
export async function setTaskState(input: SetTaskStateInput): Promise<TaskRow | null> {
  const rows = await db
    .select()
    .from(task)
    .where(
      and(
        eq(task.id, input.taskId),
        eq(task.organizationId, input.organizationId),
        isNull(task.archivedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const transition = await resolveStateTransition(input.organizationId, row.teamId, input.state);
  const mutation = await db.transaction((tx) =>
    writeTaskStateTransition(tx, {
      before: row,
      statusId: transition.statusId,
      state: transition.state,
      completedAt: transition.completedAt,
      canceledAt: transition.canceledAt,
    }),
  );
  /* v8 ignore next -- @preserve defensive: the select above proved the row exists + is active */
  if (!mutation) return null;
  await finishTaskStateTransition({ actorId: input.actorId }, mutation);
  return mutation.after;
}
