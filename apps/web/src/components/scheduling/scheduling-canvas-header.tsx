import type { JSX, ReactNode, RefObject } from 'react';

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
 * Today's day number is carried by a tonal `primary-container` chip, not a solid `primary` fill.
 * Events and time blocks must be the highest-contrast elements on the canvas, and the solid fill
 * measured 5.7:1 (light) / 8.1:1 (dark) against the canvas — well above the ~1.7:1 event blocks use
 * ({@link file://./scheduling-item-surface.ts}) — which made the day badge,
 * not an event, the highest-contrast fill on the page. `primary-container` measures 1.26:1 (light) /
 * 1.29:1 (dark), a step *below* an event's own fill, while `on-primary-container` still keeps the
 * digit legible at 10.2:1 / 8.8:1. Today stays identifiable by hue and position; it no longer
 * outranks an event for the eye.
 *
 * @param lane - The lane being titled.
 * @param displayTimezone - The canvas-wide timezone; a lane timezone equal to it is redundant.
 * @param todayDate - Today's date in `displayTimezone`, when the canvas was given a clock.
 */
function SchedulingLaneHeading({
  lane,
  displayTimezone,
  todayDate,
  compact,
}: {
  readonly lane: ScheduleLane;
  readonly displayTimezone: string;
  readonly todayDate?: string | undefined;
  /** Stack the weekday over the day number, for a rail-width canvas. */
  readonly compact: boolean;
}): JSX.Element {
  const heading = lane.resourceId === undefined ? scheduleLaneDateHeading(lane.date) : null;
  const isToday = todayDate !== undefined && todayDate === lane.date;
  const showsTimezone = lane.timezone !== undefined && lane.timezone !== displayTimezone;

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      {heading ? (
        // Stacked in a rail because a rail's scarce axis is horizontal: `TUE` over `11` costs one
        // extra text line and gives the all-day chips beside it the full lane width, where the
        // inline form spends that width on a weekday nobody scans for.
        <p
          className={`text-title-small text-on-surface flex min-w-0 gap-1.5 ${
            compact ? 'flex-col items-start gap-0' : 'items-center'
          }`}
        >
          {/* The weekday is the least informative atom in the heading — the day number is what a
              person scans for — and it is chrome sitting directly above the events. Dropping it to
              the variant tone keeps every day header quieter than an event's own title, which is
              the emphasis order this surface is supposed to have. */}
          <span
            className={`text-on-surface-variant truncate ${
              compact ? 'text-label-large uppercase' : ''
            }`}
          >
            {heading.weekday}
          </span>
          {/* The day number always occupies the same 24px box, chip or not, so every lane heading
              is exactly as tall as every other and the all-day row below stays on one line. */}
          <span
            className={`flex size-6 shrink-0 items-center justify-center rounded-full tabular-nums ${
              isToday ? 'bg-primary-container text-on-primary-container' : 'text-on-surface'
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
        <p className="text-label-large text-on-surface-variant truncate">{lane.timezone}</p>
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
  compact,
  presentation,
  gutterSlot,
  gutterWidth,
  contentWidth,
  laneWidth,
  renderItem,
  renderAllDayLaneContext,
  onOpenItem,
  onMoveAllDayItem,
  onResizeAllDayItem,
  onDropObjectOnItem,
  relationshipMode,
  onGestureAnnouncementChange,
  onSelectAllDayRegion,
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
  readonly todayDate?: string | undefined;
  readonly viewportRef: RefObject<HTMLElement | null>;
  /** Rail-width canvas: stack the lane date and drop the visible `All day` gutter label. */
  readonly compact: boolean;
  /** Calendar keeps lane headings; Agenda owns its single date outside this shared header. */
  readonly presentation: 'calendar' | 'agenda';
  /**
   * Consumer-owned chrome rendered in the header's gutter cell, beside the all-day row.
   *
   * @remarks
   * The canvas owns no controls of its own, so this is how a surface puts one in the only piece of
   * chrome that is neither a lane nor an item. It exists because the rail needs a scale stepper and
   * the gutter cell is the one place on a 280px surface with room for it.
   */
  readonly gutterSlot?: ReactNode | undefined;
  readonly gutterWidth: number;
  readonly contentWidth: number;
  readonly laneWidth: number;
  readonly renderItem?: SchedulingCanvasProps['renderItem'] | undefined;
  readonly renderAllDayLaneContext?: SchedulingCanvasProps['renderAllDayLaneContext'] | undefined;
  readonly onOpenItem?: SchedulingCanvasProps['onOpenItem'] | undefined;
  readonly onMoveAllDayItem?: SchedulingCanvasProps['onMoveAllDayItem'] | undefined;
  readonly onResizeAllDayItem?: SchedulingCanvasProps['onResizeAllDayItem'] | undefined;
  readonly onDropObjectOnItem?: SchedulingCanvasProps['onDropObjectOnItem'] | undefined;
  readonly relationshipMode: SchedulingRelationshipMode;
  readonly onGestureAnnouncementChange: (announcement: string) => void;
  readonly onSelectAllDayRegion?: SchedulingCanvasProps['onSelectAllDayRegion'] | undefined;
}): JSX.Element {
  return (
    // No rule under the header at all: the tonal step from `surface-container-low` onto the grid's
    // `surface` is the separation, which is how every other region on this surface is separated.
    // The hairline that used to sit here was the one visible border on the whole calendar that the
    // "there are just so many fucking borders everywhere" complaint could still point at.
    <header
      ref={headerRef}
      className="bg-surface-container-low sticky top-0 z-[60] flex"
      data-schedule-all-day-header=""
    >
      <div
        // A rail cannot afford a gutter as wide as the words `All day`, and it does not need one:
        // the chips sit directly under the date and read as all-day from their position, exactly as
        // every reference calendar renders them. The label stays in the accessibility tree so the
        // region is still named — only its pixels go, which frees the cell for `gutterSlot`.
        className={`text-on-surface-variant bg-surface-container-low text-label-large sticky left-0 z-[70] flex shrink-0 flex-col items-center self-stretch ${
          compact ? 'py-1' : 'px-2 py-3'
        }`}
        style={{ width: gutterWidth }}
      >
        <span className={compact ? 'sr-only' : undefined}>All day</span>
        {gutterSlot}
      </div>
      <div className="flex" style={{ width: contentWidth }}>
        {lanes.map((lane, laneIndex) => (
          <div
            key={lane.id}
            className={`min-w-0 shrink-0 ${presentation === 'agenda' ? 'px-1 py-1' : 'px-2 py-2'}`}
            data-schedule-lane-header={lane.id}
            style={{ width: laneWidth }}
          >
            {presentation === 'calendar' ? (
              <SchedulingLaneHeading
                lane={lane}
                displayTimezone={displayTimezone}
                todayDate={todayDate}
                compact={compact}
              />
            ) : null}
            <SchedulingAllDayLane
              lane={lane}
              laneIndex={laneIndex}
              lanes={lanes}
              displayTimezone={displayTimezone}
              laneWidth={laneWidth}
              viewportRef={viewportRef}
              renderItem={renderItem}
              renderAllDayLaneContext={renderAllDayLaneContext}
              onOpenItem={onOpenItem}
              onMoveAllDayItem={onMoveAllDayItem}
              onResizeAllDayItem={onResizeAllDayItem}
              onDropObjectOnItem={onDropObjectOnItem}
              relationshipMode={relationshipMode}
              onGestureAnnouncementChange={onGestureAnnouncementChange}
              onSelectAllDayRegion={onSelectAllDayRegion}
            />
          </div>
        ))}
      </div>
    </header>
  );
}
