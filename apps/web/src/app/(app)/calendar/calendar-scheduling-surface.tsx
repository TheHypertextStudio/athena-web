'use client';

import type { CalendarItemOut } from '@docket/types';
import { type JSX, useCallback, useEffect } from 'react';

import {
  useCreateCalendarItem,
  useLinkTaskToCalendarItem,
  useRelateCalendarItems,
  useUpdateCalendarItemById,
} from '@/components/calendar/calendar-mutations';
import { containedTaskLink } from '@/components/calendar/calendar-item-task-link';
import {
  resolveScheduleWallInstant,
  type ScheduleItem,
  type ScheduleItemMove,
  type ScheduleItemResize,
  type ScheduleLane,
  type ScheduleObjectGridDrop,
  type ScheduleRegionSelection,
  SchedulingCanvas,
} from '@/components/scheduling';
import { TaskTimerButton } from '@/components/time-tracking';

import {
  calendarAllDayBounds,
  movedCalendarItemBounds,
  resizedCalendarItemBounds,
} from './calendar-schedule-editing';
import type { CalendarSchedulingSurfaceProps } from './calendar-scheduling-contract';
import {
  calendarSchedulingEmptyMessage,
  calendarSchedulingError,
} from './calendar-scheduling-copy';
import { CalendarScheduleItemContent } from './calendar-schedule-item-content';

export type {
  CalendarCanvasRegionSelection,
  CalendarSchedulingSurfaceProps,
} from './calendar-scheduling-contract';

const RELATIONSHIP_TARGET_KINDS: ReadonlySet<CalendarItemOut['kind']> = new Set([
  'provider_event',
  'native_event',
  'native_block',
  'timebox',
]);

/** Default length of a timebox created by dropping a task onto empty grid time. */
const DROPPED_TASK_TIMEBOX_MINUTES = 30;
/** Minutes in a day — clamps a dropped timebox so it never spills past midnight. */
const MINUTES_PER_DAY = 24 * 60;

/**
 * Render the always-mounted scheduling grid and translate gestures into calendar mutations.
 *
 * @remarks
 * Error and empty states remain overlays owned by the canvas, so service failures never replace
 * the basic time grid.
 *
 * The surface is a single flex column with exactly one growing child — the canvas — and an
 * unbroken `flex-1` + `min-h-0` chain from the page root down to `<section aria-label="Schedule">`.
 * The shared canvas is the only scroll owner, so its host must shrink to the shell's available
 * height. Read failures stay inside the canvas overlay, and provider sync state never changes the
 * schedule's geometry. Layer controls deliberately live in the toolbar's popover rather than in
 * a permanent side column: a 16rem column that usually rendered "No calendar layers yet." was
 * costing the schedule a fifth of its width at exactly the widths where it had least to spare.
 */
export function CalendarSchedulingSurface({
  axis,
  visibleLaneCount,
  horizontalAnchorKey = 0,
  pixelsPerHour,
  displayTimezone,
  now,
  dateAxis,
  peopleAxis,
  workLocationComposition,
  selectedRegion,
  selectedRegionAnchorRef,
  onVisibleLaneCountChange,
  onVisibleDateRangeChange,
  onReachBoundary,
  onSelectRegion,
  onOpenItem,
  onOpenSharedItem,
  onZoomGesture,
}: CalendarSchedulingSurfaceProps): JSX.Element {
  const updateItem = useUpdateCalendarItemById();
  const linkTask = useLinkTaskToCalendarItem();
  const relateItems = useRelateCalendarItems();
  const createItem = useCreateCalendarItem();
  const resetUpdateItem = updateItem.reset;
  const resetLinkTask = linkTask.reset;
  const resetRelateItems = relateItems.reset;
  const inlineMutationFailed = updateItem.isError || linkTask.isError || relateItems.isError;
  const clearInlineFailures = useCallback(() => {
    resetUpdateItem();
    resetLinkTask();
    resetRelateItems();
  }, [resetLinkTask, resetRelateItems, resetUpdateItem]);
  useEffect(() => {
    clearInlineFailures();
  }, [
    axis,
    clearInlineFailures,
    dateAxis.windowLaneCount,
    dateAxis.windowStartDate,
    displayTimezone,
    peopleAxis.comparisonOrgId,
  ]);

  const persistExactBounds = (itemId: string, startsAt: string, endsAt: string): void => {
    clearInlineFailures();
    updateItem.mutate({
      itemId,
      patch: { startsAt, endsAt },
    });
  };
  const persistAllDayBounds = (itemId: string, startDate: string, endDate: string): void => {
    const patch = calendarAllDayBounds(dateAxis.itemById.get(itemId), startDate, endDate);
    if (!patch) return;
    clearInlineFailures();
    updateItem.mutate({ itemId, patch });
  };
  const resolveWallInstant = (date: string, minutes: number): string | null => {
    const resolution = resolveScheduleWallInstant(date, minutes, displayTimezone);
    return resolution.kind === 'resolved' ? resolution.instant : null;
  };
  const moveBounds = (itemId: string, date: string, startMinutes: number): void => {
    const moved = movedCalendarItemBounds(
      dateAxis.itemById.get(itemId),
      date,
      startMinutes,
      displayTimezone,
    );
    if (!moved) return;
    persistExactBounds(itemId, moved.startsAt, moved.endsAt);
  };
  const resizeBounds = (
    item: ScheduleItem,
    lane: ScheduleLane,
    edge: 'start' | 'end',
    startMinutes: number,
    endMinutes: number,
  ): void => {
    const resized = resizedCalendarItemBounds({
      source: dateAxis.itemById.get(item.id),
      item,
      lane,
      edge,
      startMinutes,
      endMinutes,
      displayTimezone,
    });
    if (!resized) return;
    persistExactBounds(item.id, resized.startsAt, resized.endsAt);
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div data-calendar-canvas-host="" className="min-h-0 min-w-0 flex-1">
        <SchedulingCanvas
          displayTimezone={displayTimezone}
          lanes={axis === 'dates' ? dateAxis.lanes : peopleAxis.lanes}
          pixelsPerHour={pixelsPerHour}
          now={now}
          viewportHeight="100%"
          minimumLaneWidth={144}
          maximumVisibleLaneCount={7}
          {...(axis === 'dates' ? workLocationComposition?.canvasProps : {})}
          initialLaneIndex={axis === 'dates' ? dateAxis.initialLaneIndex : 0}
          horizontalAnchorKey={axis === 'dates' ? horizontalAnchorKey : undefined}
          selectedRegion={selectedRegion}
          selectedRegionAnchorRef={selectedRegionAnchorRef}
          error={calendarSchedulingError(
            axis,
            inlineMutationFailed,
            dateAxis.itemsError || dateAxis.layersError,
            peopleAxis.error,
          )}
          emptyMessage={calendarSchedulingEmptyMessage(
            axis,
            dateAxis.itemsPending,
            peopleAxis.comparisonPending,
            peopleAxis.selectedActorIds.length,
          )}
          onViewportGeometry={({ visibleLaneCount: next }) => {
            if (axis === 'dates' && next > 0 && next !== visibleLaneCount) {
              onVisibleLaneCountChange(next);
            }
          }}
          onVisibleLaneRange={({ startLane, endLane }) => {
            if (axis === 'dates') {
              onVisibleDateRangeChange({
                startDate: startLane.date,
                endDate: endLane.date,
              });
            }
          }}
          onOpenItem={({ item }: { item: ScheduleItem }) => {
            if (axis === 'people') {
              const detail = peopleAxis.detailByItemId.get(item.id);
              if (detail) onOpenSharedItem(detail);
              return;
            }
            onOpenItem(item.id);
          }}
          {...(axis === 'dates'
            ? {
                onReachBoundary,
                onSelectRegion: (canvasRegion: ScheduleRegionSelection) => {
                  const { lane, startMinutes, endMinutes } = canvasRegion;
                  const startsAt = resolveWallInstant(lane.date, startMinutes);
                  const endsAt = resolveWallInstant(lane.date, endMinutes);
                  if (!startsAt || !endsAt) return;
                  onSelectRegion({
                    startsAt,
                    endsAt,
                    canvasRegion,
                  });
                },
                onMoveItem: ({ item, toLane, startMinutes }: ScheduleItemMove) => {
                  if (toLane.editable === false) return;
                  moveBounds(item.id, toLane.date, startMinutes);
                },
                onResizeItem: ({
                  item,
                  lane,
                  edge,
                  startMinutes,
                  endMinutes,
                }: ScheduleItemResize) => {
                  if (lane.editable === false) return;
                  resizeBounds(item, lane, edge, startMinutes, endMinutes);
                },
                onMoveAllDayItem: ({ item, startDate, endDate }) => {
                  persistAllDayBounds(item.id, startDate, endDate);
                },
                onResizeAllDayItem: ({ item, startDate, endDate }) => {
                  persistAllDayBounds(item.id, startDate, endDate);
                },
                // Drop a task from the rail onto empty grid time: create a timebox at that
                // moment titled after the task, then link the task into it.
                onDropObjectOnGrid: ({ object, lane, startMinutes }: ScheduleObjectGridDrop) => {
                  if (object.kind !== 'task') return;
                  const endMinutes = Math.min(
                    startMinutes + DROPPED_TASK_TIMEBOX_MINUTES,
                    MINUTES_PER_DAY,
                  );
                  const startsAt = resolveWallInstant(lane.date, startMinutes);
                  const endsAt = resolveWallInstant(lane.date, endMinutes);
                  if (!startsAt || !endsAt) return;
                  clearInlineFailures();
                  createItem.mutate(
                    { intent: 'timebox', title: object.title, startsAt, endsAt },
                    {
                      onSuccess: (created) => {
                        linkTask.mutate({
                          itemId: created.id,
                          taskId: object.taskId,
                          organizationId: object.organizationId,
                          role: 'contained',
                        });
                      },
                    },
                  );
                },
              }
            : {})}
          renderItem={({ item, density }) => {
            const source = dateAxis.itemById.get(item.id);
            return source ? (
              <CalendarScheduleItemContent item={source} density={density} />
            ) : (
              item.title
            );
          }}
          // The start-timer affordance that lets a timer be started for any task, directly from
          // that task, on the live calendar timeline. `CalendarItemCard`
          // (which already grows a `TaskTimerButton` for a task-shaped item) is never mounted by
          // this surface — the real timeline renders through `SchedulingCanvas` — so the control
          // has to reach the item card through this opt-in extension point instead. Scoped to the
          // calendar surface only: the agenda view shares this same canvas and deliberately leaves
          // `renderItemAction` unset.
          renderItemAction={({ item }) => {
            const source = dateAxis.itemById.get(item.id);
            if (!source) return null;
            const timeboxedTask = containedTaskLink(source);
            if (!timeboxedTask) return null;
            return (
              <TaskTimerButton
                taskId={timeboxedTask.taskId}
                title={timeboxedTask.title}
                controlSize="xs"
                withLabel={false}
              />
            );
          }}
          onDropObjectOnItem={({ object, targetItem }) => {
            const target = dateAxis.itemById.get(targetItem.id);
            if (!target || !RELATIONSHIP_TARGET_KINDS.has(target.kind)) return;
            if (object.kind === 'calendar_item' && object.itemId === target.id) return;
            clearInlineFailures();
            const role = target.kind === 'timebox' ? 'contained' : 'related';
            if (object.kind === 'task') {
              linkTask.mutate({
                itemId: target.id,
                taskId: object.taskId,
                organizationId: object.organizationId,
                role,
              });
            } else {
              relateItems.mutate({
                sourceItemId: target.id,
                targetItemId: object.itemId,
                role,
              });
            }
          }}
          onZoomGesture={onZoomGesture}
        />
        {axis === 'dates' ? workLocationComposition?.overlays : null}
      </div>
    </div>
  );
}
