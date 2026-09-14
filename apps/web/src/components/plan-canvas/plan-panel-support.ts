/**
 * `components/plan-canvas/plan-panel-support` — the panel's constants and pure helpers.
 *
 * @remarks
 * Everything here is a function of its arguments: what a notice says, how the viewport moves
 * around additions, which containers a search or a revision opens. The panel and its hooks call
 * these; nothing here reads React state.
 */
import type {
  PlanCommitOut,
  PlanDocument,
  PlanDraftOut,
  PlanNode,
  PlanOp,
} from '@docket/work/plan-draft-contract';
import type { Node, ReactFlowInstance } from '@xyflow/react';

import {
  type CanvasOverlayInsets,
  fitPaddingFor,
} from '@/components/canvas/canvas-viewport-insets';

import { PLAN_NODE_TYPE } from './plan-nodes';

/**
 * Below this window width the rail's conversation stays collapsed until asked for, and the board
 * keeps the room: a plan beside an open rail on a narrower window leaves no board to read.
 */
export const PLAN_RAIL_WIDE_PX = 1280;
/** How long the "Athena updated" pill stays up. */
export const PILL_VISIBLE_MS = 4_000;
/** Zoom floor when widening the viewport around what Athena added; below it a row is unreadable. */
export const REVEAL_MIN_ZOOM = 0.5;
/** The gutter a reveal keeps clear inside the visible board, before any floating chrome. */
export const REVEAL_PADDING = 32;
/** The dot grid under a plan: sparser and lighter than the graphs', since containers tile it. */
export const PLAN_DOT_GRID = {
  gap: 32,
  size: 0.75,
  color: 'var(--color-outline-variant)',
} as const;

/** A transient notice docked above the view controls. */
export interface PlanNotice {
  readonly title: string;
  readonly detail: string;
  readonly tone: 'status' | 'error';
  readonly undo?: (() => void) | undefined;
}

/** A short unique ref for a node the person adds by hand. */
export function freshRef(kind: PlanNode['kind']): string {
  return `${kind}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Minimap colour by kind: the initiative in the accent, containers and rows on the surface ramp. */
export function nodeColor(node: Node): string {
  if (node.type === PLAN_NODE_TYPE.initiative) return 'var(--color-primary)';
  if (node.type === PLAN_NODE_TYPE.project) return 'var(--color-surface-container-high)';
  return 'var(--color-outline-variant)';
}

/** The ops that put a removed subtree back, parents first, with its edges. */
export function restoreOps(document: PlanDocument, refs: readonly string[]): PlanOp[] {
  const wanted = new Set(refs);
  const nodes = document.nodes.filter((node) => wanted.has(node.ref));
  const edges = document.edges.filter((edge) => wanted.has(edge.fromRef) || wanted.has(edge.toRef));
  return [
    ...nodes.map((node): PlanOp => ({
      op: 'upsert_node',
      node: {
        ref: node.ref,
        kind: node.kind,
        parentRef: node.parentRef,
        initiativeRefs: node.initiativeRefs,
        initiativeIds: node.initiativeIds,
        fields: node.fields,
        templateId: node.templateId,
      },
    })),
    ...edges.map((edge): PlanOp => ({ op: 'add_edge', fromRef: edge.fromRef, toRef: edge.toRef })),
  ];
}

/** The ops that add a project under an initiative, rooting a new initiative when there is none. */
export function newProjectBatch(
  plan: PlanDraftOut,
  initiativeRef: string | null,
): { ref: string; batch: PlanOp[] } {
  const ref = freshRef('project');
  const batch: PlanOp[] = [];
  let parentRef = initiativeRef;
  if (parentRef === null) {
    parentRef = freshRef('initiative');
    batch.push({
      op: 'upsert_node',
      node: { ref: parentRef, kind: 'initiative', fields: { title: plan.title } },
    });
  }
  batch.push({
    op: 'upsert_node',
    node: { ref, kind: 'project', parentRef, fields: { title: 'New project' } },
  });
  return { ref, batch };
}

/** The op that adds a task row inside a project. */
export function newTaskBatch(projectRef: string): { ref: string; batch: PlanOp[] } {
  const ref = freshRef('task');
  return {
    ref,
    batch: [
      {
        op: 'upsert_node',
        node: { ref, kind: 'task', parentRef: projectRef, fields: { title: 'New task' } },
      },
    ],
  };
}

/**
 * Say what a commit did. Placement matches an existing record by name rather than creating a
 * twin, so a confirm can create everything, match everything, or a mix; each reads differently.
 */
export function commitNotice(placed: PlanCommitOut['placed']): PlanNotice {
  const created = placed.filter((item) => item.created).length;
  const matched = placed.length - created;
  const items = (count: number): string => (count === 1 ? '1 item' : `${String(count)} items`);
  if (created === 0) {
    return {
      title: `Matched ${items(matched)} already in the workspace`,
      detail: 'Nothing new was created; the plan now points at the existing records.',
      tone: 'status',
    };
  }
  return {
    title: `Created ${items(created)}`,
    detail:
      matched > 0
        ? `${items(matched)} already existed and ${matched === 1 ? 'was' : 'were'} matched instead.`
        : 'They are in the workspace now.',
    tone: 'status',
  };
}

/** The notice a commit the workspace refused shows. */
export const COMMIT_FAILED_NOTICE: PlanNotice = {
  title: 'Could not create that part of the plan',
  detail: 'Check that you can still contribute to this workspace, then try again.',
  tone: 'error',
};

/** The notice a dependency between unlike kinds shows. */
export const LIKE_KINDS_NOTICE: PlanNotice = {
  title: 'Dependencies join like with like',
  detail: 'Connect a project to a project, or a task to a task.',
  tone: 'error',
};

/** What the "Athena updated" pill says for a revision, or null when it changed nothing visible. */
export function revisionPillText(added: number, fields: number): string | null {
  if (added === 0 && fields === 0) return null;
  const parts = [
    added > 0 ? `added ${String(added)} ${added === 1 ? 'item' : 'items'}` : null,
    fields > 0 ? `updated ${String(fields)} ${fields === 1 ? 'field' : 'fields'}` : null,
  ].filter((part): part is string => part !== null);
  return `Athena ${parts.join(' and ')}`;
}

/**
 * Put every node back where the layout placed it.
 *
 * @remarks
 * xyflow keeps a dragged node where it was dropped, and the controlled flow re-syncs only when
 * the laid-out geometry changes. A drop that changes nothing (a row dragged and released outside
 * any other container) therefore has to be undone here, by writing the laid-out positions back.
 */
export function snapToLayout(
  flowInstance: ReactFlowInstance | null,
  laidOut: readonly Node[],
): void {
  if (flowInstance === null) return;
  const byId = new Map(laidOut.map((node) => [node.id, node]));
  flowInstance.setNodes((current) =>
    current.map((node) => {
      const placed = byId.get(node.id);
      return placed ? { ...node, position: placed.position } : node;
    }),
  );
}

/**
 * Bring every node into view after a revision added some, once the new nodes have been placed
 * and measured, keeping clear of the floating chrome. Returns a cancel for the pending frame.
 */
export function revealAdditions(
  flowInstance: ReactFlowInstance | null,
  insets: CanvasOverlayInsets,
): () => void {
  if (flowInstance === null) return () => undefined;
  const frame = window.requestAnimationFrame(() => {
    void flowInstance.fitView({
      duration: 450,
      minZoom: REVEAL_MIN_ZOOM,
      maxZoom: 1,
      padding: fitPaddingFor(insets, REVEAL_PADDING),
    });
  });
  return () => {
    window.cancelAnimationFrame(frame);
  };
}

/**
 * Whether the board, at the viewport's zoom, is wider than the strip a docked panel leaves it.
 * A board that no longer fits is refitted rather than nudged, because nudging one node into the
 * strip pushes another under the panel's far edge.
 */
export function boardOverflows(
  flowInstance: ReactFlowInstance | null,
  boardWidth: number,
  visibleWidth: number,
): boolean {
  if (flowInstance === null) return false;
  return boardWidth * flowInstance.getViewport().zoom + REVEAL_PADDING * 2 > visibleWidth;
}

/** The project refs the person opened, plus every container holding a task the search names. */
export function withSearchMatches(
  plan: PlanDraftOut,
  expanded: ReadonlySet<string>,
  search: string,
): ReadonlySet<string> {
  const needle = search.trim().toLowerCase();
  if (needle.length === 0) return expanded;
  const next = new Set(expanded);
  for (const node of plan.document.nodes) {
    if (node.kind !== 'task' || node.parentRef === null) continue;
    const title = plan.objects[node.ref]?.name ?? node.fields.title;
    if (title.toLowerCase().includes(needle)) next.add(node.parentRef);
  }
  return next;
}

/** The containers holding the tasks a revision added, so what Athena wrote is in view. */
export function parentsOfAddedTasks(document: PlanDocument, added: ReadonlySet<string>): string[] {
  const parents = new Set<string>();
  for (const node of document.nodes) {
    if (node.kind === 'task' && node.parentRef !== null && added.has(node.ref)) {
      parents.add(node.parentRef);
    }
  }
  return [...parents];
}

/** How much of a start the plan has: nothing, an initiative alone, or work under it. */
export type PlanStartState = 'empty' | 'initiative-only' | 'underway';

/** Read the plan's start state off its counts. */
export function planStartState(
  plan: PlanDraftOut,
  projectCount: number,
  rootInitiativeRef: string | null,
): PlanStartState {
  if (plan.document.nodes.length === 0) return 'empty';
  if (projectCount === 0 && rootInitiativeRef !== null) return 'initiative-only';
  return 'underway';
}
