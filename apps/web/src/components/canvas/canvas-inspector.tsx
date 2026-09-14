'use client';

/**
 * `components/canvas/canvas-inspector` — the chrome shared by the graph inspectors.
 *
 * @remarks
 * {@link NodePeek} and {@link ProjectPeek} show completely different things — one a task's
 * blockers, assignee, and a done toggle, the other a project's health, lead, and dependency
 * directions — but they frame them identically: a title, a way out, a scrolling body, and an
 * optional footer for the one action that must stay reachable. That frame is here so the peeks
 * cannot drift into having different close-button sizes and header heights, and the bodies stay
 * in their own files where they belong.
 *
 * The header and the footer stay put while the body scrolls, and each takes a tonal step while
 * content runs under it, so a long body reads as passing beneath the chrome rather than through
 * it. No line is drawn for either edge; the step is the separation.
 *
 * The inspector **composes** this rather than being wrapped in it by the host, which keeps each
 * peek's own rendered output (title, links, actions) exactly what it was before it docked.
 *
 * It paints no background at rest: {@link GraphInspectorHost} owns the tone, because the tone
 * differs between the docked column and the compact pane that covers the canvas.
 */
import { X } from '@docket/ui/icons';
import { cn } from '@docket/ui/lib/utils';
import { Button, surfaceToneColor } from '@docket/ui/primitives';
import { type JSX, type ReactNode, useCallback, useEffect, useState } from 'react';

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
  /** Header actions before the close button: an overflow menu, a secondary command. */
  readonly actions?: ReactNode;
  /** The action that must stay reachable however long the body is, pinned below it. */
  readonly footer?: ReactNode;
  /** The inspector's body. */
  readonly children: ReactNode;
}

/** Which edges of a scrolling body have content past them. */
interface ScrollEdges {
  /** Content is scrolled under the header. */
  readonly underHeader: boolean;
  /** Content continues under the footer. */
  readonly underFooter: boolean;
}

/** Track whether the body has content past its top and bottom edges, as it scrolls and grows. */
function useScrollEdges(): [ScrollEdges, (node: HTMLDivElement | null) => void] {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState<ScrollEdges>({ underHeader: false, underFooter: false });
  const measure = useCallback((element: HTMLDivElement): void => {
    const { scrollTop, scrollHeight, clientHeight } = element;
    setEdges({
      underHeader: scrollTop > 0,
      underFooter: scrollTop + clientHeight < scrollHeight - 1,
    });
  }, []);
  useEffect(() => {
    if (!node) return undefined;
    const onScroll = (): void => {
      measure(node);
    };
    measure(node);
    node.addEventListener('scroll', onScroll, { passive: true });
    if (typeof ResizeObserver === 'undefined') {
      return () => {
        node.removeEventListener('scroll', onScroll);
      };
    }
    const observer = new ResizeObserver(onScroll);
    observer.observe(node);
    return () => {
      node.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [measure, node]);
  return [edges, setNode];
}

/** The tonal step a header or footer takes while body content runs under it. */
function edgeClasses(underneath: boolean): string {
  return cn('shrink-0 transition-colors', underneath && surfaceToneColor('prominent'));
}

/** The graph inspector frame: a header with a way out, a scrolling body, and an optional footer. */
export function CanvasInspector({
  title,
  leading,
  closeLabel,
  onClose,
  actions,
  footer,
  children,
}: CanvasInspectorProps): JSX.Element {
  const [edges, attachBody] = useScrollEdges();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        data-scrolled={edges.underHeader || undefined}
        className={cn(
          'flex min-h-12 items-center gap-2 py-0.5 pr-0.5 pl-3',
          edgeClasses(edges.underHeader),
        )}
      >
        {leading}
        <span className="text-on-surface text-title-small min-w-0 flex-1 truncate" title={title}>
          {title}
        </span>
        {actions}
        <Button variant="ghost" controlSize="xl" iconOnly aria-label={closeLabel} onClick={onClose}>
          <X aria-hidden="true" />
        </Button>
      </div>
      <div ref={attachBody} className="min-h-0 flex-1 overflow-auto p-3">
        {children}
      </div>
      {footer ? (
        <div
          data-scrolled={edges.underFooter || undefined}
          className={cn('flex items-center justify-end gap-2 p-2', edgeClasses(edges.underFooter))}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
}
