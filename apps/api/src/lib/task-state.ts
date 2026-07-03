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
  const updated = await db
    .update(task)
    .set({
      state: transition.state,
      completedAt: transition.completedAt,
      canceledAt: transition.canceledAt,
    })
    .where(
      and(
        eq(task.id, input.taskId),
        eq(task.organizationId, input.organizationId),
        isNull(task.archivedAt),
      ),
    )
    .returning();
  const next = updated[0];
  /* v8 ignore next -- @preserve defensive: the select above proved the row exists + is active */
  if (!next) return null;

  await emitEvent({
    organizationId: input.organizationId,
    kind: transition.completedAt ? 'completed' : 'status_change',
    actorId: input.actorId,
    title: next.title,
    subject: { type: 'task', id: next.id, title: next.title },
    detail: { schema: 'docket.state_change', fromState: row.state, toState: next.state },
  });
  await enqueueSearchUpsert(input.organizationId, 'task', next.id);
  return next;
}
