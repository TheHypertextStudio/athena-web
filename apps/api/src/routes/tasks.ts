/** `@docket/api` — tasks router (mounted at `/v1/orgs/:orgId/tasks`). */
import {
  actor,
  attachment,
  auditEvent,
  changeSet,
  changeSetEntry,
  cycle,
  db,
  label,
  program,
  project,
  task,
  taskDependency,
  taskLabel,
  taskRelatedTask,
  team,
  teamMember,
  template,
} from '@docket/db';
import {
  pageOf,
  TaskArchived,
  TaskCreate,
  TaskDetail,
  TaskDetailAggregate,
  TaskId,
  TaskListQuery,
  TaskOut,
  TaskReparentBatchIn,
  TaskReparentBatchOut,
  TaskStateUpdate,
  TaskTemplateDraft,
  TaskUpdate,
} from '@docket/types';
import { constrainTaskExpansion } from '@docket/athena/task-expansion';
import { and, asc, desc, eq, exists, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../error';
import { deferAfterResponse } from '../lib/after-response';
import { detailCapabilities } from '../lib/detail-capabilities';
import { guardsInOrder } from '../lib/guards-in-order';
import {
  applyExclusivity,
  labelsForSubject,
  labelsForSubjects,
  replaceLabels,
  resolveAttachedLabels,
  resolveLabelSet,
} from '../lib/labels';
import { created, ok } from '../lib/ok';
import { rawResultRows } from '../lib/raw-result';
import {
  announceTaskChanges,
  diffTaskFields,
  recordTaskChanges,
  resolveTaskChangeLabels,
  taskActivityRows,
} from '../lib/task-audit';
import {
  applySubtaskCompletionPolicyForParents,
  finishTaskStateTransition,
  setTaskState,
} from '../lib/task-state';
import { encodeListCursor, pageResult, seekAfter } from '../lib/list-cursor';
import { landingStatus, terminalStampsFor } from '../lib/work-status';
import { apiDoc } from '../lib/openapi-route';
import { serializableTx } from '../lib/serializable-tx';
import { advanceCompletedProcessTask } from '../lib/recurrence/advance';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { productCapabilityGuard } from '../product-capability';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';
import { planTaskReparents, reparentTasks } from '../services/task-hierarchy';
import { getContainer } from '../container';
import {
  recordChangeSetInTransaction,
  trackedFields,
  undoChangeSetAtomically,
  type RecordedChange,
} from '../mcp/change-set';

import { emitEvent } from './event-emit';
import { loadEntityMentions } from '../content/entity-mentions';
import {
  assertTaskCapability,
  assertMilestoneInOrg,
  assertRefInOrg,
  buildTaskViewFilter,
  idParam,
  loadTask,
  resolveStateTransition,
  type TaskRow,
  toOut,
  toRef,
  wouldCreateCycle,
} from './task-helpers';
import { attachmentRoutes } from './attachment-routes';
import { taskActivityRoutes } from './task-activity-routes';
import { taskDependencyRoutes } from './task-dependency-routes';

/** Project a stored timestamp column onto the calendar day it names, or null when unset. */
function dayOf(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

/** Require a caller-visible task template that can originate a task. */
async function assertTaskTemplate(
  orgId: string,
  actorId: string,
  templateId: string | null | undefined,
): Promise<void> {
  if (templateId === null || templateId === undefined) return;
  // This endpoint retains a template id on work. It must use the same visibility boundary as
  // `/templates`: a foreign personal or team template is hidden rather than merely invalid.
  // The database foreign key cannot encode the organization or membership predicates, so this
  // route owns the tenant and caller boundary before it writes the reference.
  const rows = await db
    .select({ targetType: template.targetType })
    .from(template)
    .where(
      and(
        eq(template.id, templateId),
        eq(template.organizationId, orgId),
        or(
          eq(template.scope, 'organization'),
          and(eq(template.scope, 'personal'), eq(template.ownerActorId, actorId)),
          and(
            eq(template.scope, 'team'),
            exists(
              db
                .select({ one: sql`1` })
                .from(teamMember)
                .where(
                  and(
                    eq(teamMember.organizationId, orgId),
                    eq(teamMember.actorId, actorId),
                    eq(teamMember.teamId, template.teamId),
                  ),
                ),
            ),
          ),
        ),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Template not found');
  if (row.targetType !== 'task') {
    throw new ValidationError([{ message: 'Template must create tasks', path: ['templateId'] }]);
  }
}

/** Store an undirected edge under its canonical endpoint ordering. */
function relatedTaskPair(taskId: string, relatedTaskId: string) {
  return taskId < relatedTaskId
    ? { taskId, relatedTaskId }
    : { taskId: relatedTaskId, relatedTaskId: taskId };
}

/**
 * Read the Task content needed by both the legacy detail route and the local-first aggregate.
 *
 * @param orgId - The tenant that scopes every read.
 * @param actorId - The caller whose task grants filter the related records.
 * @param id - The Task to read.
 * @returns The Task row, its filtered detail projection, and its own team's workflow states.
 */
async function loadTaskDetailAggregate(
  orgId: string,
  actorId: string,
  id: string,
): Promise<{
  readonly row: Awaited<ReturnType<typeof loadTask>>;
  readonly detail: z.input<typeof TaskDetail>;
  readonly workflowStates: z.input<typeof TaskDetailAggregate>['references']['workflowStates'];
}> {
  const [taskWithTeamRows, canView] = await Promise.all([
    db
      .select({ row: task, workflowStates: team.workflowStates })
      .from(task)
      .innerJoin(team, and(eq(task.teamId, team.id), eq(team.organizationId, orgId)))
      .where(and(eq(task.id, id), eq(task.organizationId, orgId), isNull(task.archivedAt)))
      .limit(1),
    buildTaskViewFilter(orgId, actorId),
  ]);
  const taskWithTeam = taskWithTeamRows[0];
  if (!taskWithTeam) throw new NotFoundError('Task not found');
  const { row, workflowStates } = taskWithTeam;
  if (!canView(row)) throw new NotFoundError('Task not found');

  const [relatedResult, labels] = await Promise.all([
    db.execute(sql`
      WITH related AS (
        SELECT 'parent'::text AS relation, t.id, t.title, t.state,
          t.team_id AS "teamId", t.project_id AS "projectId",
          t.program_id AS "programId", t.visibility
        FROM task t
        WHERE t.id = ${row.parentTaskId}
          AND t.organization_id = ${orgId}
          AND t.archived_at IS NULL
        UNION ALL
        SELECT 'blockedBy'::text AS relation, t.id, t.title, t.state,
          t.team_id AS "teamId", t.project_id AS "projectId",
          t.program_id AS "programId", t.visibility
        FROM task_dependency d
        INNER JOIN task t ON t.id = d.blocking_task_id
        WHERE d.blocked_task_id = ${id}
          AND d.organization_id = ${orgId}
          AND t.archived_at IS NULL
        UNION ALL
        SELECT 'blocking'::text AS relation, t.id, t.title, t.state,
          t.team_id AS "teamId", t.project_id AS "projectId",
          t.program_id AS "programId", t.visibility
        FROM task_dependency d
        INNER JOIN task t ON t.id = d.blocked_task_id
        WHERE d.blocking_task_id = ${id}
          AND d.organization_id = ${orgId}
          AND t.archived_at IS NULL
        UNION ALL
        SELECT 'subtask'::text AS relation, t.id, t.title, t.state,
          t.team_id AS "teamId", t.project_id AS "projectId",
          t.program_id AS "programId", t.visibility
        FROM task t
        WHERE t.parent_task_id = ${id}
          AND t.organization_id = ${orgId}
          AND t.archived_at IS NULL
        UNION ALL
        SELECT 'related'::text AS relation, t.id, t.title, t.state,
          t.team_id AS "teamId", t.project_id AS "projectId",
          t.program_id AS "programId", t.visibility
        FROM task_related_task r
        INNER JOIN task t ON t.id = CASE
          WHEN r.task_id = ${id} THEN r.related_task_id
          ELSE r.task_id
        END
        WHERE (r.task_id = ${id} OR r.related_task_id = ${id})
          AND r.organization_id = ${orgId}
          AND t.archived_at IS NULL
      )
      SELECT * FROM related
    `),
    labelsForSubject('task', orgId, row.id),
  ]);
  interface RelatedTaskRow {
    readonly relation: 'parent' | 'blockedBy' | 'blocking' | 'subtask' | 'related';
    readonly id: string;
    readonly title: string;
    readonly state: string;
    readonly teamId: string;
    readonly projectId: string | null;
    readonly programId: string | null;
    readonly visibility: 'public' | 'private';
  }
  const relatedRows = rawResultRows<RelatedTaskRow>(relatedResult).filter(canView);
  const related = (relation: RelatedTaskRow['relation']) =>
    relatedRows.filter((candidate) => candidate.relation === relation);
  const visibleParentId = related('parent')[0]?.id ?? null;

  return {
    row,
    workflowStates,
    detail: {
      ...toOut(row, labels),
      milestoneId: row.milestoneId,
      cycleId: row.cycleId,
      parentTaskId: visibleParentId,
      estimate: row.estimate,
      estimateMinutes: row.estimateMinutes,
      completedAt: row.completedAt?.toISOString() ?? null,
      canceledAt: row.canceledAt?.toISOString() ?? null,
      blocking: related('blocking').map(toRef),
      blockedBy: related('blockedBy').map(toRef),
      subtasks: related('subtask').map(toRef),
      relatedTasks: related('related').map(toRef),
    },
  };
}

/** The aggregate route refuses malformed Task ids before it can start a data read. */
const aggregateIdParam = z.object({ id: TaskId });

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

/** Load only resources that are already direct or visibility-filtered context for one task. */
async function loadTaskExpansionResources(
  orgId: string,
  actorId: string,
  taskId: string,
): Promise<readonly { title: string; url: string | null }[]> {
  const [attachments, mentions] = await Promise.all([
    db
      .select({ title: attachment.title, url: attachment.url })
      .from(attachment)
      .where(
        and(
          eq(attachment.organizationId, orgId),
          eq(attachment.subjectType, 'task'),
          eq(attachment.subjectId, taskId),
          isNull(attachment.archivedAt),
        ),
      )
      .orderBy(asc(attachment.createdAt)),
    loadEntityMentions({
      caller: { kind: 'agent', actorId, organizationId: orgId },
      orgId,
      subjectType: 'task',
      subjectId: taskId,
    }),
  ]);
  return [
    ...attachments,
    ...mentions.external.map((mention) => ({ title: mention.label, url: mention.href })),
    ...mentions.entities.map((mention) => ({ title: mention.label, url: null })),
  ];
}

/** The task representation and one opaque operation token returned by description expansion. */
const TaskExpansionOut = z.object({
  task: TaskDetail,
  undoToken: z.string().nullable(),
});

/** Load the visibility-filtered TaskDetail projection used by every task-detail response. */
async function loadTaskDetail(
  orgId: string,
  actorId: string,
  id: string,
  loaded?: TaskRow,
): Promise<z.input<typeof TaskDetail>> {
  const row = loaded ?? (await loadTask(orgId, id));
  const canView = await buildTaskViewFilter(orgId, actorId);
  if (!canView(row)) throw new NotFoundError('Task not found');
  const parentRows =
    row.parentTaskId === null
      ? []
      : await db
          .select({
            id: task.id,
            teamId: task.teamId,
            projectId: task.projectId,
            programId: task.programId,
            visibility: task.visibility,
          })
          .from(task)
          .where(
            and(
              eq(task.id, row.parentTaskId),
              eq(task.organizationId, orgId),
              isNull(task.archivedAt),
            ),
          )
          .limit(1);
  const visibleParentId = parentRows[0] && canView(parentRows[0]) ? parentRows[0].id : null;
  const edgeColumns = {
    id: task.id,
    title: task.title,
    state: task.state,
    teamId: task.teamId,
    projectId: task.projectId,
    programId: task.programId,
    visibility: task.visibility,
  };
  const [blockedByRows, blockingRows, subtaskRows, relatedTaskRows] = await Promise.all([
    db
      .select(edgeColumns)
      .from(taskDependency)
      .innerJoin(task, eq(taskDependency.blockingTaskId, task.id))
      .where(
        and(
          eq(taskDependency.blockedTaskId, id),
          eq(taskDependency.organizationId, orgId),
          isNull(task.archivedAt),
        ),
      ),
    db
      .select(edgeColumns)
      .from(taskDependency)
      .innerJoin(task, eq(taskDependency.blockedTaskId, task.id))
      .where(
        and(
          eq(taskDependency.blockingTaskId, id),
          eq(taskDependency.organizationId, orgId),
          isNull(task.archivedAt),
        ),
      ),
    db
      .select(edgeColumns)
      .from(task)
      .where(
        and(eq(task.parentTaskId, id), eq(task.organizationId, orgId), isNull(task.archivedAt)),
      ),
    db
      .select(edgeColumns)
      .from(taskRelatedTask)
      .innerJoin(
        task,
        or(
          and(eq(taskRelatedTask.taskId, id), eq(task.id, taskRelatedTask.relatedTaskId)),
          and(eq(taskRelatedTask.relatedTaskId, id), eq(task.id, taskRelatedTask.taskId)),
        ),
      )
      .where(
        and(
          eq(taskRelatedTask.organizationId, orgId),
          isNull(task.archivedAt),
          or(eq(taskRelatedTask.taskId, id), eq(taskRelatedTask.relatedTaskId, id)),
        ),
      ),
  ]);
  return {
    ...toOut(row, await labelsForSubject('task', orgId, row.id)),
    milestoneId: row.milestoneId,
    cycleId: row.cycleId,
    parentTaskId: visibleParentId,
    estimate: row.estimate,
    estimateMinutes: row.estimateMinutes,
    completedAt: row.completedAt?.toISOString() ?? null,
    canceledAt: row.canceledAt?.toISOString() ?? null,
    blocking: blockingRows.filter(canView).map(toRef),
    blockedBy: blockedByRows.filter(canView).map(toRef),
    subtasks: subtaskRows.filter(canView).map(toRef),
    relatedTasks: relatedTaskRows.filter(canView).map(toRef),
  };
}

/** Tasks router: lifecycle (create/list/detail/update/archive/state) + subtasks + dependencies. */
const tasks = new Hono<AppEnv>()
  .post(
    '/',
    capabilityGuard('contribute'),
    apiDoc({
      status: 201,
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

      // Tenant isolation: every body-provided reference must live in the caller's org. These are
      // independent reads, so they go out together instead of as five serial round trips;
      // `guardsInOrder` keeps the reported failure the earliest-listed one regardless of timing.
      const parentTaskRead =
        body.parentTaskId === undefined ? undefined : loadTask(orgId, body.parentTaskId);
      // Every related endpoint is read, locked, and written in the same order. Two concurrent
      // creates can otherwise present the same endpoints in reverse order and wait on each other.
      const relatedTaskIds = [...(body.relatedTaskIds ?? [])].sort();
      const relatedTaskReads = relatedTaskIds.map((relatedTaskId) =>
        loadTask(orgId, relatedTaskId),
      );
      await guardsInOrder([
        assertRefInOrg(actor, orgId, body.assigneeId, 'Assignee not found'),
        assertRefInOrg(project, orgId, body.projectId, 'Project not found'),
        assertRefInOrg(cycle, orgId, body.cycleId, 'Cycle not found'),
        assertMilestoneInOrg(orgId, body.milestoneId, body.projectId),
        assertTaskTemplate(orgId, actorId, body.templateId),
        ...(parentTaskRead ? [parentTaskRead] : []),
        ...relatedTaskReads,
      ]);
      if (parentTaskRead) {
        await assertTaskCapability(orgId, actorId, await parentTaskRead, 'contribute');
      }
      const relatedTasks = await Promise.all(relatedTaskReads);
      await guardsInOrder(
        relatedTasks.map((relatedTask) =>
          assertTaskCapability(orgId, actorId, relatedTask, 'contribute'),
        ),
      );

      // resolveStateTransition validates the state key and derives terminal timestamps so
      // a task created directly in a `completed`/`canceled` state lands with correct fields.
      // Labels were accepted by the DTO and silently dropped here until now; resolved against the
      // task's own team so a team-limited label is offerable, and left for the shared write path
      // to collapse any exclusive-group collision. Neither read depends on the other, so they go
      // out together — but both can reject, and a plain `Promise.all` would answer with whichever
      // lost the race, so a body carrying an invalid state *and* an unknown label would report a
      // different error from run to run. Settled in declaration order for the same reason the
      // tenant guards above are.
      const transitionRead =
        body.state === undefined
          ? landingStatus(orgId, 'task', body.teamId).then((status) => ({
              statusId: status.id,
              state: status.key,
              ...terminalStampsFor(status.category),
            }))
          : resolveStateTransition(orgId, body.teamId, body.state);
      const labelsRead = resolveLabelSet(orgId, body.labels, { teamId: body.teamId });
      await guardsInOrder([transitionRead, labelsRead]);
      const [{ statusId, state, completedAt, canceledAt }, resolvedLabels] = await Promise.all([
        transitionRead,
        labelsRead,
      ]);

      const result = await db.transaction(async (tx) => {
        // A row lock makes a concurrent hard delete wait until this mutation commits. The
        // subsequent relation insert therefore cannot strand a newly-created task when one of its
        // requested endpoints disappears between the preflight read and the write.
        if (relatedTasks.length > 0) {
          const lockedRelatedTasks = await tx
            .select()
            .from(task)
            .where(
              and(
                eq(task.organizationId, orgId),
                isNull(task.archivedAt),
                inArray(task.id, relatedTaskIds),
              ),
            )
            .orderBy(asc(task.id))
            .for('update');
          if (lockedRelatedTasks.length !== relatedTasks.length)
            throw new NotFoundError('Task not found');
          await guardsInOrder(
            lockedRelatedTasks.map((relatedTask) =>
              assertTaskCapability(orgId, actorId, relatedTask, 'contribute', tx),
            ),
          );
        }

        const inserted = await tx
          .insert(task)
          .values({
            organizationId: orgId,
            title: body.title,
            description: body.description,
            summary: body.summary ?? null,
            teamId: body.teamId,
            statusId,
            state,
            completedAt,
            canceledAt,
            priority: body.priority ?? 'none',
            assigneeId: body.assigneeId,
            projectId: body.projectId,
            milestoneId: body.milestoneId,
            cycleId: body.cycleId,
            templateId: body.templateId,
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
        /* v8 ignore next -- @preserve defensive: insert always returns a row */
        if (!row) throw new Error('task insert returned no row');

        if (relatedTasks.length > 0) {
          await tx.insert(taskRelatedTask).values(
            relatedTasks.map((relatedTask) => ({
              organizationId: orgId,
              ...relatedTaskPair(row.id, relatedTask.id),
            })),
          );
        }
        await replaceLabels(tx, 'task', row.id, orgId, resolvedLabels);
        return {
          row,
          cascades: await applySubtaskCompletionPolicyForParents(tx, orgId, [row.parentTaskId]),
        };
      });
      const { row, cascades } = result;

      // Stream: record the creation, plus an assignment event when it lands on someone. Both are
      // post-commit effects the response does not read, and emitting an event is itself a
      // transaction plus recipient routing, automations and indexing — the bulk of what creating
      // a task used to cost the person waiting on it. Deferred as one unit so `created` still
      // lands before `assignment`; the feed's order is part of its meaning.
      // Stamped here rather than inside the deferred callback: `emitEvent` defaults `occurredAt`
      // to the moment it runs, which is now after the response, so under concurrent creates the
      // feed could order two entities against the order their rows were actually written. It is
      // also part of the dedupe key, so it needs to name the domain event, not the drain.
      const subject = { type: 'task', id: row.id, title: row.title };
      const occurredAt = new Date();
      deferAfterResponse('task-created-events', async () => {
        await emitEvent({
          organizationId: orgId,
          kind: 'created',
          actorId,
          occurredAt,
          title: row.title,
          subject,
        });
        if (row.assigneeId) {
          await emitEvent({
            organizationId: orgId,
            kind: 'assignment',
            actorId,
            occurredAt,
            title: row.title,
            subject,
          });
        }
      });
      // No creation entry is written: the row's own `createdAt`/`createdBy` are that record, and
      // the activity endpoint projects the entry from them (see `lib/task-audit.ts`).
      deferAfterResponse('task-created-search-index', () => enqueueTaskSearchIndex(orgId, row.id));
      for (const cascade of cascades) {
        await finishTaskStateTransition({ actorId: null }, cascade);
      }
      return created(c, TaskOut, toOut(row, await labelsForSubject('task', orgId, row.id)));
    },
  )
  .post(
    '/:id/expand',
    capabilityGuard('contribute'),
    productCapabilityGuard('athena'),
    apiDoc({
      tag: 'Tasks',
      summary: 'Expand a task description',
      capability: 'contribute',
      response: TaskExpansionOut,
      description:
        'Improve one existing task description in place. The task’s saved template guides structure, while written text and existing values remain authoritative. The response carries one opaque undo token when the expansion changed work.',
    }),
    zParam(idParam),
    zJson(z.object({}).strict()),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const before = await loadTask(orgId, id);
      await assertTaskCapability(orgId, actorId, before, 'contribute');

      const canView = await buildTaskViewFilter(orgId, actorId);
      const availableTasks = (
        await db
          .select({
            id: task.id,
            title: task.title,
            teamId: task.teamId,
            projectId: task.projectId,
            programId: task.programId,
            visibility: task.visibility,
          })
          .from(task)
          .where(and(eq(task.organizationId, orgId), isNull(task.archivedAt)))
          .orderBy(desc(task.updatedAt), desc(task.id))
          .limit(100)
      )
        .filter((candidate) => candidate.id !== id && canView(candidate))
        .map(({ id: taskId, title }) => ({ id: taskId, title }));

      const templateRows =
        before.templateId === null
          ? []
          : await db
              .select({ payload: template.payload })
              .from(template)
              .where(
                and(
                  eq(template.id, before.templateId),
                  eq(template.organizationId, orgId),
                  eq(template.targetType, 'task'),
                  or(
                    eq(template.scope, 'organization'),
                    and(eq(template.scope, 'personal'), eq(template.ownerActorId, actorId)),
                    and(
                      eq(template.scope, 'team'),
                      exists(
                        db
                          .select({ one: sql`1` })
                          .from(teamMember)
                          .where(
                            and(
                              eq(teamMember.organizationId, orgId),
                              eq(teamMember.actorId, actorId),
                              eq(teamMember.teamId, template.teamId),
                            ),
                          ),
                      ),
                    ),
                  ),
                ),
              )
              .limit(1);
      if (before.templateId !== null && !templateRows[0])
        throw new NotFoundError('Template not found');
      const parsedTemplate = TaskTemplateDraft.safeParse(templateRows[0]?.payload);
      const taskTemplate = parsedTemplate.success ? parsedTemplate.data : null;
      const templateDescription = taskTemplate?.description;
      const templatePriority = taskTemplate?.priority;
      const templateLabelIds = taskTemplate?.labelIds ?? [];
      const [labels, resources] = await Promise.all([
        labelsForSubject('task', orgId, before.id),
        loadTaskExpansionResources(orgId, actorId, before.id),
      ]);
      const templateLabels = applyExclusivity(await resolveAttachedLabels(orgId, templateLabelIds));
      const expansionInput = {
        taskId: before.id,
        title: before.title,
        description: before.description,
        templateDescription,
        explicit: {
          priority: before.priority === 'none' ? undefined : before.priority,
          assigneeId: before.assigneeId,
          projectId: before.projectId,
          dueDate: dayOf(before.dueDate),
          startDate: dayOf(before.startDate),
          estimateMinutes: before.estimateMinutes,
          labelIds: labels.length === 0 ? undefined : labels.map((label) => label.id),
        },
        templateDefaults: {
          ...(templatePriority !== undefined ? { priority: templatePriority } : {}),
          ...(templateLabels.length > 0
            ? { labelIds: templateLabels.map((label) => label.id) }
            : {}),
        },
        availableTasks,
        resources,
      };
      // The provider adapter constrains its own response, but this second boundary is intentional:
      // a runtime replacement must not gain permission to invent a source merely by bypassing it.
      const expansion = constrainTaskExpansion(
        expansionInput,
        await getContainer().taskExpander.expandTask(expansionInput),
      );

      await assertRefInOrg(actor, orgId, expansion.patch.assigneeId, 'Assignee not found');
      await assertRefInOrg(project, orgId, expansion.patch.projectId, 'Project not found');
      for (const field of ['startDate', 'dueDate'] as const) {
        const date = expansion.patch[field];
        if (date !== undefined && !z.iso.date().safeParse(date).success) {
          throw new ValidationError([
            { message: 'Expansion returned an invalid date', path: [field] },
          ]);
        }
      }
      if (expansion.patch.assigneeId !== undefined) {
        await assertTaskCapability(orgId, actorId, before, 'assign');
      }
      const expandedLabels =
        expansion.patch.labelIds === undefined
          ? undefined
          : await resolveLabelSet(orgId, expansion.patch.labelIds, { teamId: before.teamId });

      const endpointIds = [
        ...new Set([
          ...expansion.dependencies.flatMap((edge) => [edge.blockingTaskId, edge.blockedTaskId]),
          ...expansion.relatedTaskIds,
        ]),
      ].sort();
      const endpoints =
        endpointIds.length === 0
          ? []
          : await db
              .select()
              .from(task)
              .where(
                and(
                  eq(task.organizationId, orgId),
                  isNull(task.archivedAt),
                  inArray(task.id, endpointIds),
                ),
              );
      if (endpoints.length !== endpointIds.length) throw new NotFoundError('Task not found');
      await guardsInOrder(
        endpoints.map((endpoint) => assertTaskCapability(orgId, actorId, endpoint, 'contribute')),
      );

      const result = await serializableTx(async (tx) => {
        // Lock every task this expansion can connect in one sorted query. A relation must not
        // outlive an archive or permission change that commits while the provider is running.
        const lockedTaskIds = [...new Set([id, ...endpointIds])].sort();
        const lockedTasks = await tx
          .select()
          .from(task)
          .where(
            and(
              eq(task.organizationId, orgId),
              isNull(task.archivedAt),
              inArray(task.id, lockedTaskIds),
            ),
          )
          .orderBy(asc(task.id))
          .for('update');
        if (lockedTasks.length !== lockedTaskIds.length) throw new NotFoundError('Task not found');
        const lockedBefore = lockedTasks.find((candidate) => candidate.id === id);
        if (!lockedBefore) throw new NotFoundError('Task not found');
        await assertTaskCapability(orgId, actorId, lockedBefore, 'contribute', tx);
        if (
          lockedBefore.description !== before.description ||
          lockedBefore.title !== before.title ||
          lockedBefore.priority !== before.priority ||
          lockedBefore.assigneeId !== before.assigneeId ||
          lockedBefore.projectId !== before.projectId ||
          dayOf(lockedBefore.startDate) !== dayOf(before.startDate) ||
          dayOf(lockedBefore.dueDate) !== dayOf(before.dueDate) ||
          lockedBefore.estimateMinutes !== before.estimateMinutes ||
          lockedBefore.templateId !== before.templateId ||
          lockedBefore.teamId !== before.teamId ||
          lockedBefore.statusId !== before.statusId ||
          lockedBefore.state !== before.state
        ) {
          throw new ConflictError('Task changed while expansion was running');
        }
        const lockedLabels = await tx
          .select({ labelId: taskLabel.labelId })
          .from(taskLabel)
          .where(and(eq(taskLabel.organizationId, orgId), eq(taskLabel.taskId, lockedBefore.id)))
          .orderBy(asc(taskLabel.labelId))
          .for('update');
        const snapshotLabelIds = labels.map((candidate) => candidate.id).sort();
        if (
          lockedLabels.length !== snapshotLabelIds.length ||
          lockedLabels.some((candidate, index) => candidate.labelId !== snapshotLabelIds[index])
        ) {
          throw new ConflictError('Task changed while expansion was running');
        }
        if (expansion.patch.assigneeId !== undefined) {
          await assertTaskCapability(orgId, actorId, lockedBefore, 'assign', tx);
        }
        const childStatus =
          expansion.subtasks.length > 0
            ? await landingStatus(orgId, 'task', lockedBefore.teamId, tx)
            : null;

        const patch = {
          ...(expansion.description !== (lockedBefore.description ?? '')
            ? { description: expansion.description }
            : {}),
          ...(expansion.patch.priority !== undefined ? { priority: expansion.patch.priority } : {}),
          ...(expansion.patch.assigneeId !== undefined
            ? { assigneeId: expansion.patch.assigneeId }
            : {}),
          ...(expansion.patch.projectId !== undefined
            ? { projectId: expansion.patch.projectId }
            : {}),
          ...(expansion.patch.startDate !== undefined
            ? { startDate: new Date(expansion.patch.startDate) }
            : {}),
          ...(expansion.patch.dueDate !== undefined
            ? { dueDate: new Date(expansion.patch.dueDate) }
            : {}),
          ...(expansion.patch.estimateMinutes !== undefined
            ? { estimateMinutes: expansion.patch.estimateMinutes }
            : {}),
        };
        assertTaskWindowOrdered(lockedBefore, patch);
        const updated =
          Object.keys(patch).length === 0
            ? lockedBefore
            : (
                await tx
                  .update(task)
                  .set(patch)
                  .where(and(eq(task.id, id), eq(task.organizationId, orgId)))
                  .returning()
              )[0];
        if (!updated) throw new NotFoundError('Task not found');

        const changes: RecordedChange[] = [];
        const createdSubtasks = [] as (typeof task.$inferSelect)[];
        const insertedDependencies: (typeof expansion.dependencies)[number][] = [];
        const insertedRelatedTaskIds: string[] = [];
        if (expandedLabels !== undefined) {
          await replaceLabels(tx, 'task', lockedBefore.id, orgId, expandedLabels);
          changes.push({
            kind: 'task_labels',
            taskId: lockedBefore.id,
            before: labels.map((label) => label.id),
            after: expandedLabels.map((label) => label.id),
          });
        }
        for (const child of expansion.subtasks) {
          const [createdChild] = await tx
            .insert(task)
            .values({
              organizationId: orgId,
              title: child.title,
              description: child.description,
              teamId: lockedBefore.teamId,
              statusId: childStatus?.id ?? lockedBefore.statusId,
              state: childStatus?.key ?? lockedBefore.state,
              projectId: lockedBefore.projectId,
              programId: lockedBefore.programId,
              parentTaskId: lockedBefore.id,
              source: 'native',
              createdBy: actorId,
            })
            .returning();
          if (!createdChild) throw new Error('task expansion child insert returned no row');
          createdSubtasks.push(createdChild);
          changes.push({
            kind: 'task',
            id: createdChild.id,
            op: 'create',
            after: trackedFields('task', createdChild),
          });
        }

        // Recheck every locked endpoint inside this write transaction immediately before an
        // edge can be inserted. The pre-provider check only avoids unnecessary model work.
        await guardsInOrder(
          lockedTasks.map((endpoint) =>
            assertTaskCapability(orgId, actorId, endpoint, 'contribute', tx),
          ),
        );

        for (const dependency of expansion.dependencies) {
          if (
            await wouldCreateCycle(tx, orgId, dependency.blockingTaskId, dependency.blockedTaskId)
          )
            continue;
          const inserted = await tx
            .insert(taskDependency)
            .values({ organizationId: orgId, ...dependency })
            .onConflictDoNothing()
            .returning({ blockingTaskId: taskDependency.blockingTaskId });
          if (inserted.length > 0) {
            insertedDependencies.push(dependency);
            changes.push({
              kind: 'blocks',
              from: dependency.blockingTaskId,
              to: dependency.blockedTaskId,
              linked: true,
            });
          }
        }
        for (const relatedTaskId of expansion.relatedTaskIds) {
          const pair = relatedTaskPair(lockedBefore.id, relatedTaskId);
          const inserted = await tx
            .insert(taskRelatedTask)
            .values({ organizationId: orgId, ...pair })
            .onConflictDoNothing()
            .returning({ taskId: taskRelatedTask.taskId });
          if (inserted.length > 0) {
            insertedRelatedTaskIds.push(relatedTaskId);
            changes.push({
              kind: 'related_task',
              from: pair.taskId,
              to: pair.relatedTaskId,
              linked: true,
            });
          }
        }
        const cascades = await applySubtaskCompletionPolicyForParents(tx, orgId, [lockedBefore.id]);
        const finalUpdated =
          cascades.find((cascade) => cascade.after.id === updated.id)?.after ?? updated;
        if (finalUpdated !== lockedBefore) {
          changes.unshift({
            kind: 'task',
            id: finalUpdated.id,
            op: 'update',
            before: trackedFields('task', lockedBefore),
            after: trackedFields('task', finalUpdated),
          });
        }
        const undoToken = await recordChangeSetInTransaction(tx, {
          orgId,
          actorId,
          origin: { tool: 'task_description_expansion' },
          summary: `Expanded "${updated.title}"`,
          changes,
        });
        const activityChanges = await resolveTaskChangeLabels(
          orgId,
          diffTaskFields(lockedBefore, updated),
        );
        if (expandedLabels !== undefined) {
          activityChanges.push({
            field: 'labels',
            label: 'Labels',
            from: labels.map((label) => label.name).join(', ') || null,
            to: expandedLabels.map((label) => label.name).join(', ') || null,
          });
        }
        for (const child of createdSubtasks) {
          activityChanges.push({ field: 'subtask', label: 'Subtask', from: null, to: child.title });
        }
        const titleByTaskId = new Map(lockedTasks.map((endpoint) => [endpoint.id, endpoint.title]));
        for (const dependency of insertedDependencies) {
          const blocking =
            titleByTaskId.get(dependency.blockingTaskId) ?? dependency.blockingTaskId;
          const blocked = titleByTaskId.get(dependency.blockedTaskId) ?? dependency.blockedTaskId;
          activityChanges.push({
            field: 'dependency',
            label: 'Dependency',
            from: null,
            to: `${blocking} blocks ${blocked}`,
          });
        }
        for (const relatedTaskId of insertedRelatedTaskIds) {
          activityChanges.push({
            field: 'relatedTask',
            label: 'Related task',
            from: null,
            to: titleByTaskId.get(relatedTaskId) ?? relatedTaskId,
          });
        }
        for (const resourceUrl of expansion.resourceUrls) {
          if (
            (lockedBefore.description ?? '').includes(resourceUrl) ||
            !updated.description?.includes(resourceUrl)
          )
            continue;
          activityChanges.push({
            field: 'resource',
            label: 'Resource',
            from: null,
            to: resourceUrl,
          });
        }
        if (undoToken !== null) {
          activityChanges.push({
            field: 'expansion',
            label: 'Task definition',
            from: null,
            to: 'Expanded the description and connected context',
          });
        }
        if (activityChanges.length > 0) {
          await tx.insert(auditEvent).values(
            taskActivityRows({
              organizationId: orgId,
              taskId: updated.id,
              title: updated.title,
              actorId,
              changes: activityChanges,
            }),
          );
        }
        return {
          before: lockedBefore,
          updated: finalUpdated,
          activityUpdated: updated,
          createdSubtasks,
          undoToken,
          cascades,
          activityChanges,
        };
      });
      await announceTaskChanges({
        organizationId: orgId,
        taskId: result.updated.id,
        title: result.updated.title,
        actorId,
        changes: result.activityChanges,
      });
      await enqueueTaskSearchIndex(orgId, result.updated.id);
      for (const child of result.createdSubtasks) await enqueueTaskSearchIndex(orgId, child.id);
      for (const cascade of result.cascades) {
        await finishTaskStateTransition({ actorId: null }, cascade);
      }

      return ok(c, TaskExpansionOut, {
        task: await loadTaskDetail(orgId, actorId, result.updated.id, result.updated),
        undoToken: result.undoToken,
      });
    },
  )
  .post(
    '/:id/expand/undo',
    capabilityGuard('contribute'),
    productCapabilityGuard('athena'),
    apiDoc({
      tag: 'Tasks',
      summary: 'Undo a task expansion',
      capability: 'contribute',
      response: TaskExpansionOut,
      description:
        'Reverse one task-description expansion when the caller owns its unused undo token and no tracked work changed afterward.',
    }),
    zParam(idParam),
    zJson(z.object({ undoToken: z.string().min(1) }).strict()),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { undoToken } = c.req.valid('json');
      const before = await loadTask(orgId, id);
      await assertTaskCapability(orgId, actorId, before, 'contribute');
      const [ownedToken] = await db
        .select({ id: changeSet.id })
        .from(changeSet)
        .where(
          and(
            eq(changeSet.id, undoToken),
            eq(changeSet.organizationId, orgId),
            eq(changeSet.actorId, actorId),
            isNull(changeSet.undoneAt),
          ),
        )
        .limit(1);
      if (!ownedToken) throw new NotFoundError('Expansion undo not found');

      const undoEntries = await db
        .select()
        .from(changeSetEntry)
        .where(eq(changeSetEntry.changeSetId, undoToken));
      const tiedToSubject = undoEntries.some((entry) => {
        if (entry.entityKind === 'task' || entry.entityKind === 'task_labels') {
          return (
            entry.entityId === id ||
            entry.before?.['parentTaskId'] === id ||
            entry.after?.['parentTaskId'] === id
          );
        }
        return (
          entry.before?.['from'] === id ||
          entry.before?.['to'] === id ||
          entry.after?.['from'] === id ||
          entry.after?.['to'] === id
        );
      });
      if (!tiedToSubject) throw new NotFoundError('Expansion undo not found');
      const undoLabelIds = [
        ...new Set(
          undoEntries.flatMap((entry) =>
            entry.entityKind !== 'task_labels'
              ? []
              : [entry.before?.['labelIds'], entry.after?.['labelIds']].flatMap((ids) =>
                  Array.isArray(ids)
                    ? ids.filter((id): id is string => typeof id === 'string')
                    : [],
                ),
          ),
        ),
      ];
      const undoLabelNames = new Map(
        (undoLabelIds.length === 0
          ? []
          : await db
              .select({ id: label.id, name: label.name })
              .from(label)
              .where(and(eq(label.organizationId, orgId), inArray(label.id, undoLabelIds)))
        ).map((row) => [row.id, row.name]),
      );
      let undoActivityChanges: Awaited<ReturnType<typeof resolveTaskChangeLabels>> = [];
      const { outcomes } = await undoChangeSetAtomically(
        orgId,
        undoToken,
        async ({ tx, entries }) => {
          const [restored] = await tx
            .select()
            .from(task)
            .where(and(eq(task.id, id), eq(task.organizationId, orgId), isNull(task.archivedAt)))
            .limit(1);
          if (!restored) throw new NotFoundError('Task not found');
          const changes = await resolveTaskChangeLabels(orgId, diffTaskFields(before, restored));
          for (const entry of entries) {
            if (entry.entityKind === 'task' && entry.op === 'create') {
              const title =
                typeof entry.after?.['title'] === 'string' ? entry.after['title'] : entry.entityId;
              changes.push({ field: 'subtask', label: 'Subtask', from: title, to: null });
              continue;
            }
            if (entry.entityKind === 'blocks') {
              changes.push({
                field: 'dependency',
                label: 'Dependency',
                from: 'Added',
                to: 'Removed',
              });
              continue;
            }
            if (entry.entityKind === 'related_task') {
              changes.push({
                field: 'relatedTask',
                label: 'Related task',
                from: 'Added',
                to: 'Removed',
              });
              continue;
            }
            if (entry.entityKind === 'task_labels') {
              const beforeLabels = entry.before?.['labelIds'];
              const afterLabels = entry.after?.['labelIds'];
              const namesFor = (ids: unknown): string | null =>
                Array.isArray(ids)
                  ? ids
                      .filter((labelId): labelId is string => typeof labelId === 'string')
                      .map((labelId) => undoLabelNames.get(labelId) ?? 'Unknown')
                      .join(', ') || null
                  : null;
              changes.push({
                field: 'labels',
                label: 'Labels',
                from: namesFor(afterLabels),
                to: namesFor(beforeLabels),
              });
            }
          }
          changes.push({
            field: 'expansion',
            label: 'Task definition',
            from: 'Expanded task definition',
            to: 'Restored the previous task definition',
          });
          await tx.insert(auditEvent).values(
            taskActivityRows({
              organizationId: orgId,
              taskId: id,
              title: restored.title,
              actorId,
              changes,
            }),
          );
          undoActivityChanges = changes;
        },
      );
      const restored = await loadTask(orgId, id);
      await announceTaskChanges({
        organizationId: orgId,
        taskId: id,
        title: restored.title,
        actorId,
        changes: undoActivityChanges,
      });
      for (const outcome of outcomes) {
        if (outcome.reverted && outcome.kind === 'task') {
          await enqueueTaskSearchIndex(orgId, outcome.id);
        }
      }
      return ok(c, TaskExpansionOut, {
        task: await loadTaskDetail(orgId, actorId, id, restored),
        undoToken: null,
      });
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
      const { orgId, actorId } = c.get('actorCtx');
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
      let programFilter: SQL | undefined;
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

      const canView = await buildTaskViewFilter(orgId, actorId);
      const queryAfter = (after: string | undefined) =>
        db
          .select()
          .from(task)
          .where(
            and(
              eq(task.organizationId, orgId),
              isNull(task.archivedAt),
              seekAfter(task.createdAt, task.id, after),
              ...(programFilter ? [programFilter] : []),
              ...(labelFilter ? [labelFilter] : []),
            ),
          )
          .orderBy(desc(task.createdAt), desc(task.id));

      // Access is a predicate rather than a SQL join because the grant cascade spans several
      // optional ancestors. Do not filter a `limit + 1` database page after the fact: a hidden
      // row between two visible rows would then become the cursor boundary and make the latter
      // unreachable. The bounded path scans raw keyset batches until it has one extra *visible*
      // row, so `pageResult` still encodes the last returned visible task.
      let rows: (typeof task.$inferSelect)[];
      if (limit === undefined) {
        rows = (await queryAfter(cursor)).filter(canView);
      } else {
        const visible: (typeof task.$inferSelect)[] = [];
        let scanCursor = cursor;
        const scanBatchSize = Math.max(limit + 1, 100);
        while (visible.length <= limit) {
          const batch = await queryAfter(scanCursor).limit(scanBatchSize);
          if (batch.length === 0) break;
          visible.push(...batch.filter(canView));
          if (visible.length > limit || batch.length < scanBatchSize) break;
          const lastScanned = batch[batch.length - 1];
          /* v8 ignore next -- @preserve non-empty batch above guarantees a last row */
          if (!lastScanned) break;
          scanCursor = encodeListCursor(lastScanned.createdAt, lastScanned.id);
        }
        rows = visible;
      }
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
  .post(
    '/reparent',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Tasks',
      summary: 'Reparent tasks atomically',
      capability: 'contribute',
      response: TaskReparentBatchOut,
      description: `Assign one or more active tasks to new hierarchy parents as one atomic operation. Every subject and non-null parent must be an active task in the caller's organization; missing, archived, and cross-organization ids all return 404 without committing any assignment. The complete proposed hierarchy must remain acyclic or the whole request returns 409.

When \`preserveSelectedSubtrees\` is true, a selected task whose ancestor is also selected remains attached to that ancestor, so dragging a selected hierarchy moves the selected roots without flattening it. The response contains only committed roots and includes each previous parent assignment; clients can submit those values back with preservation disabled to implement an exact Undo. Requires \`contribute\`.`,
    }),
    zJson(TaskReparentBatchIn),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      return ok(
        c,
        TaskReparentBatchOut,
        await reparentTasks({
          organizationId: orgId,
          actorId,
          ...c.req.valid('json'),
        }),
      );
    },
  )
  .get(
    '/:id/aggregate-detail',
    apiDoc({
      tag: 'Tasks',
      summary: 'Get the bounded Task detail aggregate',
      response: TaskDetailAggregate,
      description:
        'Returns the Task snapshot, visible-control capabilities, team workflow states, and initial document content in one request. It deliberately excludes organization-wide picker rosters and optional sections.',
    }),
    zParam(aggregateIdParam),
    async (c) => {
      const { orgId, actorId, capabilities } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { row, detail, workflowStates } = await loadTaskDetailAggregate(orgId, actorId, id);
      return ok(c, TaskDetailAggregate, {
        target: 'task',
        snapshot: {
          target: 'task',
          organizationId: row.organizationId,
          id: row.id,
          title: row.title,
          status: row.state,
          priority: row.priority,
          updatedAt: row.updatedAt.toISOString(),
        },
        viewer: { actorId },
        capabilities: detailCapabilities(capabilities),
        references: { workflowStates },
        defaultView: { task: detail },
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
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      return ok(c, TaskDetail, await loadTaskDetail(orgId, actorId, id));
    },
  )
  .patch(
    '/:id',
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

      // Load and authorize the target before resolving any mutation references. The grant cascade
      // is the authority for an existing task; `actorCtx.capabilities` remains only for
      // org-scoped creation, where there is no task target yet.
      const before = await loadTask(orgId, id);
      await assertTaskCapability(orgId, ctx.actorId, before, 'contribute');

      // Changing assignee/delegate requires `assign` capability (permissions §2).
      if (body.assigneeId !== undefined || body.delegateId !== undefined) {
        await assertTaskCapability(orgId, ctx.actorId, before, 'assign');
      }

      // Tenant isolation: every re-pointed reference must live in the caller's org.
      await assertRefInOrg(actor, orgId, body.assigneeId, 'Assignee not found');
      await assertRefInOrg(actor, orgId, body.delegateId, 'Delegate not found');
      await assertRefInOrg(project, orgId, body.projectId, 'Project not found');
      await assertRefInOrg(program, orgId, body.programId, 'Program not found');
      await assertRefInOrg(cycle, orgId, body.cycleId, 'Cycle not found');
      await assertTaskTemplate(orgId, ctx.actorId, body.templateId);
      // Effective project for milestone scoping: the incoming `projectId` when the patch
      // re-points the task, otherwise its current one — loaded lazily, only when a
      // non-null `milestoneId` is actually being set and the patch doesn't already carry
      // a `projectId` to check against.
      const effectiveProjectId =
        body.milestoneId == null
          ? undefined
          : body.projectId !== undefined
            ? body.projectId
            : before.projectId;
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
        const parent = await loadTask(orgId, newParentId);
        await assertTaskCapability(orgId, ctx.actorId, parent, 'contribute');
      }

      if (body.relatedTaskIds?.some((relatedTaskId) => relatedTaskId === id)) {
        throw new ValidationError([
          { message: 'A task cannot be related to itself', path: ['relatedTaskIds'] },
        ]);
      }

      // The pre-image, read exactly once: it feeds both the state-transition resolve below and
      // the activity ledger's before/after diff, so recording history costs no extra read.
      // resolveStateTransition validates + derives timestamps; bypassing it would corrupt progress.
      const statePatch =
        body.state !== undefined
          ? await resolveStateTransition(orgId, before.teamId, body.state)
          : undefined;

      const patch = {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.summary !== undefined ? { summary: body.summary } : {}),
        ...(statePatch !== undefined
          ? {
              statusId: statePatch.statusId,
              state: statePatch.state,
              completedAt: statePatch.completedAt,
              canceledAt: statePatch.canceledAt,
              autoCompletedBySubtasks: false,
            }
          : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId } : {}),
        ...(body.delegateId !== undefined ? { delegateId: body.delegateId } : {}),
        ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
        ...(body.programId !== undefined ? { programId: body.programId } : {}),
        ...(body.parentTaskId !== undefined ? { parentTaskId: body.parentTaskId } : {}),
        ...(body.templateId !== undefined ? { templateId: body.templateId } : {}),
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
      const patchRelatedTaskIds =
        body.relatedTaskIds === undefined ? undefined : [...body.relatedTaskIds].sort();

      // An empty body is a no-op. A labels-only or related-tasks-only request still needs the
      // same transaction as a row patch, because its joins are part of one task mutation.
      if (
        Object.keys(patch).length === 0 &&
        patchLabels === undefined &&
        patchRelatedTaskIds === undefined
      ) {
        const current = await loadTask(orgId, id);
        return ok(c, TaskOut, toOut(current, await labelsForSubject('task', orgId, id)));
      }

      // Date validity, second layer: the DTO checked the days this request carries against each
      // other; this checks them against the days already stored.
      assertTaskWindowOrdered(before, patch);

      const where = and(eq(task.id, id), eq(task.organizationId, orgId), isNull(task.archivedAt));
      // The row, its replacement labels, and its undirected links form one mutation. Running
      // every non-empty PATCH at SERIALIZABLE also preserves the hierarchy's existing concurrent
      // reparenting guarantee. Related-link replacement reads its own snapshot, so a link added
      // after that snapshot cannot be deleted without being authorized on a retry.
      const result = await serializableTx(async (tx) => {
        // Both sides of a replacement are locked before reading its edge snapshot. The same
        // canonical order for `A → B` and `B → A` prevents each request from holding one endpoint
        // while waiting on the other, and makes the unique canonical-pair insert serializable.
        const lockTaskIds = [id, ...(patchRelatedTaskIds ?? [])].sort();
        const lockedTasks = await tx
          .select()
          .from(task)
          .where(
            and(
              eq(task.organizationId, orgId),
              isNull(task.archivedAt),
              inArray(task.id, lockTaskIds),
            ),
          )
          .orderBy(asc(task.id))
          .for('update');
        if (lockedTasks.length !== lockTaskIds.length) throw new NotFoundError('Task not found');
        const current = lockedTasks.find((candidate) => candidate.id === id);
        if (!current) throw new NotFoundError('Task not found');
        const relationWhere = and(
          eq(taskRelatedTask.organizationId, orgId),
          or(eq(taskRelatedTask.taskId, id), eq(taskRelatedTask.relatedTaskId, id)),
        );
        await assertTaskCapability(orgId, ctx.actorId, current, 'contribute', tx);
        if (body.assigneeId !== undefined || body.delegateId !== undefined) {
          await assertTaskCapability(orgId, ctx.actorId, current, 'assign', tx);
        }

        if (newParentId !== null) {
          const activeTasks = await tx
            .select({ id: task.id, parentTaskId: task.parentTaskId })
            .from(task)
            .where(and(eq(task.organizationId, orgId), isNull(task.archivedAt)));
          planTaskReparents(activeTasks, [{ taskId: id, parentTaskId: newParentId }], false);
        }

        const updated =
          Object.keys(patch).length === 0
            ? current
            : (await tx.update(task).set(patch).where(where).returning())[0];
        if (!updated) throw new NotFoundError('Task not found');

        const relatedActivity: { taskId: string; title: string; linked: boolean }[] = [];
        if (patchRelatedTaskIds !== undefined) {
          const lockedRelationRows = await tx
            .select({
              taskId: taskRelatedTask.taskId,
              relatedTaskId: taskRelatedTask.relatedTaskId,
            })
            .from(taskRelatedTask)
            .where(relationWhere)
            .orderBy(asc(taskRelatedTask.taskId), asc(taskRelatedTask.relatedTaskId))
            .for('update');
          const authorizationTaskIds = [
            ...patchRelatedTaskIds,
            ...lockedRelationRows.map((relatedTask) =>
              relatedTask.taskId === id ? relatedTask.relatedTaskId : relatedTask.taskId,
            ),
          ].filter((taskId, index, all) => all.indexOf(taskId) === index);
          const authorizationTasks =
            authorizationTaskIds.length === 0
              ? []
              : await tx
                  .select()
                  .from(task)
                  .where(
                    and(
                      eq(task.organizationId, orgId),
                      isNull(task.archivedAt),
                      inArray(task.id, authorizationTaskIds),
                    ),
                  );
          if (authorizationTasks.length !== authorizationTaskIds.length) {
            throw new NotFoundError('Task not found');
          }
          const relatedTaskById = new Map(
            authorizationTasks.map((candidate) => [candidate.id, candidate]),
          );
          const currentRelatedIds = lockedRelationRows.map((relatedTask) =>
            relatedTask.taskId === id ? relatedTask.relatedTaskId : relatedTask.taskId,
          );
          const nextRelatedIds = new Set<string>(patchRelatedTaskIds);
          for (const relatedTaskId of patchRelatedTaskIds) {
            if (currentRelatedIds.includes(relatedTaskId)) continue;
            const relatedTask = relatedTaskById.get(relatedTaskId);
            if (!relatedTask) throw new NotFoundError('Task not found');
            relatedActivity.push({
              taskId: relatedTask.id,
              title: relatedTask.title,
              linked: true,
            });
          }
          for (const relatedTaskId of currentRelatedIds) {
            if (nextRelatedIds.has(relatedTaskId)) continue;
            const relatedTask = relatedTaskById.get(relatedTaskId);
            if (!relatedTask) throw new NotFoundError('Task not found');
            relatedActivity.push({
              taskId: relatedTask.id,
              title: relatedTask.title,
              linked: false,
            });
          }
          await guardsInOrder(
            authorizationTaskIds.map((relatedTaskId) => {
              const relatedTask = relatedTaskById.get(relatedTaskId);
              if (!relatedTask) throw new NotFoundError('Task not found');
              return assertTaskCapability(orgId, ctx.actorId, relatedTask, 'contribute', tx);
            }),
          );
          await tx.delete(taskRelatedTask).where(relationWhere);
          if (patchRelatedTaskIds.length > 0) {
            await tx.insert(taskRelatedTask).values(
              patchRelatedTaskIds.map((relatedTaskId) => ({
                organizationId: orgId,
                ...relatedTaskPair(id, relatedTaskId),
              })),
            );
          }
        }
        if (patchLabels !== undefined) {
          await replaceLabels(tx, 'task', id, orgId, patchLabels);
        }
        const parentTaskIds = [
          ...(statePatch === undefined ? [] : [updated.parentTaskId]),
          ...(body.parentTaskId === undefined ? [] : [current.parentTaskId, updated.parentTaskId]),
        ];
        const cascades = await applySubtaskCompletionPolicyForParents(tx, orgId, parentTaskIds);
        return { row: updated, cascades, relatedActivity };
      });
      const { row, cascades, relatedActivity } = result;

      // Stream: a state transition (completed when it landed terminal) and/or a reassignment.
      const subject = { type: 'task', id: row.id, title: row.title };
      if (statePatch !== undefined) {
        await emitEvent({
          organizationId: orgId,
          kind: statePatch.completedAt ? 'completed' : 'status_change',
          actorId: ctx.actorId,
          title: row.title,
          subject,
          detail: { schema: 'docket.state_change', fromState: before.state, toState: row.state },
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
        changes: [
          ...(await resolveTaskChangeLabels(orgId, diffTaskFields(before, row))),
          ...relatedActivity.map((relatedTask) => ({
            field: 'relatedTask',
            label: 'Related task',
            from: relatedTask.linked ? null : relatedTask.title,
            to: relatedTask.linked ? relatedTask.title : null,
          })),
        ],
      });
      for (const relatedTask of relatedActivity) {
        await recordTaskChanges({
          organizationId: orgId,
          taskId: relatedTask.taskId,
          title: relatedTask.title,
          actorId: ctx.actorId,
          changes: [
            {
              field: 'relatedTask',
              label: 'Related task',
              from: relatedTask.linked ? null : row.title,
              to: relatedTask.linked ? row.title : null,
            },
          ],
        });
      }
      await enqueueTaskSearchIndex(orgId, row.id);
      if (statePatch?.completedAt) {
        await advanceCompletedProcessTask(db, {
          organizationId: orgId,
          actorId: ctx.actorId,
          completedTaskId: row.id,
          completedOn: statePatch.completedAt.toISOString().slice(0, 10),
        });
      }
      for (const cascade of cascades) {
        await finishTaskStateTransition({ actorId: null }, cascade);
      }
      return ok(c, TaskOut, toOut(row, await labelsForSubject('task', orgId, row.id)));
    },
  )
  .delete(
    '/:id',
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
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const target = await loadTask(orgId, id);
      await assertTaskCapability(orgId, actorId, target, 'contribute');
      const archivedAt = new Date();
      const result = await db.transaction(async (tx) => {
        const updated = await tx
          .update(task)
          .set({ archivedAt })
          .where(and(eq(task.id, id), eq(task.organizationId, orgId), isNull(task.archivedAt)))
          .returning();
        const row = updated[0];
        if (!row) throw new NotFoundError('Task not found');
        return {
          row,
          cascades: await applySubtaskCompletionPolicyForParents(tx, orgId, [row.parentTaskId]),
        };
      });
      const { row } = result;
      await enqueueTaskSearchIndex(orgId, row.id, 'delete');
      for (const cascade of result.cascades) {
        await finishTaskStateTransition({ actorId: null }, cascade);
      }
      return ok(c, TaskArchived, {
        id: row.id,
        /* v8 ignore next -- @preserve defensive: archivedAt was just set above */
        archivedAt: (row.archivedAt ?? archivedAt).toISOString(),
      });
    },
  )
  .post(
    '/:id/state',
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
      const target = await loadTask(orgId, id);
      await assertTaskCapability(orgId, actorId, target, 'contribute');
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
