'use client';

/**
 * `components/canvas/canvas-viewport-toolbar` — the one bar of viewport commands over a canvas.
 *
 * @remarks
 * Zoom, fit, and the host's structural commands are one family, so they share one surface at the
 * bottom-left corner: zoom out, zoom in, fit to view, then Fit selection and Re-layout. Keeping
 * them in one row on one tone means a canvas has a single place to look for "move the view",
 * and nothing about the row depends on a context-menu gesture.
 */
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  FitScreen,
  RefreshCw,
  Search,
  ZoomIn,
  ZoomOut,
} from '@docket/ui/icons';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Surface,
} from '@docket/ui/primitives';
import { type FitViewOptions, useReactFlow, useStore } from '@xyflow/react';

/** Props for {@link CanvasViewportToolbar}. */
export interface CanvasViewportToolbarProps {
  /** Re-run the host's deterministic structural layout. */
  readonly onRelayout: () => void;
  /** Padding inside the unobscured Canvas viewport. */
  readonly fitPadding?: FitViewOptions['padding'];
}

/** How long a viewport move from the toolbar takes. */
const MOVE_MS = 300;
const PAN_STEP = 120;

/** Zoom out, zoom in, and fit the whole graph to the view. */
function ZoomControls({
  fitPadding,
}: {
  readonly fitPadding: NonNullable<FitViewOptions['padding']>;
}): React.JSX.Element {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        iconOnly
        aria-label="Zoom out"
        title="Zoom out"
        onClick={() => {
          void zoomOut({ duration: MOVE_MS });
        }}
      >
        <ZoomOut className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        iconOnly
        aria-label="Zoom in"
        title="Zoom in"
        onClick={() => {
          void zoomIn({ duration: MOVE_MS });
        }}
      >
        <ZoomIn className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        iconOnly
        aria-label="Fit to view"
        title="Fit to view"
        onClick={() => {
          void fitView({ duration: MOVE_MS, maxZoom: 1, padding: fitPadding });
        }}
      >
        <FitScreen className="size-4" />
      </Button>
    </>
  );
}

/** Named directional viewport moves provide a single-pointer alternative to drag-panning. */
function PanControls(): React.JSX.Element {
  const { getViewport, setViewport } = useReactFlow();
  const panBy = (x: number, y: number): void => {
    const viewport = getViewport();
    void setViewport(
      { x: viewport.x + x, y: viewport.y + y, zoom: viewport.zoom },
      { duration: MOVE_MS },
    );
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" iconOnly aria-label="Pan canvas">
          <ChevronRight className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" width="sm">
        <DropdownMenuItem
          className="coarse:min-h-10"
          onSelect={() => {
            panBy(0, PAN_STEP);
          }}
        >
          <ChevronUp /> Pan up
        </DropdownMenuItem>
        <DropdownMenuItem
          className="coarse:min-h-10"
          onSelect={() => {
            panBy(0, -PAN_STEP);
          }}
        >
          <ChevronDown /> Pan down
        </DropdownMenuItem>
        <DropdownMenuItem
          className="coarse:min-h-10"
          onSelect={() => {
            panBy(PAN_STEP, 0);
          }}
        >
          <ChevronLeft /> Pan left
        </DropdownMenuItem>
        <DropdownMenuItem
          className="coarse:min-h-10"
          onSelect={() => {
            panBy(-PAN_STEP, 0);
          }}
        >
          <ChevronRight /> Pan right
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Zoom, fit, selection framing, and re-layout in one row. */
export default function CanvasViewportToolbar({
  onRelayout,
  fitPadding = 0.3,
}: CanvasViewportToolbarProps): React.JSX.Element {
  const { fitView, getNodes } = useReactFlow();
  const hasSelection = useStore((state) => state.nodes.some(({ selected }) => selected));
  return (
    <Surface
      tone="floating"
      shape="small"
      className="pointer-events-auto flex shrink-0 items-center gap-1 p-0.5"
      role="toolbar"
      aria-label="Canvas view controls"
    >
      <ZoomControls fitPadding={fitPadding} />
      <PanControls />
      <span aria-hidden="true" className="bg-outline-variant mx-1 h-5 w-px shrink-0" />
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Fit selection"
        title="Fit selection"
        disabled={!hasSelection}
        onClick={() => {
          const nodes = getNodes().filter(({ selected }) => selected);
          void fitView({ nodes, duration: MOVE_MS, maxZoom: 1, padding: fitPadding });
        }}
      >
        <Search className="size-4" /> <span className="hidden sm:inline">Fit selection</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Re-layout"
        title="Re-layout"
        onClick={onRelayout}
      >
        <RefreshCw className="size-4" /> <span className="hidden sm:inline">Re-layout</span>
      </Button>
    </Surface>
  );
}
