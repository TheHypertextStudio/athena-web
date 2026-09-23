/** Focused task state-transition route mounted inside the task router. */
import { db } from '@docket/db';
import { TaskOut, TaskStateUpdate } from '@docket/work/task-model';
import { Hono } from 'hono';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { labelsForSubject } from '../lib/labels';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { recordTaskStateChange } from '../lib/provenance/task-change-sets';
import {
  applySubtaskCompletionPolicy,
  closeCompletingUserTaskTimers,
  emitCompletedTaskTimerStops,
  finishTaskStateTransition,
  writeTaskStateTransition,
} from '../lib/task-state';
import { zJson, zParam } from '../lib/validate';

import {
  assertTaskCapability,
  idParam,
  loadTask,
  resolveStateTransition,
  toOut,
  type TaskRow,
} from './task-helpers';

/** Input to {@link setTaskStateRecorded}. */
interface RecordedStateChangeInput {
  readonly orgId: string;
  readonly actorId: string;
  /** The active task as the caller loaded it. */
  readonly before: TaskRow;
  /** The target workflow-state key. */
  readonly state: string;
}

/**
 * Move a task to a workflow state and record the change set in the same transaction.
 *
 * @remarks
 * The same steps as `setTaskState` in `lib/task-state`, which automation and imports share. The
 * change set is recorded here, at the route, so that shared helper never records one.
 *
 * @param input - The task, the caller, and the target state.
 * @returns the updated task, or null when the task is no longer active.
 */
async function setTaskStateRecorded(input: RecordedStateChangeInput): Promise<TaskRow | null> {
  const { orgId, actorId, before } = input;
  const transition = await resolveStateTransition(orgId, before.teamId, input.state);
  const result = await db.transaction(async (tx) => {
    const mutation = await writeTaskStateTransition(tx, {
      before,
      statusId: transition.statusId,
      state: transition.state,
      completedAt: transition.completedAt,
      canceledAt: transition.canceledAt,
    });
    /* v8 ignore next -- @preserve defensive: the caller just loaded the task as active */
    if (!mutation) return null;
    const timerStops = await closeCompletingUserTaskTimers(tx, actorId, mutation);
    const cascades = await applySubtaskCompletionPolicy(tx, mutation);
    await recordTaskStateChange(tx, { orgId, actorId, mutation, cascades });
    return { mutation, timerStops, cascades };
  });
  /* v8 ignore next -- @preserve defensive: the caller just loaded the task as active */
  if (!result) return null;
  await finishTaskStateTransition({ actorId }, result.mutation);
  await emitCompletedTaskTimerStops(result.timerStops);
  for (const cascade of result.cascades) {
    await finishTaskStateTransition({ actorId: null }, cascade);
  }
  return result.mutation.after;
}

/** Change task state through the same transition service used by automation. */
export const taskStateRoutes = new Hono<AppEnv>().post(
  '/:id/state',
  apiDoc({
    tag: 'Tasks',
    summary: 'Change task state',
    capability: 'contribute',
    response: TaskOut,
    description: `Move a task to a new workflow state — the focused alternative to a full PATCH when only the state changes (e.g. a board drag-and-drop). Requires \`contribute\`. The \`state\` key must exist in the owning team's \`workflow_states\`; an unknown key is rejected.

The transition is resolved server-side: entering a terminal state derives \`completedAt\` (for the completed category) or \`canceledAt\` (for canceled), and leaving a terminal state clears them — these timestamps are authoritative and never client-set, so progress rollups stay correct. Side effect: emits a \`completed\` observation when the task lands in a completed state, otherwise a \`status_change\` observation carrying the new \`state\` in its payload. A missing/archived task 404s. Returns the updated {@link TaskOut}.`,
  }),
  zParam(idParam),
  zJson(TaskStateUpdate),
  async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const { state } = c.req.valid('json');
    const before = await loadTask(orgId, id);
    await assertTaskCapability(orgId, actorId, before, 'contribute');
    const next = await setTaskStateRecorded({ orgId, actorId, before, state });
    if (!next) throw new NotFoundError('Task not found');
    return ok(c, TaskOut, toOut(next, await labelsForSubject('task', orgId, next.id)));
  },
);
