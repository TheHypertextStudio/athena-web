'use client';

/** Feedback shown after active canvas filters exclude a newly created object. */
import { Button, Surface } from '@docket/ui/primitives';
import { Panel } from '@xyflow/react';

/** Props for {@link CanvasCreatedHiddenNotice}. */
export interface CanvasCreatedHiddenNoticeProps {
  /** Clear the host's active filters and retry the graph query. */
  readonly onClearFilters: () => void;
}

/** Explain why creation succeeded without replacing the retained graph. */
export default function CanvasCreatedHiddenNotice({
  onClearFilters,
}: CanvasCreatedHiddenNoticeProps): React.JSX.Element {
  return (
    <Panel position="top-center">
      <Surface
        tone="prominent"
        shape="pill"
        role="status"
        className="text-body-medium flex items-center gap-2 py-1.5 pr-2 pl-4"
      >
        Created, but hidden by current filters
        <Button type="button" variant="ghost" size="sm" onClick={onClearFilters}>
          Clear filters
        </Button>
      </Surface>
    </Panel>
  );
}
