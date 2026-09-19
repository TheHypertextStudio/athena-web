'use client';

/**
 * `components/plan-canvas/plan-canvas-panel` — the planning canvas: a board, its floating chrome,
 * the inspector for a selection; the conversation with Athena lives in the shell's rail.
 *
 * @remarks
 * The panel describes what goes where; `use-plan-panel` composes the state it reads. The board
 * runs edge to edge under one floating bar, the inspector floats over its
 * right edge, and the canvas frames the board around whatever chrome is measured over it.
 */
import type { PickerOption } from '@docket/ui/components';
import { cn } from '@docket/ui/lib/utils';
import type { PlanCommitOut, PlanDraftOut, PlanRoster } from '@docket/work/plan-draft-contract';
import type { JSX, ReactNode } from 'react';

import { CanvasActionsProvider } from '@/components/canvas/canvas-actions-context';
import { GraphInspectorHost } from '@/components/canvas/graph-inspector-host';
import type { PlanOpsController } from '@/lib/plan-draft/defs';

import PlanBar from './plan-bar';
import { PlanBoard } from './plan-board';
import { PlanCanvasActionsProvider } from './plan-canvas-context';
import type { PlanDiff } from './plan-diff';
import PlanInspector from './plan-inspector';
import type { PlanActor } from './plan-nodes';
import { type PlanPanelModel, usePlanPanel } from './use-plan-panel';
import type { UndoPlanCommit } from './use-plan-view';

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
  /** Undo a commit by the change set it returned. */
  readonly onUndoCommit: UndoPlanCommit;
  /** Who the plan's nodes may be assigned to; empty while it loads. */
  readonly roster: PlanRoster;
  /** What the latest remote revision changed; empty for a local edit. */
  readonly remoteDiff: PlanDiff;
  /** Open a real record. */
  readonly onOpen: (href: string) => void;
  readonly memberOptions: readonly PickerOption[];
  /** Resolve an actor id to the person, agent, or team it names, for the cards. */
  readonly resolveActor: (actorId: string) => PlanActor | null;
  readonly initiativeOptions: readonly PickerOption[];
  /** Compose the page chrome around the view bar this panel builds. */
  readonly chrome: PlanChrome;
  readonly className?: string | undefined;
}

/** Whether the selection names a node the inspector can show. */
function hasInspectable(m: PlanPanelModel): boolean {
  const ref = m.selection.selectedRef;
  return ref !== null && m.plan.document.nodes.some((node) => node.ref === ref);
}

/** The inspector for the selection, or null while nothing selectable is selected. */
function PlanSelectionInspector({
  model: m,
  props,
}: {
  readonly model: PlanPanelModel;
  readonly props: PlanCanvasPanelProps;
}): JSX.Element | null {
  const { selection, edits } = m;
  const ref = selection.selectedRef;
  if (ref === null || !hasInspectable(m)) return null;
  return (
    <PlanInspector
      plan={m.plan}
      nodeRef={ref}
      orgId={props.orgId}
      canEdit={m.canEdit}
      committing={props.committing}
      focusTitle={selection.focusTitle}
      memberOptions={props.memberOptions}
      roster={props.roster}
      initiativeOptions={props.initiativeOptions}
      onApply={edits.apply}
      onAddSubtask={edits.addSubtask}
      onConfirm={edits.confirmRefs}
      onRemove={(nodeRef) => {
        edits.removeRefs([nodeRef]);
      }}
      onClose={selection.clearSelection}
    />
  );
}

/** The planning canvas. */
export default function PlanCanvasPanel(props: PlanCanvasPanelProps): JSX.Element {
  const { committing, chrome, className, onOpen } = props;
  const m = usePlanPanel(props);
  const { selection, edits, overlays } = m;
  // The host opens its column for any non-null aside, so an empty selection must hand it null
  // rather than an element that renders nothing.
  const inspector = hasInspectable(m) ? <PlanSelectionInspector model={m} props={props} /> : null;
  return (
    <div className={cn('flex h-full min-h-0 w-full flex-col', className)}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <GraphInspectorHost
          hostRef={m.containerRef}
          className="flex-1"
          aside={inspector}
          presentation="floating"
          onOcclusionChange={overlays.setInspectorRight}
          onClose={selection.clearSelection}
          onDock={selection.onInspectorDock}
        >
          <PlanBar
            title={chrome.title}
            navigation={chrome.navigation}
            search={m.search}
            onSearchChange={m.setSearch}
            counts={m.counts}
            onAddProject={m.addProjectAtRoot}
            selection={{
              plan: m.plan,
              refs: m.selectedRefs,
              canEdit: m.canEdit,
              committing,
              onConfirm: edits.confirmRefs,
              onRemove: edits.removeRefs,
              onOpen,
            }}
            onClearSelection={selection.clearSelection}
            insetRight={overlays.insets.right ?? 0}
            onHeightChange={overlays.setBarHeight}
          />
          <PlanCanvasActionsProvider value={m.planActions}>
            <CanvasActionsProvider value={m.canvasActions}>
              <PlanBoard
                nodes={m.nodes}
                edges={m.edges}
                canEdit={m.canEdit}
                insets={overlays.insets}
                layoutReady={m.layoutReady}
                projectCount={m.counts.projects}
                search={m.searchView}
                startState={m.startState}
                onAddProject={m.addProjectAtRoot}
                onSelectionChange={m.setSelectedRefs}
                onSelectNode={selection.setSelectedRef}
                onNavigate={m.navigate}
                onConnectEdge={edits.connectEdge}
                onDeleteEdge={edits.deleteEdge}
                onNodeDragStop={edits.onNodeDragStop}
                onInit={m.setFlowInstance}
                onRelayout={m.relayout}
                bottomNotice={m.bottomNotice}
              />
            </CanvasActionsProvider>
          </PlanCanvasActionsProvider>
        </GraphInspectorHost>
      </div>
    </div>
  );
}
