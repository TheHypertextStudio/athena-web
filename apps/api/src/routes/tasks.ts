/** `@docket/api` — tasks router (mounted at `/v1/orgs/:orgId/tasks`). */
import { type Capability, satisfies } from '@docket/authz';
import {
  actor,
  cycle,
  db,
  program,
  project,
  task,
  taskDependency,
  taskLabel,
  team,
} from '@docket/db';
import {
  pageOf,
  TaskArchived,
  TaskCreate,
  TaskDetail,
  TaskListQuery,
  TaskOut,
  TaskStateUpdate,
  TaskUpdate,
} from '@docket/types';
import { and, desc, eq, exists, inArray, isNull, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { z } from 'zod';

import type { AppEnv } from '../context';
import { CapabilityError, CycleError, NotFoundError, ValidationError } from '../error';
import { labelsForSubject, labelsForSubjects, replaceLabels, resolveLabelSet } from '../lib/labels';
import { ok } from '../lib/ok';
import { diffTaskFields, recordTaskChanges, resolveTaskChangeLabels } from '../lib/task-audit';
import { setTaskState } from '../lib/task-state';
import { pageResult, seekAfter } from '../lib/list-cursor';
import { apiDoc } from '../lib/openapi-route';
import { serializableTx } from '../lib/serializable-tx';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';

import { emitEvent } from './event-emit';
import {
  assertMilestoneInOrg,
  assertRefInOrg,
  idParam,
  loadTask,
  resolveStateTransition,
  toOut,
  toRef,
  wouldCreateSubtaskCycle,
} from './task-helpers';
import { attachmentRoutes } from './attachment-routes';
import { taskActivityRoutes } from './task-activity-routes';
import { taskDependencyRoutes } from './task-dependency-routes';

/** Project a stored timestamp column onto the calendar day it names, or null when unset. */
function dayOf(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

/**
 * Reject a PATCH that would leave the task due before it is anticipated to start.
 *
 * @remarks
 * {@link TaskUpdate} catches the case where one request supplies both days, but not the sequential
 * one — moving the anticipated start past a due date already stored, or the due date back before a
 * start already stored. Only the route can see that, because only the route has the pre-image. It
 * is checked here rather than as a CHECK constraint on purpose: a constraint violation surfaces as
 * a storage error with no field attribution, while this is a 422 naming the field the caller sent
 * and carrying copy the application owns.
 *
 * @param before - The task as stored, supplying whichever day the body omits.
 * @param patch - The columns this request is about to write.
 * @throws {ValidationError} When the resulting window would run backwards.
 */
function assertTaskWindowOrdered(
  before: { startDate: Date | null; dueDate: Date | null },
  patch: { startDate?: Date | null; dueDate?: Date | null },
): void {
  const start = dayOf(patch.startDate === undefined ? before.startDate : patch.startDate);
  const due = dayOf(patch.dueDate === undefined ? before.dueDate : patch.dueDate);
  // Lexicographic comparison is exact for zero-padded `YYYY-MM-DD` and keeps the question about
  // calendar days rather than about the server's timezone.
  if (start === null || due === null || due >= start) return;
  throw new ValidationError([
    {
      message: 'Due date cannot fall before the anticipated start date',
      path: [patch.dueDate === undefined ? 'startDate' : 'dueDate'],
    },
  ]);
}

/**
 * Ride the shared write-through seam for every task write.
 *
 * @remarks
 * Calling `enqueueSearchIndexJob` directly here would quietly skip the two other things that seam
 * does: MCP subscribers would never learn the task changed, and a task description's references
 * would never be extracted. Anything that writes a task goes through {@link enqueueSearchUpsert}.
 */
async function enqueueTaskSearchIndex(
  organizationId: string,
  entityId: string,
  operation: 'upsert' | 'delete' = 'upsert',
): Promise<void> {
  await (operation === 'upsert'
    ? enqueueSearchUpsert(organizationId, 'task', entityId)
    : enqueueSearchDelete(organizationId, 'task', entityId));
}

/** Tasks router: lifecycle (create/list/detail/update/archive/state) + subtasks + dependencies. */
const tasks = new Hono<AppEnv>()
  .post(
    '/',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Tasks',
      summary: 'Create a task',
      capability: 'contribute',
      response: TaskOut,
      description: `Create a new native task inside the org. A task is the atomic unit of work in Docket; it always belongs to exactly one team (\`teamId\`, required) and inherits that team's workflow. Requires the \`contribute\` capability — the privilege to create or edit work content.

The team must exist in the caller's org or the request 404s. Tenant isolation is strict: every optional reference in the body (\`assigneeId\`, \`projectId\`, \`cycleId\`, \`milestoneId\`, \`parentTaskId\`) is checked to live in the same org, and any cross-org or unknown id 404s before insert — the existence of out-of-tenant rows is never leaked.

Workflow state: if \`state\` is omitted the task lands in the team's first \`workflow_states\` entry (typically \`backlog\`); if supplied, the key is validated against the team's states and the transition is resolved so that a task created directly in a terminal state (\`completed\`/\`canceled\`) lands with the correct derived \`completedAt\`/\`canceledAt\` timestamps. \`priority\` defaults to \`none\`.

Side effects: emits a \`created\` observation onto the org's activity stream, and — when the task is created already assigned — an additional \`assignment\` observation. Returns the created {@link TaskOut}. Note that creating a task on someone else's behalf (\`assigneeId\`) is permitted under \`contribute\` at creation time; later reassignment via PATCH requires \`assign\` (see {@link TaskUpdate}). Related: \`POST /:id/subtasks\` to create children, \`POST /:id/dependencies\` to wire blockers.`,
    }),
    zJson(TaskCreate),
    async (c) => {
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
      await assertMilestoneInOrg(orgId, body.milestoneId, body.projectId);
      if (body.parentTaskId !== undefined) await loadTask(orgId, body.parentTaskId);

      // resolveStateTransition validates the state key and derives terminal timestamps so
      // a task created directly in a `completed`/`canceled` state lands with correct fields.
      const firstState = teamRow.workflowStates[0];
      const { state, completedAt, canceledAt } = firstState
        ? await resolveStateTransition(orgId, body.teamId, body.state ?? firstState.key)
        : { state: body.state ?? 'backlog', completedAt: null, canceledAt: null };

      // Labels were accepted by the DTO and silently dropped here until now. Resolve against the
      // task's own team so a team-limited label is offerable, and let the shared write path
      // collapse any exclusive-group collision.
      const resolvedLabels = await resolveLabelSet(orgId, body.labels, { teamId: body.teamId });

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
          startDate: body.startDate ? new Date(body.startDate) : undefined,
          dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
          source: 'native',
          createdBy: actorId,
        })
        .returning();
      const row = inserted[0];
      /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
      if (!row) throw new Error('task insert returned no row');

      if (resolvedLabels.length > 0) {
        await db.transaction((tx) => replaceLabels(tx, 'task', row.id, orgId, resolvedLabels));
      }

      // Stream: record the creation, plus an assignment event when it lands on someone.
      const subject = { type: 'task', id: row.id, title: row.title };
      await emitEvent({
        organizationId: orgId,
        kind: 'created',
        actorId,
        title: row.title,
        subject,
      });
      if (row.assigneeId) {
        await emitEvent({
          organizationId: orgId,
          kind: 'assignment',
          actorId,
          title: row.title,
          subject,
        });
      }
      // No creation entry is written: the row's own `createdAt`/`createdBy` are that record, and
      // the activity endpoint projects the entry from them (see `lib/task-audit.ts`).
      await enqueueTaskSearchIndex(orgId, row.id);
      return ok(c, TaskOut, toOut(row, await labelsForSubject('task', orgId, row.id)));
    },
  )
  .get(
    '/',
    apiDoc({
      tag: 'Tasks',
      summary: 'List tasks',
      response: pageOf(TaskOut),
      description: `List the org's active (non-archived) tasks, newest-first. Ordering is a stable keyset on \`(createdAt DESC, id DESC)\`, so paging never skips or repeats a row even as tasks are created concurrently. Archived (soft-deleted) tasks are excluded — fetch those contexts via their parent/project surfaces, not here.

Pagination is opt-in via the cursor query: omit \`limit\` to receive the full active-task list in one response (legacy behavior); supply \`limit\` to receive a bounded page plus a \`nextCursor\` you pass back as \`cursor\` to fetch the next page. \`nextCursor\` is \`null\` on the final page. An optional \`labelId\` narrows the list to tasks carrying that label; an optional \`programId\` narrows the list to tasks under that Program — carrying its \`program_id\` directly, or belonging to one of the Program's Projects (the same union a Program's own work view applies). Requires org membership (\`view\`); no extra capability. Each item is a {@link TaskOut} (the flat task shape without dependency/subtask edges — use \`GET /:id\` for those). Returns a cursor page of {@link TaskOut}.`,
    }),
    zQuery(TaskListQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { cursor, limit, programId, labelId } = c.req.valid('query');

      // Label filter: an EXISTS against the join, so a task carrying the label once is returned
      // once — a plain inner join would duplicate rows and corrupt the keyset page size.
      const labelFilter =
        labelId === undefined
          ? undefined
          : exists(
              db
                .select({ one: sql`1` })
                .from(taskLabel)
                .where(
                  and(
                    eq(taskLabel.taskId, task.id),
                    eq(taskLabel.labelId, labelId),
                    eq(taskLabel.organizationId, orgId),
                  ),
                ),
            );

      // Same "under the Program" union the Program's own work view applies: a task carrying the
      // Program directly, or belonging to one of the Program's Projects.
      let programFilter;
      if (programId !== undefined) {
        const projectRows = await db
          .select({ id: project.id })
          .from(project)
          .where(and(eq(project.programId, programId), eq(project.organizationId, orgId)));
        const projectIds = projectRows.map((p) => p.id);
        programFilter =
          projectIds.length > 0
            ? or(eq(task.programId, programId), inArray(task.projectId, projectIds))
            : eq(task.programId, programId);
      }

      // Keyset-paginate newest-first (createdAt, id tiebreak). `limit` is optional: omitted returns
      // the full active-task list as before; supplied returns a bounded page + `nextCursor`.
      const base = db
        .select()
        .from(task)
        .where(
          and(
            eq(task.organizationId, orgId),
            isNull(task.archivedAt),
            seekAfter(task.createdAt, task.id, cursor),
            ...(programFilter ? [programFilter] : []),
            ...(labelFilter ? [labelFilter] : []),
          ),
        )
        .orderBy(desc(task.createdAt), desc(task.id));
      const rows = await (limit === undefined ? base : base.limit(limit + 1));
      const { items, nextCursor } = pageResult(rows, limit, (r) => r.createdAt);
      // One extra query for the whole page rather than one per row.
      const labelsByTask = await labelsForSubjects(
        'task',
        orgId,
        items.map((t) => t.id),
      );
      return ok(c, pageOf(TaskOut), {
        items: items.map((t) => toOut(t, labelsByTask.get(t.id) ?? [])),
        nextCursor,
      });
    },
  )
  .get(
    '/:id',
    apiDoc({
      tag: 'Tasks',
      summary: 'Get task detail',
      response: TaskDetail,
      description: `Fetch one task with its full relational context: the flat task fields plus the planning ids omitted from {@link TaskOut} (\`milestoneId\`, \`cycleId\`, \`parentTaskId\`, \`estimate\`), the terminal timestamps (\`completedAt\`/\`canceledAt\`), and three resolved edge lists — \`blocking\` (tasks this one blocks), \`blockedBy\` (tasks blocking this one), and \`subtasks\` (active children). Each edge is a slim {@link TaskRef} carrying \`projectId\` so the UI can render cross-project links.

A cross-org or unknown id 404s (existence-hiding: another tenant's task is indistinguishable from a non-existent one). Subtasks exclude archived children. Requires org membership (\`view\`). Returns {@link TaskDetail}. For just the edge lists without the parent task, see \`GET /:id/dependencies\`; for the canvas projection across many tasks, see the graph endpoint.`,
    }),
    zParam(idParam),
    async (c) => {
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
        .where(
          and(eq(taskDependency.blockingTaskId, id), eq(taskDependency.organizationId, orgId)),
        );
      const subtaskRows = await db
        .select({ id: task.id, title: task.title, state: task.state, projectId: task.projectId })
        .from(task)
        .where(
          and(eq(task.parentTaskId, id), eq(task.organizationId, orgId), isNull(task.archivedAt)),
        );

      const detail: z.input<typeof TaskDetail> = {
        ...toOut(row, await labelsForSubject('task', orgId, row.id)),
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
    },
  )
  .patch(
    '/:id',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Tasks',
      summary: 'Update a task',
      capability: 'contribute',
      response: TaskOut,
      description: `Partially update a task's editable fields; only fields present in the body change, and an empty body is a valid no-op that returns the task unchanged (the storage layer rejects an empty \`SET\`, so the handler short-circuits). Base mutation requires \`contribute\`.

Reassigning (\`assigneeId\`) or delegating (\`delegateId\`) additionally requires the \`assign\` capability — \`contribute\` alone cannot move work onto another actor; without \`assign\` those two fields 403. Reparenting is RESTful: set \`parentTaskId\` to nest the task under another (its subtask) or null to detach to top-level; a task cannot be its own parent (422) or its own descendant (409 \`dependency_cycle\`), and the acyclic check + write run in one SERIALIZABLE transaction. Every referenced id (\`assigneeId\`, \`delegateId\`, \`projectId\`, \`programId\`, \`parentTaskId\`, \`cycleId\`, \`milestoneId\`) must live in the caller's org or the request 404s (existence-hiding tenant isolation).

Changing \`state\` runs the team's workflow-state transition: the key is validated against the team's \`workflow_states\`, and \`completedAt\`/\`canceledAt\` are derived (set when entering a terminal state, cleared when leaving one) — the timestamps are never client-supplied. Side effects: a state change emits a \`completed\` observation when it lands terminal, otherwise a \`status_change\`; setting an assignee emits an \`assignment\` observation. A missing/archived task 404s. Returns the updated {@link TaskOut}. To change only state, the dedicated \`POST /:id/state\` exists.`,
    }),
    zParam(idParam),
    zJson(TaskUpdate),
    async (c) => {
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
      // Effective project for milestone scoping: the incoming `projectId` when the patch
      // re-points the task, otherwise its current one — loaded lazily, only when a
      // non-null `milestoneId` is actually being set and the patch doesn't already carry
      // a `projectId` to check against.
      const effectiveProjectId =
        body.milestoneId == null
          ? undefined
          : body.projectId !== undefined
            ? body.projectId
            : (await loadTask(orgId, id)).projectId;
      await assertMilestoneInOrg(orgId, body.milestoneId, effectiveProjectId);

      // Reparent (RESTful: `parentTaskId` is a property of the task). Validate the new parent is a
      // real in-org task and not the task itself; the acyclic guard runs in the write tx below.
      const newParentId = body.parentTaskId ?? null;
      if (newParentId !== null) {
        if (newParentId === id) {
          throw new ValidationError([
            { message: 'A task cannot be its own parent', path: ['parentTaskId'] },
          ]);
        }
        await loadTask(orgId, newParentId);
      }

      // The pre-image, read exactly once: it feeds both the state-transition resolve below and
      // the activity ledger's before/after diff, so recording history costs no extra read.
      const before = await loadTask(orgId, id);

      // resolveStateTransition validates + derives timestamps; bypassing it would corrupt progress.
      const statePatch =
        body.state !== undefined
          ? await resolveStateTransition(orgId, before.teamId, body.state)
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
        ...(body.parentTaskId !== undefined ? { parentTaskId: body.parentTaskId } : {}),
        ...(body.milestoneId !== undefined ? { milestoneId: body.milestoneId } : {}),
        ...(body.cycleId !== undefined ? { cycleId: body.cycleId } : {}),
        ...(body.estimate !== undefined ? { estimate: body.estimate } : {}),
        ...(body.estimateMinutes !== undefined ? { estimateMinutes: body.estimateMinutes } : {}),
        ...(body.startDate !== undefined
          ? { startDate: body.startDate ? new Date(body.startDate) : null }
          : {}),
        ...(body.dueDate !== undefined
          ? { dueDate: body.dueDate ? new Date(body.dueDate) : null }
          : {}),
      };

      // A labels-only body has an empty column patch but is not a no-op.
      const patchLabels =
        body.labels === undefined
          ? undefined
          : await resolveLabelSet(orgId, body.labels, { teamId: before.teamId });

      // An empty patch body is a valid no-op: Drizzle rejects an empty `.set({})`.
      if (Object.keys(patch).length === 0) {
        if (patchLabels !== undefined) {
          await db.transaction((tx) => replaceLabels(tx, 'task', id, orgId, patchLabels));
          await enqueueTaskSearchIndex(orgId, id);
        }
        const current = await loadTask(orgId, id);
        return ok(c, TaskOut, toOut(current, await labelsForSubject('task', orgId, id)));
      }

      // Date validity, second layer: the DTO checked the days this request carries against each
      // other; this checks them against the days already stored.
      assertTaskWindowOrdered(before, patch);

      const where = and(eq(task.id, id), eq(task.organizationId, orgId), isNull(task.archivedAt));
      // Reparenting to a non-null parent: check the acyclic invariant + write atomically under
      // SERIALIZABLE so two concurrent reparents can't each pass and commit a subtask loop.
      const row =
        newParentId !== null
          ? await serializableTx(async (tx) => {
              if (await wouldCreateSubtaskCycle(tx, orgId, id, newParentId)) {
                throw new CycleError('Reparenting would create a subtask cycle');
              }
              return (await tx.update(task).set(patch).where(where).returning())[0];
            })
          : (await db.update(task).set(patch).where(where).returning())[0];
      if (!row) throw new NotFoundError('Task not found');

      // Stream: a state transition (completed when it landed terminal) and/or a reassignment.
      const subject = { type: 'task', id: row.id, title: row.title };
      if (statePatch !== undefined) {
        await emitEvent({
          organizationId: orgId,
          kind: statePatch.completedAt ? 'completed' : 'status_change',
          actorId: ctx.actorId,
          title: row.title,
          subject,
          detail: { schema: 'docket.state_change', fromState: null, toState: row.state },
        });
      }
      if (body.assigneeId) {
        await emitEvent({
          organizationId: orgId,
          kind: 'assignment',
          actorId: ctx.actorId,
          title: row.title,
          subject,
        });
      }
      // Ledger: one entry per field that actually moved. The diff is computed from the pre-image
      // read above, so a field re-sent at its current value records nothing.
      await recordTaskChanges({
        organizationId: orgId,
        taskId: row.id,
        title: row.title,
        actorId: ctx.actorId,
        changes: await resolveTaskChangeLabels(orgId, diffTaskFields(before, row)),
      });
      if (patchLabels !== undefined) {
        await db.transaction((tx) => replaceLabels(tx, 'task', row.id, orgId, patchLabels));
      }
      await enqueueTaskSearchIndex(orgId, row.id);
      return ok(c, TaskOut, toOut(row, await labelsForSubject('task', orgId, row.id)));
    },
  )
  .delete(
    '/:id',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Tasks',
      summary: 'Archive a task',
      capability: 'contribute',
      response: TaskArchived,
      description: `Soft-delete a task by stamping \`archivedAt\`. This is an archive, not a hard delete: the row is retained for history/audit and simply filtered out of \`GET /\`, subtask listings, and the graph. Requires \`contribute\`.

The write only matches a currently-active task in the caller's org (\`archivedAt IS NULL\`), so archiving an already-archived, cross-org, or unknown task 404s — and re-archiving is therefore not idempotent (the second call 404s). Child tasks and dependency edges are left intact in storage; they simply stop surfacing through active-task reads. Returns a {@link TaskArchived} acknowledgement with the \`id\` and the \`archivedAt\` timestamp.`,
    }),
    zParam(idParam),
    async (c) => {
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
      await enqueueTaskSearchIndex(orgId, row.id, 'delete');
      return ok(c, TaskArchived, {
        id: row.id,
        /* v8 ignore next -- @preserve defensive: archivedAt was just set above */
        archivedAt: (row.archivedAt ?? archivedAt).toISOString(),
      });
    },
  )
  .post(
    '/:id/state',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Tasks',
      summary: 'Change task state',
      capability: 'contribute',
      response: TaskOut,
      description: `Move a task to a new workflow state — the focused alternative to a full PATCH when only the state changes (e.g. a board drag-and-drop). Requires \`contribute\`. The \`state\` key must exist in the owning team's \`workflow_states\`; an unknown key is rejected.

The transition is resolved server-side: entering a terminal state derives \`completedAt\` (for the completed category) or \`canceledAt\` (for canceled), and leaving a terminal state clears them — these timestamps are authoritative and never client-set, so progress rollups stay correct. Side effect: emits a \`completed\` observation when the task lands in a completed state, otherwise a \`status_change\` observation carrying the new \`state\` in its payload. A missing/archived task 404s. Returns the updated {@link TaskOut}.`,
    }),
    zParam(idParam),
    zJson(TaskStateUpdate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { state } = c.req.valid('json');
      // Shared with the task.setStatus automation action — one transition implementation.
      const next = await setTaskState({ organizationId: orgId, taskId: id, state, actorId });
      if (!next) throw new NotFoundError('Task not found');
      return ok(c, TaskOut, toOut(next, await labelsForSubject('task', orgId, next.id)));
    },
  )
  .route('/', taskDependencyRoutes)
  .route('/', taskActivityRoutes)
  .route('/', attachmentRoutes);

export default tasks;
