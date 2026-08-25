/**
 * `@docket/types` — Task slice DTOs.
 *
 * @remarks
 * Two invariants in this file are load-bearing beyond the shapes themselves.
 *
 * **Dates.** Every task date is a calendar day, validated as a real one. `z.iso.date()` rejects
 * both malformed input and days that do not exist (`2026-02-30`, `2025-02-29`), and
 * {@link assertDateOrder} additionally refuses a window that runs backwards. The database carries
 * the same rules as CHECK constraints, so an invalid date cannot reach storage through any route,
 * tool, importer or migration — see `packages/db/src/schema/work.ts`.
 *
 * **Provenance is not a task property.** `provenance.source` (`native` | `linked`) is a machine
 * discriminator the sync engine branches on; it is not user-facing copy. See
 * {@link taskOriginLabel} for the one sanctioned way to render provenance to a person.
 */
import { z } from 'zod';

import { Priority } from './capability';
import { LabelRef } from './label';
import { CursorQuery } from './pagination';
import {
  ActorId,
  CycleId,
  LabelId,
  MilestoneId,
  OrganizationId,
  ProgramId,
  ProjectId,
  TaskId,
  TeamId,
  TemplateId,
} from './primitives';

/** Query filters for listing tasks. */
export const TaskListQuery = CursorQuery.extend({
  programId: ProgramId.optional().describe(
    'Restrict the list to tasks under a Program — carrying its `programId` directly, or belonging to one of the Program’s Projects. Omit for the full active-task list.',
  ),
  labelId: LabelId.optional().describe(
    'Restrict the list to tasks carrying this label. Combines with `programId` as an AND. Omit for no label filter.',
  ),
}).meta({ id: 'TaskListQuery', description: 'Query filters for listing tasks.' });
/** Validated task-list query value. */
export type TaskListQuery = z.infer<typeof TaskListQuery>;

/**
 * The earliest calendar day any task date may name.
 *
 * @remarks
 * A task dated before the Unix epoch is never a date someone meant; it is a typo (`0226-05-01`
 * for `2026-05-01`) or a unit mix-up that a date input will happily accept. Bounding the range
 * is the difference between "the string parses" and "the value is possible", which is what the
 * product means by a date being valid. Mirrored by the `task_start_date_range` /
 * `task_due_date_range` CHECK constraints so the bound holds for writers that never see a DTO.
 */
export const TASK_DATE_MIN = '1970-01-01';

/** The latest calendar day any task date may name. See {@link TASK_DATE_MIN}. */
export const TASK_DATE_MAX = '2200-12-31';

/** The date fields whose validity {@link checkTaskDates} enforces. */
interface TaskDateFields {
  /** Anticipated start day (`YYYY-MM-DD`), null to clear, absent to leave alone. */
  readonly startDate?: string | null | undefined;
  /** Due day (`YYYY-MM-DD`), null to clear, absent to leave alone. */
  readonly dueDate?: string | null | undefined;
}

/**
 * Reject task dates that parse but cannot be meant: out-of-range years, and a backwards window.
 *
 * @remarks
 * `z.iso.date()` already refuses malformed input and impossible days — `2026-02-30` and
 * `2025-02-29` both fail, because the format check knows how long each month is. What it cannot
 * know is the two product rules layered here: a task date must fall inside
 * {@link TASK_DATE_MIN}–{@link TASK_DATE_MAX}, and a task may not be due before it is anticipated
 * to start.
 *
 * The ordering rule fires **only when one request supplies both days**. A PATCH that moves the
 * due date alone cannot be judged against a start date the request never sent, and re-reading the
 * stored row here would make validation depend on database state — so that case is caught by the
 * `task_dates_ordered` CHECK constraint instead, which sees the post-update row. The two layers
 * are deliberate: the DTO returns a precise 422 naming the field, the constraint guarantees the
 * invariant against every writer including importers and migrations.
 *
 * Attached with `.superRefine`, so field schemas stay plain `format: date` in the OpenAPI
 * document and issues carry the offending field's path.
 *
 * @param value - The candidate body's date fields.
 * @param ctx - Zod's refinement context; issues are added with a field path.
 *
 * @example
 * ```ts
 * TaskUpdate.parse({ startDate: '2026-09-10', dueDate: '2026-09-01' }); // throws: due before start
 * ```
 */
export function checkTaskDates(value: TaskDateFields, ctx: z.RefinementCtx): void {
  for (const field of ['startDate', 'dueDate'] as const) {
    const day = value[field];
    if (typeof day !== 'string') continue;
    if (day >= TASK_DATE_MIN && day <= TASK_DATE_MAX) continue;
    ctx.addIssue({
      code: 'custom',
      path: [field],
      message: `Date must fall between ${TASK_DATE_MIN} and ${TASK_DATE_MAX}`,
    });
  }
  if (typeof value.startDate !== 'string' || typeof value.dueDate !== 'string') return;
  // Lexicographic comparison is exact for zero-padded `YYYY-MM-DD`, and avoids constructing a
  // `Date` — which would drag the server's timezone into a question about calendar days.
  if (value.dueDate >= value.startDate) return;
  ctx.addIssue({
    code: 'custom',
    path: ['dueDate'],
    message: 'Due date cannot fall before the anticipated start date',
  });
}

/** Reject repeated related-task ids before the write route has to canonicalize them. */
function checkRelatedTaskIds(
  value: { readonly relatedTaskIds?: readonly string[] | undefined },
  ctx: z.RefinementCtx,
): void {
  const relatedTaskIds = value.relatedTaskIds;
  if (relatedTaskIds === undefined) return;
  const seen = new Set<string>();
  relatedTaskIds.forEach((relatedTaskId, index) => {
    if (!seen.has(relatedTaskId)) {
      seen.add(relatedTaskId);
      return;
    }
    ctx.addIssue({
      code: 'custom',
      path: ['relatedTaskIds', index],
      message: 'Each related task can appear only once',
    });
  });
}

/** Body for creating a Task; `state` defaults to the team's first workflow state. */
export const TaskCreate = z
  .object({
    title: z
      .string()
      .min(1)
      .describe('Task title. Required, non-empty; the primary human label for the work.'),
    description: z
      .string()
      .optional()
      .describe('Optional long-form body for the task (markdown). Omit for a title-only task.'),
    teamId: TeamId.describe(
      "The owning team. Required — a task always belongs to exactly one team, and the team's `workflow_states` define the states this task may occupy. Must reference a team in the caller's org.",
    ),
    state: z
      .string()
      .optional()
      .describe(
        "Initial workflow-state key. Must be one of the team's `workflow_states` keys. Omitted → the team's first state (typically `backlog`). Supplying a terminal key (`completed`/`canceled`) lands the task there with the matching timestamp derived.",
      ),
    priority: Priority.optional().describe(
      "Task priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'. Defaults to 'none'. Drives sorting and badges; does not affect workflow state.",
    ),
    assigneeId: ActorId.optional().describe(
      "Actor the task is assigned to (the owner of the work). Must be an actor in the caller's org. Setting it at creation emits an `assignment` observation. Reassignment later requires the `assign` capability.",
    ),
    projectId: ProjectId.optional().describe(
      "Project this task rolls up into. Must be a project in the caller's org. Optional — a task can be project-less (loose work).",
    ),
    milestoneId: MilestoneId.optional().describe(
      "Milestone this task is targeted at. Must belong to the caller's org (and conventionally the same project).",
    ),
    cycleId: CycleId.optional().describe(
      "Cycle (sprint/iteration) this task is committed to. Must be a cycle in the caller's org.",
    ),
    parentTaskId: TaskId.optional().describe(
      'Parent task id to create this task as a subtask. Must be an active task in the caller’s org. Prefer `POST /tasks/:id/subtasks`, which inherits team/project from the parent.',
    ),
    templateId: TemplateId.optional().describe(
      'Task template this task was created from. Must be a caller-visible task template in the caller’s org.',
    ),
    relatedTaskIds: z
      .array(TaskId)
      .optional()
      .describe('Tasks related to this task. Each must be active and in the caller’s org.'),
    estimate: z
      .number()
      .int()
      .optional()
      .describe(
        'Coarse effort estimate in abstract points (integer). Distinct from `estimateMinutes`.',
      ),
    estimateMinutes: z
      .number()
      .int()
      .nullable()
      .optional()
      .describe('Fine-grained time estimate in minutes (integer), or null for none.'),
    startDate: z.iso
      .date()
      .optional()
      .describe(
        'Anticipated start date — the day work is expected to begin (ISO `YYYY-MM-DD`, date-only). A forecast the planner sets, distinct from `dueDate` and from when the task actually moved into a started state (which the activity log records).',
      ),
    dueDate: z.iso
      .date()
      .optional()
      .describe(
        'Target due date — the day the work is expected to be finished (ISO `YYYY-MM-DD`, date-only). Must not fall before `startDate`.',
      ),
    labels: z
      .array(LabelId)
      .optional()
      .describe('Label ids to tag the task with for classification/filtering.'),
  })
  .superRefine((value, ctx) => {
    checkTaskDates(value, ctx);
    checkRelatedTaskIds(value, ctx);
  })
  .meta({ id: 'TaskCreate', description: 'Create a task within an organization.' });
/** Validated task-create body. */
export type TaskCreate = z.infer<typeof TaskCreate>;

/**
 * A Task's single inline provenance triple (native vs linked-from-an-integration).
 *
 * @remarks
 * **This object is machine metadata, not a task property.** It exists so the reconcile engine can
 * tell a row it owns from a row it mirrors, and so a linked task can deep-link back to its source.
 * None of its fields is copy: rendering `source` verbatim is what put a badge reading "Native" on
 * every task in the product, a word describing Docket's own storage that no reader can act on.
 * {@link taskOriginLabel} is the only sanctioned way to turn provenance into something a person
 * reads, and it deliberately has nothing to say about a native task.
 */
export const TaskProvenance = z
  .object({
    source: z
      .enum(['native', 'linked'])
      .describe(
        "Machine discriminator for the sync engine: 'native' (the row is Docket's own) or 'linked' (mirrored from an external integration). Never render this value — pass it through {@link taskOriginLabel}, which yields null for a native task because there is nothing user-relevant to say about one.",
      ),
    sourceIntegrationId: z
      .string()
      .nullable()
      .optional()
      .describe('Id of the integration the task was linked from; null for native tasks.'),
    externalId: z
      .string()
      .nullable()
      .optional()
      .describe(
        "The task's id in the external system (e.g. the GitHub issue number); null for native tasks.",
      ),
    externalUrl: z
      .string()
      .nullable()
      .optional()
      .describe('Deep link to the task in the external system; null for native tasks.'),
    syncMode: z
      .enum(['import', 'mirror'])
      .nullable()
      .optional()
      .describe(
        "How a linked task stays in sync: 'import' (one-time copy, edits diverge) or 'mirror' (kept in continuous sync). Null for native tasks.",
      ),
  })
  .meta({ id: 'TaskProvenance', description: "A task's provenance." });
/** Task provenance value. */
export type TaskProvenance = z.infer<typeof TaskProvenance>;

/**
 * The one sanctioned rendering of a task's provenance — or `null` when there is nothing to say.
 *
 * @remarks
 * The product used to show a "Source" row reading **"Native"** on every task. "Native" is a word
 * about Docket's storage model, not about the reader's work: it is true of everything a person
 * creates here, so it distinguishes nothing, and a non-technical reader cannot state what it
 * means. The decision recorded by this function is that **"Native" is removed rather than
 * renamed** — a native task has no origin worth a row, and the surface renders nothing for it.
 *
 * What *is* concrete is the other case: this task is a copy of something that lives in another
 * tool. That gets a plain-language label naming the tool, so the row a reader sees is
 * "Linked from GitHub" — a fact they can act on, next to the `externalUrl` that takes them there.
 *
 * Returning `null` rather than an empty string is the point: a nullable label makes "render no
 * row" the structurally obvious branch, so a surface cannot fall back to printing the raw enum.
 *
 * @param provenance - The task's provenance triple, straight off {@link TaskOut}.
 * @param providerName - Display name of the integration's provider (e.g. `PROVIDER_CATALOG.github.name`),
 *   or null when the caller has not resolved the integration. Application-owned copy, never
 *   provider-supplied prose.
 * @returns application-owned label copy, or null when the task has no user-relevant origin.
 *
 * @example
 * ```ts
 * taskOriginLabel({ source: 'native' }, null);          // null — render nothing
 * taskOriginLabel({ source: 'linked' }, 'GitHub');      // 'Linked from GitHub'
 * taskOriginLabel({ source: 'linked' }, null);          // 'Linked from another tool'
 * ```
 *
 * @see {@link TaskProvenance} for why the raw `source` value is not copy.
 */
export function taskOriginLabel(
  provenance: Pick<TaskProvenance, 'source'>,
  providerName: string | null,
): string | null {
  if (provenance.source !== 'linked') return null;
  return providerName === null || providerName.length === 0
    ? 'Linked from another tool'
    : `Linked from ${providerName}`;
}

/**
 * The synthetic id of a task activity log's creation entry (`created:<taskId>`).
 *
 * @remarks
 * The creation entry is projected from the task row rather than stored, so it has no ledger id of
 * its own — but a list entry still needs a stable key to render and to diff against. The grammar
 * lives here, beside {@link dependencyEdgeId} and {@link subtaskEdgeId}, so the endpoint that
 * produces it and any client that recognises it cannot drift. The `created:` prefix cannot collide
 * with a ULID, which is 26 uppercase Crockford-base32 characters and contains no colon.
 *
 * @param taskId - The task whose log the entry heads.
 * @returns the entry's stable synthetic id.
 */
export function taskCreationEntryId(taskId: string): string {
  return `created:${taskId}`;
}

/** Full task representation returned by reads. */
export const TaskOut = z
  .object({
    id: TaskId.describe('Opaque task id.'),
    organizationId: OrganizationId.describe('Owning org id (the tenant key).'),
    title: z.string().describe('Task title.'),
    description: z
      .string()
      .nullable()
      .optional()
      .describe('Long-form body (markdown); null when unset.'),
    teamId: TeamId.describe(
      "The owning team, whose `workflow_states` define this task's allowed states.",
    ),
    state: z
      .string()
      .describe(
        "Current workflow-state key, one of the owning team's `workflow_states` keys (e.g. `backlog`, `in_progress`, `done`).",
      ),
    priority: Priority.describe(
      "Task priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'. Drives sorting and badges.",
    ),
    assigneeId: ActorId.nullable()
      .optional()
      .describe('Actor the task is assigned to (owner of the work); null when unassigned.'),
    delegateId: ActorId.nullable()
      .optional()
      .describe(
        'Actor the work is delegated to, distinct from the assignee (e.g. an agent acting on the assignee’s behalf); null when none.',
      ),
    projectId: ProjectId.nullable()
      .optional()
      .describe('Project this task rolls up into; null when project-less.'),
    programId: ProgramId.nullable()
      .optional()
      .describe('Program this task is associated with; null when none.'),
    parentTaskId: TaskId.nullable()
      .optional()
      .describe('Parent task when this is a subtask; null when it is top-level.'),
    templateId: TemplateId.nullable()
      .optional()
      .describe('Task template this task was created from; null when none.'),
    autoCompletedBySubtasks: z
      .boolean()
      .describe('Whether the system completed this task after every direct child ended.'),
    estimateMinutes: z
      .number()
      .int()
      .nullable()
      .optional()
      .describe('Time estimate in minutes; null when unestimated.'),
    startDate: z
      .string()
      .nullable()
      .optional()
      .describe(
        'Anticipated start date — the day work is expected to begin (ISO date string); null when unset. Distinct from `dueDate`, and distinct from when the task actually started, which is recoverable from its activity log.',
      ),
    dueDate: z
      .string()
      .nullable()
      .optional()
      .describe('Target due date (ISO date string); null when unset.'),
    provenance: TaskProvenance.describe(
      'Machine-readable origin metadata for the sync engine — NOT a task property to render. See {@link TaskProvenance} and {@link taskOriginLabel}.',
    ),
    labels: z
      .array(LabelRef)
      .describe(
        'Labels attached to the task, sorted by name. Embedded rather than referenced by id so a list row can render its chips without a second read.',
      ),
    createdAt: z.string().describe('Creation timestamp (ISO 8601).'),
    updatedAt: z.string().describe('Most-recent task update timestamp (ISO 8601).'),
  })
  .meta({ id: 'TaskOut', description: 'A task.' });
/** Task representation value. */
export type TaskOut = z.infer<typeof TaskOut>;

/** Body for updating a Task, including a single-task hierarchy change. */
export const TaskUpdate = z
  .object({
    title: z.string().min(1).optional().describe('New title (non-empty). Omit to leave unchanged.'),
    description: z
      .string()
      .optional()
      .describe('New long-form body (markdown). Omit to leave unchanged.'),
    state: z
      .string()
      .optional()
      .describe(
        "New workflow-state key; must exist in the team's `workflow_states`. Triggers the transition and derives/clears `completedAt`/`canceledAt`. Omit to leave unchanged.",
      ),
    priority: Priority.optional().describe(
      "New priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'. Omit to leave unchanged.",
    ),
    assigneeId: ActorId.nullable()
      .optional()
      .describe(
        'Reassign to this actor, or null to unassign. Requires the `assign` capability (not just `contribute`). Must be an actor in the caller’s org. Emits an `assignment` observation when set.',
      ),
    delegateId: ActorId.nullable()
      .optional()
      .describe(
        'Delegate the work to this actor, or null to clear. Requires the `assign` capability. Must be an actor in the caller’s org.',
      ),
    projectId: ProjectId.nullable()
      .optional()
      .describe(
        'Re-point to this project, or null to detach. Must be a project in the caller’s org.',
      ),
    programId: ProgramId.nullable()
      .optional()
      .describe(
        'Re-point to this program, or null to detach. Must be a program in the caller’s org.',
      ),
    parentTaskId: TaskId.nullable()
      .optional()
      .describe(
        'Reparent under this task (its subtask), or null to detach to top-level. Must be a task in the caller’s org; a task cannot become its own descendant (409 on a cycle) or its own parent (422). Omit to leave unchanged.',
      ),
    templateId: TemplateId.nullable()
      .optional()
      .describe(
        'Task template that originated this task, or null to clear. Must be a caller-visible task template in the caller’s org.',
      ),
    relatedTaskIds: z
      .array(TaskId)
      .optional()
      .describe('Replacement set of related tasks. Use an empty array to remove every link.'),
    milestoneId: MilestoneId.nullable()
      .optional()
      .describe('Re-target this milestone, or null to clear. Must belong to the caller’s org.'),
    cycleId: CycleId.nullable()
      .optional()
      .describe(
        'Re-commit to this cycle, or null to remove from its cycle. Must be a cycle in the caller’s org.',
      ),
    estimate: z
      .number()
      .int()
      .nullable()
      .optional()
      .describe('New point estimate (integer), or null to clear. Omit to leave unchanged.'),
    estimateMinutes: z
      .number()
      .int()
      .nullable()
      .optional()
      .describe('New time estimate in minutes, or null to clear. Omit to leave unchanged.'),
    startDate: z.iso
      .date()
      .nullable()
      .optional()
      .describe(
        'New anticipated start date — the day work is expected to begin (ISO `YYYY-MM-DD`), or null to clear. Omit to leave unchanged. Must not fall after `dueDate`.',
      ),
    dueDate: z.iso
      .date()
      .nullable()
      .optional()
      .describe(
        'New due date (ISO `YYYY-MM-DD`), or null to clear. Omit to leave unchanged. Must not fall before the anticipated start date.',
      ),
    labels: z
      .array(LabelId)
      .optional()
      .describe('Replacement set of label ids. Omit to leave the task’s labels unchanged.'),
  })
  .superRefine((value, ctx) => {
    checkTaskDates(value, ctx);
    checkRelatedTaskIds(value, ctx);
  })
  .meta({ id: 'TaskUpdate', description: 'Update a task.' });
/** Validated task-update body. */
export type TaskUpdate = z.infer<typeof TaskUpdate>;

/** One requested task-parent assignment in an atomic hierarchy change. */
const TaskReparentMoveIn = z.object({
  taskId: TaskId.describe('Task whose parent assignment should change.'),
  parentTaskId: TaskId.nullable().describe(
    'New parent task, or null to move the task to the top level.',
  ),
});

/**
 * Body for atomically assigning one or more tasks to a parent.
 *
 * @remarks
 * Subject task ids must be unique. When `preserveSelectedSubtrees` is true, the server moves only
 * selected hierarchy roots so a selected descendant stays attached to its selected ancestor.
 */
export const TaskReparentBatchIn = z
  .object({
    moves: z.array(TaskReparentMoveIn).min(1).describe('Non-empty set of parent assignments.'),
    preserveSelectedSubtrees: z
      .boolean()
      .describe('Whether selected descendants should remain attached to selected ancestors.'),
  })
  .superRefine(({ moves }, ctx) => {
    const taskIds = new Set<string>();
    moves.forEach(({ taskId }, index) => {
      if (!taskIds.has(taskId)) {
        taskIds.add(taskId);
        return;
      }
      ctx.addIssue({
        code: 'custom',
        path: ['moves', index, 'taskId'],
        message: 'Each task can appear only once',
      });
    });
  })
  .meta({
    id: 'TaskReparentBatchIn',
    description: 'Atomically assign one or more tasks to new hierarchy parents.',
  });
/** Validated atomic task-reparent body. */
export type TaskReparentBatchIn = z.infer<typeof TaskReparentBatchIn>;

/** One committed hierarchy assignment, including the value required to undo it. */
const TaskReparentMoveOut = TaskReparentMoveIn.extend({
  previousParentTaskId: TaskId.nullable().describe(
    'Parent task before the atomic change, or null when previously top-level.',
  ),
});

/** Result of an atomic task hierarchy change. */
export const TaskReparentBatchOut = z
  .object({
    moves: z
      .array(TaskReparentMoveOut)
      .describe('Committed hierarchy roots and their previous parent assignments.'),
  })
  .meta({
    id: 'TaskReparentBatchOut',
    description: 'Committed task hierarchy assignments with undo information.',
  });
/** Atomic task-reparent result value. */
export type TaskReparentBatchOut = z.infer<typeof TaskReparentBatchOut>;

/** Body for changing a Task's workflow state; the key must exist in the team's `workflow_states`. */
export const TaskStateUpdate = z
  .object({
    state: z
      .string()
      .min(1)
      .describe(
        "Target workflow-state key. Must be a non-empty key present in the owning team's `workflow_states`. Entering a terminal state derives `completedAt`/`canceledAt`; leaving one clears them.",
      ),
  })
  .meta({ id: 'TaskStateUpdate', description: "Set a task's workflow state." });
/** Validated task-state-change body. */
export type TaskStateUpdate = z.infer<typeof TaskStateUpdate>;

/** Body for creating a subtask under a parent Task (`parentTaskId` is taken from the path). */
export const SubtaskCreate = z
  .object({
    title: z.string().min(1).describe('Subtask title. Required, non-empty.'),
    description: z.string().optional().describe('Optional long-form body (markdown).'),
    state: z
      .string()
      .optional()
      .describe(
        "Initial workflow-state key (validated against the inherited team's `workflow_states`). Omitted → inherits the parent task's current state (not the team's first state).",
      ),
    priority: Priority.optional().describe(
      "Priority: 'none' | 'low' | 'medium' | 'high' | 'urgent'. Defaults to 'none'.",
    ),
    assigneeId: ActorId.optional().describe(
      "Actor to assign the subtask to. Must be an actor in the caller's org.",
    ),
    projectId: ProjectId.optional().describe(
      "Project for the subtask. Must be a project in the caller's org. Omitted → inherits the parent's project.",
    ),
    milestoneId: MilestoneId.optional().describe(
      "Milestone to target. Must belong to the caller's org.",
    ),
    cycleId: CycleId.optional().describe(
      "Cycle to commit to. Must be a cycle in the caller's org.",
    ),
    estimate: z.number().int().optional().describe('Point estimate (integer).'),
    estimateMinutes: z
      .number()
      .int()
      .nullable()
      .optional()
      .describe('Time estimate in minutes (integer), or null.'),
    startDate: z.iso
      .date()
      .optional()
      .describe('Anticipated start date — the day work is expected to begin (ISO `YYYY-MM-DD`).'),
    dueDate: z.iso
      .date()
      .optional()
      .describe('Target due date (ISO `YYYY-MM-DD`). Must not fall before `startDate`.'),
    labels: z.array(LabelId).optional().describe('Label ids to tag the subtask with.'),
  })
  .superRefine(checkTaskDates)
  .meta({ id: 'SubtaskCreate', description: 'Create a subtask under a parent task.' });
/** Validated subtask-create body. */
export type SubtaskCreate = z.infer<typeof SubtaskCreate>;

/** A lightweight Task reference carrying its project for cross-project dependency display. */
export const TaskRef = z
  .object({
    id: TaskId.describe('Referenced task id.'),
    title: z.string().describe('Referenced task title, for display without a second fetch.'),
    state: z.string().describe('Referenced task’s current workflow-state key.'),
    projectId: ProjectId.nullable()
      .optional()
      .describe(
        'Referenced task’s project; null when project-less. Lets the UI render cross-project links.',
      ),
  })
  .meta({ id: 'TaskRef', description: 'A task reference with its project.' });
/** Task reference value. */
export type TaskRef = z.infer<typeof TaskRef>;

/**
 * The richer single-task read: the full task plus its dependency edges and subtasks.
 *
 * @remarks
 * `blocking` are tasks this task blocks; `blockedBy` are tasks blocking this one.
 * Each ref carries its `projectId` so the UI can show cross-project links.
 */
export const TaskDetail = TaskOut.extend({
  milestoneId: MilestoneId.nullable()
    .optional()
    .describe('Milestone this task targets; null when none.'),
  cycleId: CycleId.nullable()
    .optional()
    .describe('Cycle this task is committed to; null when none.'),
  parentTaskId: TaskId.nullable()
    .optional()
    .describe('Parent task id when this is a subtask; null for a top-level task.'),
  estimate: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe('Point estimate (integer); null when unestimated.'),
  estimateMinutes: z
    .number()
    .int()
    .nullable()
    .optional()
    .describe('Time estimate in minutes; null when unestimated.'),
  completedAt: z
    .string()
    .nullable()
    .optional()
    .describe(
      'When the task entered a completed state (ISO 8601, server-derived); null unless completed.',
    ),
  canceledAt: z
    .string()
    .nullable()
    .optional()
    .describe(
      'When the task entered a canceled state (ISO 8601, server-derived); null unless canceled.',
    ),
  blocking: z
    .array(TaskRef)
    .describe('Tasks THIS task blocks (this task is the blocking side of each edge).'),
  blockedBy: z
    .array(TaskRef)
    .describe('Tasks that block THIS task (this task is the blocked side of each edge).'),
  subtasks: z.array(TaskRef).describe('Active direct children of this task.'),
  relatedTasks: z
    .array(TaskRef)
    .describe('Tasks linked to this task without dependency direction.'),
}).meta({ id: 'TaskDetail', description: 'A task with its dependencies and subtasks.' });
/** Detailed task representation value. */
export type TaskDetail = z.infer<typeof TaskDetail>;

/**
 * Body for adding a dependency edge to a Task.
 *
 * @remarks
 * Exactly one of `blockingTaskId` / `blockedTaskId` is given relative to the path
 * task: `blockingTaskId` makes the given task block the path task; `blockedTaskId`
 * makes the path task block the given task. Both express the same directed `blocks`
 * graph (blocking → blocked).
 */
export const TaskDependencyCreate = z
  .object({
    blockingTaskId: TaskId.optional().describe(
      'Set this to make the given task BLOCK the path task (the given task is the blocking side; the path task is blocked). Provide this OR `blockedTaskId`, never both.',
    ),
    blockedTaskId: TaskId.optional().describe(
      'Set this to make the path task BLOCK the given task (the path task is the blocking side; the given task is blocked). Provide this OR `blockingTaskId`, never both.',
    ),
  })
  .refine((v) => (v.blockingTaskId === undefined) !== (v.blockedTaskId === undefined), {
    message: 'Provide exactly one of blockingTaskId or blockedTaskId',
  })
  .meta({ id: 'TaskDependencyCreate', description: 'Add a directed dependency edge.' });
/** Validated dependency-create body. */
export type TaskDependencyCreate = z.infer<typeof TaskDependencyCreate>;

/** A Task's two dependency lists; each ref carries its project for cross-project display. */
export const TaskDependencyOut = z
  .object({
    blocking: z
      .array(TaskRef)
      .describe('Tasks the subject task blocks (subject is the blocking side of each edge).'),
    blockedBy: z
      .array(TaskRef)
      .describe('Tasks that block the subject task (subject is the blocked side of each edge).'),
  })
  .meta({ id: 'TaskDependencyOut', description: "A task's dependency edges." });
/** Task dependency lists value. */
export type TaskDependencyOut = z.infer<typeof TaskDependencyOut>;

/** Acknowledgement returned when a dependency edge is created. */
export const TaskDependencyCreated = z
  .object({
    created: z.literal(true).describe('Always `true`; confirms the edge was created.'),
    blockingTaskId: TaskId.describe('Resolved blocking-side task id of the created edge.'),
    blockedTaskId: TaskId.describe('Resolved blocked-side task id of the created edge.'),
  })
  .meta({ id: 'TaskDependencyCreated', description: 'A created dependency edge.' });
/** Created-dependency acknowledgement value. */
export type TaskDependencyCreated = z.infer<typeof TaskDependencyCreated>;

/** Acknowledgement returned when a dependency edge is removed. */
export const TaskRemoved = z
  .object({
    removed: z.literal(true).describe('Always `true`; confirms the dependency edge was removed.'),
  })
  .meta({ id: 'TaskRemoved', description: 'A removed edge acknowledgement.' });
/** Removal acknowledgement value. */
export type TaskRemoved = z.infer<typeof TaskRemoved>;

/**
 * A node in the dependency canvas: a slim task projection.
 *
 * @remarks
 * The canvas renderer is dataset-agnostic, so this carries only what a node card and the
 * layout need (no provenance/timestamps). FK fields that can be unset are `null` (matching
 * the column), never optional — see {@link GraphOut}.
 */
export const TaskGraphNode = z
  .object({
    id: TaskId.describe('Task id; also the node id referenced by graph edges.'),
    title: z.string().describe('Task title, for the node card label.'),
    state: z.string().describe('Current workflow-state key, for node coloring/status.'),
    priority: Priority.describe(
      "Priority: 'none' | 'low' | 'medium' | 'high' | 'urgent', for node emphasis.",
    ),
    teamId: TeamId.describe('Owning team id.'),
    projectId: ProjectId.nullable().describe(
      'Project id, or null when project-less. Always present (never omitted) to match the column.',
    ),
    programId: ProgramId.nullable().describe(
      'Program id, or null when the Task is not filed in one. Always present.',
    ),
    labelIds: z.array(LabelId).describe('Organization-global Labels attached to this Task.'),
    assigneeId: ActorId.nullable().describe(
      'Assignee id, or null when unassigned. Always present (never omitted).',
    ),
    parentTaskId: TaskId.nullable().describe(
      'Parent task id, or null for a top-level task. Drives `subtask` edges. Always present.',
    ),
    startDate: z
      .string()
      .nullable()
      .describe('ISO start date, or null. For schedule-aware layout/overlays. Always present.'),
    dueDate: z
      .string()
      .nullable()
      .describe('ISO due date, or null. Drives overdue/at-risk styling. Always present.'),
    estimate: z
      .number()
      .int()
      .nullable()
      .describe('Effort points, or null. Weights the critical-path computation. Always present.'),
    milestoneId: MilestoneId.nullable().describe(
      'Milestone id, or null. For milestone swimlanes. Always present.',
    ),
    cycleId: CycleId.nullable().describe('Cycle id, or null. For cycle swimlanes. Always present.'),
  })
  .meta({ id: 'TaskGraphNode', description: 'A task node in the dependency graph.' });
/** Dependency-graph node value. */
export type TaskGraphNode = z.infer<typeof TaskGraphNode>;

/**
 * A directed edge in the dependency canvas.
 *
 * @remarks
 * `dependency` edges run `blocking → blocked` (source blocks target); `subtask` edges run
 * `parent → child`. `id` is a stable synthetic key (`dep:<a>:<b>` / `sub:<a>:<b>`).
 */
export const TaskGraphEdge = z
  .object({
    id: z
      .string()
      .describe(
        'Stable synthetic edge key: `dep:<source>:<target>` for dependencies, `sub:<parent>:<child>` for subtasks.',
      ),
    source: TaskId.describe(
      'Source node id. For `dependency` the blocking task; for `subtask` the parent task.',
    ),
    target: TaskId.describe(
      'Target node id. For `dependency` the blocked task; for `subtask` the child task.',
    ),
    kind: z
      .enum(['dependency', 'subtask'])
      .describe(
        "Edge type: 'dependency' (`source` blocks `target`) or 'subtask' (`source` is the parent of `target`).",
      ),
  })
  .meta({ id: 'TaskGraphEdge', description: 'A directed dependency or subtask edge.' });
/** Dependency-graph edge value. */
export type TaskGraphEdge = z.infer<typeof TaskGraphEdge>;

/**
 * The synthetic id of a dependency edge (`dep:<blocking>:<blocked>`).
 *
 * @remarks
 * The one definition of the `dep:`/`sub:` id grammar, shared by the graph endpoint (which
 * produces edges) and the web optimistic cache (which fabricates them) so the two never drift.
 */
export function dependencyEdgeId(blockingTaskId: string, blockedTaskId: string): string {
  return `dep:${blockingTaskId}:${blockedTaskId}`;
}

/** The synthetic id of a subtask edge (`sub:<parent>:<child>`). */
export function subtaskEdgeId(parentTaskId: string, childTaskId: string): string {
  return `sub:${parentTaskId}:${childTaskId}`;
}

/**
 * The whole dependency graph for a scope: every viewable node plus the edges among them.
 *
 * @remarks
 * Edges are pre-pruned so both endpoints are present in `nodes` (no dangling edges). The
 * node set is already filtered to what the caller may view, so the renderer can draw it as-is.
 */
export const GraphOut = z
  .object({
    nodes: z
      .array(TaskGraphNode)
      .describe('Every task in the scope the caller may view, already access-filtered.'),
    edges: z
      .array(TaskGraphEdge)
      .describe(
        'Dependency and subtask edges among `nodes`, pre-pruned so both endpoints are present.',
      ),
  })
  .meta({ id: 'GraphOut', description: 'A scoped task dependency + subtask graph.' });
/** Dependency-graph payload value. */
export type GraphOut = z.infer<typeof GraphOut>;

/** Acknowledgement returned when a Task is archived (soft-deleted). */
export const TaskArchived = z
  .object({
    id: TaskId.describe('Id of the archived task.'),
    archivedAt: z
      .string()
      .describe(
        'When the task was archived/soft-deleted (ISO 8601). The row is retained, just hidden from active reads.',
      ),
  })
  .meta({ id: 'TaskArchived', description: 'An archived task acknowledgement.' });
/** Archived-task acknowledgement value. */
export type TaskArchived = z.infer<typeof TaskArchived>;
