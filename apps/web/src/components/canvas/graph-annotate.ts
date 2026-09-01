/**
 * `components/canvas/graph-annotate` — derive dependency semantics from a graph.
 *
 * @remarks
 * Server-safe pure functions (no `'use client'`, no React) so they can be unit-tested in
 * isolation. From the raw node + edge set we compute, per task, whether it is *blocked* (has an
 * incomplete blocker) or *ready* (every blocker is done and it hasn't started), and per dependency
 * edge a *tone* keyed off the blocker's completion. The canvas renders these; the engine stays
 * dataset-agnostic because the meaning is computed here, not in `Canvas`.
 *
 * Nodes arrive carrying the *category* their status behaves as rather than the status key, so
 * this analysis never needs a workspace's status set — which is what keeps it pure.
 */
import type { WorkStatusCategory } from '@docket/work/work-status-contract';

import { isEnded } from '@/lib/work-category';

import { pushTo } from './graph-adjacency';

/** The minimal node shape {@link annotateGraph} reads. */
export interface AnnotateNode {
  /** The task id. */
  id: string;
  /**
   * The category the task's status behaves as.
   *
   * @remarks
   * A category rather than a status key, because "is this blocker done?" is a question about the
   * category and a key only answers it against the workspace's set. The caller resolves it — which
   * keeps this module pure, and keeps a dependency analysis from having to know about workspaces.
   */
  stateType: WorkStatusCategory;
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

/** The structural graph {@link annotateGraph} operates on. */
export interface AnnotateInput {
  /** The graph's nodes. */
  nodes: readonly AnnotateNode[];
  /** The graph's edges. */
  edges: readonly AnnotateEdge[];
}

/** Whether a task has not been started yet (so completing its blockers makes it actionable). */
function isNotStarted(category: WorkStatusCategory): boolean {
  return category === 'backlog' || category === 'unstarted';
}

/** Per-node dependency flags. */
export interface NodeFlags {
  /** Has at least one unfinished blocker (an open `blocking → this` dependency). */
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
 * @param graph - The graph (nodes carry `stateType`; edges carry `kind`/`source`/`target`).
 * @returns the {@link GraphAnnotations}.
 */
export function annotateGraph(graph: AnnotateInput): GraphAnnotations {
  const categoryById = new Map(graph.nodes.map((n) => [n.id, n.stateType]));

  // Collect each task's blocker categories (incoming `dependency` edges: source blocks target).
  const blockersByTarget = new Map<string, WorkStatusCategory[]>();
  for (const e of graph.edges) {
    if (e.kind !== 'dependency') continue;
    const blocker = categoryById.get(e.source);
    if (blocker === undefined) continue;
    pushTo(blockersByTarget, e.target, blocker);
  }

  const nodeFlags = new Map<string, NodeFlags>();
  for (const n of graph.nodes) {
    const blockers = blockersByTarget.get(n.id) ?? [];
    const hasBlockers = blockers.length > 0;
    const anyOpen = blockers.some((category) => !isEnded(category));
    nodeFlags.set(n.id, {
      isBlocked: hasBlockers && anyOpen,
      isReady: hasBlockers && !anyOpen && isNotStarted(n.stateType),
    });
  }

  const edgeTone = new Map<string, EdgeTone>();
  for (const e of graph.edges) {
    if (e.kind !== 'dependency') {
      edgeTone.set(e.id, 'neutral');
      continue;
    }
    const blocker = categoryById.get(e.source);
    edgeTone.set(e.id, blocker !== undefined && isEnded(blocker) ? 'done' : 'open');
  }

  return { nodeFlags, edgeTone };
}
