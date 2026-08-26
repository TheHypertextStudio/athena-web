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
import { db, organization, task } from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';
import { isTerminalCategory, type WorkStatusCategory } from '@docket/types';

import { resolveStateTransition } from '../routes/task-helpers';
import { emitEvent, emitEventStrict } from '../routes/event-emit';
import { enqueueSearchUpsert } from '../search/write-through';
import { ConflictError, NotFoundError } from '../error';

import {
  diffTaskFields,
  recordTaskChanges,
  resolveTaskChangeLabels,
  subtaskCompletionChange,
} from './task-audit';
import { advanceCompletedProcessTask } from './recurrence/advance';
import { loadStatusSets } from './work-status';

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

/** The task-row change caused by beginning a timer on existing work. */
export interface TaskTimerStartMutation {
  /** The durable row mutation, absent when the task was already assigned and started. */
  readonly mutation: TaskStateMutation | null;
  /** Whether the timer moved an unstarted task into a started workflow state. */
  readonly stateChanged: boolean;
  /** Whether the timer claimed an otherwise-unassigned task for its starter. */
  readonly assigneeChanged: boolean;
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
    /** Preserve a provider timestamp when a sync transition must remain clean after this write. */
    readonly updatedAt?: Date;
    /** Internal cascade writes pass true; every direct transition clears the marker. */
    readonly autoCompletedBySubtasks?: boolean;
    /** Status replacement also has to move archived rows before the old status can be deleted. */
    readonly includeArchived?: boolean;
    /** A task-bound timer may claim an unassigned task without touching an existing owner. */
    readonly assigneeId?: string | null;
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
      autoCompletedBySubtasks: input.autoCompletedBySubtasks ?? false,
      ...(input.updatedAt === undefined ? {} : { updatedAt: input.updatedAt }),
      ...(input.assigneeId === undefined ? {} : { assigneeId: input.assigneeId }),
    })
    .where(
      and(
        eq(task.id, input.before.id),
        eq(task.organizationId, input.before.organizationId),
        ...(input.includeArchived ? [] : [isNull(task.archivedAt)]),
      ),
    )
    .returning();
  const after = updated[0];
  return after ? { before: input.before, after } : null;
}

/**
 * Lock and prepare an existing task for a live, task-anchored timer.
 *
 * The authorization boundary has already resolved the task before this function runs. This second
 * read deliberately locks the row inside the timer transaction, so a concurrent reassignment or
 * completion cannot leave a timer behind after the task change failed. Timer start may claim only
 * an unassigned task and advances only the canonical `unstarted` status category. Backlog is not
 * silently treated as committed work, and a terminal task is never reopened or claimed for time
 * tracking. The timer still records real effort on completed work.
 */
export async function prepareTaskTimerStart(
  tx: TaskStateTransaction,
  input: { readonly organizationId: string; readonly taskId: string; readonly actorId: string },
): Promise<TaskTimerStartMutation> {
  const rows = await tx
    .select()
    .from(task)
    .where(
      and(
        eq(task.id, input.taskId),
        eq(task.organizationId, input.organizationId),
        isNull(task.archivedAt),
      ),
    )
    .for('update');
  const before = rows[0];
  if (!before) throw new NotFoundError('Task not found');

  const statuses = await loadStatusSets(
    before.organizationId,
    { entityTypes: ['task'], teamIds: [before.teamId] },
    tx,
  );
  const current = statuses.byId(before.statusId);
  if (!current) throw new ConflictError('Task has no current workflow status');
  if (
    isTerminalCategory(current.category) ||
    before.completedAt !== null ||
    before.canceledAt !== null
  ) {
    return { mutation: null, stateChanged: false, assigneeChanged: false };
  }

  const next =
    current.category === 'unstarted'
      ? statuses.for('task', before.teamId).find((status) => status.category === 'started')
      : current;
  if (!next) throw new ConflictError('The task workflow has no started status');

  const stateChanged = next.id !== before.statusId;
  const assigneeChanged = before.assigneeId === null;
  if (!stateChanged && !assigneeChanged) {
    return { mutation: null, stateChanged: false, assigneeChanged: false };
  }
  const mutation = await writeTaskStateTransition(tx, {
    before,
    statusId: next.id,
    state: next.key,
    completedAt: before.completedAt,
    canceledAt: before.canceledAt,
    autoCompletedBySubtasks: before.autoCompletedBySubtasks,
    ...(assigneeChanged ? { assigneeId: input.actorId } : {}),
  });
  if (!mutation) throw new NotFoundError('Task not found');
  return { mutation, stateChanged, assigneeChanged };
}

/** Publish a timer's automatic claim and start-state changes after its shared transaction commits. */
export async function finishTaskTimerStart(
  input: { readonly actorId: string },
  timerStart: TaskTimerStartMutation,
): Promise<void> {
  const mutation = timerStart.mutation;
  if (!mutation) return;

  if (timerStart.stateChanged) {
    await finishTaskStateTransition(input, mutation);
  } else {
    const changes = await resolveTaskChangeLabels(
      mutation.after.organizationId,
      diffTaskFields(mutation.before, mutation.after),
    );
    await recordTaskChanges({
      organizationId: mutation.after.organizationId,
      taskId: mutation.after.id,
      title: mutation.after.title,
      actorId: input.actorId,
      changes,
    });
    await enqueueSearchUpsert(mutation.after.organizationId, 'task', mutation.after.id);
  }

  if (timerStart.assigneeChanged) {
    await emitEvent({
      organizationId: mutation.after.organizationId,
      kind: 'assignment',
      actorId: input.actorId,
      title: mutation.after.title,
      subject: { type: 'task', id: mutation.after.id, title: mutation.after.title },
    });
  }
}

/** Find the first status in a task's workflow that has the requested category. */
async function statusForCategory(
  tx: TaskStateTransaction,
  organizationId: string,
  teamId: string,
  predicate: (category: WorkStatusCategory) => boolean,
) {
  const sets = await loadStatusSets(
    organizationId,
    { entityTypes: ['task'], teamIds: [teamId] },
    tx,
  );
  return sets.for('task', teamId).find((status) => predicate(status.category));
}

/**
 * Apply the direct-child completion policy after a state transition inside its transaction.
 *
 * A parent is only evaluated from its direct children. A completed or canceled child has ended,
 * so it cannot block the parent. The marker prevents a child reopening from undoing a human's
 * explicit completion of the parent. Each cascade mutation is returned for normal post-commit
 * activity, search, recurrence, and event side effects.
 */
export async function applySubtaskCompletionPolicy(
  tx: TaskStateTransaction,
  mutation: TaskStateMutation,
): Promise<TaskStateMutation[]> {
  return applySubtaskCompletionPolicyForParents(tx, mutation.after.organizationId, [
    mutation.after.parentTaskId,
  ]);
}

/**
 * Apply the direct-child completion policy after changing one or more hierarchy edges.
 *
 * Each parent is evaluated from its current direct children, so the same path covers a child
 * changing state, arriving under a parent, and leaving one. A parent that this policy completed
 * reopens only when it again owns active direct work; a person-completed parent stays complete.
 */
export async function applySubtaskCompletionPolicyForParents(
  tx: TaskStateTransaction,
  organizationId: string,
  parentTaskIds: readonly (string | null)[],
): Promise<TaskStateMutation[]> {
  const settings = await tx
    .select({ autoCompleteParentTasks: organization.autoCompleteParentTasks })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);
  if (!settings[0]?.autoCompleteParentTasks) return [];

  const cascades: TaskStateMutation[] = [];
  const evaluated = new Set<string>();
  const pending = [...new Set(parentTaskIds.filter((id): id is string => id !== null))];
  while (pending.length > 0) {
    const parentId = pending.shift();
    if (!parentId || evaluated.has(parentId)) continue;
    evaluated.add(parentId);
    const parentRows = await tx
      .select()
      .from(task)
      .where(
        and(
          eq(task.id, parentId),
          eq(task.organizationId, organizationId),
          isNull(task.archivedAt),
        ),
      )
      .for('update');
    const parent = parentRows[0];
    if (!parent) continue;

    const children = await tx
      .select({ completedAt: task.completedAt, canceledAt: task.canceledAt })
      .from(task)
      .where(
        and(
          eq(task.parentTaskId, parent.id),
          eq(task.organizationId, parent.organizationId),
          isNull(task.archivedAt),
        ),
      );
    const everyChildEnded =
      children.length > 0 &&
      children.every((child) => child.completedAt !== null || child.canceledAt !== null);

    if (everyChildEnded && parent.completedAt === null && parent.canceledAt === null) {
      const completed = await statusForCategory(
        tx,
        parent.organizationId,
        parent.teamId,
        (category) => category === 'completed',
      );
      if (!completed) continue;
      const next = await writeTaskStateTransition(tx, {
        before: parent,
        statusId: completed.id,
        state: completed.key,
        completedAt: new Date(),
        canceledAt: null,
        autoCompletedBySubtasks: true,
      });
      if (!next) continue;
      cascades.push(next);
      if (next.after.parentTaskId !== null) pending.push(next.after.parentTaskId);
      continue;
    }

    if (!everyChildEnded && parent.autoCompletedBySubtasks && parent.completedAt !== null) {
      const reopened = await statusForCategory(
        tx,
        parent.organizationId,
        parent.teamId,
        (category) => !isTerminalCategory(category),
      );
      if (!reopened) continue;
      const next = await writeTaskStateTransition(tx, {
        before: parent,
        statusId: reopened.id,
        state: reopened.key,
        completedAt: null,
        canceledAt: null,
      });
      if (!next) continue;
      cascades.push(next);
      if (next.after.parentTaskId !== null) pending.push(next.after.parentTaskId);
      continue;
    }
  }
  return cascades;
}

/** Publish the stream, search, and process consequences after durable history is committed. */
export async function finishTaskStateConsequences(
  input: {
    readonly actorId: string | null;
    readonly enqueueSearch?: boolean;
    readonly occurredAt?: Date;
    readonly dedupeToken?: string;
    readonly strict?: boolean;
  },
  mutation: TaskStateMutation,
): Promise<void> {
  const { before, after } = mutation;
  await (input.strict ? emitEventStrict : emitEvent)({
    organizationId: after.organizationId,
    kind: after.completedAt ? 'completed' : 'status_change',
    actorId: input.actorId,
    ...(input.occurredAt && { occurredAt: input.occurredAt }),
    title: after.title,
    subject: { type: 'task', id: after.id, title: after.title },
    detail: { schema: 'docket.state_change', fromState: before.state, toState: after.state },
    ...(input.dedupeToken && { dedupeToken: input.dedupeToken }),
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

/** Publish durable history and every post-commit consequence for a state transition. */
export async function finishTaskStateTransition(
  input: { readonly actorId: string | null; readonly enqueueSearch?: boolean },
  mutation: TaskStateMutation,
): Promise<void> {
  const { before, after } = mutation;
  const changes = await resolveTaskChangeLabels(
    after.organizationId,
    diffTaskFields(before, after),
  );
  if (after.autoCompletedBySubtasks && before.completedAt === null && after.completedAt !== null) {
    changes.push(subtaskCompletionChange());
  }
  await recordTaskChanges({
    organizationId: after.organizationId,
    taskId: after.id,
    title: after.title,
    actorId: input.actorId,
    changes,
  });
  await finishTaskStateConsequences(input, mutation);
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
  const result = await db.transaction(async (tx) => {
    const mutation = await writeTaskStateTransition(tx, {
      before: row,
      statusId: transition.statusId,
      state: transition.state,
      completedAt: transition.completedAt,
      canceledAt: transition.canceledAt,
    });
    if (!mutation) return null;
    return { mutation, cascades: await applySubtaskCompletionPolicy(tx, mutation) };
  });
  /* v8 ignore next -- @preserve defensive: the select above proved the row exists + is active */
  if (!result) return null;
  await finishTaskStateTransition({ actorId: input.actorId }, result.mutation);
  for (const cascade of result.cascades) {
    await finishTaskStateTransition({ actorId: null }, cascade);
  }
  return result.mutation.after;
}
