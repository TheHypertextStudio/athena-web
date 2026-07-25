/**
 * `timeline` — dependency constraint evaluation and the downstream-ripple proposal.
 *
 * @remarks
 * A dependency edge `A blocks B` asserts that A finishes before B starts. That constraint is
 * inert in a list; on a timeline it is the whole point, because moving one bar can invalidate
 * several others at once.
 *
 * Docket takes the middle path between the two conventional models. Classic Gantt tools cascade
 * silently, so one drag rewrites many records without the user seeing it. Linear flags and never
 * moves anything, so the graph never actually helps you reschedule. Here a drag mutates **only**
 * the dragged row, and the ripple is computed and *offered* — one drag stays one intentional
 * decision, while the consequence is still made visible and applyable in a single transaction.
 *
 * Both functions are pure and side-effect free so the semantics are pinned by unit tests rather
 * than by a render, and so the same computation can run optimistically during a drag.
 */
import type { TimelineSpan } from './timeline-catalog';

/** One node of the constraint graph: a row's current span and what it blocks. */
export interface CascadeNode {
  /** The row's current span. */
  readonly span: TimelineSpan;
  /** Ids of rows that cannot start until this row finishes. */
  readonly blocks: readonly string[];
}

/** The constraint graph, keyed by row id. */
export type CascadeGraph = ReadonlyMap<string, CascadeNode>;

/** A violated dependency: the blocker still finishes after the blocked row starts. */
export interface Violation {
  /** The row that must finish first. */
  readonly blockerId: string;
  /** The row that cannot start until then. */
  readonly blockedId: string;
}

/** A proposed reschedule of one row. */
export interface ScheduleChange {
  /** The row to move. */
  readonly id: string;
  /** Its current span. */
  readonly from: TimelineSpan;
  /** The span that would satisfy its upstream constraints. */
  readonly to: TimelineSpan;
}

/** Bounds the ripple walk so a pathological or cyclic graph cannot spin. */
const MAX_CASCADE_STEPS = 500;

/**
 * Find every violated dependency in the graph.
 *
 * @remarks
 * Drives the red edge state. Evaluated over the *whole* graph rather than only the dragged row, so
 * a violation that already existed — say, one imported from a spreadsheet — surfaces immediately
 * instead of waiting for someone to touch the bar.
 *
 * @param graph - The constraint graph.
 * @returns every violated edge, in a deterministic order.
 */
export function findViolations(graph: CascadeGraph): readonly Violation[] {
  const violations: Violation[] = [];
  for (const [blockerId, node] of graph) {
    for (const blockedId of node.blocks) {
      const blocked = graph.get(blockedId);
      if (!blocked) continue;
      if (node.span.end > blocked.span.start) violations.push({ blockerId, blockedId });
    }
  }
  return violations.sort((a, b) =>
    a.blockerId === b.blockerId
      ? a.blockedId.localeCompare(b.blockedId)
      : a.blockerId.localeCompare(b.blockerId),
  );
}

/**
 * Compute the downstream reschedules implied by moving one row.
 *
 * @remarks
 * Walks the graph breadth-first from the moved row. A dependent is proposed for a shift only when
 * its blocker now finishes after it starts, and the shift is the **smallest** one that clears the
 * constraint — the dependent's duration is preserved and it is never pulled earlier, so a proposal
 * only ever relieves pressure it was actually under. Rows already satisfied are left alone, and
 * their subtrees are not walked, which keeps a proposal to the genuinely affected set.
 *
 * Each row is settled at most once and the walk is step-bounded, so a dependency cycle degrades to
 * a partial proposal rather than hanging.
 *
 * @param movedId - The dragged row's id.
 * @param movedSpan - The span the dragged row was moved to.
 * @param graph - The constraint graph *before* the move.
 * @returns the proposed changes, excluding the dragged row itself.
 */
export function computeCascade(
  movedId: string,
  movedSpan: TimelineSpan,
  graph: CascadeGraph,
): readonly ScheduleChange[] {
  // The spans the walk reasons against: the graph's, with the drag applied.
  const resolved = new Map<string, TimelineSpan>();
  for (const [id, node] of graph) resolved.set(id, node.span);
  resolved.set(movedId, movedSpan);

  const changes = new Map<string, ScheduleChange>();
  const queue: string[] = [movedId];

  for (let step = 0; queue.length > 0 && step < MAX_CASCADE_STEPS; step++) {
    const currentId = queue.shift();
    if (currentId === undefined) break;
    const node = graph.get(currentId);
    const currentSpan = resolved.get(currentId);
    if (!node || !currentSpan) continue;

    for (const blockedId of node.blocks) {
      const blockedNode = graph.get(blockedId);
      const blockedSpan = resolved.get(blockedId);
      if (!blockedNode || !blockedSpan) continue;
      // Satisfied already — leave it, and do not walk past it.
      if (currentSpan.end <= blockedSpan.start) continue;

      const shift = currentSpan.end - blockedSpan.start;
      const next: TimelineSpan = {
        start: blockedSpan.start + shift,
        end: blockedSpan.end + shift,
      };
      resolved.set(blockedId, next);
      changes.set(blockedId, { id: blockedId, from: blockedNode.span, to: next });
      queue.push(blockedId);
    }
  }

  return [...changes.values()].sort((a, b) => a.id.localeCompare(b.id));
}
