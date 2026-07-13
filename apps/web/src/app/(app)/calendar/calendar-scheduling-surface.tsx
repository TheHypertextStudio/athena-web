'use client';

import type { CalendarItemOut, CalendarPreferences } from '@docket/types';
import { type JSX, useCallback, useEffect } from 'react';

import CalendarLayerPanel from '@/components/calendar/calendar-layer-panel';
import {
  useLinkTaskToCalendarItem,
  useRelateCalendarItems,
  useUpdateCalendarItemById,
} from '@/components/calendar/calendar-mutations';
import type { CalendarRegionSelection } from '@/components/calendar/create-block-form';
import {
  isInlineEditableScheduleItem,
  type ScheduleItem,
  type ScheduleItemMove,
  type ScheduleItemResize,
  scheduleInstantAt,
  SchedulingCanvas,
} from '@/components/scheduling';

import { canPersistCalendarItemBounds, type CalendarAxis } from './calendar-schedule-model';
import type { CalendarDateAxisState } from './use-calendar-date-axis';
import type { CalendarPeopleAxisState } from './use-calendar-people-axis';

const INLINE_UPDATE_FAILURE_COPY =
  'Could not update this item. Your previous time has been restored.';
const RELATIONSHIP_TARGET_KINDS: ReadonlySet<CalendarItemOut['kind']> = new Set([
  'provider_event',
  'native_event',
  'native_block',
  'timebox',
]);

/** Props for the shared canvas and its axis-specific status/sidebar affordances. */
export interface CalendarSchedulingSurfaceProps {
  readonly axis: CalendarAxis;
  readonly visibleLaneCount: number;
  readonly pixelsPerHour: number;
  readonly displayTimezone: string;
  readonly now?: string;
  readonly preferences?: CalendarPreferences;
  readonly dateAxis: CalendarDateAxisState;
  readonly peopleAxis: CalendarPeopleAxisState;
  readonly onVisibleLaneCountChange: (count: number) => void;
  readonly onReachBoundary: (direction: 'previous' | 'next') => void;
  readonly onSelectRegion: (selection: CalendarRegionSelection) => void;
  readonly onOpenItem: (itemId: string) => void;
}

/**
 * Render the always-mounted scheduling grid and translate gestures into calendar mutations.
 *
 * @remarks
 * Error and empty states remain overlays owned by the canvas, so service failures never replace
 * the basic time grid.
 */
export function CalendarSchedulingSurface({
  axis,
  visibleLaneCount,
  pixelsPerHour,
  displayTimezone,
  now,
  preferences,
  dateAxis,
  peopleAxis,
  onVisibleLaneCountChange,
  onReachBoundary,
  onSelectRegion,
  onOpenItem,
}: CalendarSchedulingSurfaceProps): JSX.Element {
  const updateItem = useUpdateCalendarItemById();
  const linkTask = useLinkTaskToCalendarItem();
  const relateItems = useRelateCalendarItems();
  const minLaneWidth = preferences?.minLaneWidth ?? 240;
  const resetUpdateItem = updateItem.reset;
  const resetLinkTask = linkTask.reset;
  const resetRelateItems = relateItems.reset;
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

  const sourceIsInlineEditable = (source: CalendarItemOut): boolean =>
    isInlineEditableScheduleItem({
      canPersistBounds: canPersistCalendarItemBounds(source),
      allDay: Boolean(source.allDayStartDate && source.allDayEndDate),
      startsAt: source.startsAt,
      endsAt: source.endsAt,
      displayTimezone,
    });
  const persistExactBounds = (itemId: string, startsAt: string, endsAt: string): void => {
    clearInlineFailures();
    updateItem.mutate({
      itemId,
      patch: { startsAt, endsAt },
    });
  };
  const candidateIsSafe = (startsAt: string, endsAt: string): boolean =>
    isInlineEditableScheduleItem({
      canPersistBounds: true,
      allDay: false,
      startsAt,
      endsAt,
      displayTimezone,
    });
  const resolveWallInstant = (date: string, minutes: number): string | null =>
    scheduleInstantAt(date, minutes, displayTimezone, 'reject');
  const moveBounds = (
    itemId: string,
    date: string,
    startMinutes: number,
    endMinutes: number,
  ): void => {
    const source = dateAxis.itemById.get(itemId);
    if (!source || !sourceIsInlineEditable(source)) return;
    const startsAt = resolveWallInstant(date, startMinutes);
    const endsAt = resolveWallInstant(date, endMinutes);
    if (!startsAt || !endsAt || !candidateIsSafe(startsAt, endsAt)) return;
    persistExactBounds(itemId, startsAt, endsAt);
  };
  const resizeBounds = (
    itemId: string,
    date: string,
    edge: 'start' | 'end',
    startMinutes: number,
    endMinutes: number,
  ): void => {
    const source = dateAxis.itemById.get(itemId);
    if (!source?.startsAt || !source.endsAt || !sourceIsInlineEditable(source)) return;
    const startsAt = edge === 'start' ? resolveWallInstant(date, startMinutes) : source.startsAt;
    const endsAt = edge === 'end' ? resolveWallInstant(date, endMinutes) : source.endsAt;
    if (!startsAt || !endsAt || !candidateIsSafe(startsAt, endsAt)) return;
    persistExactBounds(itemId, startsAt, endsAt);
  };

  return (
    <>
      {dateAxis.conflictCount || dateAxis.failedCount ? (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-sm font-medium"
        >
          {dateAxis.conflictCount
            ? `${String(dateAxis.conflictCount)} sync conflict${dateAxis.conflictCount === 1 ? '' : 's'}`
            : null}
          {dateAxis.conflictCount && dateAxis.failedCount ? ' · ' : null}
          {dateAxis.failedCount
            ? `${String(dateAxis.failedCount)} sync error${dateAxis.failedCount === 1 ? '' : 's'}`
            : null}
        </div>
      ) : null}

      <div className="grid min-w-0 grid-cols-1 gap-4 @3xl:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0">
          <SchedulingCanvas
            displayTimezone={displayTimezone}
            lanes={axis === 'dates' ? dateAxis.lanes : peopleAxis.lanes}
            pixelsPerHour={pixelsPerHour}
            now={now}
            minimumLaneWidth={minLaneWidth}
            initialLaneIndex={axis === 'dates' ? dateAxis.initialLaneIndex : 0}
            error={
              updateItem.isError || linkTask.isError || relateItems.isError
                ? INLINE_UPDATE_FAILURE_COPY
                : (axis === 'dates' && dateAxis.itemsError) ||
                    (axis === 'people' && peopleAxis.error)
                  ? 'Calendar updates are temporarily unavailable. Showing what we have.'
                  : null
            }
            emptyMessage={
              axis === 'dates'
                ? dateAxis.itemsPending
                  ? 'Loading calendar items…'
                  : 'Nothing scheduled.'
                : peopleAxis.comparisonPending
                  ? 'Loading shared schedules…'
                  : peopleAxis.selectedActorIds.length === 0
                    ? 'Choose people to compare.'
                    : 'No shared availability for this date.'
            }
            onViewportGeometry={({ visibleLaneCount: next }) => {
              if (axis === 'dates' && next > 0 && next !== visibleLaneCount) {
                onVisibleLaneCountChange(next);
              }
            }}
            onOpenItem={({ item }: { item: ScheduleItem }) => {
              if (axis === 'people' && item.id.startsWith('busy:')) return;
              onOpenItem(item.id);
            }}
            {...(axis === 'dates'
              ? {
                  onReachBoundary,
                  onSelectRegion: ({ lane, startMinutes, endMinutes }) => {
                    const startsAt = resolveWallInstant(lane.date, startMinutes);
                    const endsAt = resolveWallInstant(lane.date, endMinutes);
                    if (!startsAt || !endsAt) return;
                    onSelectRegion({
                      startsAt,
                      endsAt,
                    });
                  },
                  onMoveItem: ({ item, toLane, startMinutes, endMinutes }: ScheduleItemMove) => {
                    if (toLane.editable === false) return;
                    moveBounds(item.id, toLane.date, startMinutes, endMinutes);
                  },
                  onResizeItem: ({
                    item,
                    lane,
                    edge,
                    startMinutes,
                    endMinutes,
                  }: ScheduleItemResize) => {
                    if (lane.editable === false) return;
                    resizeBounds(item.id, lane.date, edge, startMinutes, endMinutes);
                  },
                }
              : {})}
            renderItem={({ item }) => {
              const source = dateAxis.itemById.get(item.id);
              return (
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{item.title}</span>
                  {source?.kind === 'timebox' ? (
                    <span className="text-on-surface-variant text-[10px] font-normal">Timebox</span>
                  ) : null}
                </span>
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
          />
        </div>

        <aside className="flex min-w-0 flex-col gap-2">
          {axis === 'dates' ? (
            <>
              <h2 className="text-on-surface text-sm font-semibold">Layers</h2>
              {dateAxis.layersError ? (
                <p role="status" className="text-on-surface-variant text-xs">
                  Layer controls are temporarily unavailable.
                </p>
              ) : null}
              <CalendarLayerPanel layers={dateAxis.layers} />
            </>
          ) : (
            <div className="border-outline-variant rounded-lg border p-3">
              <h2 className="text-on-surface text-sm font-semibold">Shared schedules</h2>
              <p className="text-on-surface-variant mt-1 text-xs">
                Details appear only from layers each person shared with this workspace. Private
                provider events always appear as Busy.
              </p>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
