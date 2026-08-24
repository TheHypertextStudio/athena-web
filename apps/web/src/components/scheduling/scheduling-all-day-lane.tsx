import type { JSX, RefObject } from 'react';

import { SchedulingAllDayItem } from './scheduling-all-day-item';
import type { ScheduleLane, SchedulingCanvasProps } from './scheduling-types';
import type { SchedulingRelationshipMode } from './use-scheduling-relationship-mode';

const PRIMARY_ALL_DAY_ITEMS = 3;

/** Keep dense all-day schedules bounded while retaining direct access to every item. */
export function SchedulingAllDayLane({
  lane,
  laneIndex,
  lanes,
  displayTimezone,
  laneWidth,
  viewportRef,
  renderItem,
  renderAllDayLaneContext,
  onOpenItem,
  onMoveAllDayItem,
  onResizeAllDayItem,
  relationshipMode,
  onGestureAnnouncementChange,
  onSelectAllDayRegion,
}: {
  readonly lane: ScheduleLane;
  readonly laneIndex: number;
  readonly lanes: readonly ScheduleLane[];
  readonly displayTimezone: string;
  readonly laneWidth: number;
  readonly viewportRef: RefObject<HTMLElement | null>;
  readonly renderItem?: SchedulingCanvasProps['renderItem'];
  readonly renderAllDayLaneContext?: SchedulingCanvasProps['renderAllDayLaneContext'];
  readonly onOpenItem?: SchedulingCanvasProps['onOpenItem'];
  readonly onMoveAllDayItem?: SchedulingCanvasProps['onMoveAllDayItem'];
  readonly onResizeAllDayItem?: SchedulingCanvasProps['onResizeAllDayItem'];
  readonly relationshipMode: SchedulingRelationshipMode;
  readonly onGestureAnnouncementChange: (announcement: string) => void;
  readonly onSelectAllDayRegion?: SchedulingCanvasProps['onSelectAllDayRegion'];
}): JSX.Element {
  const allDayItems = lane.items.filter((item) => item.allDay);
  const primary = allDayItems.slice(0, PRIMARY_ALL_DAY_ITEMS);
  const overflow = allDayItems.slice(PRIMARY_ALL_DAY_ITEMS);
  const allDayLaneContext =
    renderAllDayLaneContext?.({
      lane,
      geometry: { laneIndex, laneWidth },
      onAnnouncementChange: onGestureAnnouncementChange,
    }) ?? null;
  const render = (item: (typeof allDayItems)[number]): JSX.Element => (
    <SchedulingAllDayItem
      key={item.id}
      item={item}
      lane={lane}
      laneIndex={laneIndex}
      lanes={lanes}
      displayTimezone={displayTimezone}
      laneWidth={laneWidth}
      viewportRef={viewportRef}
      renderItem={renderItem}
      onOpenItem={onOpenItem}
      onMoveAllDayItem={onMoveAllDayItem}
      onResizeAllDayItem={onResizeAllDayItem}
      relationshipMode={relationshipMode}
      onGestureAnnouncementChange={onGestureAnnouncementChange}
    />
  );

  return (
    <div
      className="relative mt-1 flex min-h-5 flex-col items-start gap-1"
      data-schedule-all-day-lane={lane.id}
    >
      {allDayLaneContext === null ? null : (
        <div className="relative z-10 w-full" data-schedule-all-day-lane-context={lane.id}>
          {allDayLaneContext}
        </div>
      )}
      {primary.map((item) => (
        <div key={item.id} className="w-full" data-schedule-all-day-primary="">
          {render(item)}
        </div>
      ))}
      {overflow.length > 0 ? (
        <details className="text-label-medium relative z-50 max-w-full">
          <summary className="text-primary hover:bg-primary/10 focus-visible:ring-ring flex cursor-pointer list-none items-center rounded px-1.5 py-0.5 outline-none focus-visible:ring-2 [@media(pointer:coarse)]:min-h-10">
            +{String(overflow.length)} more
          </summary>
          {/* Tone, not a shadow: the raised surface step is what separates the disclosure. */}
          <div
            className="bg-surface-container-high absolute top-full left-0 mt-1 flex max-h-32 min-w-40 flex-col gap-1 overflow-y-auto rounded-md p-1.5"
            data-schedule-all-day-overflow=""
          >
            {overflow.map(render)}
          </div>
        </details>
      ) : null}
      {onSelectAllDayRegion ? (
        <button
          type="button"
          className="text-primary text-label-medium hover:bg-primary-container focus-visible:ring-ring min-h-7 rounded px-1.5 outline-none focus-visible:ring-2 focus-visible:ring-inset [@media(pointer:coarse)]:min-h-10"
          aria-label={`Create all-day item for ${lane.label}`}
          onClick={(event) => {
            onSelectAllDayRegion(lane, event.currentTarget);
          }}
        >
          + All day
        </button>
      ) : null}
    </div>
  );
}
