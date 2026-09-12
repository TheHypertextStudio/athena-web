'use client';

/**
 * `components/plan-canvas/plan-canvas-panel` — the planning canvas host.
 *
 * @remarks
 * Owns everything between the plan document and the shared canvas: projection, layout, selection,
 * the docked inspector, the floating selection bar, direct-edit gestures, confirmation, and the
 * motion a remote revision triggers. Every gesture becomes a reducer op through the controller the
 * route hands in; the panel never touches the query layer itself.
 *
 * The canvas underneath is the same `Canvas` the Project and Task graphs use, at full density, so
 * the viewport toolbar, zoom controls, minimap, area selection, and keyboard chords are the ones a
 * person already knows.
 */
import type { PickerOption } from '@docket/ui/components';
import { EmptyState } from '@docket/ui/components';
import { Plus, Sparkles, Undo } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Button, Surface } from '@docket/ui/primitives';
import type {
  PlanCommitOut,
  PlanDraftOut,
  PlanNode,
  PlanOp,
} from '@docket/work/plan-draft-contract';
import { planCounts } from '@docket/work/plan-draft';
import type { Edge, Node, OnNodeDrag, ReactFlowInstance } from '@xyflow/react';
import { type JSX, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import Canvas from '@/components/canvas/canvas';
import {
  CanvasActionsProvider,
  type CanvasActions,
} from '@/components/canvas/canvas-actions-context';
import CanvasOverlayPanel from '@/components/canvas/canvas-overlay-panel';
import {
  CANVAS_OVERLAY_GUTTER,
  type CanvasOverlayInsets,
  fitPaddingFor,
  occludedRight,
} from '@/components/canvas/canvas-viewport-insets';
import DependencyEdge from '@/components/canvas/dependency-edge';
import { keepNodeInViewDeltaX } from '@/components/canvas/graph-inspector-geometry';
import { GraphInspectorHost } from '@/components/canvas/graph-inspector-host';
import { useCanvasAspectRatio } from '@/components/canvas/use-canvas-aspect-ratio';
import type { PlanOpsController } from '@/lib/plan-draft/defs';
import { prefersReducedMotion } from '@/lib/motion';

import { PlanCanvasActionsProvider, type PlanCanvasActions } from './plan-canvas-context';
import { describeConfirmation, subtreeRefs } from './plan-confirm';
import { changedFieldCount, type PlanDiff } from './plan-diff';
import PlanInitiativeNode from './plan-initiative-node';
import PlanInspector from './plan-inspector';
import {
  PLAN_MAX_PER_COLUMN,
  type PlanOrientation,
  orientPlanEdges,
  usePlanLayout,
} from './plan-layout';
import PlanLinkEdge from './plan-link-edge';
import {
  PLAN_EDGE_TYPE,
  PLAN_NODE_TYPE,
  type PlanActor,
  planNodeData,
  projectPlan,
} from './plan-nodes';
import PlanBar from './plan-bar';
import PlanConversation from './plan-conversation';
import PlanProjectNode from './plan-project-node';
import PlanTaskNode from './plan-task-node';

/** The registered node renderers. */
const NODE_TYPES = {
  [PLAN_NODE_TYPE.initiative]: PlanInitiativeNode,
  [PLAN_NODE_TYPE.project]: PlanProjectNode,
  [PLAN_NODE_TYPE.task]: PlanTaskNode,
};

/** The registered edge renderers: the shared dependency edge and the quiet membership link. */
const EDGE_TYPES = {
  [PLAN_EDGE_TYPE.dependency]: DependencyEdge,
  [PLAN_EDGE_TYPE.link]: PlanLinkEdge,
};

/**
 * Put every node back where the layout placed it.
 *
 * @remarks
 * xyflow keeps a dragged node where it was dropped, and the controlled flow re-syncs only when
 * the laid-out geometry changes. A drop that changes nothing (a row dragged and released outside
 * any other container) therefore has to be undone here, by writing the laid-out positions back.
 */
function snapToLayout(flowInstance: ReactFlowInstance | null, laidOut: readonly Node[]): void {
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
 * Say what a commit did. Placement matches an existing record by name rather than creating a
 * twin, so a confirm can create everything, match everything, or a mix; each reads differently.
 */
function commitNotice(placed: PlanCommitOut['placed']): PlanNotice {
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

/** How long the "Athena updated" pill stays up. */
const PILL_VISIBLE_MS = 4_000;
/** Zoom floor when widening the viewport around what Athena added; below it a row is unreadable. */
const REVEAL_MIN_ZOOM = 0.5;

/** The gutter a reveal keeps clear inside the visible board, before any floating chrome. */
const REVEAL_PADDING = 32;

/**
 * Below this host width the inspector and the conversation take turns: opening one closes the
 * other, because two floating columns beside each other would leave no board to read.
 */
const ONE_PANEL_BELOW_PX = 1200;

/** The measured inline size of an element, 0 until it is known. */
function useElementWidth(): [number, (node: HTMLDivElement | null) => void] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (node === null || typeof ResizeObserver === 'undefined') return;
    setWidth(node.getBoundingClientRect().width);
    observer.current = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (typeof next === 'number') setWidth(next);
    });
    observer.current.observe(node);
  }, []);
  return [width, attach];
}

/** The dot grid under a plan: sparser and lighter than the graphs', since containers tile it. */
const PLAN_DOT_GRID = { gap: 32, size: 0.75, color: 'var(--color-outline-variant)' } as const;

/**
 * Bring every node into view after a revision added some, once the new nodes have been placed
 * and measured, keeping clear of the floating chrome. Returns a cancel for the pending frame.
 */
function revealAdditions(
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
function boardOverflows(
  flowInstance: ReactFlowInstance | null,
  boardWidth: number,
  visibleWidth: number,
): boolean {
  if (flowInstance === null) return false;
  return boardWidth * flowInstance.getViewport().zoom + REVEAL_PADDING * 2 > visibleWidth;
}

/** What the floating conversation needs from the route. */
export interface PlanConversationState {
  readonly open: boolean;
  readonly draftRequest: { readonly text: string; readonly version: number } | null;
  /** Where the full Athena workspace lives. */
  readonly fullHref: string;
  readonly onToggle: (open: boolean) => void;
}

/** What the floating bar needs from the route. */
export interface PlanChrome {
  readonly title: string;
  /** The way back: an icon button before the title. */
  readonly navigation: ReactNode;
}

/** Props for {@link PlanCanvasPanel}. */
export interface PlanCanvasPanelProps {
  readonly plan: PlanDraftOut;
  readonly orgId: string;
  readonly canEdit: boolean;
  /** The edit controller from `usePlanOps`. */
  readonly ops: PlanOpsController;
  readonly committing: boolean;
  /** Create the refs (closed over ancestors server-side). Resolves null when refused. */
  readonly onCommit: (refs: readonly string[]) => Promise<PlanCommitOut | null>;
  /** What the latest remote revision changed; empty for a local edit. */
  readonly remoteDiff: PlanDiff;
  /** Open the rail with a draft message. */
  readonly onAskAthena: (text: string) => void;
  /** Open a real record. */
  readonly onOpen: (href: string) => void;
  readonly memberOptions: readonly PickerOption[];
  /** Resolve an actor id to the person, agent, or team it names, for the cards. */
  readonly resolveActor: (actorId: string) => PlanActor | null;
  readonly initiativeOptions: readonly PickerOption[];
  /** Compose the page chrome around the view bar this panel builds. */
  readonly chrome: PlanChrome;
  readonly conversation: PlanConversationState;
  readonly className?: string | undefined;
}

/** A transient notice docked above the view controls. */
interface PlanNotice {
  readonly title: string;
  readonly detail: string;
  readonly tone: 'status' | 'error';
  readonly undo?: (() => void) | undefined;
}

/** A short unique ref for a node the person adds by hand. */
function freshRef(kind: PlanNode['kind']): string {
  return `${kind}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Minimap colour by kind: the initiative in the accent, containers and rows on the surface ramp. */
function nodeColor(node: Node): string {
  if (node.type === PLAN_NODE_TYPE.initiative) return 'var(--color-primary)';
  if (node.type === PLAN_NODE_TYPE.project) return 'var(--color-surface-container-high)';
  return 'var(--color-outline-variant)';
}

/** The ops that put a removed subtree back, parents first, with its edges. */
function restoreOps(document: PlanDraftOut['document'], refs: readonly string[]): PlanOp[] {
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

/** How much of a start the plan has: nothing, an initiative alone, or work under it. */
type PlanStartState = 'empty' | 'initiative-only' | 'underway';

function planStartState(
  plan: PlanDraftOut,
  projectCount: number,
  rootInitiativeRef: string | null,
): PlanStartState {
  if (plan.document.nodes.length === 0) return 'empty';
  if (projectCount === 0 && rootInitiativeRef !== null) return 'initiative-only';
  return 'underway';
}

/**
 * What the canvas shows before there is a board to read: an empty state when nothing is drafted,
 * a hint beside the lone initiative card once a plan is rooted but nothing sits under it.
 */
function PlanStartOverlay({
  state,
  onAddProject,
}: {
  readonly state: PlanStartState;
  readonly onAddProject: (() => void) | null;
}): JSX.Element | null {
  if (state === 'underway') return null;
  if (state === 'initiative-only') {
    return (
      <CanvasOverlayPanel position="top-center" className="!top-16">
        <PlanStartHint onAddProject={onAddProject} />
      </CanvasOverlayPanel>
    );
  }
  return (
    <CanvasOverlayPanel position="top-center" className="!top-1/2 !-translate-y-1/2">
      <EmptyState
        icon={Sparkles}
        title="Nothing on the canvas yet"
        body="Tell Athena what you are planning, or add a project to start by hand."
        {...(onAddProject
          ? {
              action: (
                <Button type="button" onClick={onAddProject}>
                  <Plus className="size-4" /> Add project
                </Button>
              ),
            }
          : {})}
      />
    </CanvasOverlayPanel>
  );
}

/** What a rooted plan shows while nothing is planned under its initiative yet. */
function PlanStartHint({
  onAddProject,
}: {
  readonly onAddProject: (() => void) | null;
}): JSX.Element {
  return (
    <Surface
      tone="floating"
      shape="medium"
      className="text-on-surface-variant text-body-small pointer-events-auto flex max-w-[calc(100vw-1rem)] items-center gap-3 px-3 py-2"
      data-testid="plan-start-hint"
    >
      <Sparkles aria-hidden="true" className="text-primary size-4 shrink-0" />
      <span className="min-w-0">
        Tell Athena what this initiative involves and she will draft the projects here.
      </span>
      {onAddProject ? (
        <Button type="button" size="sm" variant="outline" onClick={onAddProject}>
          <Plus className="size-4" /> Add project
        </Button>
      ) : null}
    </Surface>
  );
}

/** The "Athena updated" pill: a transient status above the view controls. */
function PlanUpdatePill({ text }: { readonly text: string }): JSX.Element {
  return (
    <Surface
      tone="floating"
      shape="medium"
      role="status"
      className="text-primary text-label-medium pointer-events-auto flex items-center gap-1.5 px-2.5 py-1"
      data-testid="plan-update-pill"
    >
      <Sparkles aria-hidden="true" className="size-3.5" />
      {text}
    </Surface>
  );
}

/**
 * What sits above the view controls: an undoable notice wins over the update pill, so the two
 * transient surfaces never stack and neither ever collides with the selection bar up top.
 */
function bottomSlot(
  notice: PlanNotice | null,
  pill: string | null,
  onDismiss: () => void,
): JSX.Element | undefined {
  if (notice !== null) return <PlanNoticeSurface notice={notice} onDismiss={onDismiss} />;
  if (pill !== null) return <PlanUpdatePill text={pill} />;
  return undefined;
}

/** A transient notice above the view controls, with Undo when the change can be taken back. */
function PlanNoticeSurface({
  notice,
  onDismiss,
}: {
  readonly notice: PlanNotice;
  readonly onDismiss: () => void;
}): JSX.Element {
  return (
    <Surface
      tone="prominent"
      shape="large"
      role={notice.tone === 'error' ? 'alert' : 'status'}
      className="pointer-events-auto flex w-full max-w-[min(32rem,calc(100vw-2rem))] min-w-0 flex-col items-stretch gap-2 px-3 py-2 sm:w-auto sm:flex-row sm:items-center"
    >
      <div className="min-w-0 flex-1">
        <p className="text-label-large text-on-surface">{notice.title}</p>
        <p className="text-body-small text-on-surface-variant break-words sm:truncate">
          {notice.detail}
        </p>
      </div>
      <div className="flex shrink-0 justify-end gap-1">
        {notice.undo ? (
          <Button type="button" variant="ghost" size="sm" onClick={notice.undo}>
            <Undo className="size-4" /> Undo
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </Surface>
  );
}

/** The planning canvas. */
export default function PlanCanvasPanel({
  plan,
  orgId,
  canEdit,
  ops,
  committing,
  onCommit,
  remoteDiff,
  onAskAthena,
  onOpen,
  memberOptions,
  resolveActor,
  initiativeOptions,
  chrome,
  conversation,
  className,
}: PlanCanvasPanelProps): JSX.Element {
  const { containerRef, aspectRatio, ready: aspectReady } = useCanvasAspectRatio();
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  // The node the person just added by hand: its title takes focus so typing renames it at once.
  const [focusRef, setFocusRef] = useState<string | null>(null);
  const [layoutEpoch, setLayoutEpoch] = useState(0);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [notice, setNotice] = useState<PlanNotice | null>(null);
  const [search, setSearch] = useState('');
  const [pill, setPill] = useState<string | null>(null);
  // The floating chrome's geometry: the bar's height, and what the inspector and the conversation
  // cover on the right, so fits and reveals keep the board in the part a person can see.
  const [selectedRefs, setSelectedRefs] = useState<readonly string[]>([]);
  const [hostWidth, attachHost] = useElementWidth();
  const onePanel = hostWidth > 0 && hostWidth < ONE_PANEL_BELOW_PX;
  const [barHeight, setBarHeight] = useState(0);
  const [inspectorRight, setInspectorRight] = useState(0);
  const [conversationWidth, setConversationWidth] = useState(0);
  const conversationRight = occludedRight([{ open: conversation.open, width: conversationWidth }]);
  const insets = useMemo<CanvasOverlayInsets>(
    () => ({ top: barHeight + CANVAS_OVERLAY_GUTTER, right: inspectorRight + conversationRight }),
    [barHeight, inspectorRight, conversationRight],
  );

  const initiativeName = useCallback(
    (initiativeId: string): string | null =>
      initiativeOptions.find((option) => option.value === initiativeId)?.label ?? null,
    [initiativeOptions],
  );

  const projected = useMemo(
    () => projectPlan(plan, { orgId, diff: remoteDiff, canEdit, resolveActor, initiativeName }),
    [plan, orgId, remoteDiff, canEdit, resolveActor, initiativeName],
  );
  // A portrait host (a phone) runs the board down the page under the initiative; a landscape
  // host stands the initiative beside it.
  const orientation: PlanOrientation = aspectRatio < 1 ? 'column' : 'row';
  const { nodes, bounds } = usePlanLayout(projected.nodes, layoutEpoch, orientation);
  const edges = useMemo(
    () => orientPlanEdges(projected.edges, orientation),
    [projected.edges, orientation],
  );
  const counts = useMemo(() => planCounts(plan.document), [plan.document]);
  // A board that fits in one column is a board a person can see whole; the minimap earns its
  // corner once the containers spill into a second column.
  const projectCount = counts.projects;
  const byRef = useMemo(
    () => new Map(plan.document.nodes.map((node) => [node.ref, node])),
    [plan.document.nodes],
  );

  // The "Athena updated" pill: shown when a remote revision changed something, then let go. When
  // the revision added nodes the viewport also widens to take them in, so what Athena just drew
  // is never off screen.
  useEffect(() => {
    const fields = changedFieldCount(remoteDiff);
    const added = remoteDiff.added.size;
    if (fields === 0 && added === 0) return undefined;
    const parts = [
      added > 0 ? `added ${String(added)} ${added === 1 ? 'item' : 'items'}` : null,
      fields > 0 ? `updated ${String(fields)} ${fields === 1 ? 'field' : 'fields'}` : null,
    ].filter((part): part is string => part !== null);
    setPill(`Athena ${parts.join(' and ')}`);
    const timer = window.setTimeout(() => {
      setPill(null);
    }, PILL_VISIBLE_MS);
    const reveal = added > 0 ? revealAdditions(flowInstance, insets) : null;
    return () => {
      window.clearTimeout(timer);
      reveal?.();
    };
  }, [flowInstance, insets, remoteDiff]);

  // Selection follows the document: a node Athena or a commit removed cannot stay selected.
  useEffect(() => {
    if (selectedRef !== null && !byRef.has(selectedRef)) setSelectedRef(null);
  }, [byRef, selectedRef]);

  // On a narrow host the two floating columns take turns: a selection closes the conversation,
  // and opening the conversation clears the selection.
  const { open: conversationOpen, onToggle: toggleConversation } = conversation;
  const previousConversationOpen = useRef(conversationOpen);
  useEffect(() => {
    if (!onePanel) return;
    const conversationJustOpened = conversationOpen && !previousConversationOpen.current;
    previousConversationOpen.current = conversationOpen;
    if (conversationJustOpened) {
      setSelectedRef(null);
      return;
    }
    if (selectedRef !== null && conversationOpen) toggleConversation(false);
  }, [conversationOpen, onePanel, selectedRef, toggleConversation]);

  const apply = useCallback(
    async (batch: readonly PlanOp[]): Promise<PlanDraftOut | null> => {
      const result = await ops.apply(batch);
      if (result === null && ops.error !== null) {
        setNotice({ title: 'That change did not save', detail: ops.error, tone: 'error' });
      }
      return result;
    },
    [ops],
  );

  const rootInitiativeRef = useMemo(
    () => plan.document.nodes.find((node) => node.kind === 'initiative')?.ref ?? null,
    [plan.document.nodes],
  );

  const addProject = useCallback(
    (initiativeRef: string | null) => {
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
      void apply(batch).then((result) => {
        if (!result) return;
        setSelectedRef(ref);
        setFocusRef(ref);
        revealAdditions(flowInstance, insets);
      });
    },
    [apply, flowInstance, insets, plan.title],
  );

  const addTask = useCallback(
    (projectRef: string) => {
      const ref = freshRef('task');
      void apply([
        {
          op: 'upsert_node',
          node: { ref, kind: 'task', parentRef: projectRef, fields: { title: 'New task' } },
        },
      ]).then((result) => {
        if (!result) return;
        setSelectedRef(ref);
        setFocusRef(ref);
        revealAdditions(flowInstance, insets);
      });
    },
    [apply, flowInstance, insets],
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
        setSelectedRef(null);
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
    [apply, byRef, plan.document],
  );

  const confirmRefs = useCallback(
    (refs: readonly string[]) => {
      const confirmation = describeConfirmation(plan.document, refs);
      if (confirmation.count === 0) return;
      void onCommit(confirmation.refs).then((result) => {
        if (!result) {
          setNotice({
            title: 'Could not create that part of the plan',
            detail: 'Check that you can still contribute to this workspace, then try again.',
            tone: 'error',
          });
          return;
        }
        setNotice(commitNotice(result.placed));
      });
    },
    [onCommit, plan.document],
  );

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
        setNotice({
          title: 'Dependencies join like with like',
          detail: 'Connect a project to a project, or a task to a task.',
          tone: 'error',
        });
        return;
      }
      void apply([{ op: 'add_edge', fromRef: source, toRef: target }]);
    },
    [apply, byRef],
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
        if (!result) snapToLayout(flowInstance, nodes);
      });
    },
    [apply, flowInstance, nodes],
  );

  const askAbout = useCallback(
    (refs: readonly string[]) => {
      const titles = refs
        .map((ref) => byRef.get(ref)?.fields.title)
        .filter((title): title is string => title !== undefined);
      onAskAthena(titles.length > 0 ? `About "${titles.join('", "')}": ` : '');
    },
    [byRef, onAskAthena],
  );

  const planActions = useMemo<PlanCanvasActions>(
    () => ({ canEdit, addProject, addTask, removeDependency, open: onOpen }),
    [canEdit, addProject, addTask, removeDependency, onOpen],
  );
  // The shared dependency edge reads its remove affordance from the graph actions context.
  const canvasActions = useMemo<CanvasActions>(
    () => ({
      canEdit,
      navigate: (id) => {
        const href = plan.objects[id]?.href;
        if (href) onOpen(href);
      },
      setComplete: () => undefined,
      createSubtask: () => undefined,
      removeDependency,
    }),
    [canEdit, onOpen, plan.objects, removeDependency],
  );

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

  const selectedNode = useMemo(
    () => (selectedRef === null ? null : (nodes.find((node) => node.id === selectedRef) ?? null)),
    [nodes, selectedRef],
  );
  const keepSelectionInView = useCallback(
    (visibleWidth: number) => {
      if (!flowInstance || selectedNode === null) return;
      const viewport = flowInstance.getViewport();
      // A task row's position is relative to its container; the viewport needs the absolute one.
      const internal = flowInstance.getInternalNode(selectedNode.id);
      const delta = keepNodeInViewDeltaX({
        nodeX: internal?.internals.positionAbsolute.x ?? selectedNode.position.x,
        nodeWidth: selectedNode.measured?.width ?? Number(selectedNode.style?.width ?? 0),
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
    },
    [flowInstance, selectedNode],
  );

  // When the inspector docks for a node the person just added, or when the strip it leaves is
  // narrower than the board, take the whole board in rather than nudging one node into the strip.
  const onInspectorDock = useCallback(
    (visibleWidth: number) => {
      const justAdded = focusRef !== null && focusRef === selectedRef;
      if (justAdded || boardOverflows(flowInstance, bounds.width, visibleWidth)) {
        revealAdditions(flowInstance, insets);
        return;
      }
      keepSelectionInView(visibleWidth);
    },
    [bounds.width, flowInstance, focusRef, insets, keepSelectionInView, selectedRef],
  );

  // Closing the inspector clears the selection on the canvas too, so the bar's counts return and
  // Escape from inside the inspector means the same as Escape on the board.
  const clearSelection = useCallback(() => {
    setSelectedRef(null);
    flowInstance?.setNodes((current) =>
      current.map((node) => (node.selected ? { ...node, selected: false } : node)),
    );
  }, [flowInstance]);

  const bar = (
    <PlanBar
      title={chrome.title}
      navigation={chrome.navigation}
      search={search}
      onSearchChange={setSearch}
      counts={counts}
      onAddProject={
        canEdit
          ? () => {
              addProject(rootInitiativeRef);
            }
          : null
      }
      selection={{
        plan,
        refs: selectedRefs,
        canEdit,
        committing,
        onConfirm: confirmRefs,
        onRemove: removeRefs,
        onAsk: askAbout,
        onOpen,
      }}
      conversationOpen={conversation.open}
      onToggleConversation={conversation.onToggle}
      insetRight={insets.right ?? 0}
      onHeightChange={setBarHeight}
    />
  );

  const inspector =
    selectedRef !== null && byRef.has(selectedRef) ? (
      <PlanInspector
        plan={plan}
        nodeRef={selectedRef}
        orgId={orgId}
        canEdit={canEdit}
        committing={committing}
        focusTitle={focusRef === selectedRef}
        memberOptions={memberOptions}
        initiativeOptions={initiativeOptions}
        onApply={apply}
        onConfirm={confirmRefs}
        onRemove={(ref) => {
          removeRefs([ref]);
        }}
        onAsk={(ref) => {
          askAbout([ref]);
        }}
        onClose={clearSelection}
      />
    ) : null;

  const startState = planStartState(plan, counts.projects, rootInitiativeRef);

  return (
    <div ref={attachHost} className={cn('flex h-full min-h-0 w-full flex-col', className)}>
      <GraphInspectorHost
        hostRef={containerRef}
        className="flex-1"
        aside={inspector}
        presentation="floating"
        offsetRight={conversationRight}
        onOcclusionChange={setInspectorRight}
        onClose={clearSelection}
        onDock={onInspectorDock}
      >
        {bar}
        <PlanCanvasActionsProvider value={planActions}>
          <CanvasActionsProvider value={canvasActions}>
            <Canvas
              nodes={nodes}
              edges={edges}
              nodeTypes={NODE_TYPES}
              edgeTypes={EDGE_TYPES}
              density="full"
              disableLayout
              layoutReady={aspectReady}
              overlayInsets={insets}
              frameAnchor="start"
              dotGrid={PLAN_DOT_GRID}
              onSelectionChange={setSelectedRefs}
              interactive={canEdit}
              highlightChains={false}
              highlightIds={highlightIds}
              nodeColor={nodeColor}
              minimap={projectCount > PLAN_MAX_PER_COLUMN}
              focusOn={focusOn}
              onSelectNode={setSelectedRef}
              onNavigate={(id) => {
                const href = plan.objects[id]?.href;
                if (href) onOpen(href);
              }}
              onConnectEdge={connectEdge}
              onDeleteEdge={deleteEdge}
              onNodeDragStop={onNodeDragStop}
              onInit={setFlowInstance}
              onRelayout={() => {
                setLayoutEpoch((current) => current + 1);
                snapToLayout(flowInstance, nodes);
              }}
              bottomNotice={bottomSlot(notice, pill, () => {
                setNotice(null);
              })}
            >
              <PlanStartOverlay
                state={startState}
                onAddProject={
                  canEdit
                    ? () => {
                        addProject(rootInitiativeRef);
                      }
                    : null
                }
              />
            </Canvas>
          </CanvasActionsProvider>
        </PlanCanvasActionsProvider>
        {conversation.open ? (
          <PlanConversation
            orgId={orgId}
            draftRequest={conversation.draftRequest}
            fullHref={conversation.fullHref}
            offsetRight={0}
            onClose={() => {
              conversation.onToggle(false);
            }}
            onWidthChange={setConversationWidth}
          />
        ) : null}
      </GraphInspectorHost>
    </div>
  );
}
