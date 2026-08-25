'use client';

/** Visible canvas viewport commands that do not depend on a context-menu gesture. */
import { RefreshCw, Search } from '@docket/ui/icons';
import { Button, Surface } from '@docket/ui/primitives';
import { type FitViewOptions, useReactFlow, useStore } from '@xyflow/react';

/** Props for {@link CanvasViewportToolbar}. */
export interface CanvasViewportToolbarProps {
  /** Re-run the host's deterministic structural layout. */
  readonly onRelayout: () => void;
  /** Padding inside the unobscured Canvas viewport. */
  readonly fitPadding?: FitViewOptions['padding'];
}

/** Expose selection framing and re-layout next to the standard zoom controls. */
export default function CanvasViewportToolbar({
  onRelayout,
  fitPadding = 0.3,
}: CanvasViewportToolbarProps): React.JSX.Element {
  const { fitView, getNodes } = useReactFlow();
  const hasSelection = useStore((state) => state.nodes.some(({ selected }) => selected));
  return (
    <Surface
      tone="raised"
      shape="pill"
      className="pointer-events-auto flex shrink-0 items-center gap-1 p-1"
      role="toolbar"
      aria-label="Canvas view controls"
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label="Fit selection"
        title="Fit selection"
        disabled={!hasSelection}
        onClick={() => {
          const nodes = getNodes().filter(({ selected }) => selected);
          void fitView({ nodes, duration: 300, maxZoom: 1, padding: fitPadding });
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
