'use client';

/**
 * `(app)/calendar` — orchestrates the fluid date and people scheduling axes.
 *
 * @remarks
 * Geometry, data loading, controls, and gesture persistence live in focused collaborators. This
 * component owns only page-level state; it does not define day/week modes or a fixed lane count.
 *
 * ## Page layout contract
 *
 * The page is a two-child column: one never-wrapping {@link CalendarToolbar} and the scheduling
 * surface. Nothing else is allowed to take a band of vertical budget above the grid — layer
 * visibility and people comparison were both inline blocks here and are now popovers hanging off
 * the toolbar row, because "which calendars / which people" is a setting and the events are the
 * content. The grid reaches the page edge while the toolbar alone keeps its control inset. The page column clips overflow while
 * the shared canvas owns both axes, so wheel, touch, and keyboard scrolling never compete across
 * nested vertical scrollports.
 *
 * ## Zoom
 *
 * `pixelsPerHour` is a continuous, per-user persisted number with two writers: the Display menu
 * (discrete, commits immediately) and a trackpad pinch on the canvas (continuous, commits on a
 * trailing debounce so a gesture does not fire one PATCH per wheel event). Both funnel through
 * {@link clampPixelsPerHour}, so no path can persist an illegal height.
 */
import type {
  CalendarPreferences,
  HubPreferences,
} from '@docket/planning/hub-preferences-contract';
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';

import { shiftISODate } from '@/components/agenda/agenda-context';
import CalendarItemDrawer from '@/components/calendar/calendar-item-drawer';
import { CalendarItemPeekOverlay } from '@/components/calendar/item-peek/calendar-item-peek-overlay';
import {
  resolvePeekItem,
  useCalendarItemSelection,
} from '@/components/calendar/item-peek/use-calendar-item-selection';
import CreateBlockForm from '@/components/calendar/create-block-form';
import { resolveScheduleTimezone, useScheduleDisplayDate } from '@/components/scheduling';
import { workLocationPlacesDef } from '@/components/work-location/work-location-data';
import { useWorkLocationCalendarComposition } from '@/components/work-location/use-work-location-calendar-composition';
import { api } from '@/lib/api';
import {
  apiQueryOptions,
  queryKeys,
  STALE,
  unwrap,
  useApiMutation,
  useApiListQuery,
  useApiQuery,
} from '@/lib/query';
import { useNow } from '@/lib/use-now';

import { CalendarComparisonControls } from './calendar-comparison-controls';
import { CalendarLayersMenu } from './calendar-layers-menu';
import { calendarRangeLabel } from './calendar-range-label';
import type { CalendarAxis } from './calendar-schedule-model';
import {
  type CalendarCanvasRegionSelection,
  CalendarSchedulingSurface,
} from './calendar-scheduling-surface';
import {
  CalendarSharedItemDetails,
  type SharedCalendarItemDetail,
} from './calendar-shared-item-details';
import { CalendarToolbar } from './calendar-toolbar';
import { clampPixelsPerHour, DEFAULT_PIXELS_PER_HOUR } from './calendar-view-settings';
import { useCalendarDateAxis } from './use-calendar-date-axis';
import { type CalendarPeopleAxisState, useCalendarPeopleAxis } from './use-calendar-people-axis';

/**
 * Trailing debounce applied to a pinch-driven zoom write.
 *
 * @remarks
 * A trackpad pinch emits a wheel event every few milliseconds. Persisting each one would spend a
 * PATCH per frame for a value the user is still adjusting, so only the settled value is written.
 */
const ZOOM_GESTURE_COMMIT_MS = 300;

interface CalendarClientProps {
  readonly initialNow?: string;
  readonly initialTimezone?: HubPreferences['timezone'];
}

/** Keep the first server and browser date in the same zone until hydration finishes. */
function useHydratedCalendarTimezone(
  timezone: HubPreferences['timezone'] | undefined,
  initialTimezone: HubPreferences['timezone'] | undefined,
): string {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  return resolveScheduleTimezone(timezone ?? initialTimezone ?? (hydrated ? undefined : 'UTC'));
}

/** Dismiss only anchored peeks when a date or comparison change replaces their source lanes. */
function useCalendarContextReset(
  contextKey: string,
  tier: 'peek' | 'detail' | undefined,
  setOpenSharedItem: (item: SharedCalendarItemDetail | null) => void,
  closeEvent: () => void,
): void {
  const previousContextRef = useRef(contextKey);
  useEffect(() => {
    if (previousContextRef.current === contextKey) return;
    previousContextRef.current = contextKey;
    setOpenSharedItem(null);
    // Detail owns its item independently and survives preference correction or date navigation.
    if (tier === 'peek') closeEvent();
  }, [contextKey, tier, setOpenSharedItem, closeEvent]);
}

/** Connect the People toolbar control to the current comparison axis. */
function CalendarPeopleToolbarControl({
  axisState,
}: {
  readonly axisState: CalendarPeopleAxisState;
}): JSX.Element {
  return (
    <CalendarComparisonControls
      workspaces={axisState.sharedWorkspaces}
      workspaceId={axisState.comparisonOrgId}
      members={axisState.activeMembers}
      selectedActorIds={axisState.selectedActorIds}
      membersPending={axisState.membersPending}
      onWorkspaceChange={axisState.selectWorkspace}
      onActorChange={axisState.toggleActor}
    />
  );
}

/** Render the unified calendar page over the shared scheduling canvas. */
export function CalendarClientWithInitialData({
  initialNow,
  initialTimezone,
}: CalendarClientProps): JSX.Element {
  const router = useRouter();
  const [axis, setAxis] = useState<CalendarAxis>('dates');
  const [visibleLaneCount, setVisibleLaneCount] = useState(1);
  const [horizontalAnchorKey, setHorizontalAnchorKey] = useState(0);
  const openEvent = useCalendarItemSelection();
  const { close: closeEvent } = openEvent;
  const [openSharedItem, setOpenSharedItem] = useState<SharedCalendarItemDetail | null>(null);
  const closeSharedItem = useCallback(() => {
    setOpenSharedItem(null);
  }, []);
  const [selection, setSelection] = useState<CalendarCanvasRegionSelection | null>(null);
  const selectionAnchorRef = useRef<HTMLDivElement>(null);
  const [pixelsPerHour, setPixelsPerHour] = useState(DEFAULT_PIXELS_PER_HOUR);
  const pixelsPerHourEdited = useRef(false);
  // Mirrors `pixelsPerHour` so a burst of wheel events compounds off the newest value rather than
  // off whatever the last committed render happened to hold.
  const pixelsPerHourRef = useRef(pixelsPerHour);
  const zoomCommitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [visibleDateRange, setVisibleDateRange] = useState<{
    readonly startDate: string;
    readonly endDate: string;
  } | null>(null);
  const visibleDateRangeRef = useRef(visibleDateRange);
  const now = useNow(30_000, { initialNow }).toISOString();

  const preferencesQuery = useApiQuery(
    apiQueryOptions(
      queryKeys.hubPreferences(),
      () => api.v1.hub.preferences.$get(),
      'Could not load calendar preferences.',
      { staleTime: STALE.standard },
    ),
  );
  const workPlacesQuery = useApiListQuery(workLocationPlacesDef());
  const hubPreferences = preferencesQuery.data;
  const preferences = hubPreferences?.calendar;
  const displayTimezone = useHydratedCalendarTimezone(hubPreferences?.timezone, initialTimezone);
  const {
    date: anchorDate,
    today,
    setDate: setAnchorDate,
  } = useScheduleDisplayDate({
    displayTimezone,
    preferencesReady: hubPreferences !== undefined,
    now,
  });

  /** Apply a zoom to the canvas, keeping the gesture mirror in step with React state. */
  const applyPixelsPerHour = useCallback((next: number): void => {
    pixelsPerHourRef.current = next;
    setPixelsPerHour(next);
  }, []);

  useEffect(() => {
    if (!pixelsPerHourEdited.current && preferences?.pixelsPerHour !== undefined) {
      applyPixelsPerHour(preferences.pixelsPerHour);
    }
  }, [applyPixelsPerHour, preferences?.pixelsPerHour]);

  const savePreferences = useApiMutation<HubPreferences, CalendarPreferences>({
    mutationFn: (calendar) =>
      unwrap(
        () => api.v1.hub.preferences.$patch({ json: { calendar } }),
        'Could not save calendar preferences.',
      ),
    invalidateKeys: [queryKeys.hubPreferences()],
  });

  /** Cancel a pending pinch write so a deliberate commit is never overwritten by a stale one. */
  const cancelPendingZoomCommit = useCallback((): void => {
    if (zoomCommitTimer.current === null) return;
    clearTimeout(zoomCommitTimer.current);
    zoomCommitTimer.current = null;
  }, []);
  useEffect(() => cancelPendingZoomCommit, [cancelPendingZoomCommit]);

  const saveZoom = savePreferences.mutate;
  /** Persist a settled zoom immediately. */
  const commitZoom = useCallback(
    (nextPixelsPerHour: number): void => {
      cancelPendingZoomCommit();
      saveZoom({ ...(preferences ?? {}), pixelsPerHour: nextPixelsPerHour });
    },
    [cancelPendingZoomCommit, preferences, saveZoom],
  );
  // Read through a ref inside the debounce so a gesture that outlives a preferences refetch still
  // writes against the newest preferences object instead of a captured stale one.
  const commitZoomRef = useRef(commitZoom);
  useEffect(() => {
    commitZoomRef.current = commitZoom;
  }, [commitZoom]);

  const dateAxis = useCalendarDateAxis(anchorDate, visibleLaneCount, displayTimezone);
  const peopleAxis = useCalendarPeopleAxis(axis, anchorDate, displayTimezone);
  const workLocationComposition = useWorkLocationCalendarComposition({
    start: dateAxis.startISO,
    end: dateAxis.endISO,
    timezone: displayTimezone,
    lanes: dateAxis.lanes,
  });
  useCalendarContextReset(
    `${anchorDate}:${axis}:${peopleAxis.comparisonOrgId}`,
    openEvent.selection?.tier,
    setOpenSharedItem,
    closeEvent,
  );
  useEffect(() => {
    visibleDateRangeRef.current = null;
    setVisibleDateRange(null);
  }, [anchorDate, axis]);

  const visibleStart = axis === 'dates' ? (visibleDateRange?.startDate ?? anchorDate) : anchorDate;
  const visibleEnd =
    axis === 'dates'
      ? (visibleDateRange?.endDate ?? shiftISODate(anchorDate, Math.max(0, visibleLaneCount - 1)))
      : anchorDate;
  const heading = calendarRangeLabel(visibleStart, visibleEnd);
  const navigate = (direction: 'previous' | 'next'): void => {
    const magnitude = axis === 'people' ? 1 : visibleLaneCount;
    const currentStart = visibleDateRangeRef.current?.startDate ?? anchorDate;
    visibleDateRangeRef.current = null;
    setVisibleDateRange(null);
    setAnchorDate(shiftISODate(currentStart, direction === 'next' ? magnitude : -magnitude));
  };

  return (
    <div
      data-calendar-page=""
      className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden"
    >
      <CalendarToolbar
        heading={heading}
        headingShort={calendarRangeLabel(visibleStart, visibleEnd, 'short')}
        headingTiny={calendarRangeLabel(visibleStart, visibleEnd, 'tiny')}
        axis={axis}
        pixelsPerHour={pixelsPerHour}
        onToday={() => {
          visibleDateRangeRef.current = null;
          setVisibleDateRange(null);
          setHorizontalAnchorKey((current) => current + 1);
          setAnchorDate(today);
        }}
        onPrevious={navigate.bind(null, 'previous')}
        onNext={navigate.bind(null, 'next')}
        onAxisChange={(nextAxis) => {
          // The date axis can recenter its left edge as width changes. People must reopen today.
          if (nextAxis === 'people' && axis !== 'people' && anchorDate !== today) {
            visibleDateRangeRef.current = null;
            setVisibleDateRange(null);
            setAnchorDate(today);
          }
          setAxis(nextAxis);
        }}
        onZoomChange={(nextPixelsPerHour) => {
          pixelsPerHourEdited.current = true;
          applyPixelsPerHour(nextPixelsPerHour);
        }}
        onZoomCommit={commitZoom}
        layersControl={
          <CalendarLayersMenu layers={dateAxis.layers} layersError={dateAxis.layersError} />
        }
        comparisonControl={<CalendarPeopleToolbarControl axisState={peopleAxis} />}
        createControl={
          <CreateBlockForm
            displayTimezone={displayTimezone}
            layers={dateAxis.layers}
            preferences={preferences}
            selection={selection}
            selectionAnchorRef={selectionAnchorRef}
            onSelectionConsumed={() => {
              setSelection(null);
            }}
            workPlaces={workPlacesQuery.data?.items ?? []}
          />
        }
      />

      <CalendarSchedulingSurface
        axis={axis}
        visibleLaneCount={visibleLaneCount}
        horizontalAnchorKey={horizontalAnchorKey}
        pixelsPerHour={pixelsPerHour}
        displayTimezone={displayTimezone}
        now={now}
        preferences={preferences}
        dateAxis={dateAxis}
        peopleAxis={peopleAxis}
        workLocationComposition={workLocationComposition}
        selectedRegion={selection?.canvasRegion}
        selectedRegionAnchorRef={selectionAnchorRef}
        onVisibleLaneCountChange={(count) => {
          const visibleAnchor = visibleDateRangeRef.current?.startDate;
          if (axis === 'dates' && visibleAnchor && visibleAnchor !== anchorDate) {
            visibleDateRangeRef.current = null;
            setVisibleDateRange(null);
            setAnchorDate(visibleAnchor);
          }
          setVisibleLaneCount(count);
        }}
        onVisibleDateRangeChange={(range) => {
          visibleDateRangeRef.current = range;
          setVisibleDateRange(range);
        }}
        onReachBoundary={() => {
          const currentStart = visibleDateRangeRef.current?.startDate ?? anchorDate;
          visibleDateRangeRef.current = null;
          setVisibleDateRange(null);
          // Recenter on the lanes already in view so overscan extends without dropping a drag source.
          setAnchorDate(currentStart);
        }}
        onZoomGesture={(scale) => {
          pixelsPerHourEdited.current = true;
          const next = clampPixelsPerHour(pixelsPerHourRef.current * scale);
          if (next === pixelsPerHourRef.current) return;
          applyPixelsPerHour(next);
          cancelPendingZoomCommit();
          zoomCommitTimer.current = setTimeout(() => {
            zoomCommitTimer.current = null;
            commitZoomRef.current(next);
          }, ZOOM_GESTURE_COMMIT_MS);
        }}
        onSelectRegion={(region) => {
          // The same press that dismisses a peek also completes a region selection on the lane
          // underneath, which would open the create form on top of the event you were closing.
          if (openEvent.consumeDismissal()) return;
          setSelection(region);
        }}
        onOpenItem={openEvent.open}
        onOpenSharedItem={setOpenSharedItem}
      />

      <CalendarItemPeekOverlay
        item={resolvePeekItem(openEvent.peekItemId, (id) => dateAxis.itemById.get(id))}
        displayTimezone={displayTimezone}
        anchorRef={openEvent.anchorRef}
        onOpenDetail={openEvent.escalate}
        onClose={openEvent.close}
        onDismissOutside={openEvent.noteDismissal}
      />

      <CalendarItemDrawer
        displayTimezone={displayTimezone}
        itemId={openEvent.detailItemId}
        onClose={openEvent.close}
        onOpenTask={(orgId, taskId) => {
          router.push(`/orgs/${orgId}/tasks/${taskId}`);
        }}
      />
      <CalendarSharedItemDetails
        detail={openSharedItem}
        displayTimezone={displayTimezone}
        onClose={closeSharedItem}
      />
    </div>
  );
}

/** Mount Calendar without server props when the offline route table owns navigation. */
export default function CalendarClient(): JSX.Element {
  return <CalendarClientWithInitialData />;
}
