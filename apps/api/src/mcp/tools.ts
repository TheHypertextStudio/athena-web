/**
 * `@docket/api` — MCP mutation tools.
 *
 * @remarks
 * Each tool mirrors the corresponding RPC router's domain logic against the SAME
 * `db` and reuses `@docket/types` field validators where they fit. Every handler
 * authorizes via {@link authorize} (→ {@link canActor}) BEFORE writing — org-scoped
 * mutations check the org root, resource-scoped mutations check the target resource —
 * and returns the MCP result (or the `isError` contract on failure) via
 * {@link runTool}. Registration is parameterized by the caller's {@link McpContext}
 * so a fresh, identity-bound server is built per request (stateless transport).
 */
import {
  actor,
  agent,
  agentSession,
  db,
  initiative,
  integration,
  program,
  project,
  sessionActivity,
  task,
  team,
  update,
} from '@docket/db';
import { Health, Priority, SessionTrigger } from '@docket/types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { ConflictError, NotFoundError } from '../error';
import type { McpContext } from './auth';
import { resolveActor } from './auth';
import { authorize, jsonResult, runTool } from './result';

/** The subject table whose `health` an update of each subject type also writes to. */
const subjectTable = { project, program, initiative } as const;

/**
 * Register every Docket mutation tool on `server`, bound to the calling user.
 *
 * @remarks
 * Tools resolve the caller's per-org {@link McpActor} from `ctx` on each invocation,
 * so authorization is always evaluated against the live identity. Annotations declare
 * each tool's side-effect profile (all are non-read-only, non-idempotent writes;
 * destructive ones — e.g. {@link rejectAction} — set `destructiveHint`).
 *
 * @param server - The per-request {@link McpServer} to register tools on.
 * @param ctx - The authenticated MCP caller.
 */
export function registerTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    'create_task',
    {
      title: 'Create task',
      description:
        'Create a task in an organization (state defaults to the team’s first workflow state).',
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
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await resolveActor(ctx, input.orgId);
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

        const state = input.state ?? teamRow.workflowStates[0]?.key ?? 'backlog';
        const inserted = await db
          .insert(task)
          .values({
            organizationId: input.orgId,
            title: input.title,
            description: input.description,
            teamId: input.teamId,
            state,
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
      description: 'Update a task’s fields (title, description, state, priority, due date).',
      inputSchema: {
        orgId: z.string().min(1),
        taskId: z.string().min(1),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        state: z.string().optional(),
        priority: Priority.optional(),
        dueDate: z.iso.date().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await resolveActor(ctx, input.orgId);
        await authorize(actorCtx, 'contribute', {
          kind: 'task',
          id: input.taskId,
          orgId: input.orgId,
        });

        const updated = await db
          .update(task)
          .set({
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.state !== undefined ? { state: input.state } : {}),
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
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await resolveActor(ctx, input.orgId);
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

  server.registerTool(
    'assign_task',
    {
      title: 'Assign task',
      description: 'Set or clear a task’s assignee (pass a null assigneeId to unassign).',
      inputSchema: {
        orgId: z.string().min(1),
        taskId: z.string().min(1),
        assigneeId: z.string().nullable(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await resolveActor(ctx, input.orgId);
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
    'create_project',
    {
      title: 'Create project',
      description: 'Create a project within an organization.',
      inputSchema: {
        orgId: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional(),
        leadId: z.string().optional(),
        teamId: z.string().optional(),
        startDate: z.iso.date().optional(),
        targetDate: z.iso.date().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await resolveActor(ctx, input.orgId);
        await authorize(actorCtx, 'contribute', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });

        const inserted = await db
          .insert(project)
          .values({
            organizationId: input.orgId,
            name: input.name,
            description: input.description,
            leadId: input.leadId,
            teamId: input.teamId,
            startDate: input.startDate ? new Date(input.startDate) : undefined,
            targetDate: input.targetDate ? new Date(input.targetDate) : undefined,
            createdBy: actorCtx.actorId,
          })
          .returning();
        const row = inserted[0];
        /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
        if (!row) throw new Error('project insert returned no row');
        return jsonResult({ id: row.id, name: row.name });
      }),
  );

  server.registerTool(
    'post_update',
    {
      title: 'Post status update',
      description:
        'Post a status update on a project/program/initiative; the latest health also sets the subject’s current health.',
      inputSchema: {
        orgId: z.string().min(1),
        subjectType: z.enum(['project', 'program', 'initiative']),
        subjectId: z.string().min(1),
        body: z.string().min(1),
        health: Health.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await resolveActor(ctx, input.orgId);
        await authorize(actorCtx, 'contribute', {
          kind: input.subjectType,
          id: input.subjectId,
          orgId: input.orgId,
        });

        const row = await db.transaction(async (tx) => {
          const inserted = await tx
            .insert(update)
            .values({
              organizationId: input.orgId,
              authorId: actorCtx.actorId,
              subjectType: input.subjectType,
              subjectId: input.subjectId,
              health: input.health,
              body: input.body,
              createdBy: actorCtx.actorId,
            })
            .returning();
          const created = inserted[0];
          /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
          if (!created) throw new Error('update insert returned no row');

          if (input.health !== undefined) {
            const tbl = subjectTable[input.subjectType];
            await tx
              .update(tbl)
              .set({ health: input.health })
              .where(and(eq(tbl.id, input.subjectId), eq(tbl.organizationId, input.orgId)));
          }
          return created;
        });
        return jsonResult({ id: row.id, subjectType: row.subjectType, subjectId: row.subjectId });
      }),
  );

  server.registerTool(
    'link_external',
    {
      title: 'Link external item',
      description:
        'Materialize an external item as a linked task carrying its provenance, idempotently.',
      inputSchema: {
        orgId: z.string().min(1),
        integrationId: z.string().min(1),
        teamId: z.string().min(1),
        title: z.string().min(1),
        externalId: z.string().min(1),
        description: z.string().optional(),
        externalUrl: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await resolveActor(ctx, input.orgId);
        await authorize(actorCtx, 'contribute', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });

        const integrationRows = await db
          .select({ id: integration.id })
          .from(integration)
          .where(
            and(
              eq(integration.id, input.integrationId),
              eq(integration.organizationId, input.orgId),
            ),
          )
          .limit(1);
        if (!integrationRows[0]) throw new NotFoundError('Integration not found');

        const teamRows = await db
          .select({ workflowStates: team.workflowStates })
          .from(team)
          .where(and(eq(team.id, input.teamId), eq(team.organizationId, input.orgId)))
          .limit(1);
        const teamRow = teamRows[0];
        if (!teamRow) throw new NotFoundError('Team not found');

        const existing = await db
          .select({ id: task.id })
          .from(task)
          .where(
            and(
              eq(task.organizationId, input.orgId),
              eq(task.source, 'linked'),
              eq(task.sourceIntegrationId, input.integrationId),
              eq(task.externalId, input.externalId),
            ),
          )
          .limit(1);
        if (existing[0]) return jsonResult({ id: existing[0].id, alreadyLinked: true });

        const state = teamRow.workflowStates[0]?.key ?? 'backlog';
        const inserted = await db
          .insert(task)
          .values({
            organizationId: input.orgId,
            title: input.title,
            description: input.description ?? null,
            teamId: input.teamId,
            state,
            source: 'linked',
            sourceIntegrationId: input.integrationId,
            externalId: input.externalId,
            externalUrl: input.externalUrl ?? null,
            sourceSyncMode: 'mirror',
            createdBy: actorCtx.actorId,
          })
          .returning();
        const row = inserted[0];
        /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
        if (!row) throw new Error('linked task insert returned no row');
        return jsonResult({ id: row.id, alreadyLinked: false });
      }),
  );

  server.registerTool(
    'trigger_agent',
    {
      title: 'Trigger agent',
      description:
        'Create an agent session for a registered agent (optionally on a task) to be run.',
      inputSchema: {
        orgId: z.string().min(1),
        agentId: z.string().min(1),
        taskId: z.string().optional(),
        trigger: SessionTrigger.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await resolveActor(ctx, input.orgId);
        await authorize(actorCtx, 'contribute', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });

        const agentRows = await db
          .select({ id: agent.id })
          .from(agent)
          .where(and(eq(agent.id, input.agentId), eq(agent.organizationId, input.orgId)))
          .limit(1);
        if (!agentRows[0]) throw new NotFoundError('Agent not found');

        if (input.taskId !== undefined) {
          await authorize(actorCtx, 'contribute', {
            kind: 'task',
            id: input.taskId,
            orgId: input.orgId,
          });
          const taskRows = await db
            .select({ id: task.id })
            .from(task)
            .where(and(eq(task.id, input.taskId), eq(task.organizationId, input.orgId)))
            .limit(1);
          if (!taskRows[0]) throw new NotFoundError('Task not found');
        }

        const inserted = await db
          .insert(agentSession)
          .values({
            organizationId: input.orgId,
            agentId: input.agentId,
            taskId: input.taskId,
            trigger: input.trigger ?? 'delegation',
            status: 'pending',
            initiatorId: actorCtx.actorId,
          })
          .returning();
        const row = inserted[0];
        /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
        if (!row) throw new Error('agent session insert returned no row');
        return jsonResult({ id: row.id, status: row.status });
      }),
  );

  server.registerTool(
    'approve_action',
    {
      title: 'Approve agent action',
      description:
        'Approve the latest proposed action of an awaiting-approval agent session (resumes it).',
      inputSchema: { orgId: z.string().min(1), sessionId: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await resolveActor(ctx, input.orgId);
        await authorize(actorCtx, 'contribute', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });
        const row = await resolveAction(input.orgId, input.sessionId, 'approved');
        return jsonResult({ id: row.id, status: row.status });
      }),
  );

  server.registerTool(
    'reject_action',
    {
      title: 'Reject agent action',
      description:
        'Reject the latest proposed action of an awaiting-approval agent session (cancels it).',
      inputSchema: { orgId: z.string().min(1), sessionId: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await resolveActor(ctx, input.orgId);
        await authorize(actorCtx, 'contribute', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });
        const row = await resolveAction(input.orgId, input.sessionId, 'rejected');
        return jsonResult({ id: row.id, status: row.status });
      }),
  );
}

/**
 * Flip the latest `awaiting_approval` action of a session and move it forward.
 *
 * @remarks
 * Mirrors the agent-sessions router's `resolveAction`: on approve the session goes
 * `running`; on reject it is `canceled` (with `endedAt`), atomically with the
 * action's `approvalStatus`.
 *
 * @param orgId - The active organization id.
 * @param sessionId - The session being resolved.
 * @param decision - Whether to approve or reject.
 * @returns the updated session row.
 * @throws {NotFoundError} When the session is not found in the org.
 * @throws {ConflictError} When the session is not awaiting approval / has no proposed action.
 */
async function resolveAction(
  orgId: string,
  sessionId: string,
  decision: 'approved' | 'rejected',
): Promise<typeof agentSession.$inferSelect> {
  return db.transaction(async (tx) => {
    const sessionRows = await tx
      .select()
      .from(agentSession)
      .where(and(eq(agentSession.id, sessionId), eq(agentSession.organizationId, orgId)))
      .limit(1);
    const session = sessionRows[0];
    if (!session) throw new NotFoundError('Session not found');
    if (session.status !== 'awaiting_approval') {
      throw new ConflictError('Session is not awaiting approval');
    }

    const pending = await tx
      .select()
      .from(sessionActivity)
      .where(
        and(
          eq(sessionActivity.sessionId, sessionId),
          eq(sessionActivity.type, 'action'),
          eq(sessionActivity.approvalStatus, 'proposed'),
        ),
      )
      .orderBy(desc(sessionActivity.createdAt))
      .limit(1);
    const action = pending[0];
    if (!action) throw new ConflictError('No proposed action awaiting approval');

    await tx
      .update(sessionActivity)
      .set({ approvalStatus: decision })
      .where(eq(sessionActivity.id, action.id));

    const nextStatus = decision === 'approved' ? 'running' : 'canceled';
    const [updated] = await tx
      .update(agentSession)
      .set({
        status: nextStatus,
        ...(decision === 'rejected' ? { endedAt: new Date() } : {}),
      })
      .where(and(eq(agentSession.id, sessionId), eq(agentSession.organizationId, orgId)))
      .returning();
    /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
    if (!updated) throw new Error('session update returned no row');
    return updated;
  });
}
