'use client';

/** Render command feedback independently from the current canvas selection. */
import { Undo } from '@docket/ui/icons';
import { Button, Surface } from '@docket/ui/primitives';

import { useCanvasCommandContext } from './canvas-command-context';

/** Keep command feedback and trash Undo mounted after archived objects leave the graph. */
export default function CanvasCommandNotice(): React.JSX.Element | null {
  const commands = useCanvasCommandContext();
  if (commands?.notice === null || commands === null) return null;
  return (
    <Surface
      tone="prominent"
      shape="large"
      role={commands.notice.tone === 'error' ? 'alert' : 'status'}
      className="pointer-events-auto flex w-full max-w-[min(32rem,calc(100vw-2rem))] min-w-0 flex-col items-stretch gap-2 px-3 py-2 sm:w-auto sm:flex-row sm:items-center"
    >
      <div className="min-w-0 flex-1">
        <p className="text-label-large text-on-surface">{commands.notice.title}</p>
        <p className="text-body-small text-on-surface-variant break-words sm:truncate">
          {commands.notice.detail}
        </p>
      </div>
      <div className="flex shrink-0 justify-end gap-1">
        {commands.notice.offerUndo && commands.canUndo ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => void commands.undo()}>
            <Undo className="size-4" /> Undo
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="sm" onClick={commands.clearNotice}>
          Dismiss
        </Button>
      </div>
    </Surface>
  );
}
