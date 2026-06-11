import { actor, db, project, task, team } from '@docket/db';
import { Priority } from '@docket/types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError } from '../error';
import type { McpContext } from './auth';
import { jsonResult, runTool, scopedActor, authorize } from './result';
import { assertRefInOrg, loadTask, resolveStateTransition } from './tools-shared';

/** Register create_task, update_task, move_task on `server`. */
export function registerTaskCrudTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    'create_task',
    {
      title: 'Create task',
      description:
        "Create a task in an organization (state defaults to the team's first workflow state).",
      inputSchema: {
        orgId: z.string().min(1),
        teamId: z.string().min(1),
        title: z.string().min(1),
        description: z.string().optional(),
        state: z.string().optional(),
        priority: Priority.optional(),
        assigneeId: z.string().optional(),
        projectId: z.string().optional(),
        dueDate: z.iso.date().optional(),
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
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });

        const teamRows = await db
          .select()
          .from(team)
          .where(and(eq(team.id, input.teamId), eq(team.organizationId, input.orgId)))
          .limit(1);
        const teamRow = teamRows[0];
        if (!teamRow) throw new NotFoundError('Team not found');

        await assertRefInOrg(actor, input.orgId, input.assigneeId, 'Assignee not found');
        await assertRefInOrg(project, input.orgId, input.projectId, 'Project not found');

        const firstState = teamRow.workflowStates[0];
        const { state, completedAt, canceledAt } = firstState
          ? await resolveStateTransition(input.orgId, input.teamId, input.state ?? firstState.key)
          : { state: input.state ?? 'backlog', completedAt: null, canceledAt: null };

        const inserted = await db
          .insert(task)
          .values({
            organizationId: input.orgId,
            title: input.title,
            description: input.description,
            teamId: input.teamId,
            state,
            completedAt,
            canceledAt,
            priority: input.priority ?? 'none',
            assigneeId: input.assigneeId,
            projectId: input.projectId,
            dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
            source: 'native',
            createdBy: actorCtx.actorId,
          })
          .returning();
        const row = inserted[0];
        /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
        if (!row) throw new Error('task insert returned no row');
        return jsonResult({ id: row.id, state: row.state });
      }),
  );

  server.registerTool(
    'update_task',
    {
      title: 'Update task',
      description: "Update a task's fields (title, description, state, priority, due date).",
      inputSchema: {
        orgId: z.string().min(1),
        taskId: z.string().min(1),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        state: z.string().optional(),
        priority: Priority.optional(),
        dueDate: z.iso.date().optional(),
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

        // `state` is validated against the team's workflow_states and carries terminal
        // timestamp derivation, identical to the tasks router PATCH — otherwise an
        // unknown state key, or a done/canceled state with a null completedAt/canceledAt,
        // corrupts project progress.
        const statePatch =
          input.state !== undefined
            ? await resolveStateTransition(
                input.orgId,
                (await loadTask(input.orgId, input.taskId)).teamId,
                input.state,
              )
            : undefined;

        const updated = await db
          .update(task)
          .set({
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(statePatch !== undefined
              ? {
                  state: statePatch.state,
                  completedAt: statePatch.completedAt,
                  canceledAt: statePatch.canceledAt,
                }
              : {}),
            ...(input.priority !== undefined ? { priority: input.priority } : {}),
            ...(input.dueDate !== undefined ? { dueDate: new Date(input.dueDate) } : {}),
          })
          .where(and(eq(task.id, input.taskId), eq(task.organizationId, input.orgId)))
          .returning();
        const row = updated[0];
        if (!row) throw new NotFoundError('Task not found');
        return jsonResult({ id: row.id, state: row.state, priority: row.priority });
      }),
  );

  server.registerTool(
    'move_task',
    {
      title: 'Move task',
      description: 'Reparent a task onto a different team and/or project.',
      inputSchema: {
        orgId: z.string().min(1),
        taskId: z.string().min(1),
        teamId: z.string().optional(),
        projectId: z.string().nullable().optional(),
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

        if (input.teamId !== undefined) {
          const teamRows = await db
            .select({ id: team.id })
            .from(team)
            .where(and(eq(team.id, input.teamId), eq(team.organizationId, input.orgId)))
            .limit(1);
          if (!teamRows[0]) throw new NotFoundError('Team not found');
        }
        if (typeof input.projectId === 'string') {
          const projectRows = await db
            .select({ id: project.id })
            .from(project)
            .where(and(eq(project.id, input.projectId), eq(project.organizationId, input.orgId)))
            .limit(1);
          if (!projectRows[0]) throw new NotFoundError('Project not found');
        }

        const updated = await db
          .update(task)
          .set({
            ...(input.teamId !== undefined ? { teamId: input.teamId } : {}),
            ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
          })
          .where(and(eq(task.id, input.taskId), eq(task.organizationId, input.orgId)))
          .returning();
        const row = updated[0];
        if (!row) throw new NotFoundError('Task not found');
        return jsonResult({ id: row.id, teamId: row.teamId, projectId: row.projectId });
      }),
  );
}
