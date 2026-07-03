/**
 * `@docket/types` — Task slice DTOs.
 */
import { z } from 'zod';

import { Priority } from './capability';
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
} from './primitives';

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
      .describe('Planned start date (ISO `YYYY-MM-DD`, date-only).'),
    dueDate: z.iso.date().optional().describe('Target due date (ISO `YYYY-MM-DD`, date-only).'),
    labels: z
      .array(LabelId)
      .optional()
      .describe('Label ids to tag the task with for classification/filtering.'),
  })
  .meta({ id: 'TaskCreate', description: 'Create a task within an organization.' });
/** Validated task-create body. */
export type TaskCreate = z.infer<typeof TaskCreate>;

/** A Task's single inline provenance triple (native vs linked-from-an-integration). */
export const TaskProvenance = z
  .object({
    source: z
      .enum(['native', 'linked'])
      .describe(
        "Origin of the task: 'native' (created in Docket) or 'linked' (mirrored/imported from an external integration such as GitHub or Linear).",
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
      .describe('Planned start date (ISO date string); null when unset.'),
    dueDate: z
      .string()
      .nullable()
      .optional()
      .describe('Target due date (ISO date string); null when unset.'),
    provenance: TaskProvenance.describe(
      'Origin metadata — whether the task is native or linked from an integration. See {@link TaskProvenance}.',
    ),
    createdAt: z.string().describe('Creation timestamp (ISO 8601).'),
  })
  .meta({ id: 'TaskOut', description: 'A task.' });
/** Task representation value. */
export type TaskOut = z.infer<typeof TaskOut>;

/** Body for updating a Task (reparenting goes through `/move`, not here). */
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
      .optional()
      .describe('New point estimate (integer). Omit to leave unchanged.'),
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
      .describe('New start date (ISO `YYYY-MM-DD`), or null to clear. Omit to leave unchanged.'),
    dueDate: z.iso
      .date()
      .nullable()
      .optional()
      .describe('New due date (ISO `YYYY-MM-DD`), or null to clear. Omit to leave unchanged.'),
    labels: z
      .array(LabelId)
      .optional()
      .describe('Replacement set of label ids. Omit to leave the task’s labels unchanged.'),
  })
  .meta({ id: 'TaskUpdate', description: 'Update a task.' });
/** Validated task-update body. */
export type TaskUpdate = z.infer<typeof TaskUpdate>;

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
    startDate: z.iso.date().optional().describe('Planned start date (ISO `YYYY-MM-DD`).'),
    dueDate: z.iso.date().optional().describe('Target due date (ISO `YYYY-MM-DD`).'),
    labels: z.array(LabelId).optional().describe('Label ids to tag the subtask with.'),
  })
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
