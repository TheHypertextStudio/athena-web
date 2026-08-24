'use client';

/** Visible canvas viewport commands that do not depend on a context-menu gesture. */
import { RefreshCw, Search } from '@docket/ui/icons';
import { Button, Surface } from '@docket/ui/primitives';
import { Panel, useReactFlow, useStore } from '@xyflow/react';

/** Props for {@link CanvasViewportToolbar}. */
export interface CanvasViewportToolbarProps {
  /** Re-run the host's deterministic structural layout. */
  readonly onRelayout: () => void;
}

/** Expose selection framing and re-layout next to the standard zoom controls. */
export default function CanvasViewportToolbar({
  onRelayout,
}: CanvasViewportToolbarProps): React.JSX.Element {
  const { fitView, getNodes } = useReactFlow();
  const hasSelection = useStore((state) => state.nodes.some(({ selected }) => selected));
  return (
    <Panel position="bottom-left" className="!mb-24">
      <Surface
        tone="raised"
        shape="pill"
        className="flex items-center gap-1 p-1"
        role="toolbar"
        aria-label="Canvas view controls"
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!hasSelection}
          onClick={() => {
            const nodes = getNodes().filter(({ selected }) => selected);
            void fitView({ nodes, duration: 300, maxZoom: 1, padding: 0.3 });
          }}
        >
          <Search className="size-4" /> Fit selection
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onRelayout}>
          <RefreshCw className="size-4" /> Re-layout
        </Button>
      </Surface>
    </Panel>
  );
}
