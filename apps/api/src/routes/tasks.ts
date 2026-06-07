/**
 * `@docket/api` — tasks router (mounted at `/v1/orgs/:orgId/tasks`).
 *
 * @remarks
 * The full task lifecycle: create/list, single-task detail, partial update,
 * archive, workflow-state transitions, subtasks (a task with `parentTaskId`), and
 * the org-wide cross-project directed-acyclic `blocks` dependency graph. Every query
 * is scoped by `actorCtx.orgId`; dependency inserts run an acyclic reachability check
 * inside a transaction before writing the edge.
 */
import { type Capability, satisfies } from '@docket/authz';
import { db, task, taskDependency, team } from '@docket/db';
import type { TaskRef } from '@docket/types';
import {
  pageOf,
  SubtaskCreate,
  TaskArchived,
  TaskCreate,
  TaskDependencyCreate,
  TaskDependencyCreated,
  TaskDependencyOut,
  TaskDetail,
  TaskOut,
  TaskRemoved,
  TaskStateUpdate,
  TaskUpdate,
} from '@docket/types';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import {
  CapabilityError,
  ConflictError,
  CycleError,
  NotFoundError,
  ValidationError,
} from '../error';
import { ok } from '../lib/ok';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

type TaskRow = typeof task.$inferSelect;

/**
 * Postgres SQLSTATE codes that indicate a transaction was rolled back because it
 * could not be serialized against a concurrent one, and is safe to retry.
 *
 * @remarks
 * `40001` = serialization_failure (raised by SERIALIZABLE / REPEATABLE READ on a
 * conflicting concurrent write); `40P01` = deadlock_detected. Under SERIALIZABLE,
 * two concurrent edge inserts that would jointly close a cycle each pass their own
 * reachability check, but one is aborted at commit with `40001` — re-running it
 * re-reads the now-committed edge and the acyclic guard rejects it. See data-model
 * §7.4 step 3.
 */
const SERIALIZATION_RETRY_CODES = new Set(['40001', '40P01']);

/** Whether a thrown error is a retryable serialization/deadlock failure (by SQLSTATE). */
function isSerializationFailure(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof err.code === 'string' &&
    SERIALIZATION_RETRY_CODES.has((err as { code: string }).code)
  );
}

/**
 * Run a SERIALIZABLE transaction, retrying a bounded number of times when Postgres
 * aborts it with a serialization/deadlock failure (SQLSTATE 40001/40P01).
 *
 * @remarks
 * SERIALIZABLE is what makes the acyclic reachability check sound under concurrency
 * (data-model §7.4 step 3): READ COMMITTED lets two requests inserting `A→B` and
 * `B→A` each pass `wouldCreateCycle()` and both commit, producing a 2-cycle. The
 * cost of SERIALIZABLE is that the loser of a conflict is aborted with `40001`;
 * we retry it (re-reading the committed edge, which the guard then rejects) and, if
 * the conflict persists past the retry budget, surface a {@link ConflictError} the
 * client can retry rather than a 500.
 *
 * @param fn - The transaction body; receives the active SERIALIZABLE transaction.
 * @returns the transaction body's result.
 * @throws {ConflictError} When the transaction still cannot be serialized after retries.
 */
async function serializableTx<T>(
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  const maxAttempts = 3;
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(fn, { isolationLevel: 'serializable' });
    } catch (err) {
      /* v8 ignore start -- @preserve concurrency boundary: SQLSTATE 40001/40P01 only
         arises under concurrent writers on real Postgres; PGlite is single-connection,
         so the retry + give-up branches can't be hit deterministically in tests. */
      if (isSerializationFailure(err) && attempt < maxAttempts) continue;
      if (isSerializationFailure(err)) {
        throw new ConflictError('Concurrent update conflict, please retry');
      }
      /* v8 ignore stop */
      throw err;
    }
  }
}

function toOut(t: TaskRow): z.input<typeof TaskOut> {
  return {
    id: t.id,
    organizationId: t.organizationId,
    title: t.title,
    description: t.description,
    teamId: t.teamId,
    state: t.state,
    priority: t.priority,
    assigneeId: t.assigneeId,
    delegateId: t.delegateId,
    projectId: t.projectId,
    programId: t.programId,
    dueDate: t.dueDate?.toISOString() ?? null,
    provenance: {
      source: t.source,
      sourceIntegrationId: t.sourceIntegrationId,
      externalId: t.externalId,
      externalUrl: t.externalUrl,
      syncMode: t.sourceSyncMode,
    },
    createdAt: t.createdAt.toISOString(),
  };
}

/** Project a task row into a lightweight {@link TaskRef} (id/title/state/project). */
function toRef(t: Pick<TaskRow, 'id' | 'title' | 'state' | 'projectId'>): z.input<typeof TaskRef> {
  return { id: t.id, title: t.title, state: t.state, projectId: t.projectId };
}

const idParam = z.object({ id: z.string() });
const depParam = z.object({ id: z.string(), depId: z.string() });

/** Load a single active task scoped to the org, or throw {@link NotFoundError}. */
async function loadTask(orgId: string, id: string): Promise<TaskRow> {
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
 * Resolve a workflow-state transition for a task: validate the target `state` against
 * the task's team `workflow_states` and derive the terminal `completedAt`/`canceledAt`.
 *
 * @remarks
 * This is the single source of truth for state mutation, shared by `POST /:id/state`
 * and `PATCH /:id` so both paths enforce the contract identically (api-rpc-contract
 * `POST /:taskId/state`: "validated against the team's workflow_states"). Setting a
 * `completed`/`canceled`-typed state stamps the matching terminal timestamp and clears
 * the other; any non-terminal state clears both. Skipping this from PATCH would let a
 * caller set an unknown state key, or land a task in a `done`/`canceled` state with a
 * null `completedAt`/`canceledAt` — which silently corrupts project progress (which
 * counts completion via `completedAt !== null`).
 *
 * @param orgId - The tenant the task + team belong to.
 * @param teamId - The task's team, whose `workflow_states` define the valid keys.
 * @param state - The requested target state key.
 * @returns the validated state plus derived `completedAt`/`canceledAt`.
 * @throws {NotFoundError} When the team is missing (defensive; FK guarantees it exists).
 * @throws {ValidationError} When `state` is not one of the team's workflow states.
 */
async function resolveStateTransition(
  orgId: string,
  teamId: string,
  state: string,
): Promise<{ state: string; completedAt: Date | null; canceledAt: Date | null }> {
  const teamRows = await db
    .select()
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
          message: `Unknown workflow state '${state}' for this team`,
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

/**
 * Whether adding `blocking → blocked` would create a cycle, by checking if `blocked`
 * can already reach `blocking` along existing `blocks` edges (recursive reachability).
 *
 * @param tx - The active transaction (the read + the insert must be atomic).
 * @param orgId - The tenant to scope the graph to.
 * @param blockingTaskId - The proposed edge's source (blocking) task.
 * @param blockedTaskId - The proposed edge's target (blocked) task.
 * @returns true when the edge would close a cycle.
 */
async function wouldCreateCycle(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  orgId: string,
  blockingTaskId: string,
  blockedTaskId: string,
): Promise<boolean> {
  const reach = (await tx.execute(sql`
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

/** Tasks router: lifecycle (create/list/detail/update/archive/state) + subtasks + dependencies. */
const tasks = new Hono<AppEnv>()
  .post('/', capabilityGuard('contribute'), zJson(TaskCreate), async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const body = c.req.valid('json');

    const teamRows = await db
      .select()
      .from(team)
      .where(and(eq(team.id, body.teamId), eq(team.organizationId, orgId)))
      .limit(1);
    const teamRow = teamRows[0];
    if (!teamRow) throw new NotFoundError('Team not found');

    const state = body.state ?? teamRow.workflowStates[0]?.key ?? 'backlog';

    const inserted = await db
      .insert(task)
      .values({
        organizationId: orgId,
        title: body.title,
        description: body.description,
        teamId: body.teamId,
        state,
        priority: body.priority ?? 'none',
        assigneeId: body.assigneeId,
        projectId: body.projectId,
        milestoneId: body.milestoneId,
        cycleId: body.cycleId,
        parentTaskId: body.parentTaskId,
        estimate: body.estimate,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        source: 'native',
        createdBy: actorId,
      })
      .returning();
    const row = inserted[0];
    /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
    if (!row) throw new Error('task insert returned no row');
    return ok(c, TaskOut, toOut(row));
  })
  .get('/', async (c) => {
    const { orgId } = c.get('actorCtx');
    const rows = await db
      .select()
      .from(task)
      .where(and(eq(task.organizationId, orgId), isNull(task.archivedAt)));
    return ok(c, pageOf(TaskOut), { items: rows.map(toOut) });
  })
  .get('/:id', zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const row = await loadTask(orgId, id);

    // Dependency edges (org-scoped); join to the other task for its ref + project.
    // Tasks blocking THIS one (its blockers): edges where this task is the blocked side.
    const blockedByRows = await db
      .select({
        id: task.id,
        title: task.title,
        state: task.state,
        projectId: task.projectId,
      })
      .from(taskDependency)
      .innerJoin(task, eq(taskDependency.blockingTaskId, task.id))
      .where(and(eq(taskDependency.blockedTaskId, id), eq(taskDependency.organizationId, orgId)));
    // Tasks THIS one blocks: edges where this task is the blocking side.
    const blockingRows = await db
      .select({
        id: task.id,
        title: task.title,
        state: task.state,
        projectId: task.projectId,
      })
      .from(taskDependency)
      .innerJoin(task, eq(taskDependency.blockedTaskId, task.id))
      .where(and(eq(taskDependency.blockingTaskId, id), eq(taskDependency.organizationId, orgId)));
    const subtaskRows = await db
      .select({
        id: task.id,
        title: task.title,
        state: task.state,
        projectId: task.projectId,
      })
      .from(task)
      .where(
        and(eq(task.parentTaskId, id), eq(task.organizationId, orgId), isNull(task.archivedAt)),
      );

    const detail: z.input<typeof TaskDetail> = {
      ...toOut(row),
      milestoneId: row.milestoneId,
      cycleId: row.cycleId,
      parentTaskId: row.parentTaskId,
      estimate: row.estimate,
      completedAt: row.completedAt?.toISOString() ?? null,
      canceledAt: row.canceledAt?.toISOString() ?? null,
      blocking: blockingRows.map(toRef),
      blockedBy: blockedByRows.map(toRef),
      subtasks: subtaskRows.map(toRef),
    };
    return ok(c, TaskDetail, detail);
  })
  .patch('/:id', capabilityGuard('contribute'), zParam(idParam), zJson(TaskUpdate), async (c) => {
    const ctx = c.get('actorCtx');
    const { orgId } = ctx;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    // Changing assignee/delegate is an `assign`-level action (permissions §2).
    if (body.assigneeId !== undefined || body.delegateId !== undefined) {
      const held = ctx.capabilities as Capability[];
      if (!held.some((cap) => satisfies(cap, 'assign'))) throw new CapabilityError();
    }

    // `state` is validated against the team's workflow_states and carries terminal
    // timestamp derivation, identical to POST /:id/state — patching state directly must
    // NOT bypass that (otherwise an unknown state key, or a done/canceled state with a
    // null completedAt/canceledAt, corrupts project progress). Resolve it up front.
    const statePatch =
      body.state !== undefined
        ? await resolveStateTransition(orgId, (await loadTask(orgId, id)).teamId, body.state)
        : undefined;

    const patch = {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(statePatch !== undefined
        ? {
            state: statePatch.state,
            completedAt: statePatch.completedAt,
            canceledAt: statePatch.canceledAt,
          }
        : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
      ...(body.delegateId !== undefined ? { delegateId: body.delegateId } : {}),
      ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
      ...(body.programId !== undefined ? { programId: body.programId } : {}),
      ...(body.milestoneId !== undefined ? { milestoneId: body.milestoneId } : {}),
      ...(body.cycleId !== undefined ? { cycleId: body.cycleId } : {}),
      ...(body.estimate !== undefined ? { estimate: body.estimate } : {}),
      ...(body.dueDate !== undefined
        ? { dueDate: body.dueDate ? new Date(body.dueDate) : null }
        : {}),
    };

    // An empty patch body is a valid no-op: Drizzle rejects an empty `.set({})`, so
    // re-read the row (still enforcing the org-scoped existence check) and return it.
    if (Object.keys(patch).length === 0) {
      return ok(c, TaskOut, toOut(await loadTask(orgId, id)));
    }

    const updated = await db
      .update(task)
      .set(patch)
      .where(and(eq(task.id, id), eq(task.organizationId, orgId), isNull(task.archivedAt)))
      .returning();
    const row = updated[0];
    if (!row) throw new NotFoundError('Task not found');
    return ok(c, TaskOut, toOut(row));
  })
  .delete('/:id', capabilityGuard('contribute'), zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const archivedAt = new Date();
    const updated = await db
      .update(task)
      .set({ archivedAt })
      .where(and(eq(task.id, id), eq(task.organizationId, orgId), isNull(task.archivedAt)))
      .returning();
    const row = updated[0];
    if (!row) throw new NotFoundError('Task not found');
    return ok(c, TaskArchived, {
      id: row.id,
      /* v8 ignore next -- @preserve defensive: archivedAt was just set above */
      archivedAt: (row.archivedAt ?? archivedAt).toISOString(),
    });
  })
  .post(
    '/:id/state',
    capabilityGuard('contribute'),
    zParam(idParam),
    zJson(TaskStateUpdate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { state } = c.req.valid('json');
      const row = await loadTask(orgId, id);

      const transition = await resolveStateTransition(orgId, row.teamId, state);

      const updated = await db
        .update(task)
        .set({
          state: transition.state,
          completedAt: transition.completedAt,
          canceledAt: transition.canceledAt,
        })
        .where(and(eq(task.id, id), eq(task.organizationId, orgId), isNull(task.archivedAt)))
        .returning();
      const next = updated[0];
      /* v8 ignore next -- @preserve defensive: loadTask above proved the row exists + is active */
      if (!next) throw new NotFoundError('Task not found');
      return ok(c, TaskOut, toOut(next));
    },
  )
  .get('/:id/subtasks', zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    await loadTask(orgId, id);
    const rows = await db
      .select()
      .from(task)
      .where(
        and(eq(task.parentTaskId, id), eq(task.organizationId, orgId), isNull(task.archivedAt)),
      );
    return ok(c, pageOf(TaskOut), { items: rows.map(toOut) });
  })
  .post(
    '/:id/subtasks',
    capabilityGuard('contribute'),
    zParam(idParam),
    zJson(SubtaskCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const parent = await loadTask(orgId, id);

      const state = body.state ?? parent.state;

      const inserted = await db
        .insert(task)
        .values({
          organizationId: orgId,
          title: body.title,
          description: body.description,
          teamId: parent.teamId,
          state,
          priority: body.priority ?? 'none',
          assigneeId: body.assigneeId,
          projectId: body.projectId ?? parent.projectId,
          milestoneId: body.milestoneId,
          cycleId: body.cycleId,
          parentTaskId: parent.id,
          estimate: body.estimate,
          dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
          source: 'native',
          createdBy: actorId,
        })
        .returning();
      const row = inserted[0];
      /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
      if (!row) throw new Error('subtask insert returned no row');
      return ok(c, TaskOut, toOut(row));
    },
  )
  .get('/:id/dependencies', zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    await loadTask(orgId, id);

    // `blocking`: tasks THIS task blocks (this is the blocking side of the edge).
    const blocking = await db
      .select({
        id: task.id,
        title: task.title,
        state: task.state,
        projectId: task.projectId,
      })
      .from(taskDependency)
      .innerJoin(task, eq(taskDependency.blockedTaskId, task.id))
      .where(and(eq(taskDependency.blockingTaskId, id), eq(taskDependency.organizationId, orgId)));
    // `blockedBy`: tasks blocking THIS task (this is the blocked side of the edge).
    const blockedBy = await db
      .select({
        id: task.id,
        title: task.title,
        state: task.state,
        projectId: task.projectId,
      })
      .from(taskDependency)
      .innerJoin(task, eq(taskDependency.blockingTaskId, task.id))
      .where(and(eq(taskDependency.blockedTaskId, id), eq(taskDependency.organizationId, orgId)));

    const payload: z.input<typeof TaskDependencyOut> = {
      blocking: blocking.map(toRef),
      blockedBy: blockedBy.map(toRef),
    };
    return ok(c, TaskDependencyOut, payload);
  })
  .post(
    '/:id/dependencies',
    capabilityGuard('contribute'),
    zParam(idParam),
    zJson(TaskDependencyCreate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');

      // Resolve the directed edge relative to the path task.
      const blockingTaskId = body.blockingTaskId ?? id;
      const blockedTaskId = body.blockedTaskId ?? id;
      const otherId = body.blockingTaskId ?? body.blockedTaskId;
      /* v8 ignore next -- @preserve defensive: the DTO refine guarantees exactly one side is set */
      if (otherId === undefined) throw new NotFoundError('Task not found');

      if (blockingTaskId === blockedTaskId) {
        throw new ValidationError(
          new z.ZodError([
            {
              code: 'custom',
              path: ['blockedTaskId'],
              message: 'A task cannot depend on itself',
              input: otherId,
            },
          ]),
        );
      }

      // Both endpoints must be active tasks in this org (tenant isolation + existence).
      await loadTask(orgId, id);
      await loadTask(orgId, otherId);

      // The duplicate-check, acyclic reachability check, and the insert run in one
      // SERIALIZABLE transaction (data-model §7.4 step 3): READ COMMITTED would let two
      // concurrent inserts of A→B and B→A each pass wouldCreateCycle() and both commit,
      // producing a 2-cycle. SERIALIZABLE aborts the loser with SQLSTATE 40001, which
      // serializableTx retries — on re-read the committed edge makes the guard reject it.
      await serializableTx(async (tx) => {
        const existing = await tx
          .select()
          .from(taskDependency)
          .where(
            and(
              eq(taskDependency.blockingTaskId, blockingTaskId),
              eq(taskDependency.blockedTaskId, blockedTaskId),
              eq(taskDependency.organizationId, orgId),
            ),
          )
          .limit(1);
        if (existing[0]) throw new ConflictError('Dependency edge already exists');

        if (await wouldCreateCycle(tx, orgId, blockingTaskId, blockedTaskId)) {
          throw new CycleError();
        }

        await tx
          .insert(taskDependency)
          .values({ blockingTaskId, blockedTaskId, organizationId: orgId });
      });

      return ok(c, TaskDependencyCreated, { created: true, blockingTaskId, blockedTaskId });
    },
  )
  .delete(
    '/:id/dependencies/:depId',
    capabilityGuard('contribute'),
    zParam(depParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, depId } = c.req.valid('param');
      await loadTask(orgId, id);

      // The edge is removable from either endpoint: (id→depId) or (depId→id).
      const deleted = await db
        .delete(taskDependency)
        .where(
          and(
            eq(taskDependency.organizationId, orgId),
            or(
              and(eq(taskDependency.blockingTaskId, id), eq(taskDependency.blockedTaskId, depId)),
              and(eq(taskDependency.blockingTaskId, depId), eq(taskDependency.blockedTaskId, id)),
            ),
          ),
        )
        .returning();
      if (!deleted[0]) throw new NotFoundError('Dependency edge not found');
      return ok(c, TaskRemoved, { removed: true });
    },
  );

export default tasks;
