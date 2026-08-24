'use client';

/** Render command feedback independently from the current canvas selection. */
import { Undo } from '@docket/ui/icons';
import { Button, Surface } from '@docket/ui/primitives';
import { Panel } from '@xyflow/react';

import { useCanvasCommandContext } from './canvas-command-context';

/** Keep command feedback and trash Undo mounted after archived objects leave the graph. */
export default function CanvasCommandNotice(): React.JSX.Element | null {
  const commands = useCanvasCommandContext();
  if (commands?.notice === null || commands === null) return null;
  return (
    <Panel position="bottom-center">
      <Surface
        tone="prominent"
        shape="pill"
        role={commands.notice.tone === 'error' ? 'alert' : 'status'}
        className="text-body-medium flex items-center gap-2 py-1.5 pr-2 pl-4"
      >
        {commands.notice.message}
        {commands.notice.offerUndo && commands.canUndo ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => void commands.undo()}>
            <Undo className="size-4" /> Undo
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="sm" onClick={commands.clearNotice}>
          Dismiss
        </Button>
      </Surface>
    </Panel>
  );
}
