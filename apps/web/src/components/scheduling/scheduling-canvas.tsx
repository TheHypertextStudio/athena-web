'use client';

import {
  type JSX,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { SchedulingAllDayItem } from './scheduling-all-day-item';
import {
  deriveLaneGeometry,
  deriveSnapMinutes,
  MINUTES_PER_DAY,
  minutesToPixels,
  pixelsToMinutes,
} from './scheduling-geometry';
import { SchedulingItemCard } from './scheduling-item-card';
import { positionScheduleLaneItems } from './scheduling-overlap-layout';
import { SchedulingTimeGrid } from './scheduling-time-grid';
import type { ScheduleLane, SchedulingCanvasProps } from './scheduling-types';
export type { ScheduleItemRenderContext, SchedulingCanvasProps } from './scheduling-types';

const DEFAULT_VIEWPORT_WIDTH = 960;
const HOUR_GUTTER_WIDTH = 64;
const MINIMUM_LANE_WIDTH = 220;
const MINIMUM_INTERACTIVE_PIXELS = 18;
/** Render a 24-hour fluid grid while consumers own data, persistence, and policy. */
export default function SchedulingCanvas({
  displayTimezone,
  lanes,
  pixelsPerHour,
  now,
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
  const viewportCenterMinutesRef = useRef<number | undefined>(undefined);
  const timedGridRef = useRef<HTMLDivElement>(null);
  const [observedWidth, setObservedWidth] = useState(DEFAULT_VIEWPORT_WIDTH);
  const [gestureAnnouncement, setGestureAnnouncement] = useState('');
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
    return observer.disconnect.bind(observer);
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
  const fullWidth = geometry.gutterWidth + geometry.contentWidth;
  const isEmpty = lanes.every((lane) => lane.items.length === 0);
  const positionedLaneItems = useMemo(
    () =>
      lanes.map((lane) =>
        positionScheduleLaneItems(
          lane,
          displayTimezone,
          effectivePixelsPerHour,
          MINIMUM_INTERACTIVE_PIXELS,
        ),
      ),
    [displayTimezone, effectivePixelsPerHour, lanes],
  );
  useEffect(() => {
    onViewportGeometry?.({
      visibleLaneCount: geometry.visibleLaneCount,
      laneWidth: geometry.laneWidth,
    });
  }, [geometry.laneWidth, geometry.visibleLaneCount, onViewportGeometry]);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const timedGridOffset = timedGridRef.current?.offsetTop ?? 0;
    const windowKey = lanes[0]?.id;
    if (initializedWindowRef.current !== windowKey) {
      viewport.scrollLeft =
        initialLaneIndex > 0 ? geometry.gutterWidth + initialLaneIndex * geometry.laneWidth : 0;
      initializedWindowRef.current = windowKey;
    }
    if (!initializedVerticalScrollRef.current) {
      viewport.scrollTop = Math.max(
        0,
        timedGridOffset + minutesToPixels(initialScrollMinutes, effectivePixelsPerHour) - 48,
      );
      initializedVerticalScrollRef.current = true;
    } else if (previousPixelsPerHourRef.current !== effectivePixelsPerHour) {
      const previous = Math.max(1, previousPixelsPerHourRef.current);
      const centerMinutes =
        viewportCenterMinutesRef.current ??
        ((viewport.scrollTop + viewport.clientHeight / 2 - timedGridOffset) / previous) * 60;
      viewport.scrollTop = Math.max(
        0,
        timedGridOffset +
          minutesToPixels(centerMinutes, effectivePixelsPerHour) -
          viewport.clientHeight / 2,
      );
    }
    viewportCenterMinutesRef.current =
      ((viewport.scrollTop + viewport.clientHeight / 2 - timedGridOffset) /
        effectivePixelsPerHour) *
      60;
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
      className="border-outline-variant bg-surface relative h-[clamp(20rem,68dvh,48rem)] overflow-auto overscroll-contain rounded-xl border"
      data-lane-count={lanes.length}
      data-visible-lane-count={geometry.visibleLaneCount}
      data-snap-minutes={snapMinutes}
      onScroll={(event) => {
        const viewport = event.currentTarget;
        const timedGridOffset = timedGridRef.current?.offsetTop ?? 0;
        viewportCenterMinutesRef.current =
          ((viewport.scrollTop + viewport.clientHeight / 2 - timedGridOffset) * 60) /
          effectivePixelsPerHour;
        if (!onReachBoundary) return;
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
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {gestureAnnouncement}
      </p>
      <div className="min-w-full" style={{ width: fullWidth }}>
        <header className="bg-surface-container-low sticky top-0 z-40 flex border-b">
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
                  <span>{lane.date}</span>
                  {lane.timezone ? <span className="ml-1">{lane.timezone}</span> : null}
                </p>
                <div className="mt-1 flex min-h-5 flex-wrap gap-1">
                  {lane.items
                    .filter((item) => item.allDay)
                    .map((item) => (
                      <SchedulingAllDayItem
                        key={item.id}
                        item={item}
                        lane={lane}
                        renderItem={renderItem}
                        onOpenItem={onOpenItem}
                        onDropObjectOnItem={onDropObjectOnItem}
                      />
                    ))}
                </div>
              </div>
            ))}
          </div>
        </header>
        <div ref={timedGridRef} className="relative">
          <SchedulingTimeGrid
            lanes={lanes}
            displayTimezone={displayTimezone}
            pixelsPerHour={effectivePixelsPerHour}
            now={now}
            gutterWidth={geometry.gutterWidth}
            contentWidth={geometry.contentWidth}
            laneWidth={geometry.laneWidth}
          >
            <div className="absolute inset-0 flex">
              {lanes.map((lane, laneIndex) => (
                <div
                  key={lane.id}
                  aria-label={`${lane.label} time grid`}
                  className="border-outline-variant relative shrink-0 touch-none border-r"
                  data-schedule-lane={lane.id}
                  style={{ width: geometry.laneWidth, height: 24 * effectivePixelsPerHour }}
                  onPointerDown={beginSelection.bind(null, lane)}
                >
                  {positionedLaneItems[laneIndex]?.map(
                    ({ item, bounds, top, height, placement }) => (
                      <SchedulingItemCard
                        key={item.id}
                        item={item}
                        lane={lane}
                        laneIndex={laneIndex}
                        lanes={lanes}
                        laneWidth={geometry.laneWidth}
                        gutterWidth={geometry.gutterWidth}
                        pixelsPerHour={effectivePixelsPerHour}
                        snapMinutes={snapMinutes}
                        bounds={bounds}
                        top={top}
                        height={height}
                        placement={placement}
                        viewportRef={viewportRef}
                        renderItem={renderItem}
                        onOpenItem={onOpenItem}
                        onMoveItem={onMoveItem}
                        onResizeItem={onResizeItem}
                        onDropObjectOnItem={onDropObjectOnItem}
                        onGestureAnnouncementChange={setGestureAnnouncement}
                      />
                    ),
                  )}
                </div>
              ))}
            </div>
          </SchedulingTimeGrid>
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
