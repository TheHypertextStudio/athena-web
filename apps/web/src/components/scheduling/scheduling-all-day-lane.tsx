import { Plus } from '@docket/ui/icons';
import type { JSX, RefObject } from 'react';

import { SchedulingAllDayItem } from './scheduling-all-day-item';
import type { ScheduleLane, SchedulingCanvasProps } from './scheduling-types';
import type { SchedulingRelationshipMode } from './use-scheduling-relationship-mode';

const CALENDAR_PRIMARY_ALL_DAY_ITEMS = 3;
const AGENDA_PRIMARY_ALL_DAY_ITEMS = 2;

/** Keep dense all-day schedules bounded while retaining direct access to every item. */
export function SchedulingAllDayLane({
  presentation,
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
  /** Calendar keeps its stacked lane header, while Agenda uses a compact content-driven row. */
  readonly presentation: 'calendar' | 'agenda';
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
  const primaryLimit =
    presentation === 'agenda' ? AGENDA_PRIMARY_ALL_DAY_ITEMS : CALENDAR_PRIMARY_ALL_DAY_ITEMS;
  const primary = allDayItems.slice(0, primaryLimit);
  const overflow = allDayItems.slice(primaryLimit);
  const allDayLaneContext =
    renderAllDayLaneContext?.({
      lane,
      geometry: { laneIndex, laneWidth },
      onAnnouncementChange: onGestureAnnouncementChange,
    }) ?? null;
  const isAgenda = presentation === 'agenda';
  const hasContent = allDayLaneContext !== null || allDayItems.length > 0;
  const reserveCreateTarget = isAgenda && onSelectAllDayRegion !== undefined;
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
      className={
        isAgenda
          ? `relative flex flex-col items-start gap-1 ${!hasContent && onSelectAllDayRegion ? 'min-h-10' : ''}`
          : 'relative mt-1 flex min-h-5 flex-col items-start gap-1'
      }
      data-schedule-all-day-lane={lane.id}
    >
      {allDayLaneContext === null ? null : (
        <div
          className={`relative z-10 w-full ${reserveCreateTarget ? 'pr-10' : ''}`}
          data-schedule-all-day-lane-context={lane.id}
        >
          {allDayLaneContext}
        </div>
      )}
      {primary.map((item, index) => (
        <div
          key={item.id}
          className={`w-full ${reserveCreateTarget && allDayLaneContext === null && index === 0 ? 'pr-10' : ''}`}
          data-schedule-all-day-primary=""
        >
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
      {onSelectAllDayRegion && isAgenda ? (
        <button
          type="button"
          className="hover:bg-primary-container focus-visible:ring-ring absolute top-0 right-0 z-20 flex size-10 items-center justify-center rounded-full opacity-0 outline-none hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 [@media(pointer:coarse)]:opacity-100"
          aria-label={`Create all-day item for ${lane.label}`}
          onClick={(event) => {
            onSelectAllDayRegion(lane, event.currentTarget);
          }}
        >
          <Plus aria-hidden="true" className="size-5" />
        </button>
      ) : onSelectAllDayRegion ? (
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
