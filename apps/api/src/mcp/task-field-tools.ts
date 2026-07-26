import { db, task } from '@docket/db';
import type { McpRegistrar } from './catalog';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError } from '../error';
import { enqueueSearchUpsert } from '../search/write-through';
import type { McpContext } from './auth';
import { jsonResult, runTool, scopedActor, authorize } from './result';
import { DESCRIPTOR_HINT, resolveOptional, resolveWorkflowState } from './descriptors';
import { loadTask, orgIdParam, resolveStateTransition } from './tools-shared';

/** Register assign_task, set_task_delegate, set_task_state, add_subtask on `server`. */
export function registerTaskFieldTools(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'assign_task',
    {
      title: 'Assign task',
      description:
        'Set or clear who is accountable for a task. Pass null to unassign. This is ownership, not execution — to hand the doing to an agent while ownership stays put, use set_task_delegate.',
      inputSchema: {
        orgId: orgIdParam,
        taskId: z.string().min(1).describe('The task to assign, by id.'),
        assigneeId: z
          .string()
          .nullable()
          .describe(`Who becomes accountable, or null to unassign. ${DESCRIPTOR_HINT}`),
      },
      outputSchema: {
        id: z.string(),
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

        // Resolution doubles as the tenant check: a descriptor only matches within this org.
        const assigneeId = await resolveOptional(
          input.orgId,
          'actor',
          input.assigneeId,
          'assigneeId',
        );

        const updated = await db
          .update(task)
          .set({ assigneeId: assigneeId ?? null })
          .where(and(eq(task.id, input.taskId), eq(task.organizationId, input.orgId)))
          .returning();
        const row = updated[0];
        if (!row) throw new NotFoundError('Task not found');
        await enqueueSearchUpsert(input.orgId, 'task', row.id);
        return jsonResult({ id: row.id, assigneeId: row.assigneeId });
      }),
  );

  server.registerTool(
    'set_task_delegate',
    {
      title: 'Set task delegate',
      description:
        'Hand the doing of a task to an agent while accountability stays with its assignee. Pass null to take it back.',
      inputSchema: {
        orgId: orgIdParam,
        taskId: z.string().min(1).describe('The task to delegate, by id.'),
        delegateId: z
          .string()
          .nullable()
          .describe(`The agent that will do the work, or null to clear. ${DESCRIPTOR_HINT}`),
      },
      outputSchema: {
        id: z.string(),
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

        const delegateId = await resolveOptional(
          input.orgId,
          'actor',
          input.delegateId,
          'delegateId',
        );

        const updated = await db
          .update(task)
          .set({ delegateId: delegateId ?? null })
          .where(and(eq(task.id, input.taskId), eq(task.organizationId, input.orgId)))
          .returning();
        const row = updated[0];
        if (!row) throw new NotFoundError('Task not found');
        await enqueueSearchUpsert(input.orgId, 'task', row.id);
        return jsonResult({ id: row.id, delegateId: row.delegateId });
      }),
  );

  server.registerTool(
    'set_task_state',
    {
      title: 'Set task state',
      description:
        'Move a task to a workflow state. Accepts the key or the display name, so "in review" resolves to `in_review`; an unknown value comes back with the team\'s legal states listed.',
      inputSchema: {
        orgId: orgIdParam,
        taskId: z.string().min(1).describe('The task to transition, by id.'),
        state: z.string().min(1).describe('The target state, by key or display name.'),
      },
      outputSchema: {
        id: z.string(),
        state: z.string(),
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
        const transition = await resolveStateTransition(
          input.orgId,
          row.teamId,
          await resolveWorkflowState(input.orgId, row.teamId, input.state),
        );

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
        await enqueueSearchUpsert(input.orgId, 'task', next.id);
        return jsonResult({ id: next.id, state: next.state });
      }),
  );

  server.registerTool(
    'add_subtask',
    {
      title: 'Add subtask',
      description:
        "Create a subtask under a parent task. It inherits the parent's team and project, so only a title is needed.",
      inputSchema: {
        orgId: orgIdParam,
        parentTaskId: z.string().min(1).describe('The task this one sits under, by id.'),
        title: z.string().min(1).describe('A short one-line summary of the subtask.'),
      },
      outputSchema: {
        id: z.string(),
        parentTaskId: z.string(),
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
        await enqueueSearchUpsert(input.orgId, 'task', row.id);
        return jsonResult({ id: row.id, parentTaskId: row.parentTaskId });
      }),
  );
}
