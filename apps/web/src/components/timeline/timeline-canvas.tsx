'use client';

/**
 * `timeline` — the canvas: axis, label column, plotted rows, edges, and the drag surface.
 *
 * @remarks
 * The single component every temporal lens in Docket renders. It is generic over the row type and
 * reads everything domain-specific through a {@link TimelineCatalog}, so Projects, the Hub
 * portfolio, and any future surface share one implementation of the axis, zooming, grouping,
 * dependency drawing, and drag-to-schedule.
 *
 * Four structural decisions are worth calling out because they eliminate whole classes of defect
 * rather than papering over them:
 *
 * - **There is no horizontal scroll.** Time is navigated by zooming and panning the viewport, not
 *   by scrolling a track wider than the screen. That means the label column can never scroll out
 *   of view and the axis can never desynchronise from the bars — the old lens lost the project
 *   names the moment you scrolled right. Edge-zone auto-*pan* during a drag is the same idea: the
 *   window moves, not a scroll offset.
 * - **Vertical position is arithmetic.** The layout model hands over fixed-height tracks with
 *   precomputed offsets, so gridlines, row bands, and dependency waypoints all derive from the
 *   same numbers without measuring the DOM. Tracks are laid out end to end from a running sum,
 *   which is why no row can ever overlap its neighbour at any zoom or scroll offset.
 * - **The chart is not in a card.** It has no surface, border, or radius of its own: it *is* the
 *   page's content region, bled to the panel's edges. A tonal card around a full-height chart adds
 *   an inner frame, a second rounded corner against the shell's own, and a gutter of wasted width
 *   — all to say something the page had already said.
 * - **Every row is a row.** A row with no dates keeps its place in the same list at the same
 *   height with the same label and the same affordances; only its lane is empty. It is not
 *   demoted to a chip in a tray docked under the chart.
 *
 * Interaction follows one rule: never reject the gesture. A drag always commits, violations become
 * visible rather than preventing anything, and the two consequences a drag can have — an undo and
 * a downstream ripple — are offered together in a non-modal bar beneath the canvas.
 */
import { cn } from '@docket/ui';
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

import { CURSOR_DRAGGABLE } from '@/lib/actions/cursor';
import { ObjectSurface } from '@/components/objects/object-surface';
import type { ObjectRef } from '@/lib/actions/object';
import type { AppliedView } from '@/components/views/apply-view';
import type { ViewDisplayState } from '@/components/views/field-catalog';

import CascadeProposal from './cascade-proposal';
import TimelineAxis from './timeline-axis';
import TimelineBar from './timeline-bar';
import { TimelineDragPreview, TimelineDropIndicator } from './timeline-drag-layer';
import TimelineEdges, { type EdgeAnchor, edgeKey } from './timeline-edges';
import {
  type CascadeGraph,
  type CascadeNode,
  type ScheduleChange,
  type Violation,
  computeCascade,
  findViolations,
} from './cascade';
import { type TimelineCatalog, type TimelineSpan } from './timeline-catalog';
import { buildTimelineLayout, type RowTrack } from './timeline-layout';
import { TINT_DOT_CLASS, UNSCHEDULED_LANE_CLASS } from './timeline-tint';
import { BAR_HEIGHT, barInsetFor, rowCenterFor } from './timeline-geometry';
import { DAY_MS, dateAtPct, panWindow, pct, snapDown, zoomWindow } from './time-scale';
import { useTimelineAutoScroll } from './use-timeline-autoscroll';
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

/**
 * Cancel the page container's gutters so the chart runs to the content panel's edges.
 *
 * @remarks
 * Mirrors `PageContainer`'s `px-3 py-4 @2xl:p-6 @4xl:p-8` exactly. A chart is not a document: every
 * pixel of width is more time on screen, and a gutter around it reads as the frame of a card that
 * is not there. Opt-in (see {@link TimelineCanvasProps.fullBleed}) because a timeline embedded
 * among siblings — the Hub roadmap — must keep the rhythm of the stack it sits in.
 */
const FULL_BLEED_CLASS = '-mx-3 -mb-4 @2xl:-mx-6 @2xl:-mb-6 @4xl:-mx-8 @4xl:-mb-8';

/** Horizontal padding inside the label column, aligned to the page's own gutters. */
const LABEL_PAD_CLASS = 'px-3 @2xl:px-6';

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
  /**
   * Bleed the chart past the page container's gutters to the content panel's edges.
   *
   * @remarks
   * For a surface where the timeline *is* the page. Left `false` for a timeline that is one block
   * among siblings, where cancelling the container's padding would break the stack's alignment.
   */
  fullBleed?: boolean;
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
  fullBleed = false,
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
  /**
   * Where "today" falls in the window, or `null` when today is off screen.
   *
   * @remarks
   * Snapped to the start of the UTC day, like every other date on this chart. Reading the raw
   * clock here made the rule's offset a function of the millisecond the component rendered at,
   * which differed between the server pass and hydration and threw the whole subtree away. Day
   * resolution is also what the axis and every bar already use, so a marker at the day boundary is
   * the consistent reading rather than a compromise.
   */
  const todayLeft = useMemo(() => {
    const today = snapDown(Date.now(), 'day');
    return today >= window.min && today <= window.max ? pct(today, window) : null;
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
      if (track.kind !== 'row' || track.span === null) continue;
      map.set(track.id, { span: track.span, center: track.top + rowCenterFor(display) });
    }
    return map;
  }, [display, layout.tracks]);

  const rowById = useMemo(() => {
    const map = new Map<string, T>();
    for (const track of layout.tracks) {
      if (track.kind === 'row') map.set(track.id, track.row);
    }
    return map;
  }, [layout.tracks]);

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

  /** Pan the visible window, for the edge-zone auto-pan during a drag. */
  const handlePan = useCallback(
    (fraction: number): void => {
      setWindow((current) => panWindow(current, fraction));
    },
    [setWindow],
  );

  const autoScroll = useTimelineAutoScroll({ scrollRef, trackRef, onPan: handlePan });
  const { drag, startDrag, consumeDragClick } = useTimelineDrag({
    window,
    trackRef,
    autoScroll,
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

  /** Begin scheduling an undated row from a press anywhere on its empty lane. */
  const handleLanePointerDown = useCallback(
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
  }, [setWindow]);

  /** The track being dragged, for the drop indicator and the preview card. */
  const dragTrack = useMemo<RowTrack<T> | null>(() => {
    if (!drag) return null;
    for (const track of layout.tracks) {
      if (track.kind === 'row' && track.id === drag.id) return track;
    }
    return null;
  }, [drag, layout.tracks]);

  const gridStyle: CSSProperties = {
    gridTemplateColumns: `${labelWidth === null ? DEFAULT_LABEL_WIDTH : `${labelWidth}px`} minmax(0, 1fr)`,
  };

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-2', fullBleed && FULL_BLEED_CLASS)}>
      <div
        ref={scrollRef}
        data-timeline-scroll=""
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {/*
          ── Sticky axis header ──────────────────────────────────────────
          Fully opaque, on its own tonal step. Anything less and the rows sliding underneath stay
          readable through the dates.
        */}
        <div
          className="bg-surface-container-low sticky top-0 z-30 grid"
          style={gridStyle}
          data-timeline-sticky-header=""
        >
          <div className={cn('relative flex items-end pb-1.5', LABEL_PAD_CLASS)}>
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
          // `min-h-full` so the gridlines, today rule, and column guide run the whole canvas
          // rather than stopping at the last row and leaving the chart looking half-drawn.
          className="relative grid min-h-full"
          style={gridStyle}
        >
          {/* Label column */}
          <div className="relative" style={{ minHeight: layout.height }}>
            {/*
              The column guide, not a rule. `outline-variant` at a quarter opacity is enough to
              register as an alignment edge and not enough to read as a drawn line — the whole
              point of the "strong lines" note.
            */}
            <span
              aria-hidden="true"
              className="bg-outline-variant/25 absolute inset-y-0 right-0 w-px"
            />
            {layout.tracks.map((track) =>
              track.kind === 'group' ? (
                <div
                  key={`group-${track.id}`}
                  role="row"
                  data-timeline-track="group"
                  className={cn(
                    'bg-surface-container-low absolute inset-x-0 flex items-center gap-2',
                    LABEL_PAD_CLASS,
                  )}
                  style={{ top: track.top, height: track.height }}
                >
                  <span className="text-on-surface text-label-large truncate">{track.label}</span>
                  <span className="text-on-surface-variant text-label-small tabular-nums">
                    {track.count}
                  </span>
                </div>
              ) : (
                <LabelRow
                  key={`label-${track.id}`}
                  top={track.top}
                  height={track.height}
                  hovered={hoveredId === track.id}
                  object={catalog.object(track.row)}
                  href={catalog.href(track.row)}
                  onEnter={() => {
                    setHoveredId(track.id);
                    onPrefetch(track.id);
                  }}
                  onLeave={() => {
                    setHoveredId(null);
                  }}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'size-2 shrink-0 rounded-full',
                      TINT_DOT_CLASS[catalog.tint(track.row)],
                    )}
                  />
                  <button
                    type="button"
                    role="gridcell"
                    onClick={() => {
                      activate(track.id);
                    }}
                    className="text-on-surface text-label-large min-w-0 truncate text-left hover:underline"
                  >
                    {catalog.label(track.row)}
                  </button>
                  {/* Same line, never a second one — row height must not depend on the row. */}
                  {(() => {
                    const sub = catalog.sublabel(track.row);
                    return sub ? (
                      <span className="text-on-surface-variant text-body-small shrink-0 truncate">
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
            {/* Gridlines + today rule, behind everything, at guide weight rather than rule weight. */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0">
              {scale.ticks.map((tick) => (
                <div
                  key={tick.at}
                  className={cn(
                    'absolute inset-y-0 w-px',
                    tick.major ? 'bg-outline-variant/40' : 'bg-outline-variant/20',
                  )}
                  style={{ left: `${pct(tick.at, scale)}%` }}
                />
              ))}
              {todayLeft !== null ? (
                <div
                  className="bg-primary/40 absolute inset-y-0 z-[1] w-px"
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
                  className="bg-surface-container-low absolute inset-x-0"
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
              // Only the *blocked* row is marked. Ringing both endpoints paints two bars red for
              // one problem and, along a chain, turns the whole canvas red — while the row that
              // actually cannot start on time is the blocked one. The red edge already names the
              // blocker.
              const violated = allEdges.some(
                (edge) =>
                  edge.blockedId === track.id &&
                  violationKeys.has(edgeKey(edge.blockerId, edge.blockedId)),
              );
              const live = drag?.id === track.id ? drag.span : track.span;
              return (
                <div
                  key={`row-${track.id}`}
                  data-timeline-track="row"
                  className={cn(
                    'absolute inset-x-0',
                    hoveredId === track.id && 'bg-surface-container/40',
                  )}
                  style={{ top: track.top, height: track.height }}
                  onMouseEnter={() => {
                    setHoveredId(track.id);
                  }}
                  onMouseLeave={() => {
                    setHoveredId(null);
                  }}
                >
                  {live === null ? (
                    <UnscheduledLane
                      display={display}
                      schedulable={canSchedule}
                      noun={noun}
                      onPointerDown={(event) => {
                        handleLanePointerDown(event, track.id);
                      }}
                      onActivate={() => {
                        activate(track.id);
                      }}
                      label={catalog.label(track.row)}
                    />
                  ) : (
                    <TimelineBar
                      id={track.id}
                      label={catalog.label(track.row)}
                      span={live}
                      tint={catalog.tint(track.row)}
                      progress={catalog.progress(track.row)}
                      markers={catalog.markers(track.row)}
                      window={window}
                      display={display}
                      description={describe(catalog, track.row, live)}
                      violated={violated}
                      dragging={drag?.id === track.id && drag.moved}
                      schedulable={canSchedule}
                      onDragStart={(event, mode) => {
                        if (canSchedule && track.span) startDrag(event, track.id, mode, track.span);
                      }}
                      onActivate={() => {
                        activate(track.id);
                      }}
                    />
                  )}
                </div>
              );
            })}

            {/* Where the object will land — drawn from the same snapped span the drop commits. */}
            {drag?.moved && dragTrack ? (
              <TimelineDropIndicator
                top={dragTrack.top}
                height={dragTrack.height}
                span={drag.span}
                window={window}
              />
            ) : null}
          </div>
        </div>
      </div>

      {/* What the pointer is carrying, pinned to it and portalled clear of every clip. */}
      {drag?.moved && dragTrack ? (
        <TimelineDragPreview
          label={catalog.label(dragTrack.row)}
          tint={catalog.tint(dragTrack.row)}
          span={drag.span}
          pointerX={drag.pointerX}
          pointerY={drag.pointerY}
        />
      ) : null}

      {/* ── Consequences: undo, then the downstream ripple. Never modal. ──── */}
      {lastChange ? (
        <div className={cn('flex items-center gap-2', fullBleed && LABEL_PAD_CLASS)}>
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

      <div className={cn(fullBleed && LABEL_PAD_CLASS)}>
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
    </div>
  );
}

/** Props for {@link UnscheduledLane}. */
interface UnscheduledLaneProps {
  /** The active presentation toggles, so the lane centres on the same baseline as a bar. */
  display: ViewDisplayState;
  /** Whether the viewer may schedule; a read-only viewer gets the lane without the invitation. */
  schedulable: boolean;
  /** Singular noun for the plotted entity, for the lane's copy. */
  noun: string;
  /** The row's name, for the accessible label. */
  label: string;
  /** Begin a create-drag at the pressed date. */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** Open the row's detail on a click that was not a drag. */
  onActivate: () => void;
}

/**
 * The lane drawn for a row that carries no dates.
 *
 * @remarks
 * The honest rendering of "this row has no position on this axis": a full-width track at the same
 * height as every other row, seated on the same baseline a bar would occupy, saying so in words —
 * and schedulable by pressing anywhere along it, so the date it gets is the date under the
 * pointer. Plotting such a row at offset zero (what the lens did two revisions ago) claims a start
 * date it does not have; exiling it to a tray under the chart (what it did one revision ago) says
 * it is a different kind of thing.
 *
 * @param props - The {@link UnscheduledLaneProps}.
 * @returns the rendered lane.
 */
function UnscheduledLane({
  display,
  schedulable,
  noun,
  label,
  onPointerDown,
  onActivate,
}: UnscheduledLaneProps): JSX.Element {
  const inset = barInsetFor(display);
  return (
    <button
      type="button"
      aria-label={
        schedulable
          ? `${label} — not scheduled. Drag across this row to schedule it.`
          : `${label} — not scheduled.`
      }
      onPointerDown={schedulable ? onPointerDown : undefined}
      onClick={onActivate}
      className={cn(
        'focus-visible:ring-ring absolute inset-x-0 flex items-center rounded-md px-2.5 text-left focus-visible:ring-2 focus-visible:outline-none',
        UNSCHEDULED_LANE_CLASS,
        schedulable && CURSOR_DRAGGABLE,
      )}
      style={{ top: `${inset}px`, height: `${BAR_HEIGHT}px` }}
    >
      <span className="text-on-surface-variant text-label-medium truncate">
        Not scheduled
        {/*
          The instruction is dropped on a narrow container rather than truncated: at 390px the
          label column already takes a third of the width, and "…drag to place this proj…" teaches
          nobody anything. The accessible name carries the full sentence at every width.
        */}
        {schedulable ? (
          <span className="hidden @2xl:inline"> — drag to place this {noun.toLowerCase()}</span>
        ) : null}
      </span>
    </button>
  );
}

/** Props for {@link LabelRow}. */
interface LabelRowProps {
  /** The track's vertical offset from the top of the canvas, in pixels. */
  top: number;
  /** The track's height, in pixels. */
  height: number;
  /** Whether this row is the hovered one (the plot half highlights in step). */
  hovered: boolean;
  /** Canonical object identity, or `null` for a non-interactive context row. */
  object: ObjectRef | null;
  /** Detail route opened from any non-control part of the label row. */
  href: string;
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
function LabelRow({
  top,
  height,
  hovered,
  object,
  href,
  onEnter,
  onLeave,
  children,
}: LabelRowProps): JSX.Element {
  const row = (
    <div
      role="row"
      data-timeline-track="row"
      className={cn(
        'absolute inset-x-0 flex items-center gap-2 transition-colors',
        LABEL_PAD_CLASS,
        hovered && 'bg-surface-container/40',
      )}
      style={{ top, height }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {children}
    </div>
  );
  if (object === null) return row;
  return (
    <ObjectSurface object={object} surfaceId="timeline-label" href={href}>
      {row}
    </ObjectSurface>
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
  const semanticRange = catalog.spanLabel?.(row) ?? null;
  const range =
    semanticRange ??
    (span.start === span.end
      ? fmt.format(new Date(span.start))
      : `${fmt.format(new Date(span.start))} to ${fmt.format(new Date(span.end))}`);
  return `${catalog.label(row)} — ${catalog.statusLabel(row)}, ${range}`;
}
