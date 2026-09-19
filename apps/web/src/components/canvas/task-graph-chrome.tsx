'use client';

/**
 * `components/canvas/task-graph-chrome` — what a floating host changes about the Task graph.
 *
 * @remarks
 * A host that owns the whole page asks for the floating bar instead of a band. That bar carries
 * the title, the way back, the view controls, the live counts, and the selection's actions; the
 * canvas frames below the measured bar, the created-but-hidden notices sit beneath it, and the
 * bulk selection keeps only its Properties dialog since the bar carries the actions.
 */
import BulkActionsBar, { BulkPropertiesDialogHost, BulkSelectionActions } from './bulk-actions-bar';
import { useCanvasCommandContext } from './canvas-command-context';
import CanvasCreatedHiddenNotice from './canvas-created-hidden-notice';
import CanvasFloatingBar from './canvas-floating-bar';
import { useCanvasFloatingChrome } from './canvas-floating-chrome';
import type { CanvasOverlayInsets } from './canvas-viewport-insets';
import { type GraphCounts, GraphCountsLabel } from './graph-view-bar';

/** The chrome a floating host names: the title and the way back. */
export interface TaskGraphFloatingChrome {
  readonly title: string;
  /** The way back: an icon button before the title. */
  readonly navigation?: React.ReactNode;
}

/** What {@link TaskGraphChromeSlot} needs from the host, prepared by {@link useTaskGraphChrome}. */
export interface TaskGraphChromeSlotProps {
  readonly chrome: TaskGraphFloatingChrome | undefined;
  readonly onHeightChange: (height: number) => void;
}

/** What {@link useTaskGraphChrome} returns. */
export interface TaskGraphChrome {
  /** Whether a host asked for the view bar, in a band or floating. */
  readonly chromed: boolean;
  /** Whether the bar floats, which also compacts the view bar's search. */
  readonly compact: boolean;
  readonly insets: CanvasOverlayInsets | undefined;
  /** Extra classes on the created-but-hidden notices, to sit below the bar. */
  readonly noticeClass: string | undefined;
  readonly slot: TaskGraphChromeSlotProps;
}

/** The chrome's effect on the canvas, from what the host asked for and the bar's measured height. */
export function useTaskGraphChrome(
  renderChrome: ((bar: React.ReactNode) => React.ReactNode) | undefined,
  floatingChrome: TaskGraphFloatingChrome | undefined,
): TaskGraphChrome {
  const { chromed, compact, insets, noticeClass, onHeightChange } = useCanvasFloatingChrome(
    floatingChrome !== undefined,
    renderChrome !== undefined,
  );
  return {
    chromed,
    compact,
    insets,
    noticeClass,
    slot: { chrome: floatingChrome, onHeightChange },
  };
}

/** Props for {@link TaskGraphFloatingBar}. */
interface TaskGraphFloatingBarProps {
  readonly chrome: TaskGraphFloatingChrome;
  readonly controls: React.ReactNode;
  readonly counts: GraphCounts;
  readonly onHeightChange: (height: number) => void;
}

/**
 * The floating bar over the canvas. Mounted only under a floating host, inside the command
 * provider, so the selection's actions can read the canvas commands.
 */
function TaskGraphFloatingBar({
  chrome,
  controls,
  counts,
  onHeightChange,
}: TaskGraphFloatingBarProps): React.JSX.Element {
  const commands = useCanvasCommandContext();
  const selection =
    commands !== null && commands.selectedObjects.length > 0 ? (
      <BulkSelectionActions commands={commands} />
    ) : null;
  return (
    <CanvasFloatingBar
      title={chrome.title}
      ariaLabel="Task graph"
      navigation={chrome.navigation}
      controls={controls}
      trailing={<GraphCountsLabel counts={counts} />}
      selection={selection}
      onClearSelection={commands?.clearSelection}
      onHeightChange={onHeightChange}
    />
  );
}

/** Props for {@link TaskGraphChromeSlot}: the prepared slot plus the bar's live content. */
export interface TaskGraphChromeSlotRenderProps extends TaskGraphChromeSlotProps {
  readonly controls: React.ReactNode;
  readonly counts: GraphCounts;
}

/** The floating bar when a host asked for one; nothing under a band host. */
export function TaskGraphChromeSlot({
  chrome,
  ...rest
}: TaskGraphChromeSlotRenderProps): React.JSX.Element | null {
  if (chrome === undefined) return null;
  return <TaskGraphFloatingBar chrome={chrome} {...rest} />;
}

/** The selection's chrome: the embed's own panel, or only the dialog under a floating bar. */
export function BulkSlot({ floating }: { readonly floating: boolean }): React.JSX.Element {
  return floating ? <BulkPropertiesDialogHost /> : <BulkActionsBar />;
}

/** Props for {@link CreatedNotices}. */
export interface CreatedNoticesProps {
  readonly className: string | undefined;
  /** A task was created but the active filters hide it. */
  readonly hiddenByFilters: boolean;
  readonly onClearFilters: () => void;
  /** A task was created outside the graph's scope, by id. */
  readonly outsideScopeId: string | null;
  readonly outsideScopeMessage: string;
  readonly onOpen: (id: string) => void;
}

/** The notices a creation leaves when the graph cannot show what it made. */
export function CreatedNotices({
  className,
  hiddenByFilters,
  onClearFilters,
  outsideScopeId,
  outsideScopeMessage,
  onOpen,
}: CreatedNoticesProps): React.JSX.Element {
  return (
    <>
      {hiddenByFilters ? (
        <CanvasCreatedHiddenNotice
          className={className}
          message="Created, but hidden by current filters"
          actionLabel="Clear filters"
          onAction={onClearFilters}
        />
      ) : null}
      {outsideScopeId !== null ? (
        <CanvasCreatedHiddenNotice
          className={className}
          message={outsideScopeMessage}
          actionLabel="Open Task"
          onAction={() => {
            onOpen(outsideScopeId);
          }}
        />
      ) : null}
    </>
  );
}
