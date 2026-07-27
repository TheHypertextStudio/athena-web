import { db, task, team } from '@docket/db';
import { Priority, TaskId } from '@docket/types';
import type { McpRegistrar } from './catalog';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { NotFoundError } from '../error';
import { enqueueSearchUpsert } from '../search/write-through';
import type { McpContext } from './auth';
import { jsonResult, runTool, scopedActor, authorize } from './result';
import {
  DESCRIPTOR_HINT,
  resolveDescriptor,
  resolveOptional,
  resolveWorkflowState,
} from './descriptors';
import { loadTask, orgIdParam, resolveStateTransition } from './tools-shared';

/** Register create_task, update_task, move_task on `server`. */
export function registerTaskCrudTools(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'create_task',
    {
      title: 'Create task',
      description:
        "Create a task in an organization. Every reference accepts a name as well as an id, so you can create a task on the Platform team assigned to Sarah without looking either up first. State defaults to the team's first workflow state.",
      inputSchema: {
        orgId: orgIdParam,
        teamId: z.string().min(1).describe(`The team the task belongs to. ${DESCRIPTOR_HINT}`),
        title: z.string().min(1).describe('A short one-line summary of the work.'),
        description: z.string().optional().describe('The full body, as markdown.'),
        state: z
          .string()
          .optional()
          .describe(
            'The workflow state, by key or display name ("in review" resolves to `in_review`). Defaults to the team\'s first state. Read the team resource to see the legal set.',
          ),
        priority: Priority.optional(),
        assigneeId: z
          .string()
          .optional()
          .describe(`Who is accountable for the work. ${DESCRIPTOR_HINT}`),
        projectId: z
          .string()
          .optional()
          .describe(`The project to file it under. ${DESCRIPTOR_HINT}`),
        dueDate: z.iso.date().optional().describe('The due date, as `YYYY-MM-DD`.'),
      },
      outputSchema: {
        id: z.string(),
        state: z.string(),
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

        const teamId = await resolveDescriptor(input.orgId, 'team', input.teamId, 'teamId');
        const assigneeId = await resolveOptional(
          input.orgId,
          'actor',
          input.assigneeId,
          'assigneeId',
        );
        const projectId = await resolveOptional(
          input.orgId,
          'project',
          input.projectId,
          'projectId',
        );

        const teamRows = await db
          .select()
          .from(team)
          .where(and(eq(team.id, teamId), eq(team.organizationId, input.orgId)))
          .limit(1);
        const teamRow = teamRows[0];
        /* v8 ignore next -- @preserve defensive: the descriptor resolver already proved it exists */
        if (!teamRow) throw new NotFoundError('Team not found');

        const firstState = teamRow.workflowStates[0];
        const requested = input.state ?? firstState?.key;
        const { state, completedAt, canceledAt } =
          firstState && requested
            ? await resolveStateTransition(
                input.orgId,
                teamId,
                await resolveWorkflowState(input.orgId, teamId, requested),
              )
            : { state: input.state ?? 'backlog', completedAt: null, canceledAt: null };

        const inserted = await db
          .insert(task)
          .values({
            organizationId: input.orgId,
            title: input.title,
            description: input.description,
            teamId,
            state,
            completedAt,
            canceledAt,
            priority: input.priority ?? 'none',
            assigneeId: assigneeId ?? undefined,
            projectId: projectId ?? undefined,
            dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
            source: 'native',
            createdBy: actorCtx.actorId,
          })
          .returning();
        const row = inserted[0];
        /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
        if (!row) throw new Error('task insert returned no row');
        await enqueueSearchUpsert(input.orgId, 'task', row.id);
        return jsonResult({ id: row.id, state: row.state });
      }),
  );

  server.registerTool(
    'update_task',
    {
      title: 'Update task',
      description:
        "Update a task's own fields. Only the fields you pass change. To move it to another team or project use move_task; to change who owns it use assign_task.",
      inputSchema: {
        orgId: orgIdParam,
        taskId: TaskId.describe('The task to update.'),
        title: z.string().min(1).optional().describe('A short one-line summary of the work.'),
        description: z.string().optional().describe('The full body, as markdown.'),
        state: z
          .string()
          .optional()
          .describe(
            'The workflow state, by key or display name ("in review" resolves to `in_review`). Validated against the owning team\'s states; the error lists the legal set.',
          ),
        priority: Priority.optional(),
        dueDate: z.iso.date().optional().describe('The due date, as `YYYY-MM-DD`.'),
      },
      outputSchema: {
        id: z.string(),
        state: z.string(),
        priority: z.string(),
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
        let statePatch: Awaited<ReturnType<typeof resolveStateTransition>> | undefined;
        if (input.state !== undefined) {
          const { teamId } = await loadTask(input.orgId, input.taskId);
          statePatch = await resolveStateTransition(
            input.orgId,
            teamId,
            await resolveWorkflowState(input.orgId, teamId, input.state),
          );
        }

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
        await enqueueSearchUpsert(input.orgId, 'task', row.id);
        return jsonResult({ id: row.id, state: row.state, priority: row.priority });
      }),
  );

  server.registerTool(
    'move_task',
    {
      title: 'Move task',
      description:
        'Reparent a task onto a different team and/or project. Pass a null projectId to detach it from its project without moving teams.',
      inputSchema: {
        orgId: orgIdParam,
        taskId: TaskId.describe('The task to move.'),
        teamId: z.string().optional().describe(`The team to move it to. ${DESCRIPTOR_HINT}`),
        projectId: z
          .string()
          .nullable()
          .optional()
          .describe(`The project to file it under, or null to detach it. ${DESCRIPTOR_HINT}`),
      },
      outputSchema: {
        id: z.string(),
        teamId: z.string(),
        projectId: z.string().nullable(),
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

        // Resolution doubles as the tenant check: a descriptor only ever matches within this org.
        const teamId = await resolveOptional(input.orgId, 'team', input.teamId, 'teamId');
        const projectId = await resolveOptional(
          input.orgId,
          'project',
          input.projectId,
          'projectId',
        );

        const updated = await db
          .update(task)
          .set({
            ...(teamId !== undefined ? { teamId } : {}),
            ...(projectId !== undefined ? { projectId } : {}),
          })
          .where(and(eq(task.id, input.taskId), eq(task.organizationId, input.orgId)))
          .returning();
        const row = updated[0];
        if (!row) throw new NotFoundError('Task not found');
        await enqueueSearchUpsert(input.orgId, 'task', row.id);
        return jsonResult({ id: row.id, teamId: row.teamId, projectId: row.projectId });
      }),
  );
}
