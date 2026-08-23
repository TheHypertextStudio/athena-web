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
 * content. Padding is deliberately modest (`p-2` → `p-6`). The page column clips overflow while
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
import type { CalendarPreferences, HubPreferences } from '@docket/types';
import { useAppRouter as useRouter } from '@/lib/interactions/navigation';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';

import { shiftISODate } from '@/components/agenda/agenda-context';
import CalendarItemDrawer from '@/components/calendar/calendar-item-drawer';
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
import { useCalendarPeopleAxis } from './use-calendar-people-axis';

/**
 * Trailing debounce applied to a pinch-driven zoom write.
 *
 * @remarks
 * A trackpad pinch emits a wheel event every few milliseconds. Persisting each one would spend a
 * PATCH per frame for a value the user is still adjusting, so only the settled value is written.
 */
const ZOOM_GESTURE_COMMIT_MS = 300;

/** Render the unified calendar page over the shared scheduling canvas. */
export default function CalendarClient(): JSX.Element {
  const router = useRouter();
  const [axis, setAxis] = useState<CalendarAxis>('dates');
  const [visibleLaneCount, setVisibleLaneCount] = useState(1);
  const [horizontalAnchorKey, setHorizontalAnchorKey] = useState(0);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [openSharedItem, setOpenSharedItem] = useState<SharedCalendarItemDetail | null>(null);
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
  const now = useNow().toISOString();

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
  const displayTimezone = resolveScheduleTimezone(hubPreferences?.timezone);
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
  useEffect(() => {
    setOpenSharedItem(null);
  }, [anchorDate, axis, peopleAxis.comparisonOrgId]);
  useEffect(() => {
    visibleDateRangeRef.current = null;
    setVisibleDateRange(null);
  }, [anchorDate, axis]);

  const visibleStart = axis === 'dates' ? (visibleDateRange?.startDate ?? anchorDate) : anchorDate;
  const visibleEnd =
    axis === 'dates'
      ? (visibleDateRange?.endDate ?? shiftISODate(anchorDate, Math.max(0, visibleLaneCount - 1)))
      : anchorDate;
  // Month/year only. The grid's lane headers carry weekday and day-of-month, so between them each
  // date atom appears exactly once on screen.
  const heading = calendarRangeLabel(visibleStart, visibleEnd);
  // The same context abbreviated, for widths where the long form would clip mid-month.
  const headingShort = calendarRangeLabel(visibleStart, visibleEnd, 'short');
  const navigate = (direction: 'previous' | 'next'): void => {
    const magnitude = axis === 'people' ? 1 : visibleLaneCount;
    const currentStart = visibleDateRangeRef.current?.startDate ?? anchorDate;
    visibleDateRangeRef.current = null;
    setVisibleDateRange(null);
    setAnchorDate(shiftISODate(currentStart, direction === 'next' ? magnitude : -magnitude));
  };

  return (
    // `p-2` at the narrowest step, not `p-3`: 8px of inset buys the control row 8px of budget, and
    // at 320px that row was 27px over its container — enough to push the New button's right border
    // off the viewport. From `@sm` up the inset returns to the app's normal rhythm.
    <div
      data-calendar-page=""
      className="flex h-full min-h-0 w-full min-w-0 flex-col gap-3 overflow-hidden p-2 @sm:p-3 @2xl:p-4 @4xl:p-6"
    >
      <CalendarToolbar
        heading={heading}
        headingShort={headingShort}
        axis={axis}
        pixelsPerHour={pixelsPerHour}
        onToday={() => {
          visibleDateRangeRef.current = null;
          setVisibleDateRange(null);
          setHorizontalAnchorKey((current) => current + 1);
          setAnchorDate(today);
        }}
        onPrevious={() => {
          navigate('previous');
        }}
        onNext={() => {
          navigate('next');
        }}
        onAxisChange={(nextAxis) => {
          // `anchorDate` doubles as "the dates axis's left-most rendered lane": once the canvas
          // measures a viewport wide enough to show more than one lane, `onVisibleLaneCountChange`
          // below recenters it backward so `today` lands mid-window with leading context days. That
          // recentered value is correct for the dates axis, but the people axis is always a single
          // day — reusing the drifted anchor made switching to People silently compare and render
          // whatever day happened to be the dates view's left edge instead of today.
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
        comparisonControl={
          <CalendarComparisonControls
            workspaces={peopleAxis.sharedWorkspaces}
            workspaceId={peopleAxis.comparisonOrgId}
            members={peopleAxis.activeMembers}
            selectedActorIds={peopleAxis.selectedActorIds}
            membersPending={peopleAxis.membersPending}
            onWorkspaceChange={peopleAxis.selectWorkspace}
            onActorChange={peopleAxis.toggleActor}
          />
        }
        createControl={
          <CreateBlockForm
            displayTimezone={displayTimezone}
            layers={dateAxis.layers}
            preferences={preferences}
            selection={selection}
            selectionAnchorRef={selection ? selectionAnchorRef : undefined}
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
        onSelectRegion={setSelection}
        onOpenItem={setOpenItemId}
        onOpenSharedItem={setOpenSharedItem}
      />

      <CalendarItemDrawer
        displayTimezone={displayTimezone}
        itemId={openItemId}
        duplicatesByItemId={dateAxis.duplicatesByItemId}
        onClose={() => {
          setOpenItemId(null);
        }}
        onOpenTask={(orgId, taskId) => {
          router.push(`/orgs/${orgId}/tasks/${taskId}`);
        }}
      />
      <CalendarSharedItemDetails
        detail={openSharedItem}
        displayTimezone={displayTimezone}
        onClose={() => {
          setOpenSharedItem(null);
        }}
      />
    </div>
  );
}
