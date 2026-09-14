'use client';

/**
 * `components/plan-canvas/use-plan-edits` — the direct gestures on a plan, as ops.
 *
 * @remarks
 * Every edit maps onto a batch of ops applied through the plan's controller; a refused batch
 * becomes a notice. Node edits add, remove, and confirm; edge edits draw and remove dependencies
 * and re-home a dragged row. The hooks own no view state of their own: what to select, focus, or
 * reveal after an edit is the caller's, handed in as callbacks.
 */
import type { PlanDraftOut, PlanNode, PlanOp } from '@docket/work/plan-draft-contract';
import type { Edge, Node, OnNodeDrag, ReactFlowInstance } from '@xyflow/react';
import { useCallback } from 'react';

import type { PlanOpsController } from '@/lib/plan-draft/defs';

import { describeConfirmation, subtreeRefs } from './plan-confirm';
import { PLAN_NODE_TYPE } from './plan-nodes';
import {
  COMMIT_FAILED_NOTICE,
  LIKE_KINDS_NOTICE,
  type PlanNotice,
  commitNotice,
  newProjectBatch,
  newTaskBatch,
  restoreOps,
  snapToLayout,
} from './plan-panel-support';

/** Apply a batch; resolves the new plan, or null when the controller refused it. */
export type ApplyOps = (batch: readonly PlanOp[]) => Promise<PlanDraftOut | null>;

/** What {@link usePlanNodeEdits} needs. */
export interface PlanNodeEditsInput {
  readonly plan: PlanDraftOut;
  readonly ops: PlanOpsController;
  readonly onCommit: (
    refs: readonly string[],
  ) => Promise<{ placed: Parameters<typeof commitNotice>[0] } | null>;
  readonly byRef: ReadonlyMap<string, PlanNode>;
  /** Show a container's rows, so a task just added is visible. */
  readonly expandTasks: (refs: readonly string[]) => void;
  /** A node the person added: select it, focus its title, bring it into view. */
  readonly onAdded: (ref: string) => void;
  /** Nodes were removed: let go of the selection. */
  readonly onRemoved: () => void;
  readonly setNotice: (notice: PlanNotice | null) => void;
}

/** What {@link usePlanNodeEdits} returns. */
export interface PlanNodeEdits {
  readonly apply: ApplyOps;
  readonly addProject: (initiativeRef: string | null) => void;
  readonly addTask: (projectRef: string) => void;
  readonly removeRefs: (refs: readonly string[]) => void;
  readonly confirmRefs: (refs: readonly string[]) => void;
}

/** Add, remove, and confirm nodes. */
export function usePlanNodeEdits({
  plan,
  ops,
  onCommit,
  byRef,
  expandTasks,
  onAdded,
  onRemoved,
  setNotice,
}: PlanNodeEditsInput): PlanNodeEdits {
  const apply = useCallback<ApplyOps>(
    async (batch) => {
      const result = await ops.apply(batch);
      if (result === null && ops.error !== null) {
        setNotice({ title: 'That change did not save', detail: ops.error, tone: 'error' });
      }
      return result;
    },
    [ops, setNotice],
  );
  const addProject = useCallback(
    (initiativeRef: string | null) => {
      const { ref, batch } = newProjectBatch(plan, initiativeRef);
      void apply(batch).then((result) => {
        if (result) onAdded(ref);
      });
    },
    [apply, onAdded, plan],
  );
  const addTask = useCallback(
    (projectRef: string) => {
      const { ref, batch } = newTaskBatch(projectRef);
      expandTasks([projectRef]);
      void apply(batch).then((result) => {
        if (result) onAdded(ref);
      });
    },
    [apply, expandTasks, onAdded],
  );
  const removeRefs = useCallback(
    (refs: readonly string[]) => {
      const gone = subtreeRefs(plan.document, refs);
      const restore = restoreOps(plan.document, gone);
      const label =
        gone.length === 1
          ? (byRef.get(gone[0] ?? '')?.fields.title ?? 'Item')
          : `${String(gone.length)} items`;
      void apply(refs.map((ref): PlanOp => ({ op: 'remove_node', ref }))).then((result) => {
        if (!result) return;
        onRemoved();
        setNotice({
          title: 'Removed from the plan',
          detail: label,
          tone: 'status',
          undo: () => {
            setNotice(null);
            void apply(restore);
          },
        });
      });
    },
    [apply, byRef, onRemoved, plan.document, setNotice],
  );
  const confirmRefs = useCallback(
    (refs: readonly string[]) => {
      const confirmation = describeConfirmation(plan.document, refs);
      if (confirmation.count === 0) return;
      void onCommit(confirmation.refs).then((result) => {
        setNotice(result ? commitNotice(result.placed) : COMMIT_FAILED_NOTICE);
      });
    },
    [onCommit, plan.document, setNotice],
  );
  return { apply, addProject, addTask, removeRefs, confirmRefs };
}

/** What {@link usePlanEdgeEdits} needs. */
export interface PlanEdgeEditsInput {
  readonly apply: ApplyOps;
  readonly byRef: ReadonlyMap<string, PlanNode>;
  readonly flowInstance: ReactFlowInstance | null;
  /** The laid-out nodes, so a drop that changes nothing snaps back to its slot. */
  readonly nodes: readonly Node[];
  readonly expandTasks: (refs: readonly string[]) => void;
  readonly setNotice: (notice: PlanNotice | null) => void;
}

/** What {@link usePlanEdgeEdits} returns. */
export interface PlanEdgeEdits {
  readonly removeDependency: (fromRef: string, toRef: string) => void;
  readonly connectEdge: (source: string, target: string) => void;
  readonly deleteEdge: (edge: Edge) => void;
  readonly onNodeDragStop: OnNodeDrag;
}

/** Draw and remove dependencies, and re-home a dragged row. */
export function usePlanEdgeEdits({
  apply,
  byRef,
  flowInstance,
  nodes,
  expandTasks,
  setNotice,
}: PlanEdgeEditsInput): PlanEdgeEdits {
  const removeDependency = useCallback(
    (fromRef: string, toRef: string) => {
      void apply([{ op: 'remove_edge', fromRef, toRef }]);
    },
    [apply],
  );
  const connectEdge = useCallback(
    (source: string, target: string) => {
      const from = byRef.get(source);
      const to = byRef.get(target);
      if (!from || !to) return;
      if (from.kind !== to.kind || from.kind === 'initiative') {
        setNotice(LIKE_KINDS_NOTICE);
        return;
      }
      void apply([{ op: 'add_edge', fromRef: source, toRef: target }]);
    },
    [apply, byRef, setNotice],
  );
  const deleteEdge = useCallback(
    (edge: Edge) => {
      if ((edge.data as { kind?: string } | undefined)?.kind !== 'dependency') return;
      removeDependency(edge.source, edge.target);
    },
    [removeDependency],
  );
  // Dropping a draft task over another container moves it; anything else snaps back.
  const onNodeDragStop = useCallback<OnNodeDrag>(
    (_event, node) => {
      if (node.type !== PLAN_NODE_TYPE.task || flowInstance === null) return;
      const target = flowInstance
        .getIntersectingNodes(node)
        .find(
          (candidate) =>
            candidate.type === PLAN_NODE_TYPE.project && candidate.id !== node.parentId,
        );
      if (target === undefined) {
        snapToLayout(flowInstance, nodes);
        return;
      }
      void apply([{ op: 'move_node', ref: node.id, parentRef: target.id }]).then((result) => {
        if (!result) {
          snapToLayout(flowInstance, nodes);
          return;
        }
        expandTasks([target.id]);
      });
    },
    [apply, expandTasks, flowInstance, nodes],
  );
  return { removeDependency, connectEdge, deleteEdge, onNodeDragStop };
}
