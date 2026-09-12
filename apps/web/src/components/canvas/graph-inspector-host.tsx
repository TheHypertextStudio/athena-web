'use client';

/**
 * `components/canvas/graph-inspector-host` — the layout that docks or floats a graph inspector.
 *
 * @remarks
 * Selecting a node used to open a card floating over the graph's top-right corner, which covered
 * the part of the diagram nearest the thing you had just clicked. The inspector is a real column
 * beside the canvas by default, so reading it costs width rather than content. A canvas that runs
 * edge to edge asks for the `floating` presentation instead: the inspector floats over the right
 * edge on the shared floating column, the canvas stays live underneath, and the host reports how
 * much of the edge is covered so the canvas keeps its frame out from under it.
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
  type RefObject,
} from 'react';

import CanvasFloatingColumn from './canvas-floating-column';
import { CANVAS_OVERLAY_GUTTER } from './canvas-viewport-insets';

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

/** How the inspector sits on a wide host. */
export type GraphInspectorPresentation = 'docked' | 'floating';

/** What the host is doing with the inspector right now. */
type InspectorMode = 'docked' | 'floating' | 'covering';

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
   * Called once the docked or floating panel has taken its width, with how much canvas is left.
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
  /**
   * How the inspector sits on a wide host: a docked column beside the canvas (default), or a
   * floating panel over the canvas's right edge that leaves the canvas live underneath. Below
   * {@link GRAPH_INSPECTOR_DOCK_MIN_PX} both presentations cover the canvas.
   */
  readonly presentation?: GraphInspectorPresentation | undefined;
  /** Floating only: pixels another floating column already takes at the right edge. */
  readonly offsetRight?: number | undefined;
  /**
   * Floating only: how much of the right edge the panel covers while open on a wide host (its
   * width plus the gutter), and 0 once it closes or covers instead.
   */
  readonly onOcclusionChange?: ((rightPx: number) => void) | undefined;
}

/** Whether the host row is wide enough for a column beside the canvas. */
function useWideHost(row: RefObject<HTMLDivElement | null>): boolean {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const node = row.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const measure = (width: number): void => {
      setWide(width >= GRAPH_INSPECTOR_DOCK_MIN_PX);
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
  }, [row]);
  return wide;
}

/**
 * Arm the docked column's width transition only for the open/close toggle, never for a resize —
 * the column is a share of the host, so a permanently-armed transition would rubber-band the
 * canvas 240ms behind the window edge for the whole of a drag. Derived during render
 * (ShellAside's pattern) so the class is on the very render that changes the width.
 */
function useOpenAnimation(open: boolean): boolean {
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
  return animating;
}

/** Keep the last inspector so the column has something in it while it animates shut. */
function useRetained(aside: ReactNode | null): ReactNode {
  const [retained, setRetained] = useState<ReactNode>(aside);
  if (aside !== null && aside !== retained) setRetained(aside);
  return retained;
}

/** Escape inside the inspector closes it and goes no further. */
function useEscapeClose(onClose: () => void): (event: React.KeyboardEvent<HTMLElement>) => void {
  return useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    },
    [onClose],
  );
}

/** Keep the host's own row ref and forward the node to a caller's ref of either shape. */
function useForwardedRowRef(
  hostRef: Ref<HTMLDivElement> | undefined,
): [RefObject<HTMLDivElement | null>, (node: HTMLDivElement | null) => void] {
  const row = useRef<HTMLDivElement | null>(null);
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      row.current = node;
      if (typeof hostRef === 'function') hostRef(node);
      else if (hostRef) hostRef.current = node;
    },
    [hostRef],
  );
  return [row, attach];
}

/** What the reporting effects need to know. */
interface ReportInput {
  readonly open: boolean;
  readonly mode: InspectorMode;
  readonly offsetRight: number;
  readonly row: RefObject<HTMLDivElement | null>;
  readonly pinned: RefObject<HTMLDivElement | null>;
  /** The floating column's measured width; the pinned element measures the docked one. */
  readonly floatingWidth: number;
  readonly onDock: ((visibleWidth: number) => void) | undefined;
  readonly onOcclusionChange: ((rightPx: number) => void) | undefined;
}

/**
 * Report the remaining canvas width on the frame the panel mounts, and how much of the right edge
 * a floating panel covers. The pinned inner element carries the panel's full width and is never
 * animated, so it reads correctly immediately — waiting for `transitionend` would either measure a
 * half-open column or miss the event when motion is reduced to nothing.
 */
function useGeometryReports({
  open,
  mode,
  offsetRight,
  row,
  pinned,
  floatingWidth,
  onDock,
  onOcclusionChange,
}: ReportInput): void {
  useLayoutEffect(() => {
    if (!open || mode === 'covering' || !onDock) return;
    const hostWidth = row.current?.getBoundingClientRect().width ?? 0;
    if (hostWidth === 0) return;
    if (mode === 'floating') {
      if (floatingWidth === 0) return;
      onDock(hostWidth - floatingWidth - CANVAS_OVERLAY_GUTTER - offsetRight);
      return;
    }
    onDock(hostWidth - (pinned.current?.getBoundingClientRect().width ?? 0));
  }, [open, mode, offsetRight, onDock, row, pinned, floatingWidth]);

  useLayoutEffect(() => {
    if (!onOcclusionChange) return undefined;
    if (!open || mode !== 'floating' || floatingWidth === 0) {
      onOcclusionChange(0);
      return undefined;
    }
    onOcclusionChange(floatingWidth + CANVAS_OVERLAY_GUTTER);
    return () => {
      onOcclusionChange(0);
    };
  }, [open, mode, onOcclusionChange, floatingWidth]);
}

/**
 * The covering pane takes focus, gives it back, and answers Escape, because the canvas's own
 * Escape handler only fires while focus is inside the canvas, which it no longer is. A floating
 * panel never takes focus, but a person who tabbed into it and closed it should not land on the
 * document body: the canvas column takes focus back.
 */
function useInspectorFocus(
  open: boolean,
  mode: InspectorMode,
  pane: RefObject<HTMLDivElement | null>,
  canvasColumn: RefObject<HTMLDivElement | null>,
): void {
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open || mode !== 'covering') return undefined;
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement ? active : null;
    pane.current?.focus({ preventScroll: true });
    return () => {
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, mode, pane]);
  useEffect(() => {
    if (!open || mode !== 'floating') return undefined;
    return () => {
      // The pane is gone by the time this runs; focus that was inside it has fallen to the body.
      if (document.activeElement === null || document.activeElement === document.body) {
        canvasColumn.current?.focus({ preventScroll: true });
      }
    };
  }, [open, mode, canvasColumn]);
}

/** The docked column beside the canvas: a tonal step and one boundary line, no shadow. */
function DockedColumn({
  open,
  animating,
  pinned,
  onKeyDown,
  children,
}: {
  readonly open: boolean;
  readonly animating: boolean;
  readonly pinned: RefObject<HTMLDivElement | null>;
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <Surface
      as="aside"
      tone="card"
      shape="none"
      aria-label="Selection details"
      inert={open ? undefined : true}
      onKeyDown={onKeyDown}
      className={cn(
        'border-outline-variant @container h-full min-h-0 shrink-0 overflow-hidden border-l',
        animating && 'transition-[width] duration-(--dur-slow) ease-in-out',
        open ? 'w-[clamp(16rem,22%,20rem)]' : 'w-0',
      )}
    >
      {/* Pinned to the open width so the content slides rather than reflowing on every frame
          of the animation — and so its width is readable before the animation starts. */}
      <div ref={pinned} className="h-full min-h-0 w-[clamp(16rem,22%,20rem)] overflow-hidden">
        {children}
      </div>
    </Surface>
  );
}

/**
 * The covering pane on a narrow host. A plain element rather than `Surface`, which forwards no
 * ref — and the pane needs one to take focus when it covers the canvas. Its z-index sits above
 * `CanvasOverlayPanel`'s `!z-[2000]`, the layer the canvas keeps its own chrome on: a pane that
 * covers the canvas has to cover the minimap, the zoom controls, and the viewport toolbar too.
 */
function CoveringPane({
  pane,
  onKeyDown,
  children,
}: {
  readonly pane: RefObject<HTMLDivElement | null>;
  readonly onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <div
      ref={pane}
      tabIndex={-1}
      aria-label="Selection details"
      onKeyDown={onKeyDown}
      className={cn(
        surfaceToneColor('card'),
        'animate-in fade-in-0 @container absolute inset-0 z-[2100] flex min-h-0 flex-col duration-(--dur-base) outline-none',
      )}
    >
      {children}
    </div>
  );
}

/** Dock a graph inspector beside the canvas, float it over the canvas, or cover the canvas. */
export function GraphInspectorHost({
  children,
  aside,
  onClose,
  onDock,
  className,
  hostRef,
  presentation = 'docked',
  offsetRight = 0,
  onOcclusionChange,
}: GraphInspectorHostProps): JSX.Element {
  const [row, attachRow] = useForwardedRowRef(hostRef);
  const pinnedRef = useRef<HTMLDivElement | null>(null);
  const [floatingWidth, setFloatingWidth] = useState(0);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const canvasColumnRef = useRef<HTMLDivElement | null>(null);
  const wide = useWideHost(row);
  const open = aside !== null;
  const mode: InspectorMode = wide ? presentation : 'covering';

  const retained = useRetained(aside);
  const animating = useOpenAnimation(open);
  useGeometryReports({
    open,
    mode,
    offsetRight,
    row,
    pinned: pinnedRef,
    floatingWidth,
    onDock,
    onOcclusionChange,
  });
  useInspectorFocus(open, mode, paneRef, canvasColumnRef);
  const handleKeyDown = useEscapeClose(onClose);

  return (
    <div ref={attachRow} className={cn('relative flex min-h-0', className)}>
      <div
        ref={canvasColumnRef}
        tabIndex={-1}
        inert={open && mode === 'covering' ? true : undefined}
        className="relative min-h-0 min-w-0 flex-1 outline-none"
      >
        {children}
        {mode === 'floating' && open ? (
          <CanvasFloatingColumn
            label="Selection details"
            offsetRight={offsetRight}
            onEscape={onClose}
            onWidthChange={setFloatingWidth}
            className="w-[clamp(16rem,22%,20rem)]"
          >
            <div
              ref={paneRef}
              data-presentation="floating"
              className="flex h-full min-h-0 flex-col"
            >
              <div ref={pinnedRef} className="flex h-full min-h-0 w-full flex-col">
                {aside}
              </div>
            </div>
          </CanvasFloatingColumn>
        ) : null}
      </div>
      {mode === 'docked' ? (
        <DockedColumn
          open={open}
          animating={animating}
          pinned={pinnedRef}
          onKeyDown={handleKeyDown}
        >
          {retained}
        </DockedColumn>
      ) : null}
      {mode === 'covering' && open ? (
        <CoveringPane pane={paneRef} onKeyDown={handleKeyDown}>
          {aside}
        </CoveringPane>
      ) : null}
    </div>
  );
}
