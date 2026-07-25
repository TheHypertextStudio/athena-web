'use client';

/**
 * `timeline` — the canvas: axis, label column, plotted rows, edges, tray, and the drag surface.
 *
 * @remarks
 * The single component every temporal lens in Docket renders. It is generic over the row type and
 * reads everything domain-specific through a {@link TimelineCatalog}, so Projects, the Hub
 * portfolio, and any future surface share one implementation of the axis, zooming, grouping,
 * dependency drawing, and drag-to-schedule.
 *
 * Two structural decisions are worth calling out because they eliminate whole classes of defect
 * rather than papering over them:
 *
 * - **There is no horizontal scroll.** Time is navigated by zooming and panning the viewport, not
 *   by scrolling a track wider than the screen. That means the label column can never scroll out
 *   of view and the axis can never desynchronise from the bars — the old lens lost the project
 *   names the moment you scrolled right.
 * - **Vertical position is arithmetic.** The layout model hands over fixed-height tracks with
 *   precomputed offsets, so gridlines, row bands, and dependency waypoints all derive from the
 *   same numbers without measuring the DOM.
 *
 * Interaction follows one rule: never reject the gesture. A drag always commits, violations become
 * visible rather than preventing anything, and the two consequences a drag can have — an undo and
 * a downstream ripple — are offered together in a non-modal bar beneath the canvas.
 */
import { cn } from '@docket/ui';
import { dragSourceProps, type DragSource } from '@docket/ui/lib/draggable';
import { Undo } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import {
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { AppliedView } from '@/components/views/apply-view';
import type { ViewDisplayState } from '@/components/views/field-catalog';

import CascadeProposal from './cascade-proposal';
import TimelineAxis from './timeline-axis';
import TimelineBar from './timeline-bar';
import TimelineEdges, { type EdgeAnchor, edgeKey } from './timeline-edges';
import UnscheduledTray, { type TrayEntry } from './unscheduled-tray';
import {
  type CascadeGraph,
  type CascadeNode,
  type ScheduleChange,
  type Violation,
  computeCascade,
  findViolations,
} from './cascade';
import { type TimelineCatalog, type TimelineSpan } from './timeline-catalog';
import { buildTimelineLayout } from './timeline-layout';
import { TINT_DOT_CLASS } from './timeline-tint';
import { rowCenterFor } from './timeline-geometry';
import { DAY_MS, dateAtPct, panWindow, pct, zoomWindow } from './time-scale';
import { useTimelineDrag } from './use-timeline-drag';
import type { TimelineViewport } from './use-timeline-viewport';

/**
 * The label column's width before the user has resized it.
 *
 * @remarks
 * A CSS `clamp` rather than a pixel constant, so the column is responsive *by construction* — at
 * 390px the names take a proportional slice instead of a fixed 260px that would leave the plot
 * area a useless sliver, and on a wide screen it stops growing at a readable maximum. No device
 * check, no breakpoint prop: the same expression serves every width. Once the user drags the
 * divider their explicit pixel width takes over.
 */
const DEFAULT_LABEL_WIDTH = 'clamp(7rem, 30%, 16rem)';
/** The narrowest the label column may be dragged. */
const MIN_LABEL_WIDTH = 112;
/** The widest the label column may be dragged. */
const MAX_LABEL_WIDTH = 480;
/** Zoom step applied per wheel notch / button press. */
const ZOOM_STEP = 0.8;

/** A completed reschedule, retained so it can be undone. */
interface LastChange {
  /** The row that moved. */
  readonly id: string;
  /** The span it had before. */
  readonly from: TimelineSpan;
}

/** Props for {@link TimelineCanvas}. */
export interface TimelineCanvasProps<T> {
  /** The filtered / sorted / grouped rows, shared with the list lens. */
  applied: AppliedView<T>;
  /** How this entity projects onto a time axis. */
  catalog: TimelineCatalog<T>;
  /** The active presentation toggles — the sole source of row geometry. */
  display: ViewDisplayState;
  /**
   * The viewport, owned by the page.
   *
   * @remarks
   * Deliberately *not* canvas state. When the canvas owned it, the controls that move it had to
   * render inside the canvas, which forced a second toolbar row directly above the chart and
   * pushed the first bar below the fold on a phone. With the viewport lifted, every control in the
   * surface composes into the page's single toolbar row.
   */
  viewport: TimelineViewport;
  /** Singular noun for the plotted entity, for instructions and copy. */
  noun: string;
  /** Plural noun for the plotted entity. */
  pluralNoun: string;
  /** Whether the caller may reschedule; read-only viewers still get the full visual timeline. */
  canSchedule: boolean;
  /** Persist one row's new span. */
  onReschedule: (id: string, span: TimelineSpan) => void;
  /** Persist a whole proposed ripple as one transaction. */
  onApplyCascade: (changes: readonly ScheduleChange[]) => void;
  /** Whether a cascade application is in flight. */
  applyingCascade: boolean;
  /** Open a row's detail. */
  onActivate: (id: string) => void;
  /** Warm a row's detail on hover. */
  onPrefetch: (id: string) => void;
}

/**
 * Render the timeline canvas.
 *
 * @typeParam T - The row type.
 * @param props - The {@link TimelineCanvasProps}.
 * @returns the rendered canvas.
 */
export default function TimelineCanvas<T>({
  applied,
  catalog,
  display,
  viewport,
  noun,
  pluralNoun,
  canSchedule,
  onReschedule,
  onApplyCascade,
  applyingCascade,
  onActivate,
  onPrefetch,
}: TimelineCanvasProps<T>): JSX.Element {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // `null` means "the responsive default"; a number is the width the user dragged to.
  const [labelWidth, setLabelWidth] = useState<number | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [proposal, setProposal] = useState<readonly ScheduleChange[]>([]);
  const [lastChange, setLastChange] = useState<LastChange | null>(null);

  const layout = useMemo(
    () => buildTimelineLayout(applied, catalog, display),
    [applied, catalog, display],
  );

  const { window, scale, setWindow } = viewport;
  const todayLeft = useMemo(() => {
    const now = Date.now();
    return now >= window.min && now <= window.max ? pct(now, window) : null;
  }, [window]);

  /** The constraint graph over currently placed rows. */
  const graph = useMemo<CascadeGraph>(() => {
    const map = new Map<string, CascadeNode>();
    for (const entry of layout.placed) {
      map.set(entry.id, { span: entry.span, blocks: catalog.edges(entry.row).blocks });
    }
    return map;
  }, [catalog, layout.placed]);

  const allEdges = useMemo<readonly Violation[]>(() => {
    const edges: Violation[] = [];
    for (const [blockerId, node] of graph) {
      for (const blockedId of node.blocks) {
        if (graph.has(blockedId)) edges.push({ blockerId, blockedId });
      }
    }
    return edges;
  }, [graph]);

  const violationKeys = useMemo(
    () => new Set(findViolations(graph).map((v) => edgeKey(v.blockerId, v.blockedId))),
    [graph],
  );

  const anchors = useMemo<ReadonlyMap<string, EdgeAnchor>>(() => {
    const map = new Map<string, EdgeAnchor>();
    for (const track of layout.tracks) {
      if (track.kind !== 'row') continue;
      map.set(track.placed.id, {
        span: track.placed.span,
        center: track.top + rowCenterFor(display),
      });
    }
    return map;
  }, [display, layout.tracks]);

  const rowById = useMemo(() => {
    const map = new Map<string, T>();
    for (const entry of layout.placed) map.set(entry.id, entry.row);
    for (const row of layout.unscheduled) map.set(catalog.id(row), row);
    return map;
  }, [catalog, layout.placed, layout.unscheduled]);

  const nameOf = useCallback(
    (id: string): string => {
      const row = rowById.get(id);
      return row ? catalog.label(row) : id;
    },
    [catalog, rowById],
  );

  const handleCommit = useCallback(
    (id: string, span: TimelineSpan): void => {
      const previous = graph.get(id)?.span ?? null;
      onReschedule(id, span);
      setLastChange(previous ? { id, from: previous } : null);
      // The ripple is computed against the pre-drag graph and offered, never applied silently.
      setProposal(computeCascade(id, span, graph));
    },
    [graph, onReschedule],
  );

  const { drag, startDrag, consumeDragClick } = useTimelineDrag({
    window,
    trackRef,
    onCommit: handleCommit,
  });

  /** Open a row, unless this click is the tail of a drag that just committed. */
  const activate = useCallback(
    (id: string): void => {
      if (consumeDragClick()) return;
      onActivate(id);
    },
    [consumeDragClick, onActivate],
  );

  /** Begin scheduling an undated row where the pointer currently sits on the track. */
  const handleTrayPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, id: string): void => {
      const track = trackRef.current;
      if (!track || !canSchedule) return;
      const rect = track.getBoundingClientRect();
      const percent = ((event.clientX - rect.left) / rect.width) * 100;
      const start = dateAtPct(Math.min(Math.max(percent, 0), 100), window);
      startDrag(event, id, 'create', { start, end: start + DAY_MS });
    },
    [canSchedule, startDrag, window],
  );

  /** Resize the pinned label column by dragging its divider. */
  const handleResizePointerDown = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    event.preventDefault();
    const originX = event.clientX;
    const target = event.currentTarget;
    // Read the resolved width off the DOM, so a drag continues from wherever the responsive
    // default landed rather than jumping to a hard-coded starting size.
    const originWidth = target.parentElement?.getBoundingClientRect().width ?? MIN_LABEL_WIDTH;
    target.setPointerCapture(event.pointerId);
    const move = (moveEvent: globalThis.PointerEvent): void => {
      const next = originWidth + (moveEvent.clientX - originX);
      setLabelWidth(Math.min(Math.max(next, MIN_LABEL_WIDTH), MAX_LABEL_WIDTH));
    };
    const up = (): void => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  }, []);

  // Modifier-wheel zooms about the pointer; plain horizontal wheel pans. Registered non-passively
  // because both need to suppress the browser's own scroll/zoom.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onWheel = (event: WheelEvent): void => {
      const rect = track.getBoundingClientRect();
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const anchor = (event.clientX - rect.left) / rect.width;
        setWindow((current) =>
          zoomWindow(current, event.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP, anchor),
        );
        return;
      }
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        event.preventDefault();
        setWindow((current) => panWindow(current, event.deltaX / rect.width));
      }
    };
    track.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      track.removeEventListener('wheel', onWheel);
    };
  }, []);

  const trayEntries = useMemo<readonly TrayEntry[]>(
    () =>
      layout.unscheduled.map((row) => ({
        id: catalog.id(row),
        label: catalog.label(row),
        status: catalog.statusLabel(row),
        tint: catalog.tint(row),
      })),
    [catalog, layout.unscheduled],
  );

  const gridStyle: CSSProperties = {
    gridTemplateColumns: `${labelWidth === null ? DEFAULT_LABEL_WIDTH : `${labelWidth}px`} minmax(0, 1fr)`,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/*
        One tonal card. The chart is the page's content, so it takes the remaining height rather
        than a magic viewport calculation, and its surface steps up from the page background per
        MD3 tonal hierarchy instead of sitting on bare white.
      */}
      <div className="border-outline-variant bg-surface-container flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          {/* ── Sticky axis header ──────────────────────────────────────── */}
          <div
            className="bg-surface-container-high/95 supports-[backdrop-filter]:bg-surface-container-high/80 border-outline-variant sticky top-0 z-30 grid border-b backdrop-blur"
            style={gridStyle}
          >
            <div className="border-outline-variant relative flex items-end border-r px-3 pb-1.5">
              <span
                role="presentation"
                onPointerDown={handleResizePointerDown}
                className="hover:bg-primary/40 absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize"
              />
            </div>
            <TimelineAxis scale={scale} todayLeft={todayLeft} />
          </div>

          {/* ── Body ────────────────────────────────────────────────────── */}
          <div
            role="grid"
            aria-label={`${pluralNoun} timeline`}
            // `min-h-full` so the gridlines, today rule, and column divider run the whole canvas
            // rather than stopping at the last row and leaving the chart looking half-drawn.
            className="relative grid min-h-full"
            style={gridStyle}
          >
            {/* Label column */}
            <div
              className="border-outline-variant relative border-r"
              style={{ minHeight: layout.height }}
            >
              {layout.tracks.map((track) =>
                track.kind === 'group' ? (
                  <div
                    key={`group-${track.id}`}
                    role="row"
                    className="bg-surface-container-high absolute inset-x-0 flex items-center gap-2 px-3"
                    style={{ top: track.top, height: track.height }}
                  >
                    <span className="text-on-surface truncate text-xs font-semibold">
                      {track.label}
                    </span>
                    <span className="text-on-surface-variant text-[11px] tabular-nums">
                      {track.count}
                    </span>
                  </div>
                ) : (
                  <LabelRow
                    key={`label-${track.placed.id}`}
                    top={track.top}
                    height={track.height}
                    drag={catalog.dragSource(track.placed.row)}
                    onEnter={() => {
                      setHoveredId(track.placed.id);
                      onPrefetch(track.placed.id);
                    }}
                    onLeave={() => {
                      setHoveredId(null);
                    }}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'size-2 shrink-0 rounded-full',
                        TINT_DOT_CLASS[catalog.tint(track.placed.row)],
                      )}
                    />
                    <button
                      type="button"
                      role="gridcell"
                      onClick={() => {
                        activate(track.placed.id);
                      }}
                      className="text-on-surface min-w-0 truncate text-left text-sm font-medium hover:underline"
                    >
                      {catalog.label(track.placed.row)}
                    </button>
                    {/* Same line, never a second one — row height must not depend on the row. */}
                    {(() => {
                      const sub = catalog.sublabel(track.placed.row);
                      return sub ? (
                        <span className="text-on-surface-variant shrink-0 truncate text-[11px]">
                          {sub}
                        </span>
                      ) : null;
                    })()}
                  </LabelRow>
                ),
              )}
            </div>

            {/* Plot area */}
            <div ref={trackRef} className="relative" style={{ minHeight: layout.height }}>
              {/* Gridlines + today rule, behind everything. */}
              <div aria-hidden="true" className="pointer-events-none absolute inset-0">
                {scale.ticks.map((tick) => (
                  <div
                    key={tick.at}
                    className={cn(
                      'border-outline-variant absolute inset-y-0 border-l',
                      tick.major ? 'opacity-100' : 'opacity-40',
                    )}
                    style={{ left: `${pct(tick.at, scale)}%` }}
                  />
                ))}
                {todayLeft !== null ? (
                  <div
                    className="bg-primary/30 absolute inset-y-0 z-[1] w-px"
                    style={{ left: `${todayLeft}%` }}
                  />
                ) : null}
              </div>

              {/* Group band tints, so the bands read as tonal steps rather than ruled lines. */}
              {layout.tracks.map((track) =>
                track.kind === 'group' ? (
                  <div
                    key={`band-${track.id}`}
                    aria-hidden="true"
                    className="bg-surface-container-high absolute inset-x-0"
                    style={{ top: track.top, height: track.height }}
                  />
                ) : null,
              )}

              <TimelineEdges
                edges={allEdges}
                anchors={anchors}
                violations={violationKeys}
                hoveredId={hoveredId}
                window={window}
                height={layout.height}
                trackRef={trackRef}
              />

              {layout.tracks.map((track) => {
                if (track.kind !== 'row') return null;
                const { placed } = track;
                const live = drag?.id === placed.id ? drag.span : placed.span;
                // Only the *blocked* row is marked. Ringing both endpoints paints two bars red for
                // one problem and, along a chain, turns the whole canvas red — while the row that
                // actually cannot start on time is the blocked one. The red edge already names the
                // blocker.
                const violated = allEdges.some(
                  (edge) =>
                    edge.blockedId === placed.id &&
                    violationKeys.has(edgeKey(edge.blockerId, edge.blockedId)),
                );
                return (
                  <div
                    key={`row-${placed.id}`}
                    className="absolute inset-x-0"
                    style={{ top: track.top, height: track.height }}
                    onMouseEnter={() => {
                      setHoveredId(placed.id);
                    }}
                    onMouseLeave={() => {
                      setHoveredId(null);
                    }}
                  >
                    <TimelineBar
                      id={placed.id}
                      label={catalog.label(placed.row)}
                      span={live}
                      tint={catalog.tint(placed.row)}
                      progress={catalog.progress(placed.row)}
                      markers={catalog.markers(placed.row)}
                      window={window}
                      display={display}
                      description={describe(catalog, placed.row, live)}
                      violated={violated}
                      dragging={drag?.id === placed.id}
                      onDragStart={(event, mode) => {
                        if (canSchedule) startDrag(event, placed.id, mode, placed.span);
                      }}
                      onActivate={() => {
                        activate(placed.id);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/*
          The tray sits *inside* the card, sharing its surface. Rendered as its own panel it read
          as an unrelated island parked under the chart, when it is really the same collection —
          the rows that simply have no position yet.
        */}
        {trayEntries.length > 0 ? (
          <div className="border-outline-variant bg-surface-container-high shrink-0 border-t px-3 py-2">
            <UnscheduledTray
              entries={trayEntries}
              onSchedulePointerDown={handleTrayPointerDown}
              onActivate={activate}
            />
          </div>
        ) : null}
      </div>

      {/* ── Consequences: undo, then the downstream ripple. Never modal. ──── */}
      {lastChange ? (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => {
              onReschedule(lastChange.id, lastChange.from);
              setLastChange(null);
              setProposal([]);
            }}
          >
            <Undo aria-hidden className="size-4" /> Undo move of {nameOf(lastChange.id)}
          </Button>
        </div>
      ) : null}

      <CascadeProposal
        changes={proposal}
        nameOf={nameOf}
        noun={proposal.length === 1 ? noun.toLowerCase() : pluralNoun.toLowerCase()}
        applying={applyingCascade}
        onApply={() => {
          onApplyCascade(proposal);
          setProposal([]);
        }}
        onDismiss={() => {
          setProposal([]);
        }}
      />
    </div>
  );
}

/** Props for {@link LabelRow}. */
interface LabelRowProps {
  /** The track's vertical offset from the top of the canvas, in pixels. */
  top: number;
  /** The track's height, in pixels. */
  height: number;
  /** How this row is dragged as an object, or `null` when it is not draggable. */
  drag: DragSource | null;
  /** The pointer entered the row. */
  onEnter: () => void;
  /** The pointer left the row. */
  onLeave: () => void;
  /** The row's contents. */
  children: ReactNode;
}

/**
 * One label-column row — and the timeline's *object* drag handle.
 *
 * @remarks
 * The drag source lives here rather than on the bar because the bar's own pointer gesture
 * reschedules it, and a native `draggable` on that same element would pre-empt those pointer
 * events. The two gestures cannot share a target, and the split is the honest one: the label is
 * the row's identity, the bar is its schedule.
 *
 * @param props - The {@link LabelRowProps}.
 * @returns the rendered label row.
 */
function LabelRow({ top, height, drag, onEnter, onLeave, children }: LabelRowProps): JSX.Element {
  const dragProps = dragSourceProps(drag ?? undefined);
  return (
    <div
      role="row"
      {...dragProps}
      className={cn(
        'hover:bg-surface-container-high absolute inset-x-0 flex items-center gap-2 px-3 transition-colors',
        dragProps?.className,
      )}
      style={{ top, height }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {children}
    </div>
  );
}

/**
 * The span formatter for accessible bar descriptions.
 *
 * @remarks
 * Module-scoped because `Intl.DateTimeFormat` construction is comparatively expensive and this
 * runs once per bar per render. Formatted in UTC to match the axis, so a described date never
 * disagrees with the date the bar is drawn at.
 */
const SPAN_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Build the accessible description for a bar: name, status, and span. */
function describe<T>(catalog: TimelineCatalog<T>, row: T, span: TimelineSpan): string {
  const fmt = SPAN_FORMAT;
  const range =
    span.start === span.end
      ? fmt.format(new Date(span.start))
      : `${fmt.format(new Date(span.start))} to ${fmt.format(new Date(span.end))}`;
  return `${catalog.label(row)} — ${catalog.statusLabel(row)}, ${range}`;
}
