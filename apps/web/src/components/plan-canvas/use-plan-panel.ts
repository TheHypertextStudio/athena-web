'use client';

/**
 * `components/plan-canvas/use-plan-panel` — everything the plan panel's view reads, composed.
 *
 * @remarks
 * The panel is a composition of the view hooks (`use-plan-view`) and the edit hooks
 * (`use-plan-edits`) over the projection and layout. This hook wires them in dependency order
 * and hands the view one object, so the component that renders the chrome, the board, the
 * inspector, and the conversation stays a description of what goes where.
 */
import type { PickerOption } from '@docket/ui/components';
import type { PlanDraftOut, PlanNode } from '@docket/work/plan-draft-contract';
import { planCounts } from '@docket/work/plan-draft';
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react';
import { type JSX, useCallback, useMemo, useState } from 'react';

import type { CanvasActions } from '@/components/canvas/canvas-actions-context';
import { useCanvasAspectRatio } from '@/components/canvas/use-canvas-aspect-ratio';

import type { PlanCanvasActions } from './plan-canvas-context';
import type { PlanCanvasPanelProps } from './plan-canvas-panel';
import { type PlanOrientation, orientPlanEdges, usePlanLayout } from './plan-layout';
import { projectPlan } from './plan-nodes';
import { bottomSlot } from './plan-panel-overlays';
import {
  type PlanNotice,
  type PlanStartState,
  planStartState,
  snapToLayout,
} from './plan-panel-support';
import {
  type PlanEdgeEdits,
  type PlanNodeEdits,
  usePlanEdgeEdits,
  usePlanNodeEdits,
} from './use-plan-edits';
import {
  type PlanExpansion,
  type PlanOverlays,
  type PlanSearchView,
  type PlanSelection,
  usePlanExpansion,
  usePlanNotices,
  usePlanOverlays,
  usePlanResult,
  usePlanSearch,
  usePlanSelection,
} from './use-plan-view';

/** What the plan panel's view renders from. */
export interface PlanPanelModel {
  readonly plan: PlanDraftOut;
  readonly canEdit: boolean;
  readonly containerRef: ReturnType<typeof useCanvasAspectRatio>['containerRef'];
  readonly layoutReady: boolean;
  readonly overlays: PlanOverlays;
  readonly nodes: Node[];
  readonly edges: Edge[];
  readonly counts: ReturnType<typeof planCounts>;
  readonly search: string;
  readonly setSearch: (value: string) => void;
  readonly searchView: PlanSearchView;
  readonly selection: PlanSelection;
  /** The refs xyflow reports selected, for the bar's actions. */
  readonly selectedRefs: readonly string[];
  readonly setSelectedRefs: (refs: readonly string[]) => void;
  readonly edits: PlanNodeEdits & PlanEdgeEdits;
  /** Add a project under the plan's root initiative; null when the viewer cannot edit. */
  readonly addProjectAtRoot: (() => void) | null;
  readonly navigate: (ref: string) => void;
  readonly planActions: PlanCanvasActions;
  readonly canvasActions: CanvasActions;
  readonly startState: PlanStartState;
  readonly bottomNotice: JSX.Element | undefined;
  readonly setFlowInstance: (instance: ReactFlowInstance) => void;
  readonly relayout: () => void;
}

/** The initiative options' label for an id, or null when unknown. */
function initiativeLabel(options: readonly PickerOption[], id: string): string | null {
  return options.find((option) => option.value === id)?.label ?? null;
}

/** The board and the state it is drawn from: projection, layout, overlays, expansion. */
interface PlanBoardState {
  readonly containerRef: PlanPanelModel['containerRef'];
  readonly layoutReady: boolean;
  readonly overlays: PlanOverlays;
  readonly byRef: ReadonlyMap<string, PlanNode>;
  readonly counts: PlanPanelModel['counts'];
  readonly rootInitiativeRef: string | null;
  readonly expansion: PlanExpansion;
  readonly nodes: Node[];
  readonly edges: Edge[];
  readonly boardWidth: number;
  readonly flowInstance: ReactFlowInstance | null;
  readonly setFlowInstance: (instance: ReactFlowInstance) => void;
  readonly search: string;
  readonly setSearch: (value: string) => void;
  readonly relayout: () => void;
}

/** Project the plan, lay it out, and measure the chrome around it. */
function usePlanBoardState(props: PlanCanvasPanelProps): PlanBoardState {
  const { plan, orgId, canEdit, remoteDiff } = props;
  const { containerRef, aspectRatio, ready: layoutReady } = useCanvasAspectRatio();
  const [layoutEpoch, setLayoutEpoch] = useState(0);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [search, setSearch] = useState('');
  const overlays = usePlanOverlays();
  const byRef = useMemo(
    () => new Map(plan.document.nodes.map((node) => [node.ref, node])),
    [plan.document.nodes],
  );
  const counts = useMemo(() => planCounts(plan.document), [plan.document]);
  const rootInitiativeRef =
    plan.document.nodes.find((node) => node.kind === 'initiative')?.ref ?? null;
  const expansion = usePlanExpansion(plan, search, remoteDiff);
  const initiativeName = useCallback(
    (id: string) => initiativeLabel(props.initiativeOptions, id),
    [props.initiativeOptions],
  );
  const { teams } = props.roster;
  const resolveTeam = useCallback(
    (teamId: string) => teams.find((entry) => entry.id === teamId)?.name ?? null,
    [teams],
  );
  const projected = useMemo(
    () =>
      projectPlan(plan, {
        orgId,
        diff: remoteDiff,
        canEdit,
        resolveActor: props.resolveActor,
        resolveTeam,
        initiativeName,
        expandedRefs: expansion.expandedForView,
        collapsedTaskRefs: expansion.collapsedTasksForView,
      }),
    [
      plan,
      orgId,
      remoteDiff,
      canEdit,
      props.resolveActor,
      resolveTeam,
      initiativeName,
      expansion.expandedForView,
      expansion.collapsedTasksForView,
    ],
  );
  const orientation: PlanOrientation = aspectRatio < 1 ? 'column' : 'row';
  const { nodes, bounds } = usePlanLayout(projected.nodes, layoutEpoch, orientation);
  const edges = useMemo(
    () => orientPlanEdges(projected.edges, orientation),
    [projected.edges, orientation],
  );
  const relayout = useCallback(() => {
    setLayoutEpoch((current) => current + 1);
    snapToLayout(flowInstance, nodes);
  }, [flowInstance, nodes]);
  return {
    containerRef,
    layoutReady,
    overlays,
    byRef,
    counts,
    rootInitiativeRef,
    expansion,
    nodes,
    edges,
    boardWidth: bounds.width,
    flowInstance,
    setFlowInstance,
    search,
    setSearch,
    relayout,
  };
}

/** Compose the plan panel's state. */
export function usePlanPanel(props: PlanCanvasPanelProps): PlanPanelModel {
  const { plan, canEdit, remoteDiff, onOpen } = props;
  const board = usePlanBoardState(props);
  const { byRef, overlays, expansion, nodes, flowInstance } = board;
  const [selectedRefs, setSelectedRefs] = useState<readonly string[]>([]);
  const notices = usePlanNotices(remoteDiff, flowInstance, overlays.insets);
  const results = usePlanResult(props.onUndoCommit);
  const { setNotice } = notices;
  const { dismiss: dismissResult } = results;
  // One transient surface at a time: a new notice replaces the result line.
  const showNotice = useCallback(
    (notice: PlanNotice | null) => {
      if (notice !== null) dismissResult();
      setNotice(notice);
    },
    [dismissResult, setNotice],
  );
  const selection = usePlanSelection({
    flowInstance,
    nodes,
    boardWidth: board.boardWidth,
    insets: overlays.insets,
  });
  const nodeEdits = usePlanNodeEdits({
    plan,
    ops: props.ops,
    onCommit: props.onCommit,
    onCommitted: results.record,
    byRef,
    expandTasks: expansion.expandTasks,
    showSubtasks: expansion.showSubtasks,
    onAdded: selection.focusNew,
    onRemoved: selection.clearSelection,
    setNotice: showNotice,
  });
  const edgeEdits = usePlanEdgeEdits({
    apply: nodeEdits.apply,
    byRef,
    flowInstance,
    nodes,
    expandTasks: expansion.expandTasks,
    setNotice: showNotice,
  });
  const searchView = usePlanSearch(nodes, board.search);
  const actions = usePlanActions({
    plan,
    canEdit,
    onOpen,
    nodeEdits,
    edgeEdits,
    expansion,
    selection,
  });
  return {
    ...board,
    ...actions,
    plan,
    canEdit,
    searchView,
    selection,
    selectedRefs,
    setSelectedRefs,
    edits: { ...nodeEdits, ...edgeEdits },
    addProjectAtRoot: canEdit
      ? () => {
          nodeEdits.addProject(board.rootInitiativeRef);
        }
      : null,
    startState: planStartState(plan, board.counts.projects, board.rootInitiativeRef),
    bottomNotice: bottomSlot({
      result: results.result,
      notice: notices.notice,
      pill: notices.pill,
      onUndo: results.undo,
      onDismissResult: dismissResult,
      onDismissNotice: () => {
        setNotice(null);
      },
    }),
  };
}

/** What {@link usePlanActions} needs. */
interface PlanActionsInput {
  readonly plan: PlanDraftOut;
  readonly canEdit: boolean;
  readonly onOpen: (href: string) => void;
  readonly nodeEdits: PlanNodeEdits;
  readonly edgeEdits: PlanEdgeEdits;
  readonly expansion: PlanExpansion;
  readonly selection: PlanSelection;
}

/** What {@link usePlanActions} returns: the callbacks the board's nodes and edges reach for. */
type PlanActions = Pick<PlanPanelModel, 'navigate' | 'planActions' | 'canvasActions'>;

/** The actions the canvas contexts carry to the plan's nodes and the shared dependency edge. */
function usePlanActions({
  plan,
  canEdit,
  onOpen,
  nodeEdits,
  edgeEdits,
  expansion,
  selection,
}: PlanActionsInput): PlanActions {
  const navigate = useCallback(
    (ref: string) => {
      const href = plan.objects[ref]?.href;
      if (href) onOpen(href);
    },
    [onOpen, plan.objects],
  );
  const planActions = useMemo<PlanCanvasActions>(
    () => ({
      canEdit,
      addProject: nodeEdits.addProject,
      addTask: nodeEdits.addTask,
      addSubtask: nodeEdits.addSubtask,
      toggleTasks: (ref) => {
        expansion.toggleTasks(ref, () => {
          selection.hideRowsOf(ref);
        });
      },
      toggleSubtasks: expansion.toggleSubtasks,
      removeDependency: edgeEdits.removeDependency,
      open: onOpen,
    }),
    [canEdit, nodeEdits, expansion, selection, edgeEdits.removeDependency, onOpen],
  );
  const canvasActions = useMemo<CanvasActions>(
    () => ({
      canEdit,
      navigate,
      setComplete: () => undefined,
      createSubtask: () => undefined,
      removeDependency: edgeEdits.removeDependency,
    }),
    [canEdit, navigate, edgeEdits.removeDependency],
  );
  return { navigate, planActions, canvasActions };
}
