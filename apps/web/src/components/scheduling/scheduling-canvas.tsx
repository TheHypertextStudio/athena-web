'use client';

import {
  type JSX,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { isScheduleItemEditable, itemBoundsInLane } from './scheduling-date-lanes';
import { readScheduleDragObject, writeScheduleDragObject } from './scheduling-drag-object';
import {
  deriveLaneGeometry,
  deriveSnapMinutes,
  laneIndexAtOffset,
  MINUTES_PER_DAY,
  minutesToPixels,
  pixelDeltaToMinutes,
  pixelsToMinutes,
} from './scheduling-geometry';
import type {
  ScheduleItem,
  ScheduleItemMove,
  ScheduleObjectDrop,
  ScheduleItemOpen,
  ScheduleItemResize,
  ScheduleLane,
  ScheduleRegionSelection,
} from './scheduling-types';

const DEFAULT_VIEWPORT_WIDTH = 960;
const HOUR_GUTTER_WIDTH = 64;
const MINIMUM_LANE_WIDTH = 220;
const HOUR_MARKS = Array.from({ length: 25 }, (_, index) => index);

/** Context supplied to a consumer-owned item renderer. */
export interface ScheduleItemRenderContext {
  readonly item: ScheduleItem;
  readonly lane: ScheduleLane;
  readonly allDay: boolean;
}

/** Props for the pure, callback-driven {@link SchedulingCanvas}. */
export interface SchedulingCanvasProps {
  /** Arbitrary date/resource lanes. No view mode or fixed lane count is assumed. */
  readonly lanes: readonly ScheduleLane[];
  /** Continuous vertical zoom. Every positive value is supported. */
  readonly pixelsPerHour: number;
  /** Deterministic width override; when omitted the canvas observes its own viewport. */
  readonly viewportWidth?: number;
  /** Minimum readable lane width; the visible lane count is derived from this and the viewport. */
  readonly minimumLaneWidth?: number;
  /** Lane aligned at the leading edge when a rolling window mounts. */
  readonly initialLaneIndex?: number;
  /** Minute-of-day initially brought near the top of the viewport (default: 07:00). */
  readonly initialScrollMinutes?: number;
  /** Reports the live viewport-derived geometry to a rolling lane source. */
  readonly onViewportGeometry?: (geometry: {
    readonly visibleLaneCount: number;
    readonly laneWidth: number;
  }) => void;
  /** Requests the preceding/following window when horizontal scrolling reaches a boundary. */
  readonly onReachBoundary?: (direction: 'previous' | 'next') => void;
  /** Optional application-owned error copy. The grid remains mounted underneath it. */
  readonly error?: string | null;
  /** Application-owned empty copy shown when every lane has no items. */
  readonly emptyMessage?: string;
  /** Customize item content without transferring gesture or geometry ownership. */
  readonly renderItem?: (context: ScheduleItemRenderContext) => ReactNode;
  /** Receive a pointer-created time region. */
  readonly onSelectRegion?: (selection: ScheduleRegionSelection) => void;
  /** Receive item activation. */
  readonly onOpenItem?: (request: ScheduleItemOpen) => void;
  /** Receive a proposed lane/time move. */
  readonly onMoveItem?: (request: ScheduleItemMove) => void;
  /** Receive a proposed start/end resize. */
  readonly onResizeItem?: (request: ScheduleItemResize) => void;
  /** Associate a cross-surface task/event with an item target. */
  readonly onDropObjectOnItem?: (request: ScheduleObjectDrop) => void;
}

/** Format a grid hour as concise local-independent display copy. */
function formatHour(hour: number): string {
  if (hour === 24) return '';
  if (hour === 0) return '12 AM';
  if (hour === 12) return '12 PM';
  return hour < 12 ? `${String(hour)} AM` : `${String(hour - 12)} PM`;
}

/** Keep a moved interval inside one 24-hour lane without changing its duration. */
function clampMovedInterval(
  startMinutes: number,
  endMinutes: number,
  deltaMinutes: number,
): { startMinutes: number; endMinutes: number } {
  const duration = endMinutes - startMinutes;
  const nextStart = Math.max(0, Math.min(MINUTES_PER_DAY - duration, startMinutes + deltaMinutes));
  return { startMinutes: nextStart, endMinutes: nextStart + duration };
}

/** One timed item placed inside a lane. */
interface TimedScheduleItemProps {
  readonly item: ScheduleItem;
  readonly lane: ScheduleLane;
  readonly laneIndex: number;
  readonly lanes: readonly ScheduleLane[];
  readonly laneWidth: number;
  readonly pixelsPerHour: number;
  readonly snapMinutes: number;
  readonly renderItem?: SchedulingCanvasProps['renderItem'];
  readonly onOpenItem?: SchedulingCanvasProps['onOpenItem'];
  readonly onMoveItem?: SchedulingCanvasProps['onMoveItem'];
  readonly onResizeItem?: SchedulingCanvasProps['onResizeItem'];
  readonly onDropObjectOnItem?: SchedulingCanvasProps['onDropObjectOnItem'];
}

/** Render and gesture-wire one timed item without owning any persistence. */
function TimedScheduleItem({
  item,
  lane,
  laneIndex,
  lanes,
  laneWidth,
  pixelsPerHour,
  snapMinutes,
  renderItem,
  onOpenItem,
  onMoveItem,
  onResizeItem,
  onDropObjectOnItem,
}: TimedScheduleItemProps): JSX.Element | null {
  const bounds = itemBoundsInLane(item, lane);
  if (!bounds) return null;
  const editable = isScheduleItemEditable(item, lane);
  const top = minutesToPixels(bounds.startMinutes, pixelsPerHour);
  const height = Math.max(
    minutesToPixels(bounds.endMinutes - bounds.startMinutes, pixelsPerHour),
    18,
  );
  const [dropActive, setDropActive] = useState(false);

  const acceptsDrop = (event: ReactDragEvent<HTMLElement>): boolean =>
    item.dropTarget === true &&
    event.dataTransfer.types.includes('application/x-docket-schedule-object');

  const beginMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (!onMoveItem) return;
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const laneRegion = event.currentTarget.closest<HTMLElement>('[data-schedule-lane-region]');
    const laneRegionLeft = laneRegion?.getBoundingClientRect().left;
    const onPointerUp = (upEvent: PointerEvent): void => {
      window.removeEventListener('pointerup', onPointerUp);
      const targetIndex =
        laneRegionLeft !== undefined
          ? laneIndexAtOffset(upEvent.clientX - laneRegionLeft, lanes.length, laneWidth)
          : laneIndex;
      const toLane = targetIndex === null ? lane : (lanes[targetIndex] ?? lane);
      const deltaMinutes = pixelDeltaToMinutes(
        upEvent.clientY - startY,
        pixelsPerHour,
        snapMinutes,
      );
      const moved = clampMovedInterval(bounds.startMinutes, bounds.endMinutes, deltaMinutes);
      if (toLane.id === lane.id && moved.startMinutes === bounds.startMinutes) return;
      onMoveItem({ item, fromLane: lane, toLane, ...moved });
    };
    window.addEventListener('pointerup', onPointerUp);
  };

  const beginResize = (
    edge: ScheduleItemResize['edge'],
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void => {
    if (!onResizeItem) return;
    event.preventDefault();
    event.stopPropagation();
    const startY = event.clientY;
    const onPointerUp = (upEvent: PointerEvent): void => {
      window.removeEventListener('pointerup', onPointerUp);
      const deltaMinutes = pixelDeltaToMinutes(
        upEvent.clientY - startY,
        pixelsPerHour,
        snapMinutes,
      );
      const next =
        edge === 'start'
          ? {
              startMinutes: Math.max(
                0,
                Math.min(bounds.endMinutes - snapMinutes, bounds.startMinutes + deltaMinutes),
              ),
              endMinutes: bounds.endMinutes,
            }
          : {
              startMinutes: bounds.startMinutes,
              endMinutes: Math.min(
                MINUTES_PER_DAY,
                Math.max(bounds.startMinutes + snapMinutes, bounds.endMinutes + deltaMinutes),
              ),
            };
      if (next.startMinutes === bounds.startMinutes && next.endMinutes === bounds.endMinutes) {
        return;
      }
      onResizeItem({ item, lane, edge, ...next });
    };
    window.addEventListener('pointerup', onPointerUp);
  };

  return (
    <article
      className={
        dropActive
          ? 'border-primary bg-primary-container absolute z-20 overflow-hidden rounded-md border shadow-md'
          : 'border-outline-variant bg-surface-container-low absolute z-10 overflow-hidden rounded-md border shadow-sm'
      }
      data-schedule-item={item.id}
      draggable={item.dragObject !== undefined}
      onDragStart={(event) => {
        if (item.dragObject) writeScheduleDragObject(event.dataTransfer, item.dragObject);
      }}
      onDragOver={(event) => {
        if (!acceptsDrop(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'link';
        setDropActive(true);
      }}
      onDragLeave={() => {
        setDropActive(false);
      }}
      onDrop={(event) => {
        setDropActive(false);
        if (!acceptsDrop(event) || !onDropObjectOnItem) return;
        event.preventDefault();
        const object = readScheduleDragObject(event.dataTransfer);
        if (!object || (object.kind === 'calendar_item' && object.itemId === item.id)) return;
        onDropObjectOnItem({ object, targetItem: item, targetLane: lane });
      }}
      style={{
        top,
        left: 4,
        right: 4,
        height,
        borderLeftWidth: 3,
        ...(item.color ? { borderLeftColor: item.color } : {}),
      }}
    >
      {editable && onResizeItem ? (
        <button
          type="button"
          aria-label={`Resize ${item.title} from start`}
          className="absolute inset-x-0 top-0 z-20 h-1.5 cursor-ns-resize"
          onPointerDown={(event) => {
            beginResize('start', event);
          }}
        />
      ) : null}
      <button
        type="button"
        className="text-on-surface size-full truncate px-2 py-1 text-left text-xs font-medium"
        onClick={() => {
          onOpenItem?.({ item, lane });
        }}
      >
        {renderItem?.({ item, lane, allDay: false }) ?? item.title}
      </button>
      {editable && onMoveItem ? (
        <button
          type="button"
          aria-label={`Move ${item.title}`}
          className="absolute top-1 right-1 z-20 size-4 cursor-move rounded"
          onPointerDown={beginMove}
        >
          <span aria-hidden="true">⋮</span>
        </button>
      ) : null}
      {editable && onResizeItem ? (
        <button
          type="button"
          aria-label={`Resize ${item.title} from end`}
          className="absolute inset-x-0 bottom-0 z-20 h-1.5 cursor-ns-resize"
          onPointerDown={(event) => {
            beginResize('end', event);
          }}
        />
      ) : null}
    </article>
  );
}

/**
 * Render a 24-hour fluid scheduling grid for arbitrary date/resource lanes.
 *
 * The canvas owns only geometry and pointer interpretation. All data loading, item persistence,
 * opening behavior, permission policy, and display-state copy remain consumer-owned callbacks.
 */
export default function SchedulingCanvas({
  lanes,
  pixelsPerHour,
  viewportWidth,
  minimumLaneWidth = MINIMUM_LANE_WIDTH,
  initialLaneIndex = 0,
  initialScrollMinutes = 7 * 60,
  onViewportGeometry,
  onReachBoundary,
  error,
  emptyMessage = 'Nothing scheduled.',
  renderItem,
  onSelectRegion,
  onOpenItem,
  onMoveItem,
  onResizeItem,
  onDropObjectOnItem,
}: SchedulingCanvasProps): JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null);
  const initializedWindowRef = useRef<string | undefined>(undefined);
  const initializedVerticalScrollRef = useRef(false);
  const previousPixelsPerHourRef = useRef(pixelsPerHour);
  const [observedWidth, setObservedWidth] = useState(DEFAULT_VIEWPORT_WIDTH);
  const boundaryLockRef = useRef<'previous' | 'next' | null>(null);

  useLayoutEffect(() => {
    if (viewportWidth !== undefined) return;
    const element = viewportRef.current;
    if (!element) return;
    const update = (): void => {
      if (element.clientWidth > 0) setObservedWidth(element.clientWidth);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [viewportWidth]);

  const effectivePixelsPerHour = Math.max(1, pixelsPerHour);
  const geometry = useMemo(
    () =>
      deriveLaneGeometry({
        viewportWidth: viewportWidth ?? observedWidth,
        laneCount: lanes.length,
        gutterWidth: HOUR_GUTTER_WIDTH,
        minimumLaneWidth,
      }),
    [lanes.length, minimumLaneWidth, observedWidth, viewportWidth],
  );
  const snapMinutes = deriveSnapMinutes(effectivePixelsPerHour);
  const gridHeight = 24 * effectivePixelsPerHour;
  const fullWidth = geometry.gutterWidth + geometry.contentWidth;
  const isEmpty = lanes.every((lane) => lane.items.length === 0);

  useEffect(() => {
    onViewportGeometry?.({
      visibleLaneCount: geometry.visibleLaneCount,
      laneWidth: geometry.laneWidth,
    });
  }, [geometry.laneWidth, geometry.visibleLaneCount, onViewportGeometry]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const windowKey = lanes[0]?.id;
    if (initializedWindowRef.current !== windowKey) {
      viewport.scrollLeft =
        initialLaneIndex > 0 ? geometry.gutterWidth + initialLaneIndex * geometry.laneWidth : 0;
      initializedWindowRef.current = windowKey;
    }
    if (!initializedVerticalScrollRef.current) {
      viewport.scrollTop = Math.max(
        0,
        minutesToPixels(initialScrollMinutes, effectivePixelsPerHour) - 48,
      );
      initializedVerticalScrollRef.current = true;
    } else if (previousPixelsPerHourRef.current !== effectivePixelsPerHour) {
      const previous = Math.max(1, previousPixelsPerHourRef.current);
      const centerMinutes = ((viewport.scrollTop + viewport.clientHeight / 2) / previous) * 60;
      viewport.scrollTop = Math.max(
        0,
        minutesToPixels(centerMinutes, effectivePixelsPerHour) - viewport.clientHeight / 2,
      );
    }
    previousPixelsPerHourRef.current = effectivePixelsPerHour;
  }, [
    effectivePixelsPerHour,
    geometry.gutterWidth,
    geometry.laneWidth,
    initialLaneIndex,
    initialScrollMinutes,
    lanes[0]?.id,
  ]);

  const beginSelection = (lane: ScheduleLane, event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!onSelectRegion || event.button !== 0 || event.target !== event.currentTarget) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const origin = pixelsToMinutes(event.clientY - rect.top, effectivePixelsPerHour, snapMinutes);
    const onPointerUp = (upEvent: PointerEvent): void => {
      window.removeEventListener('pointerup', onPointerUp);
      const current = pixelsToMinutes(
        upEvent.clientY - rect.top,
        effectivePixelsPerHour,
        snapMinutes,
      );
      let startMinutes = Math.min(origin, current);
      let endMinutes = Math.max(origin, current);
      if (startMinutes === endMinutes) {
        if (endMinutes === MINUTES_PER_DAY) startMinutes -= snapMinutes;
        else endMinutes += snapMinutes;
      }
      onSelectRegion({ lane, startMinutes, endMinutes });
    };
    window.addEventListener('pointerup', onPointerUp);
  };

  return (
    <section
      ref={viewportRef}
      aria-label="Schedule"
      className="border-outline-variant bg-surface relative overflow-auto rounded-xl border"
      data-lane-count={lanes.length}
      data-visible-lane-count={geometry.visibleLaneCount}
      data-snap-minutes={snapMinutes}
      onScroll={(event) => {
        if (!onReachBoundary) return;
        const viewport = event.currentTarget;
        const atPrevious = viewport.scrollLeft <= geometry.gutterWidth + 2;
        const atNext = viewport.scrollLeft + viewport.clientWidth >= viewport.scrollWidth - 2;
        const direction = atPrevious ? 'previous' : atNext ? 'next' : null;
        if (direction === null) {
          boundaryLockRef.current = null;
          return;
        }
        if (boundaryLockRef.current === direction) return;
        boundaryLockRef.current = direction;
        onReachBoundary(direction);
      }}
    >
      <div className="min-w-full" style={{ width: fullWidth }}>
        <header className="bg-surface-container-low sticky top-0 z-30 flex border-b">
          <div
            className="text-on-surface-variant bg-surface-container-low sticky left-0 z-40 shrink-0 self-stretch border-r px-2 py-3 text-[11px] font-medium"
            style={{ width: geometry.gutterWidth }}
          >
            All day
          </div>
          <div className="flex" style={{ width: geometry.contentWidth }}>
            {lanes.map((lane) => (
              <div
                key={lane.id}
                className="border-outline-variant min-w-0 shrink-0 border-r px-2 py-2"
                style={{ width: geometry.laneWidth }}
              >
                <p className="text-on-surface truncate text-xs font-semibold">{lane.label}</p>
                <p className="text-on-surface-variant truncate text-[10px] tabular-nums">
                  {lane.date}
                </p>
                <div className="mt-1 flex min-h-5 flex-wrap gap-1">
                  {lane.items
                    .filter((item) => item.allDay)
                    .map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="bg-secondary-container text-on-secondary-container max-w-full truncate rounded px-1.5 py-0.5 text-[10px]"
                        style={item.color ? { borderLeft: `3px solid ${item.color}` } : undefined}
                        onClick={() => {
                          onOpenItem?.({ item, lane });
                        }}
                      >
                        {renderItem?.({ item, lane, allDay: true }) ?? item.title}
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </div>
        </header>

        <div className="relative flex" style={{ height: gridHeight }}>
          <div
            className="border-outline-variant bg-surface sticky left-0 z-20 shrink-0 border-r"
            style={{ width: geometry.gutterWidth }}
          >
            {HOUR_MARKS.map((hour) => (
              <span
                key={hour}
                className="text-on-surface-variant absolute right-2 -translate-y-1/2 text-[10px] tabular-nums"
                style={{ top: hour * effectivePixelsPerHour }}
              >
                {formatHour(hour)}
              </span>
            ))}
          </div>

          <div
            className="relative shrink-0"
            data-schedule-lane-region=""
            style={{ width: geometry.contentWidth, height: gridHeight }}
          >
            {HOUR_MARKS.map((hour) => (
              <div
                key={hour}
                aria-hidden="true"
                className="border-outline-variant pointer-events-none absolute inset-x-0 border-t"
                data-hour-line={hour}
                style={{ top: hour * effectivePixelsPerHour }}
              />
            ))}
            <div className="absolute inset-0 flex">
              {lanes.map((lane, laneIndex) => (
                <div
                  key={lane.id}
                  aria-label={`${lane.label} time grid`}
                  className="border-outline-variant relative shrink-0 touch-none border-r"
                  data-schedule-lane={lane.id}
                  style={{ width: geometry.laneWidth, height: gridHeight }}
                  onPointerDown={(event) => {
                    beginSelection(lane, event);
                  }}
                >
                  {lane.items.map((item) => (
                    <TimedScheduleItem
                      key={item.id}
                      item={item}
                      lane={lane}
                      laneIndex={laneIndex}
                      lanes={lanes}
                      laneWidth={geometry.laneWidth}
                      pixelsPerHour={effectivePixelsPerHour}
                      snapMinutes={snapMinutes}
                      renderItem={renderItem}
                      onOpenItem={onOpenItem}
                      onMoveItem={onMoveItem}
                      onResizeItem={onResizeItem}
                      onDropObjectOnItem={onDropObjectOnItem}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>

          {error || isEmpty ? (
            <div
              role={error ? 'alert' : 'status'}
              className="bg-surface/90 text-on-surface-variant pointer-events-none absolute top-4 right-4 z-20 h-fit rounded-lg border px-3 py-2 text-xs shadow-sm"
              style={{ left: geometry.gutterWidth + 16 }}
            >
              {error ?? emptyMessage}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
