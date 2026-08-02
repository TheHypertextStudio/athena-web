import type { JSX, RefObject } from 'react';

import { SchedulingAllDayLane } from './scheduling-all-day-lane';
import type { ScheduleLane, SchedulingCanvasProps } from './scheduling-types';
import type { SchedulingRelationshipMode } from './use-scheduling-relationship-mode';

/** The two visible atoms of one date lane's heading: `Sun` and `2`. */
interface ScheduleLaneDateHeading {
  readonly weekday: string;
  readonly day: string;
}

/**
 * Split a `YYYY-MM-DD` lane date into its weekday abbreviation and bare day-of-month.
 *
 * @remarks
 * Deliberately no month, no year, and never the raw ISO string: the surface's own toolbar owns the
 * month and year, so between the two every date atom is rendered exactly once. A malformed date
 * yields `null` and the lane falls back to its consumer-supplied label.
 *
 * @param date - The lane's calendar date, formatted `YYYY-MM-DD`.
 * @returns The weekday/day pair, or `null` when the date cannot be parsed.
 */
function scheduleLaneDateHeading(date: string): ScheduleLaneDateHeading | null {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  const weekday = parsed.toLocaleDateString(undefined, { weekday: 'short' });
  return { weekday, day: String(parsed.getDate()) };
}

/**
 * Render one lane's heading: a person's name for a resource lane, otherwise `Sun 2`.
 *
 * @remarks
 * Today's day number is carried by a filled primary chip. That is the only emphasis in the header —
 * no borders, no second date line — because the goal is for events, not chrome, to hold the eye.
 *
 * @param lane - The lane being titled.
 * @param displayTimezone - The canvas-wide timezone; a lane timezone equal to it is redundant.
 * @param todayDate - Today's date in `displayTimezone`, when the canvas was given a clock.
 */
function SchedulingLaneHeading({
  lane,
  displayTimezone,
  todayDate,
}: {
  readonly lane: ScheduleLane;
  readonly displayTimezone: string;
  readonly todayDate?: string;
}): JSX.Element {
  const heading = lane.resourceId === undefined ? scheduleLaneDateHeading(lane.date) : null;
  const isToday = todayDate !== undefined && todayDate === lane.date;
  const showsTimezone = lane.timezone !== undefined && lane.timezone !== displayTimezone;

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {heading ? (
        <p className="text-title-small text-on-surface flex min-w-0 items-center gap-1.5">
          <span className="truncate">{heading.weekday}</span>
          {/* The day number always occupies the same 24px box, chip or not, so every lane heading
              is exactly as tall as every other and the all-day row below stays on one line. */}
          <span
            className={`flex size-6 shrink-0 items-center justify-center rounded-full tabular-nums ${
              isToday ? 'bg-primary text-on-primary' : 'text-on-surface'
            }`}
            data-schedule-lane-today={isToday ? '' : undefined}
          >
            {heading.day}
          </span>
        </p>
      ) : (
        <p className="text-title-small text-on-surface truncate">{lane.label}</p>
      )}
      {showsTimezone ? (
        <p className="text-label-medium text-on-surface-variant truncate">{lane.timezone}</p>
      ) : null}
    </div>
  );
}

/** Render the canvas's sticky lane headings and their all-day items. */
export function SchedulingCanvasHeader({
  headerRef,
  lanes,
  displayTimezone,
  todayDate,
  viewportRef,
  gutterWidth,
  contentWidth,
  laneWidth,
  renderItem,
  onOpenItem,
  onMoveAllDayItem,
  onResizeAllDayItem,
  onDropObjectOnItem,
  relationshipMode,
  onGestureAnnouncementChange,
}: {
  /**
   * Measured by the canvas so an item's own title row knows how far down the scrollport the grid
   * actually starts — this header is `sticky top-0`, so anything clamping to the visible canvas has
   * to clamp *below* it rather than under it.
   */
  readonly headerRef: RefObject<HTMLElement | null>;
  readonly lanes: readonly ScheduleLane[];
  readonly displayTimezone: string;
  /** Today's date in `displayTimezone`, used only to mark the current lane. */
  readonly todayDate?: string;
  readonly viewportRef: RefObject<HTMLElement | null>;
  readonly gutterWidth: number;
  readonly contentWidth: number;
  readonly laneWidth: number;
  readonly renderItem?: SchedulingCanvasProps['renderItem'];
  readonly onOpenItem?: SchedulingCanvasProps['onOpenItem'];
  readonly onMoveAllDayItem?: SchedulingCanvasProps['onMoveAllDayItem'];
  readonly onResizeAllDayItem?: SchedulingCanvasProps['onResizeAllDayItem'];
  readonly onDropObjectOnItem?: SchedulingCanvasProps['onDropObjectOnItem'];
  readonly relationshipMode: SchedulingRelationshipMode;
  readonly onGestureAnnouncementChange: (announcement: string) => void;
}): JSX.Element {
  return (
    // One structural rule for the whole header instead of a grid of them: the tonal step plus a
    // single hairline is all the separation the grid below needs.
    <header
      ref={headerRef}
      className="bg-surface-container-low border-outline-variant/40 sticky top-0 z-[60] flex border-b"
    >
      <div
        className="text-on-surface-variant bg-surface-container-low text-label-medium sticky left-0 z-[70] shrink-0 self-stretch px-2 py-3"
        style={{ width: gutterWidth }}
      >
        All day
      </div>
      <div className="flex" style={{ width: contentWidth }}>
        {lanes.map((lane, laneIndex) => (
          <div
            key={lane.id}
            className="min-w-0 shrink-0 px-2 py-2"
            data-schedule-lane-header={lane.id}
            style={{ width: laneWidth }}
          >
            <SchedulingLaneHeading
              lane={lane}
              displayTimezone={displayTimezone}
              todayDate={todayDate}
            />
            <SchedulingAllDayLane
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
              onDropObjectOnItem={onDropObjectOnItem}
              relationshipMode={relationshipMode}
              onGestureAnnouncementChange={onGestureAnnouncementChange}
            />
          </div>
        ))}
      </div>
    </header>
  );
}
