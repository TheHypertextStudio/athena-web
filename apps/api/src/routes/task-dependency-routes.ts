import { actor, auditEvent, cycle, db, project, task, taskDependency } from '@docket/db';
import {
  SubtaskCreate,
  TaskDependencyCreate,
  TaskDependencyCreated,
  TaskDependencyOut,
  TaskOut,
  TaskRemoved,
} from '@docket/work/task-model';
import { CursorQuery, pageOf } from '../contracts/pagination';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, CycleError, NotFoundError, ValidationError } from '../error';
import { serializableTx } from '../lib/serializable-tx';
import { taskActivityRows } from '../lib/task-audit';
import { labelsForSubjects, replaceLabels, resolveLabelSet } from '../lib/labels';
import { encodeIdCursor, pageResultById, seekAfterId } from '../lib/list-cursor';
import { created, ok, resourceUrl } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import {
  applySubtaskCompletionPolicyForParents,
  finishTaskStateTransition,
} from '../lib/task-state';
import { zJson, zParam, zQuery } from '../lib/validate';
import { enqueueSearchUpsert } from '../search/write-through';

import {
  assertTaskCapability,
  assertMilestoneInOrg,
  assertRefInOrg,
  buildTaskViewFilter,
  depParam,
  idParam,
  loadTask,
  toOut,
  toRef,
  wouldCreateCycle,
} from './task-helpers';
import { landingTaskTransition, resolveTaskStatus } from '../lib/work-status';

async function listVisibleSubtasks(
  organizationId: string,
  parentTaskId: string,
  cursor: string | undefined,
  limit: number,
  canView: Awaited<ReturnType<typeof buildTaskViewFilter>>,
): Promise<(typeof task.$inferSelect)[]> {
  const visibleRows: (typeof task.$inferSelect)[] = [];
  let scanCursor = cursor;
  let exhausted = false;
  while (visibleRows.length < limit + 1 && !exhausted) {
    const batchLimit = limit + 1 - visibleRows.length;
    const rows = await db
      .select()
      .from(task)
      .where(
        and(
          eq(task.parentTaskId, parentTaskId),
          eq(task.organizationId, organizationId),
          isNull(task.archivedAt),
          seekAfterId(task.id, scanCursor, 'asc'),
        ),
      )
      .orderBy(asc(task.id))
      .limit(batchLimit);
    const last = rows.at(-1);
    exhausted = rows.length < batchLimit;
    if (last) scanCursor = encodeIdCursor(last.id);
    visibleRows.push(...rows.filter(canView));
  }
  return visibleRows;
}

function dependencyActivities(
  pathTask: typeof task.$inferSelect,
  otherTask: typeof task.$inferSelect,
  blockingTaskId: string,
  blockedTaskId: string,
) {
  return [
    {
      taskId: blockingTaskId,
      title: pathTask.id === blockingTaskId ? pathTask.title : otherTask.title,
      change: {
        field: 'dependency',
        label: 'Dependency',
        from: null,
        to: `Blocks ${blockedTaskId === pathTask.id ? pathTask.title : otherTask.title}`,
      },
    },
    {
      taskId: blockedTaskId,
      title: pathTask.id === blockedTaskId ? pathTask.title : otherTask.title,
      change: {
        field: 'dependency',
        label: 'Dependency',
        from: null,
        to: `Blocked by ${blockingTaskId === pathTask.id ? pathTask.title : otherTask.title}`,
      },
    },
  ];
}

/** Subtask + dependency routes, mounted on the tasks router at `/`. */
export const taskDependencyRoutes = new Hono<AppEnv>()
  .get(
    '/:id/subtasks',
    apiDoc({
      tag: 'Tasks',
      summary: 'List subtasks',
      response: pageOf(TaskOut),
      description: `List visible active direct children of a task in stable task-id order. Pages default to 50 items, accept at most 100, and omit \`nextCursor\` at exhaustion. Visibility is applied before pagination, so hidden children cannot truncate the visible page. Reuse a cursor only for the same parent task.`,
    }),
    zParam(idParam),
    zQuery(CursorQuery),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { cursor, limit } = c.req.valid('query');
      const parent = await loadTask(orgId, id);
      const canView = await buildTaskViewFilter(orgId, actorId);
      if (!canView(parent)) throw new NotFoundError('Task not found');
      const visibleRows = await listVisibleSubtasks(orgId, id, cursor, limit, canView);
      const labelsByTask = await labelsForSubjects(
        'task',
        orgId,
        visibleRows.map((t) => t.id),
      );
      return ok(
        c,
        pageOf(TaskOut),
        pageResultById(
          visibleRows.map((t) => toOut(t, labelsByTask.get(t.id) ?? [])),
          limit,
        ),
      );
    },
  )
  .post(
    '/:id/subtasks',
    apiDoc({
      status: 201,
      tag: 'Tasks',
      summary: 'Create a subtask',
      capability: 'contribute',
      response: TaskOut,
      description: `Create a child task under the path task. The parent is loaded first (cross-org/unknown parent 404s), then the child is inserted with \`parentTaskId\` set to the parent and \`teamId\` inherited from the parent — a subtask always lives on the parent's team and cannot be re-teamed at creation. Requires \`contribute\`.

The child inherits sensible defaults but can override them: \`state\` defaults to the team's first workflow state (typically \`backlog\`), \`projectId\` defaults to the parent's project when omitted, and \`priority\` defaults to \`none\`. Body-provided references (\`assigneeId\`, \`projectId\`, \`cycleId\`, \`milestoneId\`) must belong to the same organization or the request returns 404. This operation does not add a task-created or assignment event to the activity feed. Returns the new child {@link TaskOut}.`,
    }),
    zParam(idParam),
    zJson(SubtaskCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const parent = await loadTask(orgId, id);
      await assertTaskCapability(orgId, actorId, parent, 'contribute');

      // Tenant isolation: body-provided references must live in the caller's org.
      // Values inherited from the in-org parent (`teamId`, `projectId`) need no check.
      await assertRefInOrg(actor, orgId, body.assigneeId, 'Assignee not found');
      await assertRefInOrg(project, orgId, body.projectId, 'Project not found');
      await assertRefInOrg(cycle, orgId, body.cycleId, 'Cycle not found');
      await assertMilestoneInOrg(orgId, body.milestoneId, body.projectId ?? parent.projectId);

      const inherited =
        body.state === undefined
          ? await landingTaskTransition(orgId, parent.teamId)
          : await resolveTaskStatus(orgId, parent.teamId, body.state);
      // `SubtaskCreate.labels` was accepted and discarded here for the same reason
      // `TaskCreate.labels` was: nothing ever wrote the join. Resolve against the parent's team,
      // which the subtask inherits.
      const resolvedLabels = await resolveLabelSet(orgId, body.labels, { teamId: parent.teamId });

      const result = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(task)
          .values({
            organizationId: orgId,
            title: body.title,
            description: body.description,
            teamId: parent.teamId,
            statusId: inherited.statusId,
            state: inherited.state,
            completedAt: inherited.completedAt,
            canceledAt: inherited.canceledAt,
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
        if (resolvedLabels.length > 0) {
          await replaceLabels(tx, 'task', row.id, orgId, resolvedLabels);
        }
        return {
          row,
          cascades: await applySubtaskCompletionPolicyForParents(tx, orgId, [parent.id]),
        };
      });
      const { row, cascades } = result;
      for (const cascade of cascades) {
        await finishTaskStateTransition({ actorId: null }, cascade);
      }
      await enqueueSearchUpsert(orgId, 'task', row.id);
      return created(
        c,
        TaskOut,
        toOut(row, resolvedLabels),
        resourceUrl(`/v1/orgs/${orgId}/tasks/${row.id}`),
      );
    },
  )
  .get(
    '/:id/dependencies',
    apiDoc({
      tag: 'Tasks',
      summary: 'List task dependencies',
      response: TaskDependencyOut,
      description: `Return the path task's two directed dependency lists. \`blocking\` are the tasks THIS task blocks (this task is the blocking side of the edge); \`blockedBy\` are the tasks that block THIS task (this task is the blocked side). The dependency graph is directed \`blocking → blocked\`: a blocked task should not start until its blockers complete. Each entry is a slim {@link TaskRef} carrying \`projectId\` for cross-project rendering. The parent is loaded first (cross-org/unknown id 404s). Requires org membership (\`view\`). Returns {@link TaskDependencyOut}. These same lists are embedded in \`GET /:id\` (task detail).`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const pathTask = await loadTask(orgId, id);
      const canView = await buildTaskViewFilter(orgId, actorId);
      if (!canView(pathTask)) throw new NotFoundError('Task not found');

      // `blocking`: tasks THIS task blocks (this is the blocking side of the edge).
      const blocking = await db
        .select({
          id: task.id,
          title: task.title,
          state: task.state,
          teamId: task.teamId,
          projectId: task.projectId,
          programId: task.programId,
          visibility: task.visibility,
        })
        .from(taskDependency)
        .innerJoin(task, eq(taskDependency.blockedTaskId, task.id))
        .where(
          and(
            eq(taskDependency.blockingTaskId, id),
            eq(taskDependency.organizationId, orgId),
            isNull(task.archivedAt),
          ),
        );
      // `blockedBy`: tasks blocking THIS task (this is the blocked side of the edge).
      const blockedBy = await db
        .select({
          id: task.id,
          title: task.title,
          state: task.state,
          teamId: task.teamId,
          projectId: task.projectId,
          programId: task.programId,
          visibility: task.visibility,
        })
        .from(taskDependency)
        .innerJoin(task, eq(taskDependency.blockingTaskId, task.id))
        .where(
          and(
            eq(taskDependency.blockedTaskId, id),
            eq(taskDependency.organizationId, orgId),
            isNull(task.archivedAt),
          ),
        );

      const payload: z.input<typeof TaskDependencyOut> = {
        blocking: blocking.filter(canView).map(toRef),
        blockedBy: blockedBy.filter(canView).map(toRef),
      };
      return ok(c, TaskDependencyOut, payload);
    },
  )
  .post(
    '/:id/dependencies',
    apiDoc({
      status: 201,
      tag: 'Tasks',
      summary: 'Add a task dependency',
      capability: 'contribute',
      response: TaskDependencyCreated,
      description: `Add a blocking relationship involving the task in the path. Supply exactly one of \`blockingTaskId\` or \`blockedTaskId\`. \`blockingTaskId\` makes that task block the path task. \`blockedTaskId\` makes the path task block that task. Both tasks must be active and belong to this organization; otherwise Docket returns 404.

A task cannot block itself, and a new relationship cannot create a dependency cycle. A self-reference returns 422. A duplicate or cyclic relationship returns 409. Concurrent requests cannot create a cycle: Docket accepts the complete valid relationship or makes no change. The response contains the resolved blocking and blocked task IDs. Use \`DELETE /:id/dependencies/:depId\` to remove the relationship.`,
    }),
    zParam(idParam),
    zJson(TaskDependencyCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');

      // Resolve the directed edge relative to the path task.
      const blockingTaskId = body.blockingTaskId ?? id;
      const blockedTaskId = body.blockedTaskId ?? id;
      const otherId = body.blockingTaskId ?? body.blockedTaskId;
      /* v8 ignore next -- @preserve defensive: the DTO refine guarantees exactly one side is set */
      if (otherId === undefined) throw new NotFoundError('Task not found');

      // Both endpoints must be active tasks in this org, and a dependency changes the graph from
      // both sides. A grant to one private task must not let a caller attach it to another task
      // they cannot address.
      const pathTask = await loadTask(orgId, id);
      await assertTaskCapability(orgId, actorId, pathTask, 'contribute');

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

      const otherTask = await loadTask(orgId, otherId);
      await assertTaskCapability(orgId, actorId, otherTask, 'contribute');
      const dependencyActivity = dependencyActivities(
        pathTask,
        otherTask,
        blockingTaskId,
        blockedTaskId,
      );

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
        await tx.insert(auditEvent).values(
          dependencyActivity.flatMap((activity) =>
            taskActivityRows({
              organizationId: orgId,
              taskId: activity.taskId,
              title: activity.title,
              actorId,
              changes: [activity.change],
            }),
          ),
        );
      });

      return created(
        c,
        TaskDependencyCreated,
        { created: true, blockingTaskId, blockedTaskId },
        null,
      );
    },
  )
  .delete(
    '/:id/dependencies/:depId',
    apiDoc({
      tag: 'Tasks',
      summary: 'Remove a task dependency',
      capability: 'contribute',
      response: TaskRemoved,
      description: `Remove the dependency between two tasks without deleting either task. The caller does not need to know which task is the blocking side. The request returns 404 when either task or the dependency is not visible in the organization. Requires the \`contribute\` capability and returns a {@link TaskRemoved} acknowledgement.`,
    }),
    zParam(depParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id, depId } = c.req.valid('param');
      const pathTask = await loadTask(orgId, id);
      await assertTaskCapability(orgId, actorId, pathTask, 'contribute');
      const otherTask = await loadTask(orgId, depId);
      await assertTaskCapability(orgId, actorId, otherTask, 'contribute');

      // The edge is removable from either endpoint: (id→depId) or (depId→id).
      await db.transaction(async (tx) => {
        const deleted = await tx
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
        const edge = deleted[0];
        if (!edge) throw new NotFoundError('Dependency edge not found');
        const dependencyActivity = [
          {
            taskId: edge.blockingTaskId,
            title: edge.blockingTaskId === pathTask.id ? pathTask.title : otherTask.title,
            change: {
              field: 'dependency',
              label: 'Dependency',
              from: `Blocks ${edge.blockedTaskId === pathTask.id ? pathTask.title : otherTask.title}`,
              to: null,
            },
          },
          {
            taskId: edge.blockedTaskId,
            title: edge.blockedTaskId === pathTask.id ? pathTask.title : otherTask.title,
            change: {
              field: 'dependency',
              label: 'Dependency',
              from: `Blocked by ${edge.blockingTaskId === pathTask.id ? pathTask.title : otherTask.title}`,
              to: null,
            },
          },
        ];
        await tx.insert(auditEvent).values(
          dependencyActivity.flatMap((activity) =>
            taskActivityRows({
              organizationId: orgId,
              taskId: activity.taskId,
              title: activity.title,
              actorId,
              changes: [activity.change],
            }),
          ),
        );
      });
      return ok(c, TaskRemoved, { removed: true });
    },
  );
