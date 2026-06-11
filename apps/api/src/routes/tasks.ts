/** `@docket/api` — tasks router (mounted at `/v1/orgs/:orgId/tasks`). */
import { type Capability, satisfies } from '@docket/authz';
import { actor, cycle, db, program, project, task, taskDependency, team } from '@docket/db';
import {
  pageOf,
  TaskArchived,
  TaskCreate,
  TaskDetail,
  TaskOut,
  TaskStateUpdate,
  TaskUpdate,
} from '@docket/types';
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import type { z } from 'zod';

import type { AppEnv } from '../context';
import { CapabilityError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

import {
  assertMilestoneInOrg,
  assertRefInOrg,
  idParam,
  loadTask,
  resolveStateTransition,
  toOut,
  toRef,
} from './task-helpers';
import { taskDependencyRoutes } from './task-dependency-routes';

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

    // Tenant isolation: every body-provided reference must live in the caller's org.
    await assertRefInOrg(actor, orgId, body.assigneeId, 'Assignee not found');
    await assertRefInOrg(project, orgId, body.projectId, 'Project not found');
    await assertRefInOrg(cycle, orgId, body.cycleId, 'Cycle not found');
    await assertMilestoneInOrg(orgId, body.milestoneId);
    if (body.parentTaskId !== undefined) await loadTask(orgId, body.parentTaskId);

    // resolveStateTransition validates the state key and derives terminal timestamps so
    // a task created directly in a `completed`/`canceled` state lands with correct fields.
    const firstState = teamRow.workflowStates[0];
    const { state, completedAt, canceledAt } = firstState
      ? await resolveStateTransition(orgId, body.teamId, body.state ?? firstState.key)
      : { state: body.state ?? 'backlog', completedAt: null, canceledAt: null };

    const inserted = await db
      .insert(task)
      .values({
        organizationId: orgId,
        title: body.title,
        description: body.description,
        teamId: body.teamId,
        state,
        completedAt,
        canceledAt,
        priority: body.priority ?? 'none',
        assigneeId: body.assigneeId,
        projectId: body.projectId,
        milestoneId: body.milestoneId,
        cycleId: body.cycleId,
        parentTaskId: body.parentTaskId,
        estimate: body.estimate,
        estimateMinutes: body.estimateMinutes,
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

    // Tasks blocking THIS one (blockers): edges where this task is the blocked side.
    const blockedByRows = await db
      .select({ id: task.id, title: task.title, state: task.state, projectId: task.projectId })
      .from(taskDependency)
      .innerJoin(task, eq(taskDependency.blockingTaskId, task.id))
      .where(and(eq(taskDependency.blockedTaskId, id), eq(taskDependency.organizationId, orgId)));
    // Tasks THIS one blocks: edges where this task is the blocking side.
    const blockingRows = await db
      .select({ id: task.id, title: task.title, state: task.state, projectId: task.projectId })
      .from(taskDependency)
      .innerJoin(task, eq(taskDependency.blockedTaskId, task.id))
      .where(and(eq(taskDependency.blockingTaskId, id), eq(taskDependency.organizationId, orgId)));
    const subtaskRows = await db
      .select({ id: task.id, title: task.title, state: task.state, projectId: task.projectId })
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
      estimateMinutes: row.estimateMinutes,
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

    // Changing assignee/delegate requires `assign` capability (permissions §2).
    if (body.assigneeId !== undefined || body.delegateId !== undefined) {
      const held = ctx.capabilities as Capability[];
      if (!held.some((cap) => satisfies(cap, 'assign'))) throw new CapabilityError();
    }

    // Tenant isolation: every re-pointed reference must live in the caller's org.
    await assertRefInOrg(actor, orgId, body.assigneeId, 'Assignee not found');
    await assertRefInOrg(actor, orgId, body.delegateId, 'Delegate not found');
    await assertRefInOrg(project, orgId, body.projectId, 'Project not found');
    await assertRefInOrg(program, orgId, body.programId, 'Program not found');
    await assertRefInOrg(cycle, orgId, body.cycleId, 'Cycle not found');
    await assertMilestoneInOrg(orgId, body.milestoneId);

    // resolveStateTransition validates + derives timestamps; bypassing it would corrupt progress.
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
      ...(body.estimateMinutes !== undefined ? { estimateMinutes: body.estimateMinutes } : {}),
      ...(body.dueDate !== undefined
        ? { dueDate: body.dueDate ? new Date(body.dueDate) : null }
        : {}),
    };

    // An empty patch body is a valid no-op: Drizzle rejects an empty `.set({})`.
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
  .route('/', taskDependencyRoutes);

export default tasks;
