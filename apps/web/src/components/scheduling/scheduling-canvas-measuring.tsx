'use client';

import { Separator } from '@docket/ui/primitives';
import type { JSX, RefObject } from 'react';

import { deriveScheduleTicks } from './scheduling-time-axis';
import { deriveInitialScheduleScrollMinutes } from './scheduling-initial-scroll';
import type { SchedulingCanvasProps } from './scheduling-types';

/** Show the dated measuring canvas until the scrollport reports its first width. */
export function needsCanvasMeasurement(
  viewportWidth: number | undefined,
  observedWidth: number,
): boolean {
  return viewportWidth === undefined && observedWidth === 0;
}

/** Show the selected date and starting hours while the canvas measures its lane width. */
export function SchedulingCanvasMeasuring({
  viewportRef,
  options,
}: {
  readonly viewportRef: RefObject<HTMLDivElement | null>;
  readonly options: SchedulingCanvasProps;
}): JSX.Element {
  const { lanes, displayTimezone, viewportHeight } = options;
  const pixelsPerHour = Math.max(1, options.pixelsPerHour);
  const initialScrollMinutes = deriveInitialScheduleScrollMinutes({
    initialScrollMinutes: options.initialScrollMinutes,
    now: options.now,
    displayTimezone,
    lanes,
  });
  const selectedLane = lanes[options.initialLaneIndex ?? 0] ?? lanes[0];
  // A late-day start would leave most of a phone blank below midnight before the real grid mounts.
  const firstHour = Math.min(12, Math.max(0, Math.floor(initialScrollMinutes / 60)));
  const hourLabels = new Map(
    deriveScheduleTicks({
      date: selectedLane?.date ?? '1970-01-01',
      timezone: displayTimezone,
      pixelsPerHour,
      labelStyle: 'hour',
    })
      .filter((tick) => tick.kind === 'major')
      .map((tick) => [tick.wallMinutes / 60, tick.label]),
  );
  return (
    <section
      ref={viewportRef}
      aria-label="Schedule"
      aria-busy="true"
      className="bg-surface relative min-h-0 overflow-hidden"
      style={{ height: viewportHeight ?? 'clamp(20rem, 68dvh, 48rem)' }}
      data-schedule-measuring=""
    >
      <div className="flex h-12 items-center">
        <span className="w-14 shrink-0" />
        <span className="text-label-large text-on-surface px-1">
          {selectedLane?.label ?? 'Schedule'}
        </span>
      </div>
      <Separator className="opacity-30" />
      <div className="flex h-12 items-center">
        <span className="text-label-medium text-on-surface-variant w-14 shrink-0 pr-1 text-right">
          All day
        </span>
      </div>
      <Separator className="opacity-30" />
      <div>
        {Array.from({ length: 24 - firstHour }, (_, index) => {
          const hour = firstHour + index;
          return (
            <div key={hour} className="flex" style={{ height: pixelsPerHour }}>
              <span
                className="text-label-large text-on-surface-variant w-14 shrink-0 pr-1 text-right tabular-nums"
                data-schedule-hour={hour}
              >
                {hourLabels.get(hour)}
              </span>
              <span className="min-w-0 flex-1">
                <Separator className="opacity-30" />
              </span>
            </div>
          );
        })}
      </div>
      <span className="sr-only">Loading calendar items</span>
    </section>
  );
}
