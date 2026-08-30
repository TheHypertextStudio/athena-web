'use client';

/**
 * `components/canvas/canvas-inspector` — the chrome shared by the graph inspectors.
 *
 * @remarks
 * {@link NodePeek} and {@link ProjectPeek} show completely different things — one a task's
 * blockers, assignee, and a done toggle, the other a project's health, lead, and dependency
 * directions — but they frame them identically: a title, a way out, and a scrolling body. That
 * frame is here so the two cannot drift into having different close-button sizes and header
 * heights, and the bodies stay in their own files where they belong.
 *
 * The inspector **composes** this rather than being wrapped in it by the host, which keeps each
 * peek's own rendered output (title, links, actions) exactly what it was before it docked.
 *
 * It paints no background: {@link GraphInspectorHost} owns the tone, because the tone differs
 * between the docked column and the compact pane that covers the canvas.
 */
import { X } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX, ReactNode } from 'react';

/** Props for {@link CanvasInspector}. */
export interface CanvasInspectorProps {
  /** The subject's name. Truncates rather than wrapping — the column is narrow by design. */
  readonly title: string;
  /** An optional glyph before the title (a status icon, a health dot). */
  readonly leading?: ReactNode;
  /** The close action's accessible name — it must say *what* closes, not just "Close". */
  readonly closeLabel: string;
  /** Dismiss the inspector. */
  readonly onClose: () => void;
  /** The inspector's body. */
  readonly children: ReactNode;
}

/** The graph inspector frame: a header with a way out, over a scrolling body. */
export function CanvasInspector({
  title,
  leading,
  closeLabel,
  onClose,
  children,
}: CanvasInspectorProps): JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-outline-variant flex min-h-12 shrink-0 items-center gap-2 border-b py-1 pr-1 pl-3">
        {leading}
        <span className="text-on-surface text-title-small min-w-0 flex-1 truncate" title={title}>
          {title}
        </span>
        <Button variant="ghost" controlSize="xl" iconOnly aria-label={closeLabel} onClick={onClose}>
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">{children}</div>
    </div>
  );
}
