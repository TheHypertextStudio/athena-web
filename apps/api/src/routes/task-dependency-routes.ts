import { actor, cycle, db, project, task, taskDependency } from '@docket/db';
import {
  SubtaskCreate,
  TaskDependencyCreate,
  TaskDependencyCreated,
  TaskDependencyOut,
  TaskOut,
  TaskRemoved,
  pageOf,
} from '@docket/types';
import { and, eq, isNull, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, CycleError, NotFoundError, ValidationError } from '../error';
import { serializableTx } from '../lib/serializable-tx';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

import {
  assertMilestoneInOrg,
  assertRefInOrg,
  depParam,
  idParam,
  loadTask,
  toOut,
  toRef,
  wouldCreateCycle,
} from './task-helpers';

/** Subtask + dependency routes, mounted on the tasks router at `/`. */
export const taskDependencyRoutes = new Hono<AppEnv>()
  .get(
    '/:id/subtasks',
    apiDoc({ tag: 'Tasks', summary: 'List subtasks', response: pageOf(TaskOut) }),
    zParam(idParam),
    async (c) => {
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
    },
  )
  .post(
    '/:id/subtasks',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Tasks',
      summary: 'Create a subtask',
      capability: 'contribute',
      response: TaskOut,
    }),
    zParam(idParam),
    zJson(SubtaskCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const parent = await loadTask(orgId, id);

      // Tenant isolation: body-provided references must live in the caller's org.
      // Values inherited from the in-org parent (`teamId`, `projectId`) need no check.
      await assertRefInOrg(actor, orgId, body.assigneeId, 'Assignee not found');
      await assertRefInOrg(project, orgId, body.projectId, 'Project not found');
      await assertRefInOrg(cycle, orgId, body.cycleId, 'Cycle not found');
      await assertMilestoneInOrg(orgId, body.milestoneId);

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
          estimateMinutes: body.estimateMinutes,
          startDate: body.startDate ? new Date(body.startDate) : undefined,
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
  .get(
    '/:id/dependencies',
    apiDoc({ tag: 'Tasks', summary: 'List task dependencies', response: TaskDependencyOut }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      await loadTask(orgId, id);

      // `blocking`: tasks THIS task blocks (this is the blocking side of the edge).
      const blocking = await db
        .select({ id: task.id, title: task.title, state: task.state, projectId: task.projectId })
        .from(taskDependency)
        .innerJoin(task, eq(taskDependency.blockedTaskId, task.id))
        .where(
          and(eq(taskDependency.blockingTaskId, id), eq(taskDependency.organizationId, orgId)),
        );
      // `blockedBy`: tasks blocking THIS task (this is the blocked side of the edge).
      const blockedBy = await db
        .select({ id: task.id, title: task.title, state: task.state, projectId: task.projectId })
        .from(taskDependency)
        .innerJoin(task, eq(taskDependency.blockingTaskId, task.id))
        .where(and(eq(taskDependency.blockedTaskId, id), eq(taskDependency.organizationId, orgId)));

      const payload: z.input<typeof TaskDependencyOut> = {
        blocking: blocking.map(toRef),
        blockedBy: blockedBy.map(toRef),
      };
      return ok(c, TaskDependencyOut, payload);
    },
  )
  .post(
    '/:id/dependencies',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Tasks',
      summary: 'Add a task dependency',
      capability: 'contribute',
      response: TaskDependencyCreated,
    }),
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

      // Both endpoints must be active tasks in this org.
      await loadTask(orgId, id);
      await loadTask(orgId, otherId);

      // The duplicate-check, acyclic reachability check, and the insert run in one
      // SERIALIZABLE transaction (data-model §7.4): READ COMMITTED lets two concurrent
      // inserts of A→B and B→A each pass the guard and both commit, producing a 2-cycle.
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
    apiDoc({
      tag: 'Tasks',
      summary: 'Remove a task dependency',
      capability: 'contribute',
      response: TaskRemoved,
    }),
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
