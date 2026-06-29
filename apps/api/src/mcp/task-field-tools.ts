import { actor, db, task } from '@docket/db';
import type { McpRegistrar } from './catalog';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError } from '../error';
import type { McpContext } from './auth';
import { jsonResult, runTool, scopedActor, authorize } from './result';
import { assertRefInOrg, loadTask, resolveStateTransition } from './tools-shared';

/** Register assign_task, set_task_delegate, set_task_state, add_subtask on `server`. */
export function registerTaskFieldTools(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'assign_task',
    {
      title: 'Assign task',
      description: "Set or clear a task's assignee (pass a null assigneeId to unassign).",
      inputSchema: {
        orgId: z.string().min(1),
        taskId: z.string().min(1),
        assigneeId: z.string().nullable(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:write');
        await authorize(actorCtx, 'assign', { kind: 'task', id: input.taskId, orgId: input.orgId });

        if (input.assigneeId !== null) {
          const actorRows = await db
            .select({ id: actor.id })
            .from(actor)
            .where(and(eq(actor.id, input.assigneeId), eq(actor.organizationId, input.orgId)))
            .limit(1);
          if (!actorRows[0]) throw new NotFoundError('Assignee not found');
        }

        const updated = await db
          .update(task)
          .set({ assigneeId: input.assigneeId })
          .where(and(eq(task.id, input.taskId), eq(task.organizationId, input.orgId)))
          .returning();
        const row = updated[0];
        if (!row) throw new NotFoundError('Task not found');
        return jsonResult({ id: row.id, assigneeId: row.assigneeId });
      }),
  );

  server.registerTool(
    'set_task_delegate',
    {
      title: 'Set task delegate',
      description:
        'Hand the doing of a task to an agent while ownership stays (pass null to clear).',
      inputSchema: {
        orgId: z.string().min(1),
        taskId: z.string().min(1),
        delegateId: z.string().nullable(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        // Changing a delegate is an `assign`-level act (permissions §2), exactly as the
        // tasks router PATCH gates assignee/delegate changes.
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:write');
        await authorize(actorCtx, 'assign', { kind: 'task', id: input.taskId, orgId: input.orgId });

        if (input.delegateId !== null) {
          await assertRefInOrg(actor, input.orgId, input.delegateId, 'Delegate not found');
        }

        const updated = await db
          .update(task)
          .set({ delegateId: input.delegateId })
          .where(and(eq(task.id, input.taskId), eq(task.organizationId, input.orgId)))
          .returning();
        const row = updated[0];
        if (!row) throw new NotFoundError('Task not found');
        return jsonResult({ id: row.id, delegateId: row.delegateId });
      }),
  );

  server.registerTool(
    'set_task_state',
    {
      title: 'Set task state',
      description:
        "Transition a task to a workflow state (validated against the team's workflow_states).",
      inputSchema: {
        orgId: z.string().min(1),
        taskId: z.string().min(1),
        state: z.string().min(1),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:write');
        await authorize(actorCtx, 'contribute', {
          kind: 'task',
          id: input.taskId,
          orgId: input.orgId,
        });
        const row = await loadTask(input.orgId, input.taskId);
        const transition = await resolveStateTransition(input.orgId, row.teamId, input.state);

        const updated = await db
          .update(task)
          .set({
            state: transition.state,
            completedAt: transition.completedAt,
            canceledAt: transition.canceledAt,
          })
          .where(and(eq(task.id, input.taskId), eq(task.organizationId, input.orgId)))
          .returning();
        const next = updated[0];
        /* v8 ignore next -- @preserve defensive: loadTask above proved the row exists */
        if (!next) throw new NotFoundError('Task not found');
        return jsonResult({ id: next.id, state: next.state });
      }),
  );

  server.registerTool(
    'add_subtask',
    {
      title: 'Add subtask',
      description: "Create a subtask under a parent task (inherits the parent's team + project).",
      inputSchema: {
        orgId: z.string().min(1),
        parentTaskId: z.string().min(1),
        title: z.string().min(1),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:write');
        await authorize(actorCtx, 'contribute', {
          kind: 'task',
          id: input.parentTaskId,
          orgId: input.orgId,
        });
        const parent = await loadTask(input.orgId, input.parentTaskId);

        const inserted = await db
          .insert(task)
          .values({
            organizationId: input.orgId,
            title: input.title,
            teamId: parent.teamId,
            state: parent.state,
            projectId: parent.projectId,
            parentTaskId: parent.id,
            source: 'native',
            createdBy: actorCtx.actorId,
          })
          .returning();
        const row = inserted[0];
        /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
        if (!row) throw new Error('subtask insert returned no row');
        return jsonResult({ id: row.id, parentTaskId: row.parentTaskId });
      }),
  );
}
