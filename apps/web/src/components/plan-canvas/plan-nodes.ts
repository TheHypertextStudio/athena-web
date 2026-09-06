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
import type { Edge, Node } from '@xyflow/react';
import type { PlanDraftOut, PlanNode, PlanNodeKind } from '@docket/work/plan-draft-contract';

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

/** Card and row geometry, in canvas units. */
export const PLAN_INITIATIVE_SIZE = { width: 268, height: 96 } as const;
export const PLAN_TASK_SIZE = { width: 272, height: 44 } as const;
export const PLAN_PROJECT_WIDTH = 304;
/** The container's header band: glyph, title, meta line. */
export const PLAN_PROJECT_HEADER = 68;
/** Inset between the container edge and its rows. */
export const PLAN_PROJECT_PADDING = 12;
/** Vertical gap between task rows. */
export const PLAN_TASK_GAP = 6;
/** The ghost "Add task" row an editable draft container ends with. */
export const PLAN_PROJECT_FOOTER = 36;

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
  readonly ownerName: string | null;
  readonly targetDate: string | null;
  /** Whether this is the plan's root rather than a second initiative a project also joins. */
  readonly isRoot: boolean;
}

/** The project container. */
export interface PlanProjectNodeData extends PlanNodeBaseData {
  readonly kind: 'project';
  readonly summary: string | null;
  readonly leadName: string | null;
  readonly targetDate: string | null;
  readonly taskCount: number;
  /** Names of the other initiatives this project also belongs to. */
  readonly alsoIn: readonly string[];
  /** Whether the container ends with an Add task row. */
  readonly canAddTask: boolean;
}

/** A task row inside its project. */
export interface PlanTaskNodeData extends PlanNodeBaseData {
  readonly kind: 'task';
  readonly parentRef: string;
  readonly assigneeName: string | null;
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
  /** Resolve an actor id to a display name, or null when unknown. */
  readonly actorName: (actorId: string) => string | null;
  /** Resolve an existing initiative id to its name, or null when unknown. */
  readonly initiativeName: (initiativeId: string) => string | null;
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

function nameOf(actorId: string | null | undefined, options: ProjectPlanOptions): string | null {
  return actorId ? options.actorName(actorId) : null;
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
      ownerName: nameOf(node.fields.ownerId, options),
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
  taskCount: number,
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
      leadName: nameOf(node.fields.leadId, options),
      targetDate: node.fields.targetDate ?? null,
      taskCount,
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
    extent: 'parent',
    draggable: options.canEdit && node.status === 'draft',
    data: {
      ...baseData(node, plan, options),
      kind: 'task',
      parentRef: node.parentRef ?? '',
      assigneeName: nameOf(node.fields.assigneeId, options),
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
  const taskCounts = countTasks(plan.document.nodes);
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
        projects.push(projectNode(node, plan, options, byRef, taskCounts.get(node.ref) ?? 0));
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

/** How many task rows each project holds. */
function countTasks(nodes: readonly PlanNode[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    if (node.kind !== 'task' || node.parentRef === null) continue;
    counts.set(node.parentRef, (counts.get(node.parentRef) ?? 0) + 1);
  }
  return counts;
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
      selectable: false,
      deletable: false,
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
      deletable: canEdit,
      data: { kind: 'dependency' },
    }));
}
