'use client';

/** Feedback shown after active canvas filters exclude a newly created object. */
import { Button, Surface } from '@docket/ui/primitives';

import CanvasOverlayPanel from './canvas-overlay-panel';

/** Props for {@link CanvasCreatedHiddenNotice}. */
export interface CanvasCreatedHiddenNoticeProps {
  /** Explain why the created object cannot appear in the retained canvas. */
  readonly message: string;
  /** Name the recovery action in user terms. */
  readonly actionLabel: string;
  /** Recover by changing the view or opening the created object. */
  readonly onAction: () => void;
}

/** Explain why creation succeeded without replacing the retained graph. */
export default function CanvasCreatedHiddenNotice({
  message,
  actionLabel,
  onAction,
}: CanvasCreatedHiddenNoticeProps): React.JSX.Element {
  return (
    <CanvasOverlayPanel position="top-center">
      <Surface
        tone="prominent"
        shape="pill"
        role="status"
        className="text-body-medium flex items-center gap-2 py-1.5 pr-2 pl-4"
      >
        {message}
        <Button type="button" variant="ghost" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      </Surface>
    </CanvasOverlayPanel>
  );
}
