import { loadTaskDetailRow } from './task-detail-row';
import { assertTaskAssignmentEdit, detachTaskAssigneeEdit } from './task-person-edit';
import { taskListOutput } from './task-list-output';
/** `@docket/api` — tasks router (mounted at `/v1/orgs/:orgId/tasks`). */
import {
  actor,
  changeSet,
  changeSetEntry,
  db,
  label,
  program,
  project,
  task,
  taskDependency,
  taskLabel,
  taskRelatedTask,
  team,
  template,
} from '@docket/db';
import { pageOf } from '../contracts/pagination';
import {
  TaskArchived,
  TaskCreate,
  TaskDetail,
  TaskListQuery,
  TaskOut,
  TaskReparentBatchIn,
  TaskReparentBatchOut,
  TaskUpdate,
} from '@docket/work/task-model';
import { TaskDetailAggregate } from '../contracts/detail-aggregate';
import { TaskId } from '@docket/work/ids';
import { TaskTemplateDraft } from '@docket/work/template-contract';
import { constrainTaskExpansion } from '@docket/athena/task-expansion';
import { and, asc, desc, eq, exists, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError, ValidationError } from '../error';
import { deferAfterResponse } from '../lib/after-response';
import { detailCapabilities } from '../lib/detail-capabilities';
import { guardsInOrder } from '../lib/guards-in-order';
import { originFor } from '../lib/provenance/context';
import { insertAuditEvents } from '../lib/provenance/audit-events';
import {
  recordTaskPatch,
  recordTaskReparents,
  replaceTaskLabelSet,
  settleTaskArchive,
  settleTaskCreation,
} from '../lib/provenance/task-change-sets';
import {
  applyExclusivity,
  labelsForSubject,
  replaceLabels,
  resolveAttachedLabels,
  resolveLabelSet,
} from '../lib/labels';
import { created, ok } from '../lib/ok';
import { rawResultRows } from '../lib/raw-result';
import { visibleTemplateWhere } from '../lib/templates/visibility';
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
} from '../lib/task-state';
import { encodeListCursor, pageResult, seekAfter } from '../lib/list-cursor';
import { landingStatus, landingTaskTransition } from '../lib/work-status';
import { apiDoc } from '../lib/openapi-route';
import { serializableTx } from '../lib/serializable-tx';
import { assertTaskWindowOrdered, dayOf } from '../lib/task-window';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { productCapabilityGuard } from '../product-capability';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';
import { assertTeamCycle, planTaskReparents, reparentTasks } from '../services/task-hierarchy';
import { getContainer } from '../container';
import {
  recordChangeSetInTransaction,
  trackedFields,
  undoChangeSetAtomically,
  type RecordedChange,
} from '../mcp/change-set';
import { labelSetChange } from '../mcp/change-set-labels';

import { emitEvent } from './event-emit';
import { loadTaskExpansionResources } from './task-expansion-resources';
import {
  assertTaskCapability,
  assertMilestoneInOrg,
  assertRefInOrg,
  buildTaskViewFilter,
  idParam,
  loadTask,
  resolveStateTransition,
  releasedMilestonePatch,
  type TaskRow,
  toOut,
  toRef,
  wouldCreateCycle,
} from './task-helpers';
import { attachmentRoutes } from './attachment-routes';
import { taskActivityRoutes } from './task-activity-routes';
import { taskDependencyRoutes } from './task-dependency-routes';
import { taskStateRoutes } from './task-state-routes';
import { closePatchTimers, finishTaskPatch } from './task-update-effects';
import { relatedTaskPair, replaceRelatedTasks } from './task-related-replace';

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
    .where(visibleTemplateWhere(orgId, actorId, { id: templateId }))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Template not found');
  if (row.targetType !== 'task') {
    throw new ValidationError([{ message: 'Template must create tasks', path: ['templateId'] }]);
  }
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
    loadTaskDetailRow(orgId, id),
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
      sourcePeople: taskWithTeam.sourcePeople,
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
      description: `Create a task in the organization. \`teamId\` is required, and the task uses that team's workflow. Every supplied reference, including \`assigneeId\`, \`projectId\`, \`cycleId\`, \`milestoneId\`, and \`parentTaskId\`, must identify a resource in the same organization. A cycle must also belong to the selected team. Invalid or inaccessible references return 404; a cycle from another team returns 409 \`cadence_changed\`.

When \`state\` is omitted, Docket uses the team's first workflow state. When the selected state is completed or canceled, Docket sets the matching terminal timestamp. \`priority\` defaults to \`none\`.

The new task appears in the organization's activity stream. An assigned task also produces an assignment event. Creating a task with \`assigneeId\` requires \`contribute\`; changing an existing task's assignee requires \`assign\`.`,
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
          ? landingTaskTransition(orgId, body.teamId)
          : resolveStateTransition(orgId, body.teamId, body.state);
      const labelsRead = resolveLabelSet(orgId, body.labels, { teamId: body.teamId });
      await guardsInOrder([transitionRead, labelsRead]);
      const [{ statusId, state, completedAt, canceledAt }, resolvedLabels] = await Promise.all([
        transitionRead,
        labelsRead,
      ]);

      const result = await db.transaction(async (tx) => {
        await assertTeamCycle(tx, orgId, body.cycleId, body.teamId);
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
        return settleTaskCreation(tx, {
          orgId,
          actorId,
          row,
          relatedTaskIds,
          labels: resolvedLabels,
        });
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
                visibleTemplateWhere(orgId, actorId, {
                  id: before.templateId,
                  targetType: 'task',
                }),
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
          await assertTaskAssignmentEdit(orgId, actorId, lockedBefore, tx);
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
          changes.push(
            labelSetChange(
              'task',
              lockedBefore.id,
              labels.map((label) => label.id),
              expandedLabels.map((label) => label.id),
            ),
          );
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
          origin: originFor('task_description_expansion'),
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
          await insertAuditEvents(
            tx,
            'task_description_expansion',
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
          await insertAuditEvents(
            tx,
            'undo_task_description_expansion',
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
      description: `List active tasks in the organization, newest first. Tasks use \`createdAt\` and then \`id\` for stable ordering. Archived tasks are excluded.

\`limit\` defaults to 50 and accepts at most 100. Reuse a cursor only with the same \`programId\`, \`labelId\`, and \`milestoneId\` filters. \`labelId\` selects tasks with that label. \`milestoneId\` selects tasks on that milestone. \`programId\` selects tasks attached directly to the program or to one of its projects. Docket applies task visibility before filling the page. Organization membership is required. Each item is a {@link TaskOut}; use \`GET /:id\` for dependencies and subtasks.`,
    }),
    zQuery(TaskListQuery),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { cursor, limit, programId, labelId, milestoneId } = c.req.valid('query');

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
              ...(milestoneId === undefined ? [] : [eq(task.milestoneId, milestoneId)]),
            ),
          )
          .orderBy(desc(task.createdAt), desc(task.id));

      // Access is a predicate rather than a SQL join because the grant cascade spans several
      // optional ancestors. Do not filter a `limit + 1` database page after the fact: a hidden
      // row between two visible rows would then become the cursor boundary and make the latter
      // unreachable. The bounded path scans raw keyset batches until it has one extra *visible*
      // row, so `pageResult` still encodes the last returned visible task.
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
      const { items, nextCursor } = pageResult(visible, limit, (r) => r.createdAt);
      return ok(c, pageOf(TaskOut), {
        items: await taskListOutput(orgId, items),
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
      const result = await reparentTasks({
        organizationId: orgId,
        actorId,
        ...c.req.valid('json'),
      });
      await recordTaskReparents(orgId, actorId, result.moves);
      return ok(c, TaskReparentBatchOut, result);
    },
  )
  .get(
    '/:id/aggregate-detail',
    apiDoc({
      tag: 'Tasks',
      summary: 'Get the bounded Task detail aggregate',
      response: TaskDetailAggregate,
      description:
        'Return the task snapshot, the caller’s available controls, team workflow states, and initial document content in one request. Organization-wide picker rosters and optional sections are not included.',
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
      description: `Update selected task fields. Omitted fields remain unchanged, and an empty body returns the task unchanged. Every referenced resource must be visible to the caller and belong to the same organization. A selected cycle must also belong to the task's team. A \`milestoneId\` must belong to the task's project; changing \`projectId\` without sending \`milestoneId\` clears a milestone that belongs to another project.

Changing \`assigneeId\` or \`delegateId\` requires \`assign\`; other changes require \`contribute\`. Set \`parentTaskId\` to make the task a subtask, or set it to null to move the task to the top level. A task cannot become its own parent or a child of one of its descendants. Docket checks the hierarchy while applying the change, so concurrent updates cannot create a cycle. When \`cycleCadenceRevision\` is present, a stale value returns 409 \`cadence_changed\` before Docket moves the task.

\`state\` must match a key in the team's \`workflowStates\`. Docket manages \`completedAt\` and \`canceledAt\` from that state. State and assignment changes add matching activity events. Use \`POST /:id/state\` when changing only the state.`,
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
        // Re-filing a task under another project releases a milestone that belongs to the old
        // one, unless this same request names the milestone to use instead.
        ...(await releasedMilestonePatch(before.milestoneId, body)),
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
        await assertTeamCycle(tx, orgId, body.cycleId, before.teamId, body.cycleCadenceRevision);
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
        await assertTaskCapability(orgId, ctx.actorId, current, 'contribute', tx);
        if (body.assigneeId !== undefined || body.delegateId !== undefined) {
          await assertTaskCapability(orgId, ctx.actorId, current, 'assign', tx);
        }
        await detachTaskAssigneeEdit(orgId, id, body.assigneeId, tx);

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
        const timerStops = await closePatchTimers(tx, ctx.actorId, statePatch, current, updated);

        const relatedActivity = await replaceRelatedTasks(tx, {
          orgId,
          actorId: ctx.actorId,
          taskId: id,
          relatedTaskIds: patchRelatedTaskIds,
        });
        const labels = await replaceTaskLabelSet(tx, orgId, id, patchLabels);
        const parentTaskIds = [
          ...(statePatch === undefined ? [] : [updated.parentTaskId]),
          ...(body.parentTaskId === undefined ? [] : [current.parentTaskId, updated.parentTaskId]),
        ];
        const cascades = await applySubtaskCompletionPolicyForParents(tx, orgId, parentTaskIds);
        await recordTaskPatch(tx, {
          orgId,
          actorId: ctx.actorId,
          before: current,
          after: updated,
          cascades,
          related: relatedActivity,
          labels,
        });
        return { row: updated, cascades, relatedActivity, timerStops };
      });
      const { row, cascades, relatedActivity, timerStops } = result;

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
      await finishTaskPatch({
        orgId,
        actorId: ctx.actorId,
        row,
        completedAt: statePatch?.completedAt,
        timerStops,
        cascades,
      });
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
      description: `Archive a task without deleting its history. Archived tasks no longer appear in active task lists, subtask lists, or the task graph. Requires \`contribute\`.

Archiving an already archived, inaccessible, or unknown task returns 404, so a repeated request does not return the first result. Child tasks and dependencies remain intact. Returns a {@link TaskArchived} acknowledgement with the task ID and archive time.`,
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
        return settleTaskArchive(tx, { orgId, actorId, row });
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
  .route('/', taskStateRoutes)
  .route('/', taskDependencyRoutes)
  .route('/', taskActivityRoutes)
  .route('/', attachmentRoutes);

export default tasks;
