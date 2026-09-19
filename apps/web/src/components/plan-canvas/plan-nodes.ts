/**
 * `components/plan-canvas/plan-nodes` — projecting a plan document onto xyflow nodes and edges.
 *
 * @remarks
 * Node ids are the document's refs, so a selection, a diff, and an op all speak the same handle.
 * Three node types cover the three kinds this slice plans: an initiative card, a project
 * container that holds its task rows by containment, and a task row. The two relationships the
 * data model distinguishes are drawn differently on purpose: initiative-to-project is many-to-many
 * and is an edge; project-to-task is ownership and is containment.
 *
 * Sizes live here rather than in the renderers because the layout has to know them before
 * anything renders — a container's height is a function of how many rows it holds.
 */
import type { ActorKind } from '@docket/ui/components';
import type { Edge, Node } from '@xyflow/react';
import type {
  PlanDocument,
  PlanDraftOut,
  PlanNode,
  PlanNodeKind,
} from '@docket/work/plan-draft-contract';

import { dependencyMarkerEnd } from '../canvas/dependency-marker';
import type { PlanDiff } from './plan-diff';

/** Node type names registered with the canvas. */
export const PLAN_NODE_TYPE = {
  initiative: 'planInitiative',
  project: 'planProject',
  task: 'planTask',
} as const;

/** Edge type names registered with the canvas. */
export const PLAN_EDGE_TYPE = {
  /** An initiative-to-project membership link. Never selectable, never a dependency. */
  link: 'planLink',
  /** A `blocks` dependency between two projects or two tasks; the shared dependency edge. */
  dependency: 'default',
} as const;

/** The initiative card, in canvas units. */
export const PLAN_INITIATIVE_SIZE = { width: 336, height: 112 } as const;
/**
 * The project container's width; its height follows its rows. Wide enough that a row carries its
 * title beside the assignee, the team, and the due date without truncating the title to a word.
 */
export const PLAN_PROJECT_WIDTH = 376;
/** Inset between the container edge and its rows. */
export const PLAN_PROJECT_PADDING = 8;
/**
 * A task row inside its container, in canvas units: the container's width less its insets, at
 * the height of a list row rather than a card.
 */
export const PLAN_TASK_SIZE = {
  width: PLAN_PROJECT_WIDTH - PLAN_PROJECT_PADDING * 2,
  height: 32,
} as const;
/** How far a subtask row sits in from its feature task, in canvas units. */
export const PLAN_SUBTASK_INDENT = 20;
/** The container's header band: glyph, title, meta line. */
export const PLAN_PROJECT_HEADER = 64;
/** The stroke every dependency edge on the plan takes, so the arrowhead matches the line. */
export const PLAN_DEPENDENCY_STROKE = 'var(--color-outline)';
/** Vertical gap between task rows. */
export const PLAN_TASK_GAP = 4;
/** The ghost "Add task" row an editable draft container ends with. */
export const PLAN_PROJECT_FOOTER = 32;
/** One line of the miniature task list a collapsed container shows. */
export const PLAN_MINI_ROW = 16;
/** How many task titles the miniature list names before the rest become a count. */
export const PLAN_MINI_SHOWN = 3;
/** Vertical inset inside the miniature list. */
export const PLAN_MINI_PADDING = 6;

/**
 * The height of a collapsed container's miniature task list, or 0 when it has no tasks.
 *
 * @param taskCount - Rows the container holds.
 */
export function miniTaskListHeight(taskCount: number): number {
  if (taskCount === 0) return 0;
  const lines = Math.min(taskCount, PLAN_MINI_SHOWN) + (taskCount > PLAN_MINI_SHOWN ? 1 : 0);
  return lines * PLAN_MINI_ROW + PLAN_MINI_PADDING * 2;
}

/** A person, agent, or team a plan field names, resolved for display. */
export interface PlanActor {
  readonly kind: ActorKind;
  readonly name: string;
  readonly avatarUrl: string | null;
}

/** What every plan node renderer receives. */
export interface PlanNodeBaseData extends Record<string, unknown> {
  readonly ref: string;
  readonly kind: PlanNodeKind;
  readonly orgId: string;
  readonly title: string;
  readonly status: PlanNode['status'];
  /** The real object's route once confirmed. */
  readonly href: string | null;
  /** Whether the node arrived in the latest revision, for the enter motion. */
  readonly entered: boolean;
  /** Field names the latest revision changed, for the highlight sweep. */
  readonly changedFields: readonly string[];
  /** Whether the viewer may edit the draft. */
  readonly canEdit: boolean;
}

/** The initiative card. */
export interface PlanInitiativeNodeData extends PlanNodeBaseData {
  readonly kind: 'initiative';
  readonly summary: string | null;
  readonly owner: PlanActor | null;
  readonly targetDate: string | null;
  /** Whether this is the plan's root rather than a second initiative a project also joins. */
  readonly isRoot: boolean;
}

/** One task as the miniature list names it. */
export interface PlanMiniTask {
  readonly ref: string;
  readonly title: string;
  readonly status: PlanNode['status'];
}

/** The project container. */
export interface PlanProjectNodeData extends PlanNodeBaseData {
  readonly kind: 'project';
  readonly summary: string | null;
  readonly lead: PlanActor | null;
  readonly targetDate: string | null;
  readonly taskCount: number;
  /** The tasks in document order, for the miniature list a collapsed container shows. */
  readonly tasks: readonly PlanMiniTask[];
  /** Whether the container shows its task rows; collapsed, it shows the miniature list. */
  readonly expanded: boolean;
  /** Names of the other initiatives this project also belongs to. */
  readonly alsoIn: readonly string[];
  /** Whether the container ends with an Add task row. */
  readonly canAddTask: boolean;
}

/** How deep a task row sits: a feature task in its project, or a subtask under one. */
export type PlanTaskDepth = 0 | 1;

/** A task row inside its project. */
export interface PlanTaskNodeData extends PlanNodeBaseData {
  readonly kind: 'task';
  /** The project container the row sits in, whether it is a task or a subtask. */
  readonly parentRef: string;
  /** The feature task a subtask hangs from; null for a task directly in its project. */
  readonly parentTaskRef: string | null;
  readonly depth: PlanTaskDepth;
  readonly assignee: PlanActor | null;
  /** The owning team's name, or null when none is set or the roster does not know it. */
  readonly team: string | null;
  readonly dueDate: string | null;
  readonly priority: string | null;
  /** How many subtasks hang from this task; always 0 on a subtask. */
  readonly subtaskCount: number;
  /** Whether this task's subtasks are shown beneath it. */
  readonly subtasksShown: boolean;
  /** Whether the viewer may add a subtask here: a draft task that is not itself a subtask. */
  readonly canAddSubtask: boolean;
}

/** One task in the order its container lists it: each task, then its subtasks. */
export interface PlanTaskRow {
  readonly node: PlanNode;
  /** The project the row sits in. */
  readonly projectRef: string;
  readonly parentTaskRef: string | null;
  readonly depth: PlanTaskDepth;
  readonly subtaskCount: number;
}

/**
 * The project a task sits in: its parent when that is a project, its feature task's project when
 * it is a subtask, or null when neither resolves.
 *
 * @param byRef - The document's nodes by ref.
 * @param node - A task node.
 */
export function taskProjectRef(
  byRef: ReadonlyMap<string, PlanNode>,
  node: PlanNode,
): string | null {
  const parent = node.parentRef === null ? undefined : byRef.get(node.parentRef);
  if (parent?.kind === 'project') return parent.ref;
  if (parent?.kind !== 'task' || parent.parentRef === null) return null;
  return byRef.get(parent.parentRef)?.kind === 'project' ? parent.parentRef : null;
}

/** Whether a task node hangs from another task. */
export function isSubtaskNode(byRef: ReadonlyMap<string, PlanNode>, node: PlanNode): boolean {
  return node.parentRef !== null && byRef.get(node.parentRef)?.kind === 'task';
}

/** Each feature task's subtasks, in document order, by the feature task's ref. */
function subtasksByTask(
  document: PlanDocument,
  byRef: ReadonlyMap<string, PlanNode>,
): Map<string, PlanNode[]> {
  const grouped = new Map<string, PlanNode[]>();
  for (const node of document.nodes) {
    if (node.kind !== 'task' || node.parentRef === null || !isSubtaskNode(byRef, node)) continue;
    grouped.set(node.parentRef, [...(grouped.get(node.parentRef) ?? []), node]);
  }
  return grouped;
}

/**
 * Every task that resolves to a project, grouped by project in reading order: each feature task
 * in document order, followed directly by its subtasks.
 *
 * @param document - The plan document.
 * @returns the rows per project ref.
 */
export function planTaskRows(document: PlanDocument): Map<string, PlanTaskRow[]> {
  const byRef = new Map(document.nodes.map((node) => [node.ref, node]));
  const subtasks = subtasksByTask(document, byRef);
  const rows = new Map<string, PlanTaskRow[]>();
  for (const node of document.nodes) {
    if (node.kind !== 'task' || isSubtaskNode(byRef, node)) continue;
    const projectRef = taskProjectRef(byRef, node);
    if (projectRef === null) continue;
    const children = subtasks.get(node.ref) ?? [];
    const list = rows.get(projectRef) ?? [];
    list.push({ node, projectRef, parentTaskRef: null, depth: 0, subtaskCount: children.length });
    for (const child of children) {
      list.push({ node: child, projectRef, parentTaskRef: node.ref, depth: 1, subtaskCount: 0 });
    }
    rows.set(projectRef, list);
  }
  return rows;
}

/** Read the typed data off a plan node (one place for the cast). */
export function planNodeData(node: { data: unknown }): PlanNodeBaseData {
  return node.data as PlanNodeBaseData;
}

/** What the projection needs from the surrounding surface. */
export interface ProjectPlanOptions {
  readonly orgId: string;
  /** The latest diff, for the enter and highlight motion. */
  readonly diff: PlanDiff;
  readonly canEdit: boolean;
  /** Resolve an actor id to the actor it names, or null when unknown. */
  readonly resolveActor: (actorId: string) => PlanActor | null;
  /** Resolve an existing initiative id to its name, or null when unknown. */
  readonly initiativeName: (initiativeId: string) => string | null;
  /** The project refs whose task rows are shown; every other container is collapsed. */
  readonly expandedRefs: ReadonlySet<string>;
  /** Resolve a team id to its name, or null when unknown. */
  readonly resolveTeam: (teamId: string) => string | null;
  /** The feature tasks whose subtasks are hidden; every other task shows its subtasks. */
  readonly collapsedTaskRefs: ReadonlySet<string>;
}

function baseData(
  node: PlanNode,
  plan: PlanDraftOut,
  options: ProjectPlanOptions,
): PlanNodeBaseData {
  const live = plan.objects[node.ref];
  return {
    ref: node.ref,
    kind: node.kind,
    orgId: options.orgId,
    title: live?.name ?? node.fields.title,
    status: node.status,
    href: live?.href ?? null,
    entered: options.diff.added.has(node.ref),
    changedFields: options.diff.changed.get(node.ref) ?? [],
    canEdit: options.canEdit,
  };
}

function actorOf(
  actorId: string | null | undefined,
  options: ProjectPlanOptions,
): PlanActor | null {
  return actorId ? options.resolveActor(actorId) : null;
}

function initiativeNode(
  node: PlanNode,
  plan: PlanDraftOut,
  options: ProjectPlanOptions,
  isRoot: boolean,
): Node<PlanInitiativeNodeData> {
  return {
    id: node.ref,
    type: PLAN_NODE_TYPE.initiative,
    position: { x: 0, y: 0 },
    data: {
      ...baseData(node, plan, options),
      kind: 'initiative',
      summary: node.fields.summary ?? null,
      owner: actorOf(node.fields.ownerId, options),
      targetDate: node.fields.targetDate ?? null,
      isRoot,
    },
  };
}

function projectNode(
  node: PlanNode,
  plan: PlanDraftOut,
  options: ProjectPlanOptions,
  byRef: ReadonlyMap<string, PlanNode>,
  tasks: readonly PlanMiniTask[],
): Node<PlanProjectNodeData> {
  const alsoIn = [
    ...node.initiativeRefs.map((ref) => byRef.get(ref)?.fields.title ?? null),
    ...node.initiativeIds.map((id) => options.initiativeName(id)),
  ].filter((name): name is string => name !== null);
  return {
    id: node.ref,
    type: PLAN_NODE_TYPE.project,
    position: { x: 0, y: 0 },
    data: {
      ...baseData(node, plan, options),
      kind: 'project',
      summary: node.fields.summary ?? null,
      lead: actorOf(node.fields.leadId, options),
      targetDate: node.fields.targetDate ?? null,
      taskCount: tasks.length,
      tasks,
      expanded: options.expandedRefs.has(node.ref),
      alsoIn,
      canAddTask: options.canEdit && node.status === 'draft',
    },
  };
}

/** Whether a row is out of view: its container is collapsed, or its feature task is. */
function rowHidden(row: PlanTaskRow, options: ProjectPlanOptions): boolean {
  if (!options.expandedRefs.has(row.projectRef)) return true;
  return row.parentTaskRef !== null && options.collapsedTaskRefs.has(row.parentTaskRef);
}

function taskNode(
  row: PlanTaskRow,
  plan: PlanDraftOut,
  options: ProjectPlanOptions,
): Node<PlanTaskNodeData> {
  const { node } = row;
  const teamId = node.fields.teamId;
  return {
    id: node.ref,
    type: PLAN_NODE_TYPE.task,
    position: { x: 0, y: 0 },
    // A subtask sits in its project's container beside its feature task, one level in, so the
    // container stays the only frame on the board.
    parentId: row.projectRef,
    // No `extent`: a row must be able to leave its container, because dragging it into another
    // container is how a person moves a task; the drop handler re-homes it or snaps it back.
    draggable: options.canEdit && node.status === 'draft',
    // A collapsed container names its tasks in miniature; the rows themselves stay out of the
    // graph, and so do the edges that end on them.
    hidden: rowHidden(row, options),
    data: {
      ...baseData(node, plan, options),
      kind: 'task',
      parentRef: row.projectRef,
      parentTaskRef: row.parentTaskRef,
      depth: row.depth,
      assignee: actorOf(node.fields.assigneeId, options),
      team: teamId ? options.resolveTeam(teamId) : null,
      dueDate: node.fields.dueDate ?? null,
      priority: node.fields.priority ?? null,
      subtaskCount: row.subtaskCount,
      subtasksShown: !options.collapsedTaskRefs.has(node.ref),
      canAddSubtask: options.canEdit && row.depth === 0 && node.status === 'draft',
    },
  };
}

/** The initiative refs a project belongs to, primary parent first. */
function projectInitiativeRefs(node: PlanNode): string[] {
  const refs = node.parentRef === null ? [] : [node.parentRef];
  for (const ref of node.initiativeRefs) if (!refs.includes(ref)) refs.push(ref);
  return refs;
}

/**
 * Project a plan onto unpositioned nodes and edges. Parents precede children, as xyflow requires.
 *
 * @param plan - The plan to draw.
 * @param options - Name resolution, edit gate, and the latest diff.
 * @returns nodes keyed by ref and the link and dependency edges between them.
 */
export function projectPlan(
  plan: PlanDraftOut,
  options: ProjectPlanOptions,
): { nodes: Node[]; edges: Edge[] } {
  const byRef = new Map(plan.document.nodes.map((node) => [node.ref, node]));
  const rowsByProject = planTaskRows(plan.document);
  const rootRef = plan.document.nodes.find((node) => node.kind === 'initiative')?.ref ?? null;

  const initiatives: Node[] = [];
  const projects: Node[] = [];
  const tasks: Node[] = [];
  const links: Edge[] = [];
  for (const node of plan.document.nodes) {
    if (node.kind === 'initiative') {
      initiatives.push(initiativeNode(node, plan, options, node.ref === rootRef));
    }
    if (node.kind !== 'project') continue;
    const rows = rowsByProject.get(node.ref) ?? [];
    projects.push(projectNode(node, plan, options, byRef, miniTasks(plan, rows)));
    links.push(...linkEdges(node, byRef));
    tasks.push(...rows.map((row) => taskNode(row, plan, options)));
  }
  return {
    nodes: [...initiatives, ...projects, ...tasks],
    edges: [...links, ...dependencyEdges(plan, byRef, options.canEdit)],
  };
}

/** A project's feature tasks in reading order, as the miniature list names them. */
function miniTasks(plan: PlanDraftOut, rows: readonly PlanTaskRow[]): PlanMiniTask[] {
  return rows
    .filter((row) => row.depth === 0)
    .map(({ node }) => ({
      ref: node.ref,
      title: plan.objects[node.ref]?.name ?? node.fields.title,
      status: node.status,
    }));
}

/** The membership edges from every initiative a project belongs to. */
function linkEdges(node: PlanNode, byRef: ReadonlyMap<string, PlanNode>): Edge[] {
  return projectInitiativeRefs(node)
    .filter((initiativeRef) => byRef.get(initiativeRef)?.kind === 'initiative')
    .map((initiativeRef) => ({
      id: `link:${initiativeRef}>${node.ref}`,
      source: initiativeRef,
      target: node.ref,
      type: PLAN_EDGE_TYPE.link,
      targetHandle: 'link',
      selectable: false,
      deletable: false,
      focusable: false,
      data: { kind: 'link' },
    }));
}

/** The dependency edges whose two ends are both on the canvas. */
function dependencyEdges(
  plan: PlanDraftOut,
  byRef: ReadonlyMap<string, PlanNode>,
  canEdit: boolean,
): Edge[] {
  return plan.document.edges
    .filter((edge) => byRef.has(edge.fromRef) && byRef.has(edge.toRef))
    .map((edge) => ({
      id: `dep:${edge.fromRef}>${edge.toRef}`,
      source: edge.fromRef,
      target: edge.toRef,
      type: PLAN_EDGE_TYPE.dependency,
      sourceHandle: 'dep-out',
      targetHandle: 'dep-in',
      deletable: canEdit,
      markerEnd: dependencyMarkerEnd(PLAN_DEPENDENCY_STROKE),
      style: { stroke: PLAN_DEPENDENCY_STROKE, strokeWidth: 1.5 },
      data: { kind: 'dependency' },
    }));
}
