/** Focused task state-transition route mounted inside the task router. */
import { TaskOut, TaskStateUpdate } from '@docket/work/task-model';
import { Hono } from 'hono';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { labelsForSubject } from '../lib/labels';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { setTaskState } from '../lib/task-state';
import { zJson, zParam } from '../lib/validate';

import { assertTaskCapability, idParam, loadTask, toOut } from './task-helpers';

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
    const target = await loadTask(orgId, id);
    await assertTaskCapability(orgId, actorId, target, 'contribute');
    const next = await setTaskState({ organizationId: orgId, taskId: id, state, actorId });
    if (!next) throw new NotFoundError('Task not found');
    return ok(c, TaskOut, toOut(next, await labelsForSubject('task', orgId, next.id)));
  },
);
