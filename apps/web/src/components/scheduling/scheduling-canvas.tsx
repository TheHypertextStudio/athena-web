'use client';

import { type JSX, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { SchedulingAllDayItem } from './scheduling-all-day-item';
import { SchedulingCanvasNotice } from './scheduling-canvas-notice';
import { deriveLaneGeometry, deriveSnapMinutes, minutesToPixels } from './scheduling-geometry';
import { SchedulingHorizontalBoundary } from './scheduling-horizontal-boundary';
import { SchedulingItemCard } from './scheduling-item-card';
import { positionScheduleLaneItems } from './scheduling-overlap-layout';
import { SchedulingTimeGrid } from './scheduling-time-grid';
import type { SchedulingCanvasProps } from './scheduling-types';
import { useSchedulingRegionSelection } from './use-scheduling-region-selection';
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
  const horizontalBoundaryRef = useRef(new SchedulingHorizontalBoundary());
  useLayoutEffect(() => {
    if (viewportWidth !== undefined) return;
    const element = viewportRef.current;
    if (!element) return;
    const update = (): void => {
      horizontalBoundaryRef.current.synchronize(element);
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
  const regionSelection = useSchedulingRegionSelection({
    lanes,
    pixelsPerHour: effectivePixelsPerHour,
    snapMinutes,
    onSelectRegion,
  });
  const fullWidth = geometry.gutterWidth + geometry.contentWidth;
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
      viewport.scrollLeft = initialLaneIndex > 0 ? initialLaneIndex * geometry.laneWidth : 0;
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
    horizontalBoundaryRef.current.synchronize(viewport);
  }, [
    effectivePixelsPerHour,
    geometry.laneWidth,
    initialLaneIndex,
    initialScrollMinutes,
    lanes[0]?.id,
  ]);
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
        const direction = horizontalBoundaryRef.current.observe(viewport);
        if (direction && onReachBoundary) onReachBoundary(direction);
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
          <SchedulingCanvasNotice
            emptyMessage={emptyMessage}
            error={error}
            gutterWidth={geometry.gutterWidth}
            isEmpty={lanes.every((lane) => lane.items.length === 0)}
            viewportWidth={viewportWidth ?? observedWidth}
          />
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
                  onPointerDown={(event) => {
                    regionSelection.onPointerDown(lane, event);
                  }}
                >
                  {regionSelection.preview?.laneId === lane.id ? (
                    <div
                      aria-hidden="true"
                      className="border-primary/40 bg-primary/10 pointer-events-none absolute inset-x-1 z-10 rounded-md border"
                      data-schedule-region-preview={lane.id}
                      data-start-minutes={regionSelection.preview.startMinutes}
                      data-end-minutes={regionSelection.preview.endMinutes}
                      style={{
                        top: minutesToPixels(
                          regionSelection.preview.startMinutes,
                          effectivePixelsPerHour,
                        ),
                        height: minutesToPixels(
                          regionSelection.preview.endMinutes - regionSelection.preview.startMinutes,
                          effectivePixelsPerHour,
                        ),
                      }}
                    />
                  ) : null}
                  {positionedLaneItems[laneIndex]?.map(
                    ({ item, bounds, top, height, placement }) => (
                      <SchedulingItemCard
                        key={item.id}
                        item={item}
                        lane={lane}
                        laneIndex={laneIndex}
                        lanes={lanes}
                        displayTimezone={displayTimezone}
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
        </div>
      </div>
    </section>
  );
}
