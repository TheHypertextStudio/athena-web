'use client';

import { useMediaQuery } from '@docket/ui/hooks';
import { type JSX, useCallback, useMemo, useState } from 'react';

import { SchedulingCanvasHeader } from './scheduling-canvas-header';
import { arrangeDenseScheduleItems } from './scheduling-dense-overflow';
import { SchedulingDenseOverflow } from './scheduling-dense-overflow-ui';
import { deriveSnapMinutes } from './scheduling-geometry';
import { deriveInitialScheduleScrollMinutes } from './scheduling-initial-scroll';
import { SchedulingItemCard } from './scheduling-item-card';
import { positionScheduleLaneItems } from './scheduling-overlap-layout';
import { presentSchedulingRegion, SchedulingRegionPreview } from './scheduling-region-preview';
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
/** Render a 24-hour fluid grid while consumers own data, persistence, and policy. */
export default function SchedulingCanvas({
  displayTimezone,
  lanes,
  pixelsPerHour,
  now,
  viewportWidth,
  viewportHeight,
  minimumLaneWidth = MINIMUM_LANE_WIDTH,
  initialLaneIndex = 0,
  horizontalAnchorKey,
  initialScrollMinutes,
  onViewportGeometry,
  onVisibleLaneRange,
  onReachBoundary,
  error,
  emptyMessage = 'Nothing scheduled.',
  renderItem,
  selectedRegion,
  selectedRegionAnchorRef,
  onSelectRegion,
  onOpenItem,
  onMoveItem,
  onResizeItem,
  onMoveAllDayItem,
  onResizeAllDayItem,
  onDropObjectOnItem,
}: SchedulingCanvasProps): JSX.Element {
  const [gestureAnnouncement, setGestureAnnouncement] = useState('');
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
  const { viewportRef, timedGridRef, observedWidth, geometry, onScroll } = useSchedulingViewport({
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
      className={`border-outline-variant bg-surface relative overflow-auto overscroll-contain rounded-xl border ${viewportHeight === undefined ? 'h-[clamp(20rem,68dvh,48rem)]' : ''}`}
      style={viewportHeight === undefined ? undefined : { height: viewportHeight }}
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
          lanes={lanes}
          displayTimezone={displayTimezone}
          viewportRef={viewportRef}
          gutterWidth={geometry.gutterWidth}
          contentWidth={geometry.contentWidth}
          laneWidth={geometry.laneWidth}
          viewportWidth={viewportWidth ?? observedWidth}
          emptyMessage={emptyMessage}
          error={error}
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
                    if (event.target === event.currentTarget) setGestureAnnouncement('');
                    regionSelection.onPointerDown(lane, event);
                  }}
                  onClickCapture={regionSelection.onClickCapture}
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
      </div>
    </section>
  );
}
