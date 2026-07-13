'use client';

import { type JSX, type ReactNode, useMemo } from 'react';

import {
  deriveScheduleTicks,
  scheduleWallPositionForInstant,
  type ScheduleTick,
} from './scheduling-time-axis';
import type { ScheduleLane } from './scheduling-types';

/** Props for the shared adaptive wall-clock grid. */
export interface SchedulingTimeGridProps {
  /** Lanes whose dates determine transition and current-time annotations. */
  readonly lanes: readonly ScheduleLane[];
  /** IANA timezone shared by every rendered clock position. */
  readonly displayTimezone: string;
  /** Continuous vertical scale in pixels per hour. */
  readonly pixelsPerHour: number;
  /** Optional deterministic ISO instant for the current-time indicator. */
  readonly now?: string;
  /** Width of the sticky time-label gutter. */
  readonly gutterWidth: number;
  /** Full width occupied by all lane cells. */
  readonly contentWidth: number;
  /** Width of one arbitrary lane. */
  readonly laneWidth: number;
  /** Timed lane cells and items rendered over the grid. */
  readonly children: ReactNode;
}

/** Convert wall-clock minutes to an exact grid position at the active scalar zoom. */
function tickTop(wallMinutes: number, pixelsPerHour: number): number {
  return (wallMinutes / 60) * pixelsPerHour;
}

/** One contiguous daylight-saving anomaly rendered as a single lane band. */
interface ScheduleTransitionBand {
  readonly transition: Exclude<ScheduleTick['transition'], 'normal'>;
  readonly startWallMinutes: number;
  readonly endWallMinutes: number;
}

/** Coalesce consecutive anomalous snap ticks into one exact wall-clock band. */
function transitionBands(ticks: readonly ScheduleTick[]): ScheduleTransitionBand[] {
  const bands: ScheduleTransitionBand[] = [];
  ticks.forEach((tick, index) => {
    if (tick.transition === 'normal') return;
    const endWallMinutes = ticks[index + 1]?.wallMinutes ?? tick.wallMinutes;
    const previous = bands.at(-1);
    if (previous?.transition === tick.transition && previous.endWallMinutes === tick.wallMinutes) {
      bands[bands.length - 1] = { ...previous, endWallMinutes };
      return;
    }
    bands.push({
      transition: tick.transition,
      startWallMinutes: tick.wallMinutes,
      endWallMinutes,
    });
  });
  return bands;
}

/** Compact copy for a daylight-saving wall-clock anomaly. */
function transitionLabel(transition: ScheduleTransitionBand['transition']): string {
  return transition === 'skipped' ? 'Skipped hour · DST' : 'Repeated hour · DST';
}

/**
 * Render adaptive labels, major/minor rules, DST annotations, and a deterministic current line.
 *
 * @remarks
 * The renderer never owns lanes or items. With zero lanes, invalid `now`, or no `now`, the full
 * 24-hour grid remains present and only the optional current-time annotation is omitted.
 */
export function SchedulingTimeGrid({
  lanes,
  displayTimezone,
  pixelsPerHour,
  now,
  gutterWidth,
  contentWidth,
  laneWidth,
  children,
}: SchedulingTimeGridProps): JSX.Element {
  const currentPosition = now ? scheduleWallPositionForInstant(now, displayTimezone) : null;
  const referenceDate = lanes[0]?.date ?? currentPosition?.date ?? '1970-01-01';
  const ticks = useMemo(
    () =>
      deriveScheduleTicks({
        date: referenceDate,
        timezone: displayTimezone,
        pixelsPerHour,
      }),
    [displayTimezone, pixelsPerHour, referenceDate],
  );
  const transitionsByDate = useMemo(() => {
    const transitions = new Map<string, ScheduleTransitionBand[]>();
    for (const date of new Set(lanes.map((lane) => lane.date))) {
      transitions.set(
        date,
        transitionBands(deriveScheduleTicks({ date, timezone: displayTimezone, pixelsPerHour })),
      );
    }
    return transitions;
  }, [displayTimezone, lanes, pixelsPerHour]);
  const gridHeight = 24 * pixelsPerHour;

  return (
    <div className="relative flex" style={{ height: gridHeight }}>
      <div
        className="border-outline-variant bg-surface sticky left-0 z-20 shrink-0 border-r"
        style={{ width: gutterWidth }}
      >
        {ticks
          .filter((tick) => tick.kind === 'major')
          .map((tick) => (
            <span
              key={tick.wallMinutes}
              className="text-on-surface-variant absolute right-2 -translate-y-1/2 text-[10px] tabular-nums"
              data-schedule-label={tick.wallMinutes}
              style={{ top: tickTop(tick.wallMinutes, pixelsPerHour) }}
            >
              {tick.label}
            </span>
          ))}
      </div>

      <div
        className="relative shrink-0"
        data-schedule-lane-region=""
        style={{ width: contentWidth, height: gridHeight }}
      >
        {ticks.map((tick) => (
          <div
            key={tick.wallMinutes}
            aria-hidden="true"
            className={
              tick.kind === 'major'
                ? 'border-outline-variant pointer-events-none absolute inset-x-0 border-t'
                : 'border-outline-variant/40 pointer-events-none absolute inset-x-0 border-t'
            }
            data-hour-line={tick.wallMinutes % 60 === 0 ? tick.wallMinutes / 60 : undefined}
            data-schedule-tick={tick.kind}
            data-schedule-tick-minutes={tick.wallMinutes}
            style={{ top: tickTop(tick.wallMinutes, pixelsPerHour) }}
          />
        ))}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-0 flex"
          data-schedule-transition-layer=""
        >
          {lanes.map((lane) => (
            <div
              key={lane.id}
              className="relative shrink-0"
              style={{ width: laneWidth, height: gridHeight }}
            >
              {(transitionsByDate.get(lane.date) ?? []).map((band) => (
                <span
                  key={`${String(band.startWallMinutes)}:${band.transition}`}
                  className="text-on-surface-variant bg-surface-container-high/50 absolute inset-x-1 border-y border-dashed px-1 text-[9px]"
                  data-schedule-transition={band.transition}
                  data-schedule-transition-lane={lane.id}
                  style={{
                    top: tickTop(band.startWallMinutes, pixelsPerHour),
                    height: tickTop(band.endWallMinutes - band.startWallMinutes, pixelsPerHour),
                  }}
                >
                  {transitionLabel(band.transition)}
                </span>
              ))}
            </div>
          ))}
        </div>
        {children}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-30 flex"
          data-schedule-current-layer=""
        >
          {lanes.map((lane) => (
            <div
              key={lane.id}
              className="relative shrink-0"
              style={{ width: laneWidth, height: gridHeight }}
            >
              {currentPosition?.date === lane.date ? (
                <span
                  className="bg-destructive absolute inset-x-0 h-0.5"
                  data-current-time-line={lane.id}
                  style={{ top: tickTop(currentPosition.wallMinutes, pixelsPerHour) }}
                />
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
