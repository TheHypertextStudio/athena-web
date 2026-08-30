'use client';

/**
 * `components/canvas/graph-inspector-host` — the layout that docks a graph inspector.
 *
 * @remarks
 * Selecting a node used to open a card floating over the graph's top-right corner, which covered
 * the part of the diagram nearest the thing you had just clicked. The inspector is a real column
 * beside the canvas now, so reading it costs width rather than content.
 *
 * ## The threshold is measured on the host, not the window
 *
 * A viewport media query is wrong here, and expensively so. `<main>` is
 * `viewport − 328px of chrome − the utility rail`, which is **416px** at a 1024px window with the
 * rail open. A `lg` query would happily dock a 280px inspector into that and leave 136px of graph.
 * So the host measures itself. That is safe in a way the shell rail is not: the inspector only
 * exists after a click, so there is no first-paint state to get wrong, and the boolean is needed in
 * JS anyway — for `inert`, for focus, and for the pan.
 *
 * ## Below the threshold the inspector covers the canvas rather than shrinking it
 *
 * Stacking it under the graph was the alternative and it is worse: a node-link diagram in a 416px
 * panel has no vertical budget to give away, and changing the canvas's *height* re-runs the
 * aspect-ratio bucketing that decides the whole layout. Covering it changes neither dimension, so
 * the compact path needs no refit at all. One pane at a time is also what MD3's adaptive guidance
 * asks for at these sizes.
 *
 * ## What must not happen: a relayout
 *
 * `useCanvasAspectRatio`'s `containerRef` stays on **this host**, never on the canvas column. The
 * layout engine buckets the aspect ratio at 0.8 and 1.25 and re-packs the entire graph when the
 * bucket flips — so measuring the narrowed column would re-pack the graph under the user at the
 * exact moment they opened something to read. The aspect ratio is docking-invariant; the column's
 * width change is absorbed by a pan instead.
 */
import { cn } from '@docket/ui';
import { Surface, surfaceToneColor } from '@docket/ui/primitives';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type Ref,
} from 'react';

/**
 * The host width at which a docked column stops being worth its cost.
 *
 * @remarks
 * 768px — the `@3xl` container step. Below it the inspector would take more than a third of the
 * graph.
 */
export const GRAPH_INSPECTOR_DOCK_MIN_PX = 768;

/**
 * The docked column's inline size.
 *
 * @remarks
 * A *share* of the host, floored and capped — the same width law as the shell rail, scoped to a
 * container instead of the viewport. A fixed width that appears at a threshold is what makes a
 * canvas narrower at a wider window; a share with a slope under 1 cannot.
 *
 * Written out as a literal at each use site as well, because Tailwind's scanner reads class
 * strings and never constants. This export is the documentation of the number, not its source.
 */
export const GRAPH_INSPECTOR_INLINE_SIZE = 'clamp(16rem, 22%, 20rem)';

/** How long the dock/undock width transition runs — matches `--dur-slow`. */
const DOCK_DURATION_MS = 240;

/** Props for {@link GraphInspectorHost}. */
export interface GraphInspectorHostProps {
  /** The canvas. Rendered in the column the inspector leaves it. */
  readonly children: ReactNode;
  /**
   * The inspector, or `null` when nothing is selected.
   *
   * @remarks
   * The host keeps the last non-null value mounted for the length of the close animation, so the
   * column animates out with content in it rather than collapsing an empty box.
   */
  readonly aside: ReactNode | null;
  /** Dismiss the inspector — bound to Escape while it holds focus. */
  readonly onClose: () => void;
  /**
   * Called once the docked column has taken its width, with how much canvas is left.
   *
   * @remarks
   * The host reports the number rather than panning itself, because only the graph knows which
   * node needs to stay visible. Not called on the compact path: covering the canvas changes no
   * dimension, so there is nothing to correct.
   */
  readonly onDock?: (visibleWidth: number) => void;
  /** Extra classes for the host row. */
  readonly className?: string;
  /**
   * A caller's ref for the host row — the canvas aspect-ratio observer's element.
   *
   * @remarks
   * Accepts a callback ref because that is what `useCanvasAspectRatio` hands out. The host keeps
   * its own ref regardless and forwards to this one, so both observers watch the same element.
   * See the note above about why that element is the row and not the canvas column.
   */
  readonly hostRef?: Ref<HTMLDivElement>;
}

/** Dock a graph inspector beside the canvas, or over it when the host is too narrow. */
export function GraphInspectorHost({
  children,
  aside,
  onClose,
  onDock,
  className,
  hostRef,
}: GraphInspectorHostProps): JSX.Element {
  const row = useRef<HTMLDivElement>(null);
  const attachRow = useCallback(
    (node: HTMLDivElement | null) => {
      row.current = node;
      if (typeof hostRef === 'function') hostRef(node);
      else if (hostRef) hostRef.current = node;
    },
    [hostRef],
  );
  const pinnedRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [docked, setDocked] = useState(true);
  const open = aside !== null;

  // Keep the last inspector so the column has something in it while it animates shut.
  const [retained, setRetained] = useState<ReactNode>(aside);
  if (aside !== null && aside !== retained) setRetained(aside);

  useEffect(() => {
    const node = row.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const measure = (width: number): void => {
      setDocked(width >= GRAPH_INSPECTOR_DOCK_MIN_PX);
    };
    measure(node.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === 'number') measure(width);
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Arm the width transition only for the open/close toggle, never for a resize — the column is a
  // share of the host, so a permanently-armed transition would rubber-band the canvas 240ms behind
  // the window edge for the whole of a drag. Derived during render (ShellAside's pattern) so the
  // class is on the very render that changes the width.
  const previousOpen = useRef(open);
  const [animating, setAnimating] = useState(false);
  if (previousOpen.current !== open) {
    previousOpen.current = open;
    if (!animating) setAnimating(true);
  }
  useEffect(() => {
    if (!animating) return undefined;
    const timer = setTimeout(() => {
      setAnimating(false);
    }, DOCK_DURATION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [animating]);

  // Report the remaining canvas width on the frame the column mounts. The pinned inner element
  // carries the column's full width and is never animated, so it reads correctly immediately —
  // waiting for `transitionend` would either measure a half-open column or miss the event when
  // motion is reduced to nothing.
  useLayoutEffect(() => {
    if (!open || !docked || !onDock) return;
    const hostWidth = row.current?.getBoundingClientRect().width ?? 0;
    const columnWidth = pinnedRef.current?.getBoundingClientRect().width ?? 0;
    if (hostWidth > 0) onDock(hostWidth - columnWidth);
  }, [open, docked, onDock]);

  // The compact pane covers the canvas, so it has to behave like a pane: take focus, give it back,
  // and answer Escape. The canvas's own Escape handler only fires while focus is inside the
  // canvas, which it no longer is.
  useEffect(() => {
    if (!open || docked) return undefined;
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement ? active : null;
    paneRef.current?.focus({ preventScroll: true });
    return () => {
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, docked]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    },
    [onClose],
  );

  return (
    <div ref={attachRow} className={cn('relative flex min-h-0', className)}>
      <div inert={open && !docked ? true : undefined} className="relative min-h-0 min-w-0 flex-1">
        {children}
      </div>

      {docked ? (
        <Surface
          as="aside"
          tone="card"
          shape="none"
          aria-label="Selection details"
          inert={open ? undefined : true}
          onKeyDown={handleKeyDown}
          className={cn(
            // A tonal step and one boundary line, no shadow: the column is docked, not floating.
            'border-outline-variant @container h-full min-h-0 shrink-0 overflow-hidden border-l',
            animating && 'transition-[width] duration-(--dur-slow) ease-in-out',
            open ? 'w-[clamp(16rem,22%,20rem)]' : 'w-0',
          )}
        >
          {/* Pinned to the open width so the content slides rather than reflowing on every frame
              of the animation — and so its width is readable before the animation starts. */}
          <div
            ref={pinnedRef}
            className="h-full min-h-0 w-[clamp(16rem,22%,20rem)] overflow-hidden"
          >
            {retained}
          </div>
        </Surface>
      ) : open ? (
        // A plain element rather than `Surface`, which forwards no ref — and the pane needs one to
        // take focus when it covers the canvas. `surfaceToneColor` keeps the tone coming from the
        // same named role either way.
        //
        // The z-index sits above `CanvasOverlayPanel`'s `!z-[2000]`, the layer the canvas keeps its
        // own chrome on: a pane that covers the canvas has to cover the minimap, the zoom controls,
        // and the viewport toolbar too, and at any lower level they punch straight through it.
        <div
          ref={paneRef}
          tabIndex={-1}
          aria-label="Selection details"
          onKeyDown={handleKeyDown}
          className={cn(
            surfaceToneColor('card'),
            'animate-in fade-in-0 @container absolute inset-0 z-[2100] flex min-h-0 flex-col duration-(--dur-base) outline-none',
          )}
        >
          {aside}
        </div>
      ) : null}
    </div>
  );
}
