'use client';

import { MapPin } from '@docket/ui/icons';
import { type JSX, useRef } from 'react';

import {
  partitionScheduleRangeByContext,
  projectInstantRangeToScheduleLane,
  type ScheduleAllDayLaneRenderContext,
  type ScheduleLane,
  type ScheduleTimedItemDecorationContext,
  type ScheduleTimedLaneContextRenderContext,
} from '@/components/scheduling';

import type { WorkLocationCalendarRegion } from './work-location-calendar-model';

interface WorkLocationAllDayContextProps {
  readonly regions: readonly WorkLocationCalendarRegion[];
  readonly context: ScheduleAllDayLaneRenderContext;
  readonly lanes?: readonly ScheduleLane[];
  readonly displayTimezone: string;
  readonly onOpen: (region: WorkLocationCalendarRegion) => void;
  readonly onMove: (region: WorkLocationCalendarRegion, targetDate: string) => void;
}

interface WorkLocationTimedLaneContextProps {
  readonly regions: readonly WorkLocationCalendarRegion[];
  readonly context: ScheduleTimedLaneContextRenderContext;
  readonly displayTimezone: string;
  readonly onOpen: (region: WorkLocationCalendarRegion) => void;
  readonly onEdit: (input: {
    readonly region: WorkLocationCalendarRegion;
    readonly targetDate: string;
    readonly startMinutes: number;
    readonly endMinutes: number;
  }) => void;
}

interface WorkLocationTimeboxDecorationProps {
  readonly regions: readonly WorkLocationCalendarRegion[];
  readonly context: ScheduleTimedItemDecorationContext;
  readonly displayTimezone: string;
}

/** Project a normalized exact region into one neutral schedule lane. */
function regionBounds(
  region: WorkLocationCalendarRegion,
  lane: ScheduleLane,
  displayTimezone: string,
) {
  return projectInstantRangeToScheduleLane(
    { startsAt: region.startsAt, endsAt: region.endsAt },
    lane,
    displayTimezone,
  );
}

/** Clamp a number into inclusive bounds. */
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Start one pointer session that resolves a visible target lane and snapped minute delta. */
function startTimedPointerSession(input: {
  readonly event: React.PointerEvent<HTMLElement>;
  readonly mode: 'move' | 'resize-start' | 'resize-end';
  readonly region: WorkLocationCalendarRegion;
  readonly bounds: { readonly startMinutes: number; readonly endMinutes: number };
  readonly context: ScheduleTimedLaneContextRenderContext;
  readonly onCommit: WorkLocationTimedLaneContextProps['onEdit'];
  readonly onDragged: () => void;
}): void {
  if (input.event.button !== 0) return;
  input.event.preventDefault();
  input.event.stopPropagation();
  const pointerId = input.event.pointerId;
  const originX = input.event.clientX;
  const originY = input.event.clientY;
  let preview: {
    targetDate: string;
    startMinutes: number;
    endMinutes: number;
  } | null = null;

  const onMove = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    const laneDelta = Math.round((event.clientX - originX) / input.context.geometry.laneWidth);
    const targetIndex = clamp(
      input.context.geometry.laneIndex + laneDelta,
      0,
      input.context.lanes.length - 1,
    );
    const targetLane = input.context.lanes[targetIndex];
    if (!targetLane) return;
    const rawMinuteDelta = ((event.clientY - originY) * 60) / input.context.geometry.pixelsPerHour;
    const minuteDelta =
      Math.round(rawMinuteDelta / input.context.snapMinutes) * input.context.snapMinutes;
    const duration = input.bounds.endMinutes - input.bounds.startMinutes;
    if (input.mode === 'move') {
      const startMinutes = clamp(input.bounds.startMinutes + minuteDelta, 0, 1_440 - duration);
      preview = { targetDate: targetLane.date, startMinutes, endMinutes: startMinutes + duration };
    } else if (input.mode === 'resize-start') {
      preview = {
        targetDate: targetLane.date,
        startMinutes: clamp(
          input.bounds.startMinutes + minuteDelta,
          0,
          input.bounds.endMinutes - input.context.snapMinutes,
        ),
        endMinutes: input.bounds.endMinutes,
      };
    } else {
      preview = {
        targetDate: targetLane.date,
        startMinutes: input.bounds.startMinutes,
        endMinutes: clamp(
          input.bounds.endMinutes + minuteDelta,
          input.bounds.startMinutes + input.context.snapMinutes,
          1_440,
        ),
      };
    }
    input.onDragged();
  };
  const finish = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', cancel);
    if (preview) input.onCommit({ region: input.region, ...preview });
  };
  const cancel = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', cancel);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', cancel);
}

/** Render all-day expected location inside the shared all-day lane context row. */
export function WorkLocationAllDayContext({
  regions,
  context,
  lanes = [context.lane],
  displayTimezone,
  onOpen,
  onMove,
}: WorkLocationAllDayContextProps): JSX.Element | null {
  const suppressedClick = useRef<string | null>(null);
  const visible = regions.filter((region) => {
    const bounds = regionBounds(region, context.lane, displayTimezone);
    return region.allDay && bounds?.startMinutes === 0 && bounds.endMinutes === 1_440;
  });
  if (visible.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1" aria-label="Expected work location">
      {visible.map((region) =>
        region.editable ? (
          <button
            key={region.id}
            type="button"
            aria-label={`${region.label} work location`}
            className="bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest active:bg-secondary-container focus-visible:outline-primary text-label-small inline-flex min-h-7 max-w-full items-center gap-1 rounded-full px-2 focus-visible:outline-2 focus-visible:outline-offset-2 motion-safe:transition-colors motion-reduce:transition-none [@media(pointer:coarse)]:min-h-11"
            onClick={() => {
              if (suppressedClick.current === region.id) {
                suppressedClick.current = null;
                return;
              }
              onOpen(region);
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.stopPropagation();
              const pointerId = event.pointerId;
              const originX = event.clientX;
              const onPointerMove = (moveEvent: PointerEvent): void => {
                if (moveEvent.pointerId !== pointerId) return;
                const laneDelta = Math.round(
                  (moveEvent.clientX - originX) / context.geometry.laneWidth,
                );
                if (laneDelta !== 0) suppressedClick.current = region.id;
              };
              const finish = (upEvent: PointerEvent): void => {
                if (upEvent.pointerId !== pointerId) return;
                cleanup();
                const laneDelta = Math.round(
                  (upEvent.clientX - originX) / context.geometry.laneWidth,
                );
                const target =
                  lanes[clamp(context.geometry.laneIndex + laneDelta, 0, lanes.length - 1)];
                if (target && target.date !== context.lane.date) onMove(region, target.date);
              };
              const cancel = (cancelEvent: PointerEvent): void => {
                if (cancelEvent.pointerId === pointerId) cleanup();
              };
              const cleanup = (): void => {
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerup', finish);
                window.removeEventListener('pointercancel', cancel);
              };
              window.addEventListener('pointermove', onPointerMove);
              window.addEventListener('pointerup', finish);
              window.addEventListener('pointercancel', cancel);
            }}
          >
            <MapPin aria-hidden="true" className="size-3.5! shrink-0" />
            <span className="truncate">{region.label}</span>
          </button>
        ) : (
          <span
            key={region.id}
            data-work-location-read-only="true"
            className="bg-surface-container text-on-surface-variant text-label-small inline-flex min-h-7 min-w-0 items-center gap-1 rounded-full px-2"
          >
            <MapPin aria-hidden="true" className="size-3.5! shrink-0" />
            <span className="truncate">{region.label}</span>
          </span>
        ),
      )}
    </div>
  );
}

/** Render partial-day location rails and direct-manipulation controls inside one timed lane. */
export function WorkLocationTimedLaneContext({
  regions,
  context,
  displayTimezone,
  onOpen,
  onEdit,
}: WorkLocationTimedLaneContextProps): JSX.Element | null {
  const suppressedClick = useRef<string | null>(null);
  const visible = regions.flatMap((region) => {
    if (region.allDay) return [];
    const bounds = regionBounds(region, context.lane, displayTimezone);
    return bounds ? [{ region, bounds }] : [];
  });
  if (visible.length === 0) return null;
  return (
    <>
      {visible.map(({ region, bounds }) => {
        const top = (bounds.startMinutes / 60) * context.geometry.pixelsPerHour;
        const height =
          ((bounds.endMinutes - bounds.startMinutes) / 60) * context.geometry.pixelsPerHour;
        const rail = (
          <span
            data-testid="work-location-rail"
            aria-hidden="true"
            className="bg-tertiary/60 absolute top-0 left-2 h-full w-0.5 rounded-full"
          />
        );
        if (!region.editable) {
          return (
            <div
              key={region.id}
              data-work-location-read-only="true"
              className="absolute right-0 left-0"
              style={{ top, height }}
            >
              {rail}
              <span className="bg-surface-container text-on-surface-variant text-label-small absolute top-0 left-3 max-w-[calc(100%-1rem)] truncate rounded-full px-2 py-1">
                {region.label}
              </span>
            </div>
          );
        }
        const startSession = (
          event: React.PointerEvent<HTMLElement>,
          mode: 'move' | 'resize-start' | 'resize-end',
        ): void => {
          startTimedPointerSession({
            event,
            mode,
            region,
            bounds,
            context,
            onCommit: onEdit,
            onDragged: () => {
              suppressedClick.current = region.id;
            },
          });
        };
        return (
          <div
            key={region.id}
            className="absolute right-0 left-0"
            style={{ top, height }}
            data-work-location-timed={region.id}
          >
            {rail}
            <button
              type="button"
              aria-label={`Move ${region.label} work location`}
              className="bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest active:bg-secondary-container focus-visible:outline-primary text-label-small pointer-events-auto absolute top-0 left-3 inline-flex min-h-7 max-w-[calc(100%-1rem)] min-w-7 items-center gap-1 rounded-full px-2 focus-visible:outline-2 focus-visible:outline-offset-2 motion-safe:transition-colors motion-reduce:transition-none [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
              onClick={() => {
                if (suppressedClick.current === region.id) {
                  suppressedClick.current = null;
                  return;
                }
                onOpen(region);
              }}
              onPointerDown={(event) => {
                startSession(event, 'move');
              }}
            >
              <MapPin aria-hidden="true" className="size-3.5! shrink-0" />
              <span className="truncate">{region.label}</span>
            </button>
            <button
              type="button"
              aria-label={`Resize start of ${region.label}`}
              className="hover:bg-tertiary-container/30 active:bg-tertiary-container/50 focus-visible:bg-tertiary-container/30 focus-visible:outline-primary pointer-events-auto absolute -top-2 left-0 min-h-4 min-w-4 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 motion-safe:transition-colors motion-reduce:transition-none [@media(pointer:coarse)]:-top-5 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
              onPointerDown={(event) => {
                startSession(event, 'resize-start');
              }}
            />
            <button
              type="button"
              aria-label={`Resize end of ${region.label}`}
              className="hover:bg-tertiary-container/30 active:bg-tertiary-container/50 focus-visible:bg-tertiary-container/30 focus-visible:outline-primary pointer-events-auto absolute -bottom-2 left-0 min-h-4 min-w-4 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 motion-safe:transition-colors motion-reduce:transition-none [@media(pointer:coarse)]:-bottom-5 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11"
              onPointerDown={(event) => {
                startSession(event, 'resize-end');
              }}
            />
          </div>
        );
      })}
    </>
  );
}

/** Decorate one timebox with context partitions while the item stays one interaction target. */
export function WorkLocationTimeboxDecoration({
  regions,
  context,
  displayTimezone,
}: WorkLocationTimeboxDecorationProps): JSX.Element | null {
  if (context.item.appearance !== 'timebox') return null;
  const regionById = new Map(regions.map((region) => [region.id, region]));
  const projected = regions.flatMap((region) => {
    if (region.allDay) return [];
    const bounds = regionBounds(region, context.lane, displayTimezone);
    return bounds ? [{ id: region.id, ...bounds }] : [];
  });
  const sections = partitionScheduleRangeByContext(context.geometry.bounds, projected);
  const duration = context.geometry.bounds.endMinutes - context.geometry.bounds.startMinutes;
  if (duration <= 0) return null;
  return (
    <div className="absolute inset-0 overflow-hidden rounded-[inherit]">
      {sections.map((section) => {
        const region = section.contextId ? regionById.get(section.contextId) : undefined;
        const top =
          ((section.startMinutes - context.geometry.bounds.startMinutes) / duration) * 100;
        const height = ((section.endMinutes - section.startMinutes) / duration) * 100;
        return (
          <span
            key={`${section.contextId ?? 'neutral'}:${String(section.startMinutes)}`}
            data-testid="work-location-timebox-section"
            data-context={region ? 'location' : 'neutral'}
            className={
              region
                ? 'bg-tertiary-container/20 border-tertiary/50 absolute inset-x-0 border-l-2'
                : 'absolute inset-x-0 bg-transparent'
            }
            style={{ top: `${String(top)}%`, height: `${String(height)}%` }}
          />
        );
      })}
    </div>
  );
}
