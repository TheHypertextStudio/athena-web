'use client';

/**
 * `(app)/calendar` — orchestrates the fluid date and people scheduling axes.
 *
 * @remarks
 * Geometry, data loading, controls, and gesture persistence live in focused collaborators. This
 * component owns only page-level state; it does not define day/week modes or a fixed lane count.
 */
import type { CalendarPreferences, HubPreferences } from '@docket/types';
import { useRouter } from 'next/navigation';
import { type JSX, useEffect, useRef, useState } from 'react';

import { shiftISODate } from '@/components/agenda/agenda-context';
import CalendarItemDrawer from '@/components/calendar/calendar-item-drawer';
import CreateBlockForm from '@/components/calendar/create-block-form';
import { resolveScheduleTimezone, useScheduleDisplayDate } from '@/components/scheduling';
import { api } from '@/lib/api';
import { formatCalendarDate } from '@/lib/format-date';
import {
  apiQueryOptions,
  queryKeys,
  STALE,
  unwrap,
  useApiMutation,
  useApiQuery,
} from '@/lib/query';
import { useNow } from '@/lib/use-now';

import { CalendarComparisonControls } from './calendar-comparison-controls';
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
import { useCalendarDateAxis } from './use-calendar-date-axis';
import { useCalendarPeopleAxis } from './use-calendar-people-axis';

const DEFAULT_PIXELS_PER_HOUR = 72;

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
  useEffect(() => {
    if (!pixelsPerHourEdited.current && preferences?.pixelsPerHour !== undefined) {
      setPixelsPerHour(preferences.pixelsPerHour);
    }
  }, [preferences?.pixelsPerHour]);

  const savePreferences = useApiMutation<HubPreferences, CalendarPreferences>({
    mutationFn: (calendar) =>
      unwrap(
        () => api.v1.hub.preferences.$patch({ json: { calendar } }),
        'Could not save calendar preferences.',
      ),
    invalidateKeys: [queryKeys.hubPreferences()],
  });
  const dateAxis = useCalendarDateAxis(anchorDate, visibleLaneCount, displayTimezone);
  const peopleAxis = useCalendarPeopleAxis(axis, anchorDate, displayTimezone);
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
  const heading =
    visibleStart === visibleEnd
      ? (formatCalendarDate(visibleStart) ?? visibleStart)
      : `${formatCalendarDate(visibleStart) ?? visibleStart} – ${formatCalendarDate(visibleEnd) ?? visibleEnd}`;
  const navigate = (direction: 'previous' | 'next'): void => {
    const magnitude = axis === 'people' ? 1 : visibleLaneCount;
    const currentStart = visibleDateRangeRef.current?.startDate ?? anchorDate;
    visibleDateRangeRef.current = null;
    setVisibleDateRange(null);
    setAnchorDate(shiftISODate(currentStart, direction === 'next' ? magnitude : -magnitude));
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-4 p-4 @2xl:p-6 @4xl:p-8">
      <CalendarToolbar
        heading={heading}
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
        onAxisChange={setAxis}
        onZoomChange={(nextPixelsPerHour) => {
          pixelsPerHourEdited.current = true;
          setPixelsPerHour(nextPixelsPerHour);
        }}
        onZoomCommit={(nextPixelsPerHour) => {
          savePreferences.mutate({ ...(preferences ?? {}), pixelsPerHour: nextPixelsPerHour });
        }}
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
          />
        }
      />

      {axis === 'people' ? (
        <CalendarComparisonControls
          workspaces={peopleAxis.sharedWorkspaces}
          workspaceId={peopleAxis.comparisonOrgId}
          members={peopleAxis.activeMembers}
          selectedActorIds={peopleAxis.selectedActorIds}
          membersPending={peopleAxis.membersPending}
          onWorkspaceChange={peopleAxis.selectWorkspace}
          onActorChange={peopleAxis.toggleActor}
        />
      ) : null}

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
        onSelectRegion={setSelection}
        onOpenItem={setOpenItemId}
        onOpenSharedItem={setOpenSharedItem}
      />

      <CalendarItemDrawer
        displayTimezone={displayTimezone}
        itemId={openItemId}
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
