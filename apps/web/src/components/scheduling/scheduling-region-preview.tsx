import type { JSX, Ref } from 'react';

import { minutesToPixels } from './scheduling-geometry';
import { formatScheduleInstantRange } from './scheduling-time-label';
import { resolveScheduleWallInstant } from './scheduling-wall-time';
import type { ScheduleLane } from './scheduling-types';

/** User-facing meaning of one wall-clock region preview. */
export interface SchedulingRegionPreviewPresentation {
  readonly valid: boolean;
  readonly label: string;
  readonly announcement: string;
}

/** Resolve exact instants before presenting or committing a selected wall-clock region. */
export function presentSchedulingRegion({
  lane,
  startMinutes,
  endMinutes,
  displayTimezone,
}: {
  readonly lane: ScheduleLane;
  readonly startMinutes: number;
  readonly endMinutes: number;
  readonly displayTimezone: string;
}): SchedulingRegionPreviewPresentation {
  const start = resolveScheduleWallInstant(lane.date, startMinutes, displayTimezone);
  const end = resolveScheduleWallInstant(lane.date, endMinutes, displayTimezone);
  if (start.kind === 'repeated' || end.kind === 'repeated') {
    return {
      valid: false,
      label: 'Choose occurrence · DST',
      announcement: 'That time repeats because clocks change. Use New to choose Earlier or Later.',
    };
  }
  if (start.kind !== 'resolved' || end.kind !== 'resolved') {
    return {
      valid: false,
      label: 'Unavailable · DST',
      announcement: 'That time is unavailable because clocks change.',
    };
  }
  const range = formatScheduleInstantRange(start.instant, end.instant, displayTimezone);
  if (!range) {
    return {
      valid: false,
      label: 'Unavailable · DST',
      announcement: 'That time is unavailable because clocks change.',
    };
  }
  return {
    valid: true,
    label: range,
    announcement: `Selected ${lane.label}, ${range}.`,
  };
}

/** Render an exact, visible label over the region being created. */
export function SchedulingRegionPreview({
  laneId,
  startMinutes,
  endMinutes,
  pixelsPerHour,
  presentation,
  state = 'preview',
  anchorRef,
}: {
  readonly laneId: string;
  readonly startMinutes: number;
  readonly endMinutes: number;
  readonly pixelsPerHour: number;
  readonly presentation: SchedulingRegionPreviewPresentation;
  readonly state?: 'preview' | 'selected';
  readonly anchorRef?: Ref<HTMLDivElement>;
}): JSX.Element {
  const selected = state === 'selected';
  return (
    <div
      ref={anchorRef}
      aria-hidden="true"
      className={
        presentation.valid
          ? selected
            ? 'border-primary/70 bg-primary/20 ring-primary/25 pointer-events-none absolute inset-x-1 z-10 rounded-md border ring-1'
            : 'border-primary/50 bg-primary/15 pointer-events-none absolute inset-x-1 z-10 rounded-md border'
          : 'border-destructive/60 bg-destructive-container/60 pointer-events-none absolute inset-x-1 z-10 rounded-md border border-dashed'
      }
      data-schedule-region-preview={selected ? undefined : laneId}
      data-schedule-region-selection={selected ? laneId : undefined}
      data-schedule-region-state={state}
      data-schedule-region-valid={presentation.valid}
      data-start-minutes={startMinutes}
      data-end-minutes={endMinutes}
      style={{
        top: minutesToPixels(startMinutes, pixelsPerHour),
        height: minutesToPixels(endMinutes - startMinutes, pixelsPerHour),
      }}
    >
      <span className="bg-surface/95 text-on-surface absolute top-1 left-1 max-w-[calc(100%-0.5rem)] truncate rounded px-1.5 py-0.5 text-[10px] leading-4 font-semibold tabular-nums shadow-sm">
        {presentation.label}
      </span>
    </div>
  );
}
