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
 *
 * Every tool declares ALL FOUR {@link import('@modelcontextprotocol/sdk/types.js').ToolAnnotations}
 * hints explicitly (`readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`)
 * per mcp-surface.md §3.2 — Docket's own DB is a closed world (`openWorldHint:false`)
 * except `link_external` and `trigger_agent` which touch external systems.
 */
import {
  actor,
  agent,
  agentSession,
  comment,
  dailyPlanItem,
  db,
  hub,
  initiative,
  initiativeProgram,
  initiativeProject,
  integration,
  program,
  project,
  sessionActivity,
  task,
  taskDependency,
  team,
  update,
} from '@docket/db';
import { Health, Priority, SessionTrigger } from '@docket/types';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { and, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { ConflictError, CycleError, NotFoundError, ValidationError } from '../error';
import type { McpContext } from './auth';
import { authorize, jsonResult, runTool, scopedActor } from './result';

/** The subject table whose `health` an update of each subject type also writes to. */
const subjectTable = { project, program, initiative } as const;

/**
 * Validate a workflow-state transition for a task against its team's `workflow_states`.
 *
 * @remarks
 * Mirrors the tasks router `resolveStateTransition`: an unknown state key is a
 * {@link ValidationError}; a `completed`/`canceled`-typed state stamps the matching
 * terminal timestamp (so project progress, which counts `completedAt !== null`, stays
 * correct) and clears the other.
 *
 * @param orgId - The tenant the task + team belong to.
 * @param teamId - The task's team, whose `workflow_states` define the valid keys.
 * @param state - The requested target state key.
 * @returns the validated state plus derived `completedAt`/`canceledAt`.
 * @throws {NotFoundError} When the team is missing (defensive; FK guarantees it).
 * @throws {ValidationError} When `state` is not one of the team's workflow states.
 */
async function resolveStateTransition(
  orgId: string,
  teamId: string,
  state: string,
): Promise<{ state: string; completedAt: Date | null; canceledAt: Date | null }> {
  const teamRows = await db
    .select({ workflowStates: team.workflowStates })
    .from(team)
    .where(and(eq(team.id, teamId), eq(team.organizationId, orgId)))
    .limit(1);
  const teamRow = teamRows[0];
  /* v8 ignore next -- @preserve defensive: a task always references an in-org team (FK + cascade) */
  if (!teamRow) throw new NotFoundError('Team not found');

  const target = teamRow.workflowStates.find((s) => s.key === state);
  if (!target) {
    throw new ValidationError(
      new z.ZodError([
        {
          code: 'custom',
          path: ['state'],
          message: `Unknown workflow state '${state}'`,
          input: state,
        },
      ]),
    );
  }
  return {
    state,
    completedAt: target.type === 'completed' ? new Date() : null,
    canceledAt: target.type === 'canceled' ? new Date() : null,
  };
}

/** Load an active, org-scoped task row, or throw {@link NotFoundError}. */
async function loadTask(orgId: string, id: string): Promise<typeof task.$inferSelect> {
  const rows = await db
    .select()
    .from(task)
    .where(and(eq(task.id, id), eq(task.organizationId, orgId), isNull(task.archivedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Task not found');
  return row;
}

/**
 * Assert a directly org-scoped referenced row belongs to the caller's org, or 404.
 *
 * @remarks
 * The task FKs target each table's global PK with no `organization_id` constraint, so
 * tenant isolation is enforced here (data-model §0.2). A `null`/`undefined` id is a
 * no-op. Mirrors the tasks router `assertRefInOrg`.
 */
async function assertRefInOrg(
  table: typeof actor | typeof project | typeof program,
  orgId: string,
  refId: string | null | undefined,
  message: string,
): Promise<void> {
  if (refId === null || refId === undefined) return;
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, refId), eq(table.organizationId, orgId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError(message);
}

/**
 * Whether adding `blocking → blocked` would create a cycle (recursive reachability).
 *
 * @remarks
 * Mirrors the tasks router `wouldCreateCycle`: the edge closes a cycle when `blocked`
 * can already reach `blocking` along existing `blocks` edges. Org-scoped.
 */
async function wouldCreateCycle(
  orgId: string,
  blockingTaskId: string,
  blockedTaskId: string,
): Promise<boolean> {
  const reach = (await db.execute(sql`
    WITH RECURSIVE reach AS (
      SELECT blocked_task_id AS n FROM task_dependency
        WHERE blocking_task_id = ${blockedTaskId} AND organization_id = ${orgId}
      UNION
      SELECT d.blocked_task_id FROM task_dependency d
        JOIN reach r ON d.blocking_task_id = r.n WHERE d.organization_id = ${orgId}
    )
    SELECT 1 AS hit FROM reach WHERE n = ${blockingTaskId} LIMIT 1
  `)) as unknown as { rows: unknown[] };
  return reach.rows.length > 0;
}

/**
 * Register every Docket mutation tool on `server`, bound to the calling user.
 *
 * @remarks
 * Tools resolve the caller's per-org {@link McpActor} from `ctx` on each invocation,
 * so authorization is always evaluated against the live identity. Every tool declares
 * all four {@link ToolAnnotations} hints explicitly (no reliance on SDK defaults) and
 * authorizes via the permission engine before any write — `org`/`user` come strictly
 * from the verified token (never from tool arguments).
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
        'Transition a task to a workflow state (validated against the team’s workflow_states).',
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
      description: 'Create a subtask under a parent task (inherits the parent’s team + project).',
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

  server.registerTool(
    'add_task_dependency',
    {
      title: 'Add task dependency',
      description:
        'Add a directed blocks edge (blocking → blocked); cross-project, acyclic, no self-loops.',
      inputSchema: {
        orgId: z.string().min(1),
        blockingTaskId: z.string().min(1),
        blockedTaskId: z.string().min(1),
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
          id: input.blockingTaskId,
          orgId: input.orgId,
        });

        if (input.blockingTaskId === input.blockedTaskId) {
          throw new ValidationError(
            new z.ZodError([
              {
                code: 'custom',
                path: ['blockedTaskId'],
                message: 'A task cannot depend on itself',
                input: input.blockedTaskId,
              },
            ]),
          );
        }
        await loadTask(input.orgId, input.blockingTaskId);
        await loadTask(input.orgId, input.blockedTaskId);

        const existing = await db
          .select({ blockingTaskId: taskDependency.blockingTaskId })
          .from(taskDependency)
          .where(
            and(
              eq(taskDependency.blockingTaskId, input.blockingTaskId),
              eq(taskDependency.blockedTaskId, input.blockedTaskId),
              eq(taskDependency.organizationId, input.orgId),
            ),
          )
          .limit(1);
        if (existing[0]) return jsonResult({ alreadyLinked: true });

        if (await wouldCreateCycle(input.orgId, input.blockingTaskId, input.blockedTaskId)) {
          throw new CycleError();
        }

        await db.insert(taskDependency).values({
          blockingTaskId: input.blockingTaskId,
          blockedTaskId: input.blockedTaskId,
          organizationId: input.orgId,
        });
        return jsonResult({
          alreadyLinked: false,
          blockingTaskId: input.blockingTaskId,
          blockedTaskId: input.blockedTaskId,
        });
      }),
  );

  server.registerTool(
    'remove_task_dependency',
    {
      title: 'Remove task dependency',
      description: 'Drop a blocks edge between two tasks (removable from either endpoint).',
      inputSchema: {
        orgId: z.string().min(1),
        blockingTaskId: z.string().min(1),
        blockedTaskId: z.string().min(1),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:write');
        await authorize(actorCtx, 'contribute', {
          kind: 'task',
          id: input.blockingTaskId,
          orgId: input.orgId,
        });
        await loadTask(input.orgId, input.blockingTaskId);

        const deleted = await db
          .delete(taskDependency)
          .where(
            and(
              eq(taskDependency.organizationId, input.orgId),
              or(
                and(
                  eq(taskDependency.blockingTaskId, input.blockingTaskId),
                  eq(taskDependency.blockedTaskId, input.blockedTaskId),
                ),
                and(
                  eq(taskDependency.blockingTaskId, input.blockedTaskId),
                  eq(taskDependency.blockedTaskId, input.blockingTaskId),
                ),
              ),
            ),
          )
          .returning();
        if (!deleted[0]) throw new NotFoundError('Dependency edge not found');
        return jsonResult({ removed: true });
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
    'update_project',
    {
      title: 'Update project',
      description: 'Partially update a project (name, description, status, lead, dates).',
      inputSchema: {
        orgId: z.string().min(1),
        projectId: z.string().min(1),
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        status: z.enum(['planned', 'active', 'completed', 'canceled']).optional(),
        leadId: z.string().nullable().optional(),
        programId: z.string().nullable().optional(),
        startDate: z.iso.date().nullable().optional(),
        targetDate: z.iso.date().nullable().optional(),
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
          kind: 'project',
          id: input.projectId,
          orgId: input.orgId,
        });
        await assertRefInOrg(actor, input.orgId, input.leadId, 'Lead not found');
        await assertRefInOrg(program, input.orgId, input.programId, 'Program not found');

        const patch = {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(input.leadId !== undefined ? { leadId: input.leadId } : {}),
          ...(input.programId !== undefined ? { programId: input.programId } : {}),
          ...(input.startDate !== undefined
            ? { startDate: input.startDate ? new Date(input.startDate) : null }
            : {}),
          ...(input.targetDate !== undefined
            ? { targetDate: input.targetDate ? new Date(input.targetDate) : null }
            : {}),
        };
        if (Object.keys(patch).length === 0) {
          const rows = await db
            .select({ id: project.id, name: project.name })
            .from(project)
            .where(and(eq(project.id, input.projectId), eq(project.organizationId, input.orgId)))
            .limit(1);
          if (!rows[0]) throw new NotFoundError('Project not found');
          return jsonResult({ id: rows[0].id, name: rows[0].name });
        }
        const updated = await db
          .update(project)
          .set(patch)
          .where(and(eq(project.id, input.projectId), eq(project.organizationId, input.orgId)))
          .returning();
        const row = updated[0];
        if (!row) throw new NotFoundError('Project not found');
        return jsonResult({ id: row.id, name: row.name, status: row.status });
      }),
  );

  server.registerTool(
    'create_program',
    {
      title: 'Create program',
      description:
        'Create an ongoing program (status active/paused/archived; programs never complete).',
      inputSchema: {
        orgId: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional(),
        ownerId: z.string().optional(),
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
        // The programs router gates create on `manage`; mirror that bar exactly.
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:write');
        await authorize(actorCtx, 'manage', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });
        await assertRefInOrg(actor, input.orgId, input.ownerId, 'Owner not found');

        const inserted = await db
          .insert(program)
          .values({
            organizationId: input.orgId,
            name: input.name,
            description: input.description,
            ownerId: input.ownerId,
            status: 'active',
            createdBy: actorCtx.actorId,
          })
          .returning();
        const row = inserted[0];
        /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
        if (!row) throw new Error('program insert returned no row');
        return jsonResult({ id: row.id, name: row.name });
      }),
  );

  server.registerTool(
    'create_initiative',
    {
      title: 'Create initiative',
      description:
        'Create a cross-cutting theme (associates with programs/projects; holds no work).',
      inputSchema: {
        orgId: z.string().min(1),
        name: z.string().min(1),
        description: z.string().optional(),
        ownerId: z.string().optional(),
        targetDate: z.iso.date().optional(),
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
        await assertRefInOrg(actor, input.orgId, input.ownerId, 'Owner not found');

        const inserted = await db
          .insert(initiative)
          .values({
            organizationId: input.orgId,
            name: input.name,
            description: input.description,
            ownerId: input.ownerId,
            status: 'active',
            targetDate: input.targetDate ? new Date(input.targetDate) : undefined,
            createdBy: actorCtx.actorId,
          })
          .returning();
        const row = inserted[0];
        /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
        if (!row) throw new Error('initiative insert returned no row');
        return jsonResult({ id: row.id, name: row.name });
      }),
  );

  server.registerTool(
    'link_initiative',
    {
      title: 'Link initiative',
      description: 'Link or unlink an initiative to/from a project or program (m2m theme link).',
      inputSchema: {
        orgId: z.string().min(1),
        initiativeId: z.string().min(1),
        targetType: z.enum(['project', 'program']),
        targetId: z.string().min(1),
        action: z.enum(['link', 'unlink']).default('link'),
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
        // The initiatives router gates link/unlink on `contribute`.
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:write');
        await authorize(actorCtx, 'contribute', {
          kind: 'initiative',
          id: input.initiativeId,
          orgId: input.orgId,
        });

        const initRows = await db
          .select({ id: initiative.id })
          .from(initiative)
          .where(
            and(eq(initiative.id, input.initiativeId), eq(initiative.organizationId, input.orgId)),
          )
          .limit(1);
        if (!initRows[0]) throw new NotFoundError('Initiative not found');

        if (input.targetType === 'project') {
          const proj = await db
            .select({ id: project.id })
            .from(project)
            .where(and(eq(project.id, input.targetId), eq(project.organizationId, input.orgId)))
            .limit(1);
          if (!proj[0]) throw new NotFoundError('Project not found');

          if (input.action === 'unlink') {
            await db
              .delete(initiativeProject)
              .where(
                and(
                  eq(initiativeProject.initiativeId, input.initiativeId),
                  eq(initiativeProject.projectId, input.targetId),
                  eq(initiativeProject.organizationId, input.orgId),
                ),
              );
            return jsonResult({ linked: false });
          }
          const existing = await db
            .select({ initiativeId: initiativeProject.initiativeId })
            .from(initiativeProject)
            .where(
              and(
                eq(initiativeProject.initiativeId, input.initiativeId),
                eq(initiativeProject.projectId, input.targetId),
                eq(initiativeProject.organizationId, input.orgId),
              ),
            )
            .limit(1);
          if (!existing[0]) {
            await db.insert(initiativeProject).values({
              initiativeId: input.initiativeId,
              projectId: input.targetId,
              organizationId: input.orgId,
            });
          }
          return jsonResult({ linked: true });
        }

        const prog = await db
          .select({ id: program.id })
          .from(program)
          .where(and(eq(program.id, input.targetId), eq(program.organizationId, input.orgId)))
          .limit(1);
        if (!prog[0]) throw new NotFoundError('Program not found');

        if (input.action === 'unlink') {
          await db
            .delete(initiativeProgram)
            .where(
              and(
                eq(initiativeProgram.initiativeId, input.initiativeId),
                eq(initiativeProgram.programId, input.targetId),
                eq(initiativeProgram.organizationId, input.orgId),
              ),
            );
          return jsonResult({ linked: false });
        }
        const existing = await db
          .select({ initiativeId: initiativeProgram.initiativeId })
          .from(initiativeProgram)
          .where(
            and(
              eq(initiativeProgram.initiativeId, input.initiativeId),
              eq(initiativeProgram.programId, input.targetId),
              eq(initiativeProgram.organizationId, input.orgId),
            ),
          )
          .limit(1);
        if (!existing[0]) {
          await db.insert(initiativeProgram).values({
            initiativeId: input.initiativeId,
            programId: input.targetId,
            organizationId: input.orgId,
          });
        }
        return jsonResult({ linked: true });
      }),
  );

  server.registerTool(
    'add_comment',
    {
      title: 'Add comment',
      description: 'Post a comment on a task/project/program/initiative (the caller’s own actor).',
      inputSchema: {
        orgId: z.string().min(1),
        subjectType: z.enum(['task', 'project', 'program', 'initiative']),
        subjectId: z.string().min(1),
        body: z.string().min(1),
        parentCommentId: z.string().optional(),
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
        // The comments router gates create on the `comment` capability.
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:write');
        await authorize(actorCtx, 'comment', {
          kind: input.subjectType,
          id: input.subjectId,
          orgId: input.orgId,
        });

        if (input.parentCommentId !== undefined) {
          const parentRows = await db
            .select()
            .from(comment)
            .where(
              and(eq(comment.id, input.parentCommentId), eq(comment.organizationId, input.orgId)),
            )
            .limit(1);
          const parent = parentRows[0];
          if (!parent) throw new NotFoundError('Parent comment not found');
          if (parent.subjectType !== input.subjectType || parent.subjectId !== input.subjectId) {
            throw new ValidationError(
              new z.ZodError([
                {
                  code: 'custom',
                  path: ['parentCommentId'],
                  message: 'Parent comment is on a different subject',
                  input: input.parentCommentId,
                },
              ]),
            );
          }
          if (parent.parentCommentId !== null) {
            throw new ValidationError(
              new z.ZodError([
                {
                  code: 'custom',
                  path: ['parentCommentId'],
                  message: 'Cannot reply to a reply; replies are single-level',
                  input: input.parentCommentId,
                },
              ]),
            );
          }
        }

        const inserted = await db
          .insert(comment)
          .values({
            organizationId: input.orgId,
            authorId: actorCtx.actorId,
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            body: input.body,
            parentCommentId: input.parentCommentId,
            createdBy: actorCtx.actorId,
          })
          .returning();
        const row = inserted[0];
        /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
        if (!row) throw new Error('comment insert returned no row');
        return jsonResult({ id: row.id, subjectType: row.subjectType, subjectId: row.subjectId });
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        // Linking touches an external system (resolves provenance via the org's
        // Integration credentials) → open world.
        openWorldHint: true,
      },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await scopedActor(ctx, input.orgId, 'connectors:link');
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
        /* v8 ignore next -- @preserve defensive: linked task insert returned no row */
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
        prompt: z.string().optional(),
      },
      annotations: {
        title: 'Run agent',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        // Dispatching an agent run reaches an external runtime → open world.
        openWorldHint: true,
      },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await scopedActor(ctx, input.orgId, 'agents:run');
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
    'respond_to_session',
    {
      title: 'Respond to session',
      description:
        'Answer an agent elicitation in a live session (resumes an awaiting_input session).',
      inputSchema: {
        orgId: z.string().min(1),
        sessionId: z.string().min(1),
        activityId: z.string().min(1),
        body: z.string().min(1),
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
        // The reply route gates on `contribute`.
        const actorCtx = await scopedActor(ctx, input.orgId, 'agents:run');
        await authorize(actorCtx, 'contribute', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });
        const status = await replyToElicitation(
          input.orgId,
          input.sessionId,
          input.activityId,
          input.body,
        );
        return jsonResult({ sessionId: input.sessionId, status });
      }),
  );

  server.registerTool(
    'approve_action',
    {
      title: 'Approve agent action',
      description:
        'Approve the latest proposed action of an awaiting-approval agent session (resumes it).',
      inputSchema: { orgId: z.string().min(1), sessionId: z.string().min(1) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        // The session approval gate is an `assign`-level act (permissions §9.3), exactly
        // as the agent-sessions router's approve route requires.
        const actorCtx = await scopedActor(ctx, input.orgId, 'agents:run');
        await authorize(actorCtx, 'assign', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });
        const row = await resolveSessionAction(input.orgId, input.sessionId, 'approved');
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
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await scopedActor(ctx, input.orgId, 'agents:run');
        await authorize(actorCtx, 'assign', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });
        const row = await resolveSessionAction(input.orgId, input.sessionId, 'rejected');
        return jsonResult({ id: row.id, status: row.status });
      }),
  );

  server.registerTool(
    'cancel_session',
    {
      title: 'Cancel session',
      description: 'Cancel a non-terminal agent session (stamps endedAt).',
      inputSchema: { orgId: z.string().min(1), sessionId: z.string().min(1) },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        // Lifecycle transitions are gated on `contribute` in the agent-sessions router.
        const actorCtx = await scopedActor(ctx, input.orgId, 'agents:run');
        await authorize(actorCtx, 'contribute', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });
        const row = await cancelSession(input.orgId, input.sessionId);
        return jsonResult({ id: row.id, status: row.status });
      }),
  );

  server.registerTool(
    'run_view',
    {
      title: 'Run view',
      description:
        'Run an ad-hoc, permission-filtered query over tasks/projects/programs/initiatives.',
      inputSchema: {
        orgId: z.string().min(1),
        entity: z.enum(['task', 'project', 'program', 'initiative']),
        limit: z.number().int().min(1).max(200).default(50),
      },
      annotations: {
        title: 'Run view',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        // A read still requires `view` on the org root; a caller who can't see the org
        // gets the existence-hiding not-found (-32002 surfaced as isError text), never a
        // forbidden — mcp-surface.md §3.1.
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:read');
        await authorize(actorCtx, 'view', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });

        const items = await runEntityQuery(input.orgId, input.entity, input.limit);
        return jsonResult({ entity: input.entity, items });
      }),
  );

  server.registerTool(
    'search',
    {
      title: 'Search',
      description: 'Fused title search across the caller’s tasks, projects, and programs.',
      inputSchema: {
        orgId: z.string().min(1),
        query: z.string().min(1),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      runTool(async () => {
        const actorCtx = await scopedActor(ctx, input.orgId, 'work:read');
        await authorize(actorCtx, 'view', {
          kind: 'organization',
          id: input.orgId,
          orgId: input.orgId,
        });
        const pattern = `%${input.query}%`;
        const [taskRows, projectRows, programRows] = await Promise.all([
          db
            .select({ id: task.id, title: task.title })
            .from(task)
            .where(
              and(
                eq(task.organizationId, input.orgId),
                isNull(task.archivedAt),
                ilike(task.title, pattern),
              ),
            )
            .limit(input.limit),
          db
            .select({ id: project.id, name: project.name })
            .from(project)
            .where(and(eq(project.organizationId, input.orgId), ilike(project.name, pattern)))
            .limit(input.limit),
          db
            .select({ id: program.id, name: program.name })
            .from(program)
            .where(and(eq(program.organizationId, input.orgId), ilike(program.name, pattern)))
            .limit(input.limit),
        ]);
        const results = [
          ...taskRows.map((t) => ({ type: 'task', id: t.id, title: t.title })),
          ...projectRows.map((p) => ({ type: 'project', id: p.id, title: p.name })),
          ...programRows.map((p) => ({ type: 'program', id: p.id, title: p.name })),
        ].slice(0, input.limit);
        return jsonResult({ query: input.query, results });
      }),
  );

  server.registerTool(
    'add_to_daily_plan',
    {
      title: 'Add to daily plan',
      description:
        'Pull a task into the caller’s Hub Daily Plan for a date (Hub-scoped, cross-org).',
      inputSchema: {
        orgId: z.string().min(1),
        taskId: z.string().min(1),
        date: z.iso.date(),
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
        // Hub-scoped: authorized by `sub` ownership of the Hub plus org membership.
        // `resolveActor` proves the caller is a human Actor in the org (membership IS the
        // scope) before the ref task is verified to live there.
        await scopedActor(ctx, input.orgId, 'work:write');

        const hubRows = await db
          .select({ id: hub.id })
          .from(hub)
          .where(eq(hub.userId, ctx.userId))
          .limit(1);
        const hubRow = hubRows[0];
        if (!hubRow) throw new NotFoundError('Hub not found');

        const taskRows = await db
          .select({ id: task.id })
          .from(task)
          .where(and(eq(task.id, input.taskId), eq(task.organizationId, input.orgId)))
          .limit(1);
        if (!taskRows[0]) throw new NotFoundError('Task not found');

        // Idempotent: re-adding the same task on the same date returns the existing item.
        const existing = await db
          .select({ id: dailyPlanItem.id, status: dailyPlanItem.status })
          .from(dailyPlanItem)
          .where(
            and(
              eq(dailyPlanItem.hubId, hubRow.id),
              eq(dailyPlanItem.refTaskId, input.taskId),
              eq(dailyPlanItem.date, input.date),
            ),
          )
          .limit(1);
        if (existing[0]) {
          return jsonResult({ id: existing[0].id, status: existing[0].status, created: false });
        }

        const inserted = await db
          .insert(dailyPlanItem)
          .values({
            hubId: hubRow.id,
            refOrganizationId: input.orgId,
            refTaskId: input.taskId,
            date: input.date,
          })
          .returning();
        const row = inserted[0];
        /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
        if (!row) throw new Error('daily plan item insert returned no row');
        return jsonResult({ id: row.id, status: row.status, created: true });
      }),
  );
}

/** A lightweight projection for `run_view` rows. */
interface ViewItem {
  readonly id: string;
  readonly title: string;
  readonly state?: string;
  readonly status?: string;
}

/**
 * Run an org-scoped, ad-hoc entity query for `run_view`.
 *
 * @param orgId - The active organization id.
 * @param entity - The entity kind to list.
 * @param limit - The max rows to return.
 * @returns the projected rows (id + title + state/status where applicable).
 */
async function runEntityQuery(
  orgId: string,
  entity: 'task' | 'project' | 'program' | 'initiative',
  limit: number,
): Promise<ViewItem[]> {
  if (entity === 'task') {
    const rows = await db
      .select({ id: task.id, title: task.title, state: task.state })
      .from(task)
      .where(and(eq(task.organizationId, orgId), isNull(task.archivedAt)))
      .orderBy(desc(task.createdAt))
      .limit(limit);
    return rows.map((r) => ({ id: r.id, title: r.title, state: r.state }));
  }
  if (entity === 'project') {
    const rows = await db
      .select({ id: project.id, name: project.name, status: project.status })
      .from(project)
      .where(eq(project.organizationId, orgId))
      .orderBy(desc(project.createdAt))
      .limit(limit);
    return rows.map((r) => ({ id: r.id, title: r.name, status: r.status }));
  }
  if (entity === 'program') {
    const rows = await db
      .select({ id: program.id, name: program.name, status: program.status })
      .from(program)
      .where(eq(program.organizationId, orgId))
      .orderBy(desc(program.createdAt))
      .limit(limit);
    return rows.map((r) => ({ id: r.id, title: r.name, status: r.status }));
  }
  const rows = await db
    .select({ id: initiative.id, name: initiative.name, status: initiative.status })
    .from(initiative)
    .where(eq(initiative.organizationId, orgId))
    .orderBy(desc(initiative.createdAt))
    .limit(limit);
  return rows.map((r) => ({ id: r.id, title: r.name, status: r.status }));
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
async function resolveSessionAction(
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

/**
 * Reply to an agent `elicitation` — append a human `response` and resume if waiting.
 *
 * @remarks
 * Mirrors the agent-sessions router's `replyToElicitation`: the referenced activity
 * must be an `elicitation` on the (org-scoped) session; a `response` activity is
 * appended and an `awaiting_input` session resumes to `running`.
 *
 * @param orgId - The active organization id.
 * @param sessionId - The session that owns the elicitation.
 * @param activityId - The `elicitation` activity being answered.
 * @param text - The human reply body.
 * @returns the resulting session status.
 * @throws {NotFoundError} When the session or elicitation is not found in the org.
 * @throws {ConflictError} When the referenced activity is not an `elicitation`.
 */
async function replyToElicitation(
  orgId: string,
  sessionId: string,
  activityId: string,
  text: string,
): Promise<string> {
  return db.transaction(async (tx) => {
    const sessionRows = await tx
      .select()
      .from(agentSession)
      .where(and(eq(agentSession.id, sessionId), eq(agentSession.organizationId, orgId)))
      .limit(1);
    const session = sessionRows[0];
    if (!session) throw new NotFoundError('Session not found');

    const promptRows = await tx
      .select()
      .from(sessionActivity)
      .where(and(eq(sessionActivity.id, activityId), eq(sessionActivity.sessionId, sessionId)))
      .limit(1);
    const prompt = promptRows[0];
    if (!prompt) throw new NotFoundError('Activity not found');
    if (prompt.type !== 'elicitation') throw new ConflictError('Activity is not an elicitation');

    await tx
      .insert(sessionActivity)
      .values({ sessionId, organizationId: orgId, type: 'response', body: { text } });

    let nextStatus = session.status;
    if (session.status === 'awaiting_input') {
      nextStatus = 'running';
      await tx
        .update(agentSession)
        .set({ status: 'running' })
        .where(and(eq(agentSession.id, sessionId), eq(agentSession.organizationId, orgId)));
    }
    return nextStatus;
  });
}

/**
 * Cancel a non-terminal agent session (stamps `endedAt`).
 *
 * @remarks
 * Mirrors the agent-sessions router's `transitionLifecycle('cancel')`: terminal
 * sessions (`completed`/`failed`/`canceled`) cannot be canceled again.
 *
 * @param orgId - The active organization id.
 * @param sessionId - The session to cancel.
 * @returns the updated session row.
 * @throws {NotFoundError} When the session is not found in the org.
 * @throws {ConflictError} When the session is already in a terminal state.
 */
async function cancelSession(
  orgId: string,
  sessionId: string,
): Promise<typeof agentSession.$inferSelect> {
  const rows = await db
    .select()
    .from(agentSession)
    .where(and(eq(agentSession.id, sessionId), eq(agentSession.organizationId, orgId)))
    .limit(1);
  const session = rows[0];
  if (!session) throw new NotFoundError('Session not found');
  const terminal = ['completed', 'failed', 'canceled'];
  if (terminal.includes(session.status)) {
    throw new ConflictError('Session is already in a terminal state');
  }
  const [updated] = await db
    .update(agentSession)
    .set({ status: 'canceled', endedAt: new Date() })
    .where(and(eq(agentSession.id, sessionId), eq(agentSession.organizationId, orgId)))
    .returning();
  /* v8 ignore next -- @preserve defensive: update always returns a row */
  if (!updated) throw new Error('session update returned no row');
  return updated;
}
