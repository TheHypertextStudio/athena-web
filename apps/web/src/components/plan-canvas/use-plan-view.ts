'use client';

/**
 * `components/plan-canvas/use-plan-view` — the panel's view state, one concern per hook.
 *
 * @remarks
 * Overlays measure the floating chrome into insets; selection keeps the selected node in view and
 * lets go of it; expansion decides which containers show their rows; notices hold the transient
 * pill and notice; search names the nodes to dim around.
 */
import type { PlanCommitOut, PlanDraftOut } from '@docket/work/plan-draft-contract';
import type { Node, ReactFlowInstance } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  CANVAS_OVERLAY_GUTTER,
  type CanvasOverlayInsets,
} from '@/components/canvas/canvas-viewport-insets';
import { keepNodeInViewDeltaX } from '@/components/canvas/graph-inspector-geometry';
import { prefersReducedMotion } from '@/lib/motion';

import { changedFieldCount, type PlanDiff } from './plan-diff';
import { planNodeData } from './plan-nodes';
import {
  PILL_VISIBLE_MS,
  type PlanNotice,
  boardOverflows,
  parentsOfAddedTasks,
  revealAdditions,
  revisionPillText,
  withSearchMatches,
  withoutSearchMatches,
} from './plan-panel-support';
import { type PlanResult, planResultFrom, planUndoFailure } from './plan-result';

/** What {@link usePlanOverlays} returns. */
export interface PlanOverlays {
  readonly insets: CanvasOverlayInsets;
  readonly setBarHeight: (height: number) => void;
  readonly setInspectorRight: (right: number) => void;
}

/** Measure the floating chrome into the insets the canvas frames around. */
export function usePlanOverlays(): PlanOverlays {
  const [barHeight, setBarHeight] = useState(0);
  const [inspectorRight, setInspectorRight] = useState(0);
  const insets = useMemo<CanvasOverlayInsets>(
    () => ({ top: barHeight + CANVAS_OVERLAY_GUTTER, right: inspectorRight }),
    [barHeight, inspectorRight],
  );
  return { insets, setBarHeight, setInspectorRight };
}

/** Pan just enough that a node's right edge clears a docked panel; nothing when it already does. */
function nudgeIntoView(flowInstance: ReactFlowInstance, node: Node, visibleWidth: number): void {
  const viewport = flowInstance.getViewport();
  // A task row's position is relative to its container; the viewport needs the absolute one.
  const internal = flowInstance.getInternalNode(node.id);
  const delta = keepNodeInViewDeltaX({
    nodeX: internal?.internals.positionAbsolute.x ?? node.position.x,
    nodeWidth: node.measured?.width ?? Number(node.style?.width ?? 0),
    zoom: viewport.zoom,
    viewportX: viewport.x,
    visibleWidth,
    margin: 24,
  });
  if (delta === 0) return;
  void flowInstance.setViewport(
    { ...viewport, x: viewport.x + delta },
    { duration: prefersReducedMotion() ? 0 : 240 },
  );
}

/** What {@link usePlanSelection} needs. */
export interface PlanSelectionInput {
  readonly flowInstance: ReactFlowInstance | null;
  readonly nodes: readonly Node[];
  readonly boardWidth: number;
  readonly insets: CanvasOverlayInsets;
}

/** What {@link usePlanSelection} returns. */
export interface PlanSelection {
  readonly selectedRef: string | null;
  readonly setSelectedRef: (ref: string | null) => void;
  readonly selectedNode: Node | null;
  /** Whether the selected node was just added, so its title takes focus. */
  readonly focusTitle: boolean;
  /** Select a node the person just added, focus its title, and bring it into view. */
  readonly focusNew: (ref: string) => void;
  /** Let go of the selection on the canvas too, so the bar's counts return. */
  readonly clearSelection: () => void;
  /** Let go of a row selected inside a container that is being collapsed. */
  readonly hideRowsOf: (projectRef: string) => void;
  /** The inspector docked: refit or nudge so the selection stays in view. */
  readonly onInspectorDock: (visibleWidth: number) => void;
}

/** The selected node, kept in view beside the floating chrome. */
export function usePlanSelection({
  flowInstance,
  nodes,
  boardWidth,
  insets,
}: PlanSelectionInput): PlanSelection {
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [focusRef, setFocusRef] = useState<string | null>(null);
  const selectedNode = useMemo(
    () => (selectedRef === null ? null : (nodes.find((node) => node.id === selectedRef) ?? null)),
    [nodes, selectedRef],
  );
  const focusNew = useCallback(
    (ref: string) => {
      setSelectedRef(ref);
      setFocusRef(ref);
      revealAdditions(flowInstance, insets);
    },
    [flowInstance, insets],
  );
  const clearSelection = useCallback(() => {
    setSelectedRef(null);
    flowInstance?.setNodes((current) =>
      current.map((node) => (node.selected ? { ...node, selected: false } : node)),
    );
  }, [flowInstance]);
  const hideRowsOf = useCallback(
    (projectRef: string) => {
      if (selectedNode?.parentId === projectRef) clearSelection();
    },
    [clearSelection, selectedNode],
  );
  const onInspectorDock = useCallback(
    (visibleWidth: number) => {
      const justAdded = focusRef !== null && focusRef === selectedRef;
      if (justAdded || boardOverflows(flowInstance, boardWidth, visibleWidth)) {
        revealAdditions(flowInstance, insets);
        return;
      }
      if (flowInstance && selectedNode !== null)
        nudgeIntoView(flowInstance, selectedNode, visibleWidth);
    },
    [boardWidth, flowInstance, focusRef, insets, selectedNode, selectedRef],
  );
  return {
    selectedRef,
    setSelectedRef,
    selectedNode,
    focusTitle: focusRef !== null && focusRef === selectedRef,
    focusNew,
    clearSelection,
    hideRowsOf,
    onInspectorDock,
  };
}

/** What {@link usePlanExpansion} returns. */
export interface PlanExpansion {
  /** The containers showing their rows: the person's, plus what a search opens. */
  readonly expandedForView: ReadonlySet<string>;
  readonly expandTasks: (refs: readonly string[]) => void;
  /** Show or hide a container's rows; `onHide` runs when this hides them. */
  readonly toggleTasks: (projectRef: string, onHide: () => void) => void;
  /** The feature tasks whose subtasks are folded away, less any a search names a subtask of. */
  readonly collapsedTasksForView: ReadonlySet<string>;
  /** Fold or unfold a feature task's subtasks. */
  readonly toggleSubtasks: (taskRef: string) => void;
  /** Unfold a feature task, so a subtask just added under it is visible. */
  readonly showSubtasks: (taskRef: string) => void;
}

/** Feature tasks rest unfolded; a person folds the ones whose subtasks they are done reading. */
function useSubtaskFolding(
  plan: PlanDraftOut,
  search: string,
): Pick<PlanExpansion, 'collapsedTasksForView' | 'toggleSubtasks' | 'showSubtasks'> {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggleSubtasks = useCallback((taskRef: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(taskRef)) next.delete(taskRef);
      else next.add(taskRef);
      return next;
    });
  }, []);
  const showSubtasks = useCallback((taskRef: string) => {
    setCollapsed((current) => {
      if (!current.has(taskRef)) return current;
      const next = new Set(current);
      next.delete(taskRef);
      return next;
    });
  }, []);
  const collapsedTasksForView = useMemo(
    () => withoutSearchMatches(plan, collapsed, search),
    [plan, collapsed, search],
  );
  return { collapsedTasksForView, toggleSubtasks, showSubtasks };
}

/**
 * Which containers show their rows. Containers rest collapsed; a person opens the ones they are
 * working in, a search opens the containers holding matches, and a revision that adds tasks opens
 * the containers those tasks landed in.
 */
export function usePlanExpansion(
  plan: PlanDraftOut,
  search: string,
  remoteDiff: PlanDiff,
): PlanExpansion {
  const [expandedRefs, setExpandedRefs] = useState<ReadonlySet<string>>(() => new Set());
  const expandTasks = useCallback((refs: readonly string[]) => {
    setExpandedRefs((current) => {
      if (refs.every((ref) => current.has(ref))) return current;
      const next = new Set(current);
      for (const ref of refs) next.add(ref);
      return next;
    });
  }, []);
  const toggleTasks = useCallback(
    (projectRef: string, onHide: () => void) => {
      if (expandedRefs.has(projectRef)) onHide();
      setExpandedRefs((current) => {
        const next = new Set(current);
        if (next.has(projectRef)) next.delete(projectRef);
        else next.add(projectRef);
        return next;
      });
    },
    [expandedRefs],
  );
  const latestDocument = useRef(plan.document);
  latestDocument.current = plan.document;
  useEffect(() => {
    const parents = parentsOfAddedTasks(latestDocument.current, remoteDiff.added);
    if (parents.length > 0) expandTasks(parents);
  }, [expandTasks, remoteDiff]);
  const expandedForView = useMemo(
    () => withSearchMatches(plan, expandedRefs, search),
    [plan, expandedRefs, search],
  );
  const folding = useSubtaskFolding(plan, search);
  return { expandedForView, expandTasks, toggleTasks, ...folding };
}

/** What {@link usePlanNotices} returns. */
export interface PlanNotices {
  readonly notice: PlanNotice | null;
  readonly setNotice: (notice: PlanNotice | null) => void;
  /** The "Athena updated" pill's text while it is up. */
  readonly pill: string | null;
}

/**
 * The transient surfaces above the view controls. A remote revision raises the pill and, when it
 * added nodes, widens the viewport to take them in, so what Athena just drew is never off screen.
 */
export function usePlanNotices(
  remoteDiff: PlanDiff,
  flowInstance: ReactFlowInstance | null,
  insets: CanvasOverlayInsets,
): PlanNotices {
  const [notice, setNotice] = useState<PlanNotice | null>(null);
  const [pill, setPill] = useState<string | null>(null);
  useEffect(() => {
    const added = remoteDiff.added.size;
    const text = revisionPillText(added, changedFieldCount(remoteDiff));
    if (text === null) return undefined;
    setPill(text);
    const timer = window.setTimeout(() => {
      setPill(null);
    }, PILL_VISIBLE_MS);
    const reveal = added > 0 ? revealAdditions(flowInstance, insets) : null;
    return () => {
      window.clearTimeout(timer);
      reveal?.();
    };
  }, [flowInstance, insets, remoteDiff]);
  return { notice, setNotice, pill };
}

/** How an Undo of a commit went: done, or refused with the error the mutation rejected with. */
export interface PlanUndoOutcome {
  readonly ok: boolean;
  readonly error?: unknown;
}

/** Undo the commit a change set recorded. */
export type UndoPlanCommit = (changeSetId: string) => Promise<PlanUndoOutcome>;

/** What {@link usePlanResult} returns. */
export interface PlanResultControls {
  /** The line after the latest confirm, or null when there is none to show. */
  readonly result: PlanResult | null;
  /** Show the line for a commit the API accepted. */
  readonly record: (commit: PlanCommitOut) => void;
  /** Undo the commit the line names. */
  readonly undo: () => void;
  readonly dismiss: () => void;
}

/** The line once an Undo for `changeSetId` settles; a line for a later commit is left alone. */
function settleUndo(
  current: PlanResult | null,
  changeSetId: string,
  outcome: PlanUndoOutcome,
): PlanResult | null {
  if (current?.changeSetId !== changeSetId) return current;
  if (outcome.ok) return { ...current, phase: 'undone', error: null };
  return { ...current, phase: 'created', error: planUndoFailure(outcome.error) };
}

/** The line a confirm leaves behind, and the Undo on it. */
export function usePlanResult(undoCommit: UndoPlanCommit): PlanResultControls {
  const [result, setResult] = useState<PlanResult | null>(null);
  const record = useCallback((commit: PlanCommitOut) => {
    setResult(planResultFrom(commit));
  }, []);
  const dismiss = useCallback(() => {
    setResult(null);
  }, []);
  const undo = useCallback(() => {
    const changeSetId = result?.changeSetId ?? null;
    if (result?.phase !== 'created' || changeSetId === null) return;
    setResult({ ...result, phase: 'undoing', error: null });
    void undoCommit(changeSetId).then((outcome) => {
      setResult((current) => settleUndo(current, changeSetId, outcome));
    });
  }, [result, undoCommit]);
  return { result, record, undo, dismiss };
}

/** What {@link usePlanSearch} returns. */
export interface PlanSearchView {
  /** The nodes the canvas frames, or undefined when nothing is searched. */
  readonly focusOn: readonly string[] | undefined;
  /** The nodes to keep bright while the rest dim. */
  readonly highlightIds: Set<string> | null;
}

/** The nodes a search names. */
export function usePlanSearch(nodes: readonly Node[], search: string): PlanSearchView {
  const needle = search.trim().toLowerCase();
  const focusOn = useMemo(
    () =>
      needle.length === 0
        ? undefined
        : nodes
            .filter((node) => planNodeData(node).title.toLowerCase().includes(needle))
            .map((node) => node.id),
    [needle, nodes],
  );
  const highlightIds = useMemo(() => (focusOn === undefined ? null : new Set(focusOn)), [focusOn]);
  return { focusOn, highlightIds };
}
