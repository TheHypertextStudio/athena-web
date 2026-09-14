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
import type { PlanDraftOut, PlanNode, PlanNodeKind } from '@docket/work/plan-draft-contract';

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
/** The project container's width; its height follows its rows. */
export const PLAN_PROJECT_WIDTH = 304;
/** Inset between the container edge and its rows. */
export const PLAN_PROJECT_PADDING = 8;
/** A task row inside its container, in canvas units: the container's width less its insets. */
export const PLAN_TASK_SIZE = {
  width: PLAN_PROJECT_WIDTH - PLAN_PROJECT_PADDING * 2,
  height: 40,
} as const;
/** The container's header band: glyph, title, meta line. */
export const PLAN_PROJECT_HEADER = 64;
/** The stroke every dependency edge on the plan takes, so the arrowhead matches the line. */
export const PLAN_DEPENDENCY_STROKE = 'var(--color-outline)';
/** Vertical gap between task rows. */
export const PLAN_TASK_GAP = 4;
/** The ghost "Add task" row an editable draft container ends with. */
export const PLAN_PROJECT_FOOTER = 32;
/** One line of the miniature task list a collapsed container shows. */
export const PLAN_MINI_ROW = 18;
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

/** A task row inside its project. */
export interface PlanTaskNodeData extends PlanNodeBaseData {
  readonly kind: 'task';
  readonly parentRef: string;
  readonly assignee: PlanActor | null;
  readonly dueDate: string | null;
  readonly priority: string | null;
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

function taskNode(
  node: PlanNode,
  plan: PlanDraftOut,
  options: ProjectPlanOptions,
): Node<PlanTaskNodeData> {
  return {
    id: node.ref,
    type: PLAN_NODE_TYPE.task,
    position: { x: 0, y: 0 },
    ...(node.parentRef === null ? {} : { parentId: node.parentRef }),
    // No `extent`: a row must be able to leave its container, because dragging it into another
    // container is how a person moves a task; the drop handler re-homes it or snaps it back.
    draggable: options.canEdit && node.status === 'draft',
    // A collapsed container names its tasks in miniature; the rows themselves stay out of the
    // graph, and so do the edges that end on them.
    hidden: node.parentRef === null || !options.expandedRefs.has(node.parentRef),
    data: {
      ...baseData(node, plan, options),
      kind: 'task',
      parentRef: node.parentRef ?? '',
      assignee: actorOf(node.fields.assigneeId, options),
      dueDate: node.fields.dueDate ?? null,
      priority: node.fields.priority ?? null,
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
  const tasksByProject = miniTasks(plan);
  const rootRef = plan.document.nodes.find((node) => node.kind === 'initiative')?.ref ?? null;

  const initiatives: Node[] = [];
  const projects: Node[] = [];
  const tasks: Node[] = [];
  const links: Edge[] = [];
  for (const node of plan.document.nodes) {
    switch (node.kind) {
      case 'initiative':
        initiatives.push(initiativeNode(node, plan, options, node.ref === rootRef));
        break;
      case 'project':
        projects.push(projectNode(node, plan, options, byRef, tasksByProject.get(node.ref) ?? []));
        links.push(...linkEdges(node, byRef));
        break;
      case 'task':
        if (node.parentRef !== null && byRef.has(node.parentRef)) {
          tasks.push(taskNode(node, plan, options));
        }
        break;
      case 'program':
        break;
    }
  }
  return {
    nodes: [...initiatives, ...projects, ...tasks],
    edges: [...links, ...dependencyEdges(plan, byRef, options.canEdit)],
  };
}

/** Each project's tasks in document order, as the miniature list names them. */
function miniTasks(plan: PlanDraftOut): Map<string, PlanMiniTask[]> {
  const grouped = new Map<string, PlanMiniTask[]>();
  for (const node of plan.document.nodes) {
    if (node.kind !== 'task' || node.parentRef === null) continue;
    const list = grouped.get(node.parentRef) ?? [];
    list.push({
      ref: node.ref,
      title: plan.objects[node.ref]?.name ?? node.fields.title,
      status: node.status,
    });
    grouped.set(node.parentRef, list);
  }
  return grouped;
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
