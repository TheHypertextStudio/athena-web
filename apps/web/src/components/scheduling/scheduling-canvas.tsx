'use client';

import { useMediaQuery } from '@docket/ui/hooks';
import {
  type CSSProperties,
  type JSX,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { SchedulingCanvasHeader } from './scheduling-canvas-header';
import { SchedulingCanvasNotice } from './scheduling-canvas-notice';
import { arrangeDenseScheduleItems } from './scheduling-dense-overflow';
import { SchedulingDenseOverflow } from './scheduling-dense-overflow-ui';
import { readScheduleDragObject, SCHEDULE_DRAG_MIME } from './scheduling-drag-object';
import { deriveSnapMinutes, pixelsToMinutes } from './scheduling-geometry';
import { deriveInitialScheduleScrollMinutes } from './scheduling-initial-scroll';
import { SchedulingItemCard } from './scheduling-item-card';
import { positionScheduleLaneItems } from './scheduling-overlap-layout';
import { presentSchedulingRegion, SchedulingRegionPreview } from './scheduling-region-preview';
import { scheduleWallPositionForInstant } from './scheduling-time-axis';
import { SchedulingTimeGrid } from './scheduling-time-grid';
import type { ScheduleRegionSelection, SchedulingCanvasProps } from './scheduling-types';
import { useSchedulingDensePromotion } from './use-scheduling-dense-promotion';
import { useSchedulingRegionSelection } from './use-scheduling-region-selection';
import { useSchedulingRelationshipMode } from './use-scheduling-relationship-mode';
import { useSchedulingViewport } from './use-scheduling-viewport';
export type { ScheduleItemRenderContext, SchedulingCanvasProps } from './scheduling-types';
const MINIMUM_LANE_WIDTH = 220;
const MINIMUM_INTERACTIVE_PIXELS = 18;
const MINIMUM_COARSE_POINTER_PIXELS = 40;
/**
 * Wheel delta that corresponds to one e-fold of zoom.
 *
 * @remarks
 * A macOS trackpad pinch arrives as `ctrlKey` wheel events of a few pixels each; dividing by 180
 * makes a full two-finger spread land near a 2x change without any single event feeling jumpy.
 */
const ZOOM_GESTURE_DELTA_SCALE = 180;
/** Render a 24-hour fluid grid while consumers own data, persistence, and policy. */
export default function SchedulingCanvas({
  displayTimezone,
  lanes,
  pixelsPerHour,
  now,
  viewportWidth,
  viewportHeight,
  minimumLaneWidth = MINIMUM_LANE_WIDTH,
  gutterSlot,
  initialLaneIndex = 0,
  horizontalAnchorKey,
  initialScrollMinutes,
  onViewportGeometry,
  onVisibleLaneRange,
  onReachBoundary,
  error,
  emptyMessage = 'Nothing scheduled.',
  emptyAction,
  renderItem,
  renderItemAction,
  selectedRegion,
  selectedRegionAnchorRef,
  onSelectRegion,
  onOpenItem,
  onMoveItem,
  onResizeItem,
  onMoveAllDayItem,
  onResizeAllDayItem,
  onDropObjectOnItem,
  onDropObjectOnGrid,
  onZoomGesture,
}: SchedulingCanvasProps): JSX.Element {
  const [gestureAnnouncement, setGestureAnnouncement] = useState('');
  // The sticky lane header covers the top of the scrollport, so an item that has scrolled partly
  // out of view has to pin its title below the header rather than under it. Measured (the header
  // grows with all-day items) and published as a CSS variable the item bodies consume.
  const headerRef = useRef<HTMLElement | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useEffect(() => {
    const node = headerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setHeaderHeight(Math.round(entry.contentRect.height));
    });
    observer.observe(node);
    setHeaderHeight(Math.round(node.getBoundingClientRect().height));
    return () => {
      observer.disconnect();
    };
  }, []);
  const usesCoarsePointer = useMediaQuery('(pointer: coarse)');
  const minimumInteractivePixels = usesCoarsePointer
    ? MINIMUM_COARSE_POINTER_PIXELS
    : MINIMUM_INTERACTIVE_PIXELS;
  const effectivePixelsPerHour = Math.max(1, pixelsPerHour);
  const snapMinutes = deriveSnapMinutes(effectivePixelsPerHour);
  const resolvedInitialScrollMinutes = deriveInitialScheduleScrollMinutes({
    initialScrollMinutes,
    now,
    displayTimezone,
    lanes,
  });
  const { viewportRef, timedGridRef, observedWidth, geometry, axis, captureZoomAnchor, onScroll } =
    useSchedulingViewport({
      lanes,
      pixelsPerHour: effectivePixelsPerHour,
      viewportWidth,
      minimumLaneWidth,
      initialLaneIndex,
      horizontalAnchorKey,
      initialScrollMinutes: resolvedInitialScrollMinutes,
      onViewportGeometry,
      onVisibleLaneRange,
      onReachBoundary,
    });
  // Trackpad pinch / ctrl+wheel zoom. React's synthetic `onWheel` is attached passively at the
  // root, so it cannot cancel the browser's own page zoom — the listener has to be registered
  // manually with `{ passive: false }`. The canvas emits raw multiplicative intent only; the
  // consumer owns clamping, rounding, and persistence.
  useEffect(() => {
    const node = viewportRef.current;
    if (!node || !onZoomGesture) return;
    const onWheel = (event: WheelEvent): void => {
      // macOS reports a trackpad pinch as a wheel event with `ctrlKey` set, and no pinch gesture
      // ever produces a plain wheel — so this one test covers pinch and ctrl/⌘+wheel alike.
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      captureZoomAnchor(event.clientY);
      onZoomGesture(Math.exp(-event.deltaY / ZOOM_GESTURE_DELTA_SCALE));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      node.removeEventListener('wheel', onWheel);
    };
  }, [captureZoomAnchor, onZoomGesture, viewportRef]);
  const relationshipMode = useSchedulingRelationshipMode({
    viewportRef,
    onDropObjectOnItem,
    onAnnouncementChange: setGestureAnnouncement,
  });
  const densePromotion = useSchedulingDensePromotion({
    viewportRef,
    relationshipTargeting: relationshipMode.source !== null,
    onAnnouncementChange: setGestureAnnouncement,
  });
  const commitRegionSelection = useCallback(
    (selection: ScheduleRegionSelection): void => {
      const presentation = presentSchedulingRegion({
        ...selection,
        displayTimezone,
      });
      setGestureAnnouncement(presentation.announcement);
      if (presentation.valid) onSelectRegion?.(selection);
    },
    [displayTimezone, onSelectRegion],
  );
  const regionSelection = useSchedulingRegionSelection({
    lanes,
    pixelsPerHour: effectivePixelsPerHour,
    snapMinutes,
    viewportRef,
    onSelectRegion: onSelectRegion ? commitRegionSelection : undefined,
  });
  const regionPresentation = useMemo(() => {
    const preview = regionSelection.preview;
    const lane = preview ? lanes.find((candidate) => candidate.id === preview.laneId) : undefined;
    return preview && lane ? presentSchedulingRegion({ ...preview, lane, displayTimezone }) : null;
  }, [displayTimezone, lanes, regionSelection.preview]);
  const selectedRegionPresentation = useMemo(() => {
    if (!selectedRegion) return null;
    const lane = lanes.find((candidate) => candidate.id === selectedRegion.lane.id);
    return lane
      ? presentSchedulingRegion({
          lane,
          startMinutes: selectedRegion.startMinutes,
          endMinutes: selectedRegion.endMinutes,
          displayTimezone,
        })
      : null;
  }, [displayTimezone, lanes, selectedRegion]);
  const fullWidth = geometry.gutterWidth + geometry.contentWidth;
  const todayDate = now
    ? (scheduleWallPositionForInstant(now, displayTimezone)?.date ?? undefined)
    : undefined;
  const arrangedLaneItems = useMemo(
    () =>
      lanes.map((lane) =>
        arrangeDenseScheduleItems(
          positionScheduleLaneItems(
            lane,
            displayTimezone,
            effectivePixelsPerHour,
            minimumInteractivePixels,
          ),
          geometry.laneWidth,
          {
            promotedItemId:
              densePromotion.promotion?.laneId === lane.id
                ? densePromotion.promotion.itemId
                : undefined,
          },
        ),
      ),
    [
      densePromotion.promotion,
      displayTimezone,
      effectivePixelsPerHour,
      geometry.laneWidth,
      lanes,
      minimumInteractivePixels,
    ],
  );
  return (
    <section
      ref={viewportRef}
      aria-label="Schedule"
      // No outer border: the tonal step from the page canvas onto `bg-surface` carries the
      // separation, exactly as the shell's own panels do.
      //
      // Deliberately NOT a scroll-snap container, though a day is exactly the kind of indivisible
      // unit `scroll-snap-type: x` exists for. This scrollport is a direct-manipulation surface: a
      // resize grip is grabbed by scrolling it into view, measuring its box, and pressing on that
      // point. A snap — mandatory *or* proximity — is applied a frame after that programmatic
      // scroll, which moves the grip out from under the pointer and drops the gesture. Both
      // variants were tried and both broke `fluid-scheduling-gestures`. Lane alignment is instead
      // guaranteed where it is actually decided, in `use-scheduling-viewport`'s horizontal anchor:
      // every rendered scroll position is a whole number of lanes, measured across 162 widths.
      className={`bg-surface relative overflow-auto overscroll-contain rounded-xl ${viewportHeight === undefined ? 'h-[clamp(20rem,68dvh,48rem)]' : ''}`}
      style={
        {
          '--schedule-sticky-top': `${String(headerHeight)}px`,
          ...(viewportHeight === undefined ? {} : { height: viewportHeight }),
        } as CSSProperties
      }
      data-lane-count={lanes.length}
      data-visible-lane-count={geometry.visibleLaneCount}
      data-snap-minutes={snapMinutes}
      onScroll={onScroll}
    >
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {regionPresentation?.announcement ?? gestureAnnouncement}
      </p>
      <div className="min-w-full" style={{ width: fullWidth }}>
        <SchedulingCanvasHeader
          headerRef={headerRef}
          lanes={lanes}
          displayTimezone={displayTimezone}
          todayDate={todayDate}
          viewportRef={viewportRef}
          compact={axis.labelStyle === 'hour'}
          gutterSlot={gutterSlot}
          gutterWidth={geometry.gutterWidth}
          contentWidth={geometry.contentWidth}
          laneWidth={geometry.laneWidth}
          renderItem={renderItem}
          onOpenItem={onOpenItem}
          onMoveAllDayItem={onMoveAllDayItem}
          onResizeAllDayItem={onResizeAllDayItem}
          onDropObjectOnItem={onDropObjectOnItem}
          relationshipMode={relationshipMode}
          onGestureAnnouncementChange={setGestureAnnouncement}
        />
        <div ref={timedGridRef} className="relative">
          <SchedulingTimeGrid
            lanes={lanes}
            displayTimezone={displayTimezone}
            pixelsPerHour={effectivePixelsPerHour}
            labelStyle={axis.labelStyle}
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
                  // A single hairline between lanes, and none after the last one — the separator
                  // exists to divide days, not to draw a box around the grid.
                  className={`relative shrink-0 touch-none ${laneIndex === lanes.length - 1 ? '' : 'border-outline-variant/30 border-r'}`}
                  data-schedule-lane={lane.id}
                  style={{ width: geometry.laneWidth, height: 24 * effectivePixelsPerHour }}
                  onPointerDown={(event) => {
                    if (event.target === event.currentTarget) setGestureAnnouncement('');
                    regionSelection.onPointerDown(lane, event);
                  }}
                  onClickCapture={regionSelection.onClickCapture}
                  // Accept a native drag object dropped onto empty grid time and schedule it there.
                  // Drops onto an item are handled by the card (which stops propagation), so this
                  // fires only for empty-time drops.
                  onDragOver={
                    onDropObjectOnGrid
                      ? (event) => {
                          if (!event.dataTransfer.types.includes(SCHEDULE_DRAG_MIME)) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'copy';
                        }
                      : undefined
                  }
                  onDrop={
                    onDropObjectOnGrid
                      ? (event) => {
                          const object = readScheduleDragObject(event.dataTransfer);
                          if (!object) return;
                          event.preventDefault();
                          const rect = event.currentTarget.getBoundingClientRect();
                          const startMinutes = pixelsToMinutes(
                            event.clientY - rect.top,
                            effectivePixelsPerHour,
                            snapMinutes,
                          );
                          onDropObjectOnGrid({ object, lane, startMinutes });
                        }
                      : undefined
                  }
                >
                  {selectedRegion?.lane.id === lane.id && selectedRegionPresentation ? (
                    <SchedulingRegionPreview
                      laneId={lane.id}
                      startMinutes={selectedRegion.startMinutes}
                      endMinutes={selectedRegion.endMinutes}
                      pixelsPerHour={effectivePixelsPerHour}
                      presentation={selectedRegionPresentation}
                      state="selected"
                      anchorRef={selectedRegionAnchorRef}
                    />
                  ) : null}
                  {regionSelection.preview?.laneId === lane.id && regionPresentation ? (
                    <SchedulingRegionPreview
                      laneId={lane.id}
                      startMinutes={regionSelection.preview.startMinutes}
                      endMinutes={regionSelection.preview.endMinutes}
                      pixelsPerHour={effectivePixelsPerHour}
                      presentation={regionPresentation}
                    />
                  ) : null}
                  {arrangedLaneItems[laneIndex]?.directItems.map(
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
                        renderItemAction={renderItemAction}
                        onOpenItem={onOpenItem}
                        onMoveItem={onMoveItem}
                        onResizeItem={onResizeItem}
                        onDropObjectOnItem={onDropObjectOnItem}
                        relationshipMode={relationshipMode}
                        onGestureAnnouncementChange={setGestureAnnouncement}
                      />
                    ),
                  )}
                  {arrangedLaneItems[laneIndex]?.overflowGroups.map((group) => (
                    <SchedulingDenseOverflow
                      key={`${group.clusterId}:overflow`}
                      group={group}
                      lane={lane}
                      displayTimezone={displayTimezone}
                      renderItem={renderItem}
                      onOpenItem={onOpenItem}
                      onRevealItem={densePromotion.revealItem}
                    />
                  ))}
                </div>
              ))}
            </div>
          </SchedulingTimeGrid>
        </div>
        {/* Last flow child so `sticky bottom-0` rides the visible bottom edge at every scroll
            position; its own height is cancelled by the notice's negative margin. */}
        <SchedulingCanvasNotice
          emptyMessage={emptyMessage}
          emptyAction={emptyAction}
          error={error}
          isEmpty={lanes.every((lane) => lane.items.length === 0)}
          viewportWidth={viewportWidth ?? observedWidth}
        />
      </div>
    </section>
  );
}
