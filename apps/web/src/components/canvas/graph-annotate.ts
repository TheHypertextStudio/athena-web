/**
 * `components/canvas/graph-annotate` — derive dependency semantics from a graph.
 *
 * @remarks
 * Server-safe pure functions (no `'use client'`, no React) so they can be unit-tested in
 * isolation. From the raw node + edge set we compute, per task, whether it is *blocked* (has an
 * incomplete blocker) or *ready* (every blocker is done and it hasn't started), and per dependency
 * edge a *tone* keyed off the blocker's completion. The canvas renders these; the engine stays
 * dataset-agnostic because the meaning is computed here, not in `Canvas`.
 */
import { stateTypeOf } from '@/lib/work-state';

/** The minimal node shape {@link annotateGraph} reads (a structural superset of `TaskGraphNode`). */
export interface AnnotateNode {
  /** The task id. */
  id: string;
  /** The free-form workflow-state key. */
  state: string;
}

/** The minimal edge shape {@link annotateGraph} reads (a structural superset of `TaskGraphEdge`). */
export interface AnnotateEdge {
  /** The edge id. */
  id: string;
  /** `dependency` (source blocks target) or `subtask` (parent → child). */
  kind: 'dependency' | 'subtask';
  /** The source (blocker / parent) node id. */
  source: string;
  /** The target (blocked / child) node id. */
  target: string;
}

/** The structural graph {@link annotateGraph} operates on; `GraphOut` satisfies it. */
export interface AnnotateInput {
  /** The graph's nodes. */
  nodes: readonly AnnotateNode[];
  /** The graph's edges. */
  edges: readonly AnnotateEdge[];
}

/** Whether a task's workflow state counts as terminal (done/canceled) for blocking purposes. */
function isComplete(state: string): boolean {
  const type = stateTypeOf(state);
  return type === 'completed' || type === 'canceled';
}

/** Whether a task has not been started yet (so completing its blockers makes it actionable). */
function isNotStarted(state: string): boolean {
  const type = stateTypeOf(state);
  return type === 'backlog' || type === 'unstarted';
}

/** Per-node dependency flags. */
export interface NodeFlags {
  /** Has at least one incomplete blocker (an open `blocking → this` dependency). */
  isBlocked: boolean;
  /** Has blockers, all of them complete, and itself not yet started — i.e. unblocked & actionable. */
  isReady: boolean;
}

/** A dependency edge's tone, keyed off whether its blocker (source) is complete. */
export type EdgeTone = 'done' | 'open' | 'neutral';

/** The derived annotations for a graph: per-node flags + per-edge tone. */
export interface GraphAnnotations {
  /** Node id → {@link NodeFlags}. */
  nodeFlags: Map<string, NodeFlags>;
  /** Edge id → {@link EdgeTone} (`neutral` for subtask edges). */
  edgeTone: Map<string, EdgeTone>;
}

/**
 * Compute blocked/ready flags and edge tones for a dependency graph.
 *
 * @param graph - The graph (nodes carry `state`; edges carry `kind`/`source`/`target`).
 * @returns the {@link GraphAnnotations}.
 */
export function annotateGraph(graph: AnnotateInput): GraphAnnotations {
  const stateById = new Map(graph.nodes.map((n) => [n.id, n.state]));

  // Collect each task's blocker states (incoming `dependency` edges: source blocks target).
  const blockersByTarget = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.kind !== 'dependency') continue;
    const blockerState = stateById.get(e.source);
    if (blockerState === undefined) continue;
    const list = blockersByTarget.get(e.target) ?? [];
    list.push(blockerState);
    blockersByTarget.set(e.target, list);
  }

  const nodeFlags = new Map<string, NodeFlags>();
  for (const n of graph.nodes) {
    const blockers = blockersByTarget.get(n.id) ?? [];
    const hasBlockers = blockers.length > 0;
    const anyOpen = blockers.some((s) => !isComplete(s));
    nodeFlags.set(n.id, {
      isBlocked: hasBlockers && anyOpen,
      isReady: hasBlockers && !anyOpen && isNotStarted(n.state),
    });
  }

  const edgeTone = new Map<string, EdgeTone>();
  for (const e of graph.edges) {
    if (e.kind !== 'dependency') {
      edgeTone.set(e.id, 'neutral');
      continue;
    }
    const blockerState = stateById.get(e.source);
    edgeTone.set(e.id, blockerState !== undefined && isComplete(blockerState) ? 'done' : 'open');
  }

  return { nodeFlags, edgeTone };
}
