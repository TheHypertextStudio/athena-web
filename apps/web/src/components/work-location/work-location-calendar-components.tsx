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

const WORK_LOCATION_RAIL_LEFT_PX = 8;
const WORK_LOCATION_RAIL_WIDTH_PX = 2;

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

/** Format one wall-clock minute using stable application-owned calendar gesture copy. */
function wallTimeLabel(minutes: number): string {
  const normalized = clamp(minutes, 0, 1_440) % 1_440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const period = hour < 12 ? 'AM' : 'PM';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(displayHour)}:${String(minute).padStart(2, '0')} ${period}`;
}

/** Build one consistent work-location preview or completion announcement. */
function timedGestureAnnouncement(input: {
  readonly phase: 'preview' | 'complete';
  readonly mode: 'move' | 'resize-start' | 'resize-end';
  readonly label: string;
  readonly laneLabel: string;
  readonly startMinutes: number;
  readonly endMinutes: number;
}): string {
  const verb =
    input.mode === 'move'
      ? input.phase === 'preview'
        ? 'Moving'
        : 'Moved'
      : input.phase === 'preview'
        ? 'Resizing'
        : 'Resized';
  return `${verb} ${input.label} work location to ${input.laneLabel}, ${wallTimeLabel(input.startMinutes)} to ${wallTimeLabel(input.endMinutes)}.`;
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
    targetLabel: string;
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
      preview = {
        targetDate: targetLane.date,
        targetLabel: targetLane.label,
        startMinutes,
        endMinutes: startMinutes + duration,
      };
    } else if (input.mode === 'resize-start') {
      preview = {
        targetDate: targetLane.date,
        targetLabel: targetLane.label,
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
        targetLabel: targetLane.label,
        startMinutes: input.bounds.startMinutes,
        endMinutes: clamp(
          input.bounds.endMinutes + minuteDelta,
          input.bounds.startMinutes + input.context.snapMinutes,
          1_440,
        ),
      };
    }
    input.context.onAnnouncementChange(
      timedGestureAnnouncement({
        phase: 'preview',
        mode: input.mode,
        label: input.region.label,
        laneLabel: preview.targetLabel,
        startMinutes: preview.startMinutes,
        endMinutes: preview.endMinutes,
      }),
    );
    input.onDragged();
  };
  const finish = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', cancel);
    if (preview) {
      input.onCommit({
        region: input.region,
        targetDate: preview.targetDate,
        startMinutes: preview.startMinutes,
        endMinutes: preview.endMinutes,
      });
      input.context.onAnnouncementChange(
        timedGestureAnnouncement({
          phase: 'complete',
          mode: input.mode,
          label: input.region.label,
          laneLabel: preview.targetLabel,
          startMinutes: preview.startMinutes,
          endMinutes: preview.endMinutes,
        }),
      );
    }
  };
  const cancel = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', cancel);
    input.context.onAnnouncementChange('');
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
            className="group focus-visible:outline-primary inline-flex min-h-11 max-w-full min-w-11 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2"
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
                if (laneDelta !== 0) {
                  suppressedClick.current = region.id;
                  const target =
                    lanes[clamp(context.geometry.laneIndex + laneDelta, 0, lanes.length - 1)];
                  if (target) {
                    context.onAnnouncementChange(
                      `Moving ${region.label} work location to ${target.label}.`,
                    );
                  }
                }
              };
              const finish = (upEvent: PointerEvent): void => {
                if (upEvent.pointerId !== pointerId) return;
                cleanup();
                const laneDelta = Math.round(
                  (upEvent.clientX - originX) / context.geometry.laneWidth,
                );
                const target =
                  lanes[clamp(context.geometry.laneIndex + laneDelta, 0, lanes.length - 1)];
                if (target && target.date !== context.lane.date) {
                  onMove(region, target.date);
                  context.onAnnouncementChange(
                    `Moved ${region.label} work location to ${target.label}.`,
                  );
                }
              };
              const cancel = (cancelEvent: PointerEvent): void => {
                if (cancelEvent.pointerId === pointerId) {
                  cleanup();
                  context.onAnnouncementChange('');
                }
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
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault();
              event.stopPropagation();
              const delta = event.key === 'ArrowLeft' ? -1 : 1;
              const target =
                lanes[clamp(context.geometry.laneIndex + delta, 0, Math.max(0, lanes.length - 1))];
              if (!target || target.date === context.lane.date) return;
              onMove(region, target.date);
              context.onAnnouncementChange(
                `Moved ${region.label} work location to ${target.label}.`,
              );
            }}
          >
            <span
              className="bg-surface-container-high text-on-surface-variant group-hover:bg-surface-container-highest group-active:bg-secondary-container text-label-small inline-flex min-h-7 max-w-full items-center gap-1 rounded-full px-2 motion-safe:transition-colors motion-reduce:transition-none"
              data-work-location-chip-visual=""
            >
              <MapPin aria-hidden="true" className="size-3.5! shrink-0" />
              <span className="truncate">{region.label}</span>
            </span>
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
        const commitKeyboardEdit = (
          event: React.KeyboardEvent<HTMLButtonElement>,
          mode: 'move' | 'resize-start' | 'resize-end',
        ): void => {
          const movesDate =
            mode === 'move' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight');
          const movesTime = event.key === 'ArrowUp' || event.key === 'ArrowDown';
          if (!movesDate && !movesTime) return;
          event.preventDefault();
          event.stopPropagation();
          const laneDelta = movesDate ? (event.key === 'ArrowLeft' ? -1 : 1) : 0;
          const targetIndex = clamp(
            context.geometry.laneIndex + laneDelta,
            0,
            context.lanes.length - 1,
          );
          const targetLane = context.lanes[targetIndex];
          if (!targetLane) return;
          const minuteDelta = movesTime
            ? event.key === 'ArrowUp'
              ? -context.snapMinutes
              : context.snapMinutes
            : 0;
          const duration = bounds.endMinutes - bounds.startMinutes;
          let startMinutes = bounds.startMinutes;
          let endMinutes = bounds.endMinutes;
          if (mode === 'move') {
            startMinutes = clamp(bounds.startMinutes + minuteDelta, 0, 1_440 - duration);
            endMinutes = startMinutes + duration;
          } else if (mode === 'resize-start') {
            startMinutes = clamp(
              bounds.startMinutes + minuteDelta,
              0,
              bounds.endMinutes - context.snapMinutes,
            );
          } else {
            endMinutes = clamp(
              bounds.endMinutes + minuteDelta,
              bounds.startMinutes + context.snapMinutes,
              1_440,
            );
          }
          if (
            targetLane.date === context.lane.date &&
            startMinutes === bounds.startMinutes &&
            endMinutes === bounds.endMinutes
          ) {
            return;
          }
          onEdit({ region, targetDate: targetLane.date, startMinutes, endMinutes });
          context.onAnnouncementChange(
            timedGestureAnnouncement({
              phase: 'complete',
              mode,
              label: region.label,
              laneLabel: targetLane.label,
              startMinutes,
              endMinutes,
            }),
          );
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
              className="group focus-visible:outline-primary pointer-events-auto absolute -top-2 left-3 z-10 inline-flex min-h-11 max-w-[calc(100%-1rem)] min-w-11 items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2"
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
              onKeyDown={(event) => {
                commitKeyboardEdit(event, 'move');
              }}
            >
              <span className="bg-surface-container-high text-on-surface-variant group-hover:bg-surface-container-highest group-active:bg-secondary-container text-label-small inline-flex min-h-7 max-w-full items-center gap-1 rounded-full px-2 motion-safe:transition-colors motion-reduce:transition-none">
                <MapPin aria-hidden="true" className="size-3.5! shrink-0" />
                <span className="truncate">{region.label}</span>
              </span>
            </button>
            <button
              type="button"
              aria-label={`Resize start of ${region.label}`}
              className="hover:bg-tertiary-container/30 active:bg-tertiary-container/50 focus-visible:bg-tertiary-container/30 focus-visible:outline-primary pointer-events-auto absolute -top-5 left-0 z-20 min-h-11 min-w-11 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 motion-safe:transition-colors motion-reduce:transition-none"
              onPointerDown={(event) => {
                startSession(event, 'resize-start');
              }}
              onKeyDown={(event) => {
                commitKeyboardEdit(event, 'resize-start');
              }}
            />
            <button
              type="button"
              aria-label={`Resize end of ${region.label}`}
              className="hover:bg-tertiary-container/30 active:bg-tertiary-container/50 focus-visible:bg-tertiary-container/30 focus-visible:outline-primary pointer-events-auto absolute -bottom-5 left-0 z-20 min-h-11 min-w-11 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 motion-safe:transition-colors motion-reduce:transition-none"
              onPointerDown={(event) => {
                startSession(event, 'resize-end');
              }}
              onKeyDown={(event) => {
                commitKeyboardEdit(event, 'resize-end');
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
  const connectorWidth = Math.max(
    0,
    context.geometry.leadingOffset - WORK_LOCATION_RAIL_LEFT_PX - WORK_LOCATION_RAIL_WIDTH_PX,
  );
  return (
    <div className="absolute inset-0 overflow-visible rounded-[inherit]">
      {sections.map((section) => {
        const region = section.contextId ? regionById.get(section.contextId) : undefined;
        const top =
          ((section.startMinutes - context.geometry.bounds.startMinutes) / duration) * 100;
        const height = ((section.endMinutes - section.startMinutes) / duration) * 100;
        return (
          <span
            key={`${section.contextId ?? 'neutral'}:${String(section.startMinutes)}`}
            className="contents"
          >
            {region && connectorWidth > 0 ? (
              <span
                data-testid="work-location-timebox-connector"
                className="bg-tertiary/50 pointer-events-none absolute h-0.5"
                style={{
                  left: -connectorWidth,
                  top: `${String(top + height / 2)}%`,
                  width: connectorWidth,
                }}
              />
            ) : null}
            <span
              data-testid="work-location-timebox-section"
              data-context={region ? 'location' : 'neutral'}
              className={
                region
                  ? 'bg-tertiary-container/20 border-tertiary/50 absolute inset-x-0 overflow-hidden border-l-2'
                  : 'absolute inset-x-0 overflow-hidden bg-transparent'
              }
              style={{ top: `${String(top)}%`, height: `${String(height)}%` }}
            />
          </span>
        );
      })}
    </div>
  );
}
