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
import { Plus, Search, Sparkles, Undo } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Button, Input, Surface, surfaceToneVariable } from '@docket/ui/primitives';
import type {
  PlanCommitOut,
  PlanDraftOut,
  PlanNode,
  PlanOp,
} from '@docket/work/plan-draft-contract';
import { planCounts } from '@docket/work/plan-draft';
import type { Edge, Node, OnNodeDrag, ReactFlowInstance } from '@xyflow/react';
import { type JSX, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import Canvas from '@/components/canvas/canvas';
import {
  CanvasActionsProvider,
  type CanvasActions,
} from '@/components/canvas/canvas-actions-context';
import CanvasOverlayPanel from '@/components/canvas/canvas-overlay-panel';
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
import { usePlanLayout } from './plan-layout';
import PlanLinkEdge from './plan-link-edge';
import { PLAN_EDGE_TYPE, PLAN_NODE_TYPE, planNodeData, projectPlan } from './plan-nodes';
import PlanProjectNode from './plan-project-node';
import PlanSelectionBar from './plan-selection-bar';
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

/** How long the "Athena updated" pill stays up. */
const PILL_VISIBLE_MS = 4_000;

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
  readonly initiativeOptions: readonly PickerOption[];
  /** Compose the page chrome around the view bar this panel builds. */
  readonly renderChrome?: ((bar: ReactNode) => ReactNode) | undefined;
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

/** Minimap colour by kind. */
function nodeColor(node: Node): string {
  if (node.type === PLAN_NODE_TYPE.project) return surfaceToneVariable('card');
  if (node.type === PLAN_NODE_TYPE.initiative) return 'var(--color-primary)';
  return surfaceToneVariable('floating');
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

/** The view bar: search, the Add project action, and the counts. */
function PlanViewBar({
  search,
  onSearchChange,
  counts,
  onAddProject,
}: {
  readonly search: string;
  readonly onSearchChange: (value: string) => void;
  readonly counts: { projects: number; tasks: number; draft: number };
  readonly onAddProject: (() => void) | null;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <div className="relative min-w-0 flex-1 basis-40">
        <Search
          aria-hidden="true"
          className="text-on-surface-variant pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        />
        <Input
          aria-label="Search the plan"
          placeholder="Search"
          value={search}
          onChange={(event) => {
            onSearchChange(event.target.value);
          }}
          className="pl-8"
        />
      </div>
      {onAddProject ? (
        <Button type="button" variant="outline" size="sm" onClick={onAddProject}>
          <Plus className="size-4" /> Project
        </Button>
      ) : null}
      <span
        className="text-on-surface-variant text-label-medium ml-auto shrink-0 whitespace-nowrap"
        data-testid="plan-counts"
      >
        {counts.projects} {counts.projects === 1 ? 'project' : 'projects'} · {counts.tasks}{' '}
        {counts.tasks === 1 ? 'task' : 'tasks'} ·{' '}
        <span className={cn(counts.draft > 0 && 'text-primary')}>{counts.draft} draft</span>
      </span>
    </div>
  );
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
  initiativeOptions,
  renderChrome,
  className,
}: PlanCanvasPanelProps): JSX.Element {
  const { containerRef, aspectRatio, ready: aspectReady } = useCanvasAspectRatio();
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [layoutEpoch, setLayoutEpoch] = useState(0);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null);
  const [notice, setNotice] = useState<PlanNotice | null>(null);
  const [search, setSearch] = useState('');
  const [pill, setPill] = useState<string | null>(null);

  const actorName = useCallback(
    (actorId: string): string | null =>
      memberOptions.find((option) => option.value === actorId)?.label ?? null,
    [memberOptions],
  );
  const initiativeName = useCallback(
    (initiativeId: string): string | null =>
      initiativeOptions.find((option) => option.value === initiativeId)?.label ?? null,
    [initiativeOptions],
  );

  const projected = useMemo(
    () => projectPlan(plan, { orgId, diff: remoteDiff, canEdit, actorName, initiativeName }),
    [plan, orgId, remoteDiff, canEdit, actorName, initiativeName],
  );
  const { nodes } = usePlanLayout(projected.nodes, projected.edges, aspectRatio, layoutEpoch);
  const edges = projected.edges;
  const counts = useMemo(() => planCounts(plan.document), [plan.document]);
  const byRef = useMemo(
    () => new Map(plan.document.nodes.map((node) => [node.ref, node])),
    [plan.document.nodes],
  );

  // The "Athena updated" pill: shown when a remote revision changed something, then let go.
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
    return () => {
      window.clearTimeout(timer);
    };
  }, [remoteDiff]);

  // Selection follows the document: a node Athena or a commit removed cannot stay selected.
  useEffect(() => {
    if (selectedRef !== null && !byRef.has(selectedRef)) setSelectedRef(null);
  }, [byRef, selectedRef]);

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
        if (result) setSelectedRef(ref);
      });
    },
    [apply, plan.title],
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
        if (result) setSelectedRef(ref);
      });
    },
    [apply],
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
        const created = result.placed.filter((item) => item.created).length;
        const matched = result.placed.length - created;
        setNotice({
          title: created === 1 ? 'Created 1 item' : `Created ${String(created)} items`,
          detail:
            matched > 0
              ? `${String(matched)} already existed and ${matched === 1 ? 'was' : 'were'} matched instead.`
              : 'They are in the workspace now.',
          tone: 'status',
        });
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
        setLayoutEpoch((current) => current + 1);
        return;
      }
      void apply([{ op: 'move_node', ref: node.id, parentRef: target.id }]).then((result) => {
        if (!result) setLayoutEpoch((current) => current + 1);
      });
    },
    [apply, flowInstance],
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

  const selectedNode = useMemo(
    () => (selectedRef === null ? null : (nodes.find((node) => node.id === selectedRef) ?? null)),
    [nodes, selectedRef],
  );
  const keepSelectionInView = useCallback(
    (visibleWidth: number) => {
      if (!flowInstance || selectedNode === null) return;
      const viewport = flowInstance.getViewport();
      const delta = keepNodeInViewDeltaX({
        nodeX: selectedNode.position.x,
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

  const bar = (
    <PlanViewBar
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
        onClose={() => {
          setSelectedRef(null);
        }}
      />
    ) : null;

  const isEmpty = plan.document.nodes.length === 0;

  return (
    <div className={cn('flex h-full min-h-0 w-full flex-col', className)}>
      {renderChrome?.(bar)}
      <GraphInspectorHost
        hostRef={containerRef}
        className="flex-1"
        aside={inspector}
        onClose={() => {
          setSelectedRef(null);
        }}
        onDock={keepSelectionInView}
      >
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
              interactive={canEdit}
              highlightChains={false}
              nodeColor={nodeColor}
              minimap
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
              }}
              bottomNotice={
                notice !== null ? (
                  <PlanNoticeSurface
                    notice={notice}
                    onDismiss={() => {
                      setNotice(null);
                    }}
                  />
                ) : undefined
              }
            >
              <PlanSelectionBar
                plan={plan}
                canEdit={canEdit}
                committing={committing}
                onConfirm={confirmRefs}
                onRemove={removeRefs}
                onAsk={askAbout}
                onOpen={onOpen}
              />
              {pill !== null ? (
                <CanvasOverlayPanel position="top-right">
                  <Surface
                    tone="floating"
                    shape="medium"
                    role="status"
                    className="text-primary text-label-medium flex items-center gap-1.5 px-2.5 py-1"
                    data-testid="plan-update-pill"
                  >
                    <Sparkles aria-hidden="true" className="size-3.5" />
                    {pill}
                  </Surface>
                </CanvasOverlayPanel>
              ) : null}
              {isEmpty ? (
                <CanvasOverlayPanel position="top-center" className="!top-1/2 !-translate-y-1/2">
                  <EmptyState
                    icon={Sparkles}
                    title="Nothing on the canvas yet"
                    body="Tell Athena what you are planning, or add a project to start by hand."
                    {...(canEdit
                      ? {
                          action: (
                            <Button
                              type="button"
                              onClick={() => {
                                addProject(rootInitiativeRef);
                              }}
                            >
                              <Plus className="size-4" /> Add project
                            </Button>
                          ),
                        }
                      : {})}
                  />
                </CanvasOverlayPanel>
              ) : null}
            </Canvas>
          </CanvasActionsProvider>
        </PlanCanvasActionsProvider>
      </GraphInspectorHost>
    </div>
  );
}
