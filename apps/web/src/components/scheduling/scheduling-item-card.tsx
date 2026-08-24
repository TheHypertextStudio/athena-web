'use client';

import { DRAGGABLE } from '@docket/ui/lib/draggable';
import { type CSSProperties, type JSX, type RefObject, useId } from 'react';

import { useRelationDropTarget } from '@/components/dnd/use-relation-drop-target';

import {
  isScheduleItemEditable,
  scheduleItemEditCapabilities,
  type ScheduleItemLaneBounds,
} from './scheduling-date-lanes';
import { MINUTES_PER_DAY, minutesToPixels } from './scheduling-geometry';
import {
  scheduleOverlapHorizontalStyle,
  scheduleOverlapLeadingOffset,
  type ScheduleOverlapPlacement,
} from './scheduling-overlap-layout';
import { SchedulingItemBody } from './scheduling-item-body';
import { SchedulingGripIcon, SchedulingLinkIcon } from './scheduling-item-icons';
import { scheduleItemSurfacePalette } from './scheduling-item-surface';
import {
  SchedulingRelationshipSourceControl,
  SchedulingRelationshipTargetControl,
} from './scheduling-relationship-controls';
import { formatScheduleItemTimeRange, presentScheduleItemTimeRange } from './scheduling-time-label';
import type {
  ScheduleItem,
  ScheduleItemDensity,
  ScheduleLane,
  SchedulingCanvasProps,
} from './scheduling-types';
import { useSchedulingGesture } from './use-scheduling-gesture';
import type { SchedulingRelationshipMode } from './use-scheduling-relationship-mode';

const MINIMUM_PREVIEW_HEIGHT = 18;

/** Props for one timed item rendered inside a scheduling lane. */
export interface SchedulingItemCardProps {
  readonly item: ScheduleItem;
  readonly lane: ScheduleLane;
  readonly laneIndex: number;
  readonly lanes: readonly ScheduleLane[];
  readonly displayTimezone: string;
  readonly laneWidth: number;
  readonly gutterWidth: number;
  readonly pixelsPerHour: number;
  readonly snapMinutes: number;
  readonly bounds: ScheduleItemLaneBounds;
  readonly top: number;
  readonly height: number;
  readonly placement: ScheduleOverlapPlacement;
  readonly viewportRef: RefObject<HTMLElement | null>;
  readonly renderItem?: SchedulingCanvasProps['renderItem'];
  readonly renderItemAction?: SchedulingCanvasProps['renderItemAction'];
  readonly renderTimedItemDecoration?: SchedulingCanvasProps['renderTimedItemDecoration'];
  readonly onOpenItem?: SchedulingCanvasProps['onOpenItem'];
  readonly onMoveItem?: SchedulingCanvasProps['onMoveItem'];
  readonly onResizeItem?: SchedulingCanvasProps['onResizeItem'];
  readonly relationshipMode: SchedulingRelationshipMode;
  readonly onGestureAnnouncementChange: (announcement: string) => void;
}

/**
 * Choose how much card detail fits without obscuring adjacent times.
 *
 * @remarks
 * Width demotes a card only when it is **also short**. The old rule was `height < 48 || width <
 * 120`, from when a full-density title was a single `truncate`d line that genuinely needed 120px of
 * run. The title wraps now ({@link file://./scheduling-item-body.tsx}), so a tall narrow card has
 * somewhere to put the overflow and vertical room is the only thing full density actually needs.
 *
 * That `||` was what kept the rail truncating. A 280px rail leaves the lane ~216px, so any two
 * overlapping events split it into ~104px columns — under 120 — and a two-hour meeting with 96px of
 * empty fill beneath it rendered as one clipped line.
 */
function itemDensity(height: number, width: number): ScheduleItemDensity {
  if (height < 24) return 'marker';
  if (height < 48) return 'compact';
  if (width < 120 && height < 64) return 'compact';
  return 'full';
}

/** Render and gesture-wire one timed semantic surface without owning any persistence. */
export function SchedulingItemCard({
  item,
  lane,
  laneIndex,
  lanes,
  displayTimezone,
  laneWidth,
  gutterWidth,
  pixelsPerHour,
  snapMinutes,
  bounds,
  top,
  height,
  placement,
  viewportRef,
  renderItem,
  renderItemAction,
  renderTimedItemDecoration,
  onOpenItem,
  onMoveItem,
  onResizeItem,
  relationshipMode,
  onGestureAnnouncementChange,
}: SchedulingItemCardProps): JSX.Element {
  const readOnlyDescriptionId = useId();
  const relationTarget = useRelationDropTarget({
    target: item.object ?? {
      kind: 'calendar_event',
      id: item.id,
      organizationId: null,
      title: item.title,
    },
    disabled: item.dropTarget !== true || item.object === undefined,
  });
  const editable = isScheduleItemEditable(item, lane);
  const editCapabilities = scheduleItemEditCapabilities(item, lane, displayTimezone);
  const gesture = useSchedulingGesture({
    item,
    lane,
    laneIndex,
    lanes,
    laneWidth,
    gutterWidth,
    pixelsPerHour,
    snapMinutes,
    bounds,
    editable,
    viewportRef,
    onOpenItem: item.openable === false ? undefined : onOpenItem,
    onMoveItem: editCapabilities.canMove ? onMoveItem : undefined,
    onResizeItem:
      editCapabilities.canResizeStart || editCapabilities.canResizeEnd ? onResizeItem : undefined,
    presentPreviewTimeRange: (mode, preview) =>
      presentScheduleItemTimeRange({
        item,
        lane,
        laneIndex,
        lanes,
        displayTimezone,
        bounds,
        preview,
        previewMode: mode,
      }),
    onAnnouncementChange: onGestureAnnouncementChange,
  });
  const visibleBounds = gesture.preview ?? bounds;
  const visibleTop = gesture.preview
    ? minutesToPixels(visibleBounds.startMinutes, pixelsPerHour)
    : top;
  const visibleHeight = gesture.preview
    ? Math.max(
        MINIMUM_PREVIEW_HEIGHT,
        minutesToPixels(visibleBounds.endMinutes - visibleBounds.startMinutes, pixelsPerHour),
      )
    : height;
  const previewLane = gesture.preview ? lanes[gesture.preview.laneIndex] : undefined;
  const visibleLane = previewLane ?? lane;
  const visibleLaneIndex = previewLane && gesture.preview ? gesture.preview.laneIndex : laneIndex;
  const laneTranslation = (visibleLaneIndex - laneIndex) * laneWidth;
  const estimatedWidth = Math.max(0, laneWidth / placement.columnCount - 2);
  const density = itemDensity(visibleHeight, estimatedWidth);
  const startsAtDayBoundary = visibleBounds.startMinutes === 0;
  const endsAtDayBoundary = visibleBounds.endMinutes === MINUTES_PER_DAY;
  const resizeTargetClassName =
    'focus-visible:ring-ring absolute z-20 size-6 max-w-full cursor-ns-resize touch-none bg-transparent pointer-events-none outline-none group-focus-within:pointer-events-auto group-hover:pointer-events-auto focus-visible:ring-2 focus-visible:ring-inset [@media(pointer:coarse)]:size-11 [@media(pointer:coarse)]:pointer-events-auto';
  const resizeIndicatorClassName =
    'bg-(--schedule-item-foreground) pointer-events-none absolute h-0.5 w-3 max-w-full rounded-full opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none';
  const timeRange = formatScheduleItemTimeRange({
    item,
    lane,
    laneIndex,
    lanes,
    displayTimezone,
    bounds,
    preview: gesture.preview,
    previewMode: gesture.previewMode,
  });
  const content = renderItem?.({ item, lane, allDay: false, density }) ?? item.title;
  const action = renderItemAction?.({ item, lane, allDay: false, density }) ?? null;
  const decoration =
    renderTimedItemDecoration?.({
      item,
      lane: visibleLane,
      geometry: {
        laneIndex: visibleLaneIndex,
        bounds: visibleBounds,
        top: visibleTop,
        height: visibleHeight,
        laneWidth,
        leadingOffset: scheduleOverlapLeadingOffset(placement, laneWidth),
        pixelsPerHour,
      },
      placement: {
        columnIndex: placement.columnIndex,
        columnCount: placement.columnCount,
      },
    }) ?? null;
  const dragObject = item.object;
  const bodyOpenable = item.openable !== false;
  const bodyMovable = editCapabilities.canMove && onMoveItem !== undefined;
  const isRelationshipTarget = relationshipMode.isTarget(item);
  const appearance = item.appearance ?? 'event';
  const surfaceState =
    relationTarget.canDrop && relationTarget.isOver ? 'drop' : gesture.preview ? 'preview' : 'rest';
  const surfacePalette = scheduleItemSurfacePalette(appearance, item.color, surfaceState);
  const horizontalStyle = scheduleOverlapHorizontalStyle(placement);
  return (
    <article
      ref={relationTarget.dropProps.ref}
      // The visual surface stops one pixel before the item's exact geometry. Adjacent blocks keep
      // separate silhouettes without shrinking the hit targets or changing gesture math.
      className={`${DRAGGABLE} ${relationTarget.dropProps.className} isolate ${
        relationTarget.isOver
          ? 'ring-primary group absolute z-30 overflow-visible rounded-sm ring-2'
          : gesture.preview
            ? 'ring-primary group absolute z-40 overflow-visible rounded-sm ring-2'
            : 'group absolute z-10 overflow-visible rounded-sm focus-within:z-20 hover:z-20'
      }`}
      data-item-density={density}
      data-drop-state={relationTarget.dropState}
      data-layout-column={placement.columnIndex}
      data-layout-column-count={placement.columnCount}
      data-schedule-item={item.id}
      data-schedule-item-appearance={appearance}
      data-gesture-preview={gesture.preview ? gesture.previewMode : undefined}
      style={
        {
          top: visibleTop,
          ...horizontalStyle,
          height: visibleHeight,
          transform: laneTranslation === 0 ? undefined : `translateX(${String(laneTranslation)}px)`,
          '--schedule-item-fill': surfacePalette.fill,
          '--schedule-item-foreground': surfacePalette.foreground,
          '--schedule-item-focus': surfacePalette.focusIndicator,
          '--color-ring': surfacePalette.focusIndicator,
        } as CSSProperties
      }
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-0 top-0 bottom-px -z-20 rounded-sm transition-colors motion-reduce:transition-none ${
          surfaceState !== 'rest' || appearance === 'event'
            ? ''
            : appearance === 'timebox'
              ? 'border-outline border border-dashed'
              : 'border-outline-variant border'
        }`}
        data-schedule-item-surface=""
        style={{
          backgroundColor: 'var(--schedule-item-fill)',
          borderLeftColor:
            surfaceState === 'rest' && appearance === 'timebox'
              ? 'var(--color-outline)'
              : undefined,
        }}
      />
      {decoration === null ? null : (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 bottom-px -z-10 overflow-visible rounded-sm"
          data-schedule-item-decoration=""
          inert
        >
          {decoration}
        </div>
      )}
      <div
        className="contents"
        data-schedule-relationship-covered=""
        inert={isRelationshipTarget ? true : undefined}
      >
        {editCapabilities.canResizeStart && onResizeItem ? (
          <button
            type="button"
            aria-label={`Resize ${item.title} from start`}
            className={`${resizeTargetClassName} left-0 ${startsAtDayBoundary ? 'top-0' : '-top-3 [@media(pointer:coarse)]:-top-8'}`}
            data-schedule-resize-target="start"
            onPointerDown={gesture.onStartResizePointerDown}
            onKeyDown={gesture.onStartResizeKeyDown}
          >
            <span
              aria-hidden="true"
              className={`${resizeIndicatorClassName} right-0 ${startsAtDayBoundary ? 'top-0' : 'bottom-2.5'}`}
              data-schedule-resize-indicator="start"
            />
          </button>
        ) : null}
        <SchedulingItemBody
          item={item}
          density={density}
          height={visibleHeight}
          timeRange={timeRange}
          content={content}
          readOnlyDescriptionId={readOnlyDescriptionId}
          editable={editable}
          openable={bodyOpenable}
          movable={bodyMovable}
          onPointerDown={gesture.onBodyPointerDown}
          onClick={gesture.onBodyClick}
        />
        {/* The `id` sits on the text, not on the icon's box: `aria-describedby` should resolve to
            the words alone, and a query for those words should land on the described element. */}
        {!editable && item.readOnlyLabel ? (
          <span id={readOnlyDescriptionId} className="sr-only">
            {item.readOnlyLabel}
          </span>
        ) : null}
        {editCapabilities.canMove && onMoveItem ? (
          <button
            type="button"
            aria-label={`Move ${item.title}`}
            className="focus-visible:ring-ring absolute top-0.5 right-0.5 z-30 size-6 cursor-grab rounded text-(--schedule-item-foreground) opacity-0 transition-[color,opacity] outline-none group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:ring-2 focus-visible:ring-inset active:cursor-grabbing motion-reduce:transition-none [@media(pointer:coarse)]:size-11"
            onPointerDown={gesture.onMovePointerDown}
            onKeyDown={gesture.onMoveKeyDown}
          >
            <SchedulingGripIcon />
          </button>
        ) : null}
        {dragObject ? (
          <SchedulingRelationshipSourceControl
            item={item}
            object={dragObject}
            mode={relationshipMode}
            className="focus-visible:ring-ring absolute bottom-0.5 left-0.5 z-30 size-6 cursor-grab rounded transition-[color,opacity] outline-none focus-visible:ring-2 focus-visible:ring-inset motion-reduce:transition-none [@media(pointer:coarse)]:size-11"
            activeClassName="bg-primary-container text-on-primary-container ring-primary/40 opacity-100 ring-2 [--color-ring:var(--color-on-primary-container)]"
            inactiveClassName="text-(--schedule-item-foreground) opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
          >
            <SchedulingLinkIcon />
          </SchedulingRelationshipSourceControl>
        ) : null}
        {action ? (
          <div
            className="absolute right-0.5 bottom-0.5 z-30 flex size-6 items-center justify-center opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 motion-reduce:transition-none [@media(pointer:coarse)]:size-11"
            data-schedule-item-action=""
            // The move handle and relationship-source control each stop their own pointerdown
            // (see `beginSchedulingPointerSession`) so it never bubbles to the lane's
            // `onPointerDown`, which would otherwise arm a region-selection drag underneath a
            // plain click on this control. Mirror that guard here rather than relying on this
            // wrapper's sibling position alone, since — unlike the body's own drag-start
            // handler — the lane's pointerdown listener sits on an ancestor of this control.
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
          >
            {action}
          </div>
        ) : null}
        {editCapabilities.canResizeEnd && onResizeItem ? (
          <button
            type="button"
            aria-label={`Resize ${item.title} from end`}
            className={`${resizeTargetClassName} right-0 ${endsAtDayBoundary ? 'bottom-0' : '-bottom-3 [@media(pointer:coarse)]:-bottom-8'}`}
            data-schedule-resize-target="end"
            onPointerDown={gesture.onEndResizePointerDown}
            onKeyDown={gesture.onEndResizeKeyDown}
          >
            <span
              aria-hidden="true"
              className={`${resizeIndicatorClassName} left-0 ${endsAtDayBoundary ? 'bottom-0' : 'top-2.5'}`}
              data-schedule-resize-indicator="end"
            />
          </button>
        ) : null}
      </div>
      <SchedulingRelationshipTargetControl
        item={item}
        lane={lane}
        mode={relationshipMode}
        className="ring-primary/70 focus-visible:ring-ring bg-primary/5 absolute inset-0 z-50 cursor-pointer rounded-md ring-2 outline-none ring-inset focus-visible:ring-4"
      />
      {relationTarget.isOver && relationTarget.effectLabel ? (
        <span className="bg-primary text-on-primary pointer-events-none absolute inset-x-1 top-1/2 z-[60] -translate-y-1/2 rounded px-2 py-1 text-center text-xs font-medium">
          {relationTarget.effectLabel}
        </span>
      ) : null}
    </article>
  );
}
