'use client';

import { Home, MapPin } from '@docket/ui/icons';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@docket/ui/primitives';
import { type JSX, useEffect, useRef, useState } from 'react';

import {
  partitionScheduleRangeByContext,
  projectInstantRangeToScheduleLane,
  resolveScheduleWallInstant,
  type ScheduleAllDayLaneRenderContext,
  type ScheduleLane,
  type ScheduleMinuteBounds,
  type ScheduleTimedItemDecorationContext,
  type ScheduleTimedLaneContextRenderContext,
} from '@/components/scheduling';

import type { WorkLocationCalendarRegion } from './work-location-calendar-model';

/** Width reserved for a partial-day work-location rail and its interaction targets. */
export const WORK_LOCATION_TIMED_TRACK_WIDTH_PX = 40;

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
    readonly mode: 'move' | 'resize-start' | 'resize-end';
    readonly sourceDate: string;
    readonly sourceStartMinutes: number;
    readonly sourceEndMinutes: number;
    readonly targetDate: string;
    readonly startMinutes: number;
    readonly endMinutes: number;
  }) => WorkLocationTimedEditOutcome;
}

/** Explicit result of converting a visible gesture into exact work-location bounds. */
export type WorkLocationTimedEditOutcome =
  { readonly status: 'accepted' } | { readonly status: 'rejected'; readonly announcement: string };

interface WorkLocationTimedPreview {
  readonly regionId: string;
  readonly mode: 'move' | 'resize-start' | 'resize-end';
  readonly targetDate: string;
  readonly targetLabel: string;
  readonly targetIndex: number;
  readonly startMinutes: number;
  readonly endMinutes: number;
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

/** Resolve the shared leading track for a timed item that intersects a partial-day location. */
export function resolveWorkLocationTimedLeadingInset(input: {
  readonly regions: readonly WorkLocationCalendarRegion[];
  readonly lane: ScheduleLane;
  readonly bounds: ScheduleMinuteBounds;
  readonly displayTimezone: string;
}): number {
  const intersects = input.regions.some((region) => {
    if (region.allDay) return false;
    const bounds = regionBounds(region, input.lane, input.displayTimezone);
    return (
      bounds !== null &&
      input.bounds.startMinutes < bounds.endMinutes &&
      bounds.startMinutes < input.bounds.endMinutes
    );
  });
  return intersects ? WORK_LOCATION_TIMED_TRACK_WIDTH_PX : 0;
}

/** Return whether one lane has a complete-day work-location region to render. */
export function hasWorkLocationAllDayRegion(input: {
  readonly regions: readonly WorkLocationCalendarRegion[];
  readonly lane: ScheduleLane;
  readonly displayTimezone: string;
}): boolean {
  return input.regions.some((region) => {
    const bounds = regionBounds(region, input.lane, input.displayTimezone);
    return region.allDay && bounds?.startMinutes === 0 && bounds.endMinutes === 1_440;
  });
}

/** Return whether one projected lane edge maps to the region's exact owned source endpoint. */
function regionOwnsLaneEdge(
  region: WorkLocationCalendarRegion,
  lane: ScheduleLane,
  minutes: number,
  edge: 'start' | 'end',
  displayTimezone: string,
): boolean {
  if (edge === 'start' ? !region.ownsStart : !region.ownsEnd) return false;
  const exact = edge === 'start' ? region.sourceStartsAt : region.sourceEndsAt;
  const resolution = resolveScheduleWallInstant(lane.date, minutes, displayTimezone, exact);
  return resolution.kind === 'resolved' && Date.parse(resolution.instant) === Date.parse(exact);
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
  readonly onPreview: (preview: WorkLocationTimedPreview | null) => void;
}): void {
  if (input.event.button !== 0) return;
  input.event.preventDefault();
  input.event.stopPropagation();
  input.onPreview(null);
  const pointerId = input.event.pointerId;
  const originX = input.event.clientX;
  const originY = input.event.clientY;
  let preview: WorkLocationTimedPreview | null = null;

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
        regionId: input.region.id,
        mode: input.mode,
        targetDate: targetLane.date,
        targetLabel: targetLane.label,
        targetIndex,
        startMinutes,
        endMinutes: startMinutes + duration,
      };
    } else if (input.mode === 'resize-start') {
      preview = {
        regionId: input.region.id,
        mode: input.mode,
        targetDate: targetLane.date,
        targetLabel: targetLane.label,
        targetIndex,
        startMinutes: clamp(
          input.bounds.startMinutes + minuteDelta,
          0,
          input.bounds.endMinutes - input.context.snapMinutes,
        ),
        endMinutes: input.bounds.endMinutes,
      };
    } else {
      preview = {
        regionId: input.region.id,
        mode: input.mode,
        targetDate: targetLane.date,
        targetLabel: targetLane.label,
        targetIndex,
        startMinutes: input.bounds.startMinutes,
        endMinutes: clamp(
          input.bounds.endMinutes + minuteDelta,
          input.bounds.startMinutes + input.context.snapMinutes,
          1_440,
        ),
      };
    }
    const changed =
      preview.targetDate !== input.context.lane.date ||
      preview.startMinutes !== input.bounds.startMinutes ||
      preview.endMinutes !== input.bounds.endMinutes;
    if (!changed) {
      preview = null;
      input.onPreview(null);
      input.context.onAnnouncementChange('');
      return;
    }
    input.onPreview(preview);
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
  };
  const finish = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    onMove(event);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', cancel);
    if (preview) {
      input.onDragged();
      const outcome = input.onCommit({
        region: input.region,
        mode: input.mode,
        sourceDate: input.context.lane.date,
        sourceStartMinutes: input.bounds.startMinutes,
        sourceEndMinutes: input.bounds.endMinutes,
        targetDate: preview.targetDate,
        startMinutes: preview.startMinutes,
        endMinutes: preview.endMinutes,
      });
      input.onPreview(null);
      input.context.onAnnouncementChange(
        outcome.status === 'accepted'
          ? timedGestureAnnouncement({
              phase: 'complete',
              mode: input.mode,
              label: input.region.label,
              laneLabel: preview.targetLabel,
              startMinutes: preview.startMinutes,
              endMinutes: preview.endMinutes,
            })
          : outcome.announcement,
      );
    }
  };
  const cancel = (event: PointerEvent): void => {
    if (event.pointerId !== pointerId) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', cancel);
    input.onPreview(null);
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
    <div
      className="flex h-10 min-w-0 flex-nowrap items-center gap-1 overflow-hidden"
      aria-label="Expected work location"
    >
      {visible.map((region) =>
        region.editable ? (
          <button
            key={region.id}
            type="button"
            aria-label={`${region.label} work location`}
            className="group focus-visible:outline-primary inline-flex min-h-10 max-w-full min-w-10 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2"
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
                const target =
                  lanes[clamp(context.geometry.laneIndex + laneDelta, 0, lanes.length - 1)];
                if (target && target.date !== context.lane.date) {
                  context.onAnnouncementChange(
                    `Moving ${region.label} work location to ${target.label}.`,
                  );
                } else {
                  context.onAnnouncementChange('');
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
                  suppressedClick.current = region.id;
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
              {region.isHome ? (
                <Home aria-hidden="true" className="size-3.5! shrink-0" />
              ) : (
                <MapPin aria-hidden="true" className="size-3.5! shrink-0" />
              )}
              <span className="truncate">{region.label}</span>
            </span>
          </button>
        ) : (
          <span
            key={region.id}
            data-work-location-read-only="true"
            className="bg-surface-container text-on-surface-variant text-label-small inline-flex min-h-7 min-w-0 items-center gap-1 rounded-full px-2"
          >
            {region.isHome ? (
              <Home aria-hidden="true" className="size-3.5! shrink-0" />
            ) : (
              <MapPin aria-hidden="true" className="size-3.5! shrink-0" />
            )}
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
  const [preview, setPreview] = useState<WorkLocationTimedPreview | null>(null);
  const visible = regions.flatMap((region) => {
    if (region.allDay) return [];
    const bounds = regionBounds(region, context.lane, displayTimezone);
    return bounds
      ? [
          {
            region,
            bounds,
            ownsStart: regionOwnsLaneEdge(
              region,
              context.lane,
              bounds.startMinutes,
              'start',
              displayTimezone,
            ),
            ownsEnd: regionOwnsLaneEdge(
              region,
              context.lane,
              bounds.endMinutes,
              'end',
              displayTimezone,
            ),
          },
        ]
      : [];
  });
  const previewRegion = preview
    ? visible.find(({ region }) => region.id === preview.regionId)?.region
    : undefined;
  const PreviewMarkerIcon = previewRegion?.isHome ? Home : MapPin;
  useEffect(() => {
    setPreview(null);
  }, [context.lane.id, regions]);
  if (visible.length === 0) return null;

  const pointerOwner = (
    mode: WorkLocationTimedPreview['mode'],
    clientY: number,
    target: HTMLElement,
  ) => {
    const laneTop =
      target.closest<HTMLElement>('[data-schedule-timed-lane-context]')?.getBoundingClientRect()
        .top ?? 0;
    const pointerMinutes = ((clientY - laneTop) * 60) / context.geometry.pixelsPerHour;
    const candidates = visible.filter(
      (entry) =>
        entry.region.editable &&
        (mode === 'move' || (mode === 'resize-start' ? entry.ownsStart : entry.ownsEnd)),
    );
    return candidates.sort((left, right) => {
      const leftAnchor = mode === 'resize-end' ? left.bounds.endMinutes : left.bounds.startMinutes;
      const rightAnchor =
        mode === 'resize-end' ? right.bounds.endMinutes : right.bounds.startMinutes;
      return Math.abs(leftAnchor - pointerMinutes) - Math.abs(rightAnchor - pointerMinutes);
    })[0];
  };
  return (
    <TooltipProvider delayDuration={300}>
      {preview ? (
        <div
          data-testid="work-location-rail-preview"
          aria-hidden="true"
          className="pointer-events-none absolute right-0 left-0 z-40"
          style={{
            top: (preview.startMinutes / 60) * context.geometry.pixelsPerHour,
            height:
              ((preview.endMinutes - preview.startMinutes) / 60) * context.geometry.pixelsPerHour,
            transform:
              preview.targetIndex === context.geometry.laneIndex
                ? undefined
                : `translateX(${String((preview.targetIndex - context.geometry.laneIndex) * context.geometry.laneWidth)}px)`,
          }}
        >
          <span className="bg-tertiary-container/35 absolute top-0 left-1.5 h-full w-7 rounded-full" />
          <span className="bg-tertiary absolute top-0 left-[19px] h-full w-0.5 rounded-full" />
          <span className="bg-tertiary-container text-on-tertiary-container absolute -top-3 left-2 flex size-6 items-center justify-center rounded-full">
            <PreviewMarkerIcon aria-hidden="true" className="size-3.5!" />
          </span>
        </div>
      ) : null}
      {visible.map(({ region, bounds, ownsStart, ownsEnd }) => {
        const top = (bounds.startMinutes / 60) * context.geometry.pixelsPerHour;
        const height =
          ((bounds.endMinutes - bounds.startMinutes) / 60) * context.geometry.pixelsPerHour;
        const rail = (
          <>
            <span
              data-testid="work-location-band"
              data-work-location-band={region.id}
              aria-hidden="true"
              className="bg-tertiary-container/35 pointer-events-none absolute top-0 left-1.5 h-full w-7 rounded-full"
            />
            <span
              data-testid="work-location-rail"
              aria-hidden="true"
              className="bg-tertiary pointer-events-none absolute top-0 left-[19px] h-full w-0.5 rounded-full"
            />
          </>
        );
        if (!region.editable) {
          const description = `${region.label}, ${wallTimeLabel(bounds.startMinutes)} to ${wallTimeLabel(bounds.endMinutes)}`;
          const descriptionId = `work-location-description-${region.id}`;
          const MarkerIcon = region.isHome ? Home : MapPin;
          return (
            <div
              key={region.id}
              data-work-location-read-only="true"
              className="absolute right-0 left-0"
              style={{ top, height }}
            >
              {rail}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    tabIndex={0}
                    aria-label={`${region.label} work location`}
                    aria-describedby={descriptionId}
                    className="focus-visible:outline-primary pointer-events-auto absolute -top-5 left-0 flex size-10 items-center justify-center rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    <span
                      data-work-location-marker-kind={region.isHome ? 'home' : 'place'}
                      className="bg-tertiary-container text-on-tertiary-container flex size-6 items-center justify-center rounded-full"
                    >
                      <MarkerIcon aria-hidden="true" className="size-3.5!" />
                    </span>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{description}</TooltipContent>
              </Tooltip>
              <span id={descriptionId} className="sr-only">
                {description}
              </span>
            </div>
          );
        }
        const startSession = (
          event: React.PointerEvent<HTMLElement>,
          mode: 'move' | 'resize-start' | 'resize-end',
        ): void => {
          const owner = pointerOwner(mode, event.clientY, event.currentTarget);
          if (!owner) return;
          startTimedPointerSession({
            event,
            mode,
            region: owner.region,
            bounds: owner.bounds,
            context,
            onCommit: onEdit,
            onDragged: () => {
              suppressedClick.current = region.id;
            },
            onPreview: setPreview,
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
          const nextPreview: WorkLocationTimedPreview = {
            regionId: region.id,
            mode,
            targetDate: targetLane.date,
            targetLabel: targetLane.label,
            targetIndex,
            startMinutes,
            endMinutes,
          };
          setPreview(nextPreview);
          context.onAnnouncementChange(
            timedGestureAnnouncement({
              phase: 'preview',
              mode,
              label: region.label,
              laneLabel: targetLane.label,
              startMinutes,
              endMinutes,
            }),
          );
          const outcome = onEdit({
            region,
            mode,
            sourceDate: context.lane.date,
            sourceStartMinutes: bounds.startMinutes,
            sourceEndMinutes: bounds.endMinutes,
            targetDate: targetLane.date,
            startMinutes,
            endMinutes,
          });
          if (outcome.status === 'rejected') {
            setPreview(null);
            context.onAnnouncementChange(outcome.announcement);
            return;
          }
          setPreview(null);
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
        const description = `${region.label}, ${wallTimeLabel(bounds.startMinutes)} to ${wallTimeLabel(bounds.endMinutes)}`;
        const descriptionId = `work-location-description-${region.id}`;
        const MarkerIcon = region.isHome ? Home : MapPin;
        return (
          <div
            key={region.id}
            className="absolute right-0 left-0"
            style={{ top, height }}
            data-work-location-timed={region.id}
          >
            {rail}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`Move ${region.label} work location`}
                  aria-describedby={descriptionId}
                  data-work-location-hit-slot="move"
                  className="group focus-visible:outline-primary pointer-events-auto absolute -top-5 left-0 z-30 flex size-10 min-h-10 min-w-10 items-center justify-center rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
                  onClick={(event) => {
                    if (suppressedClick.current !== null) {
                      suppressedClick.current = null;
                      return;
                    }
                    const owner =
                      event.detail === 0
                        ? { region }
                        : pointerOwner('move', event.clientY, event.currentTarget);
                    if (owner) onOpen(owner.region);
                  }}
                  onPointerDown={(event) => {
                    startSession(event, 'move');
                  }}
                  onKeyDown={(event) => {
                    commitKeyboardEdit(event, 'move');
                  }}
                >
                  <span
                    data-work-location-marker-kind={region.isHome ? 'home' : 'place'}
                    className="bg-tertiary-container text-on-tertiary-container group-hover:bg-tertiary-container/80 group-active:bg-tertiary-container/70 ring-tertiary flex size-6 items-center justify-center rounded-full ring-1 motion-safe:transition-colors motion-reduce:transition-none"
                  >
                    <MarkerIcon aria-hidden="true" className="size-3.5!" />
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent>{description}</TooltipContent>
            </Tooltip>
            <span id={descriptionId} className="sr-only">
              {description}
            </span>
            {ownsStart ? (
              <button
                type="button"
                aria-label={`Resize start of ${region.label}`}
                data-work-location-hit-slot="start"
                className="hover:bg-tertiary-container/30 active:bg-tertiary-container/50 focus-visible:bg-tertiary-container/30 focus-visible:outline-primary pointer-events-auto absolute z-20 size-10 min-h-10 min-w-10 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 motion-safe:transition-colors motion-reduce:transition-none"
                style={{ left: 0, top: 20, width: 40, height: 40 }}
                onPointerDown={(event) => {
                  startSession(event, 'resize-start');
                }}
                onKeyDown={(event) => {
                  commitKeyboardEdit(event, 'resize-start');
                }}
              />
            ) : null}
            {ownsEnd ? (
              <button
                type="button"
                aria-label={`Resize end of ${region.label}`}
                data-work-location-hit-slot="end"
                className="hover:bg-tertiary-container/30 active:bg-tertiary-container/50 focus-visible:bg-tertiary-container/30 focus-visible:outline-primary pointer-events-auto absolute z-20 size-10 min-h-10 min-w-10 rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 motion-safe:transition-colors motion-reduce:transition-none"
                style={{
                  left: 0,
                  top: height - 20,
                  width: 40,
                  height: 40,
                }}
                onPointerDown={(event) => {
                  startSession(event, 'resize-end');
                }}
                onKeyDown={(event) => {
                  commitKeyboardEdit(event, 'resize-end');
                }}
              />
            ) : null}
          </div>
        );
      })}
    </TooltipProvider>
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
