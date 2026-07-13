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
import { type JSX, useEffect, useState } from 'react';

import { shiftISODate } from '@/components/agenda/agenda-context';
import CalendarItemDrawer from '@/components/calendar/calendar-item-drawer';
import CreateBlockForm, {
  type CalendarRegionSelection,
} from '@/components/calendar/create-block-form';
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

import { CalendarComparisonControls } from './calendar-comparison-controls';
import type { CalendarAxis } from './calendar-schedule-model';
import { CalendarSchedulingSurface } from './calendar-scheduling-surface';
import { CalendarToolbar } from './calendar-toolbar';
import { useCalendarDateAxis } from './use-calendar-date-axis';
import { useCalendarPeopleAxis } from './use-calendar-people-axis';

const DEFAULT_PIXELS_PER_HOUR = 72;

/** Render the unified calendar page over the shared scheduling canvas. */
export default function CalendarClient(): JSX.Element {
  const router = useRouter();
  const [axis, setAxis] = useState<CalendarAxis>('dates');
  const [visibleLaneCount, setVisibleLaneCount] = useState(1);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [selection, setSelection] = useState<CalendarRegionSelection | null>(null);
  const [pixelsPerHour, setPixelsPerHour] = useState(DEFAULT_PIXELS_PER_HOUR);
  const [now] = useState(() => new Date().toISOString());

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
    if (preferences?.pixelsPerHour !== undefined) setPixelsPerHour(preferences.pixelsPerHour);
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

  const visibleEnd = shiftISODate(anchorDate, Math.max(0, visibleLaneCount - 1));
  const heading =
    axis === 'people' || visibleLaneCount <= 1
      ? (formatCalendarDate(anchorDate) ?? anchorDate)
      : `${formatCalendarDate(anchorDate) ?? anchorDate} – ${formatCalendarDate(visibleEnd) ?? visibleEnd}`;
  const navigate = (direction: 'previous' | 'next'): void => {
    const magnitude = axis === 'people' ? 1 : visibleLaneCount;
    setAnchorDate((date) => shiftISODate(date, direction === 'next' ? magnitude : -magnitude));
  };

  return (
    <div className="flex w-full flex-col gap-4 p-4 @2xl:p-6 @4xl:p-8">
      <CalendarToolbar
        heading={heading}
        axis={axis}
        pixelsPerHour={pixelsPerHour}
        onToday={() => {
          setAnchorDate(today);
        }}
        onPrevious={() => {
          navigate('previous');
        }}
        onNext={() => {
          navigate('next');
        }}
        onAxisChange={setAxis}
        onZoomChange={setPixelsPerHour}
        onZoomCommit={(nextPixelsPerHour) => {
          savePreferences.mutate({ ...(preferences ?? {}), pixelsPerHour: nextPixelsPerHour });
        }}
        createControl={
          <CreateBlockForm
            rangeKeys={[queryKeys.calendarItems(dateAxis.startISO, dateAxis.endISO)]}
            layers={dateAxis.layers}
            preferences={preferences}
            selection={selection}
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
        pixelsPerHour={pixelsPerHour}
        displayTimezone={displayTimezone}
        now={now}
        preferences={preferences}
        dateAxis={dateAxis}
        peopleAxis={peopleAxis}
        onVisibleLaneCountChange={setVisibleLaneCount}
        onReachBoundary={(direction) => {
          setAnchorDate((date) =>
            shiftISODate(date, direction === 'next' ? visibleLaneCount : -visibleLaneCount),
          );
        }}
        onSelectRegion={setSelection}
        onOpenItem={setOpenItemId}
      />

      <CalendarItemDrawer
        itemId={openItemId}
        onClose={() => {
          setOpenItemId(null);
        }}
        onOpenTask={(orgId, taskId) => {
          router.push(`/orgs/${orgId}/tasks/${taskId}`);
        }}
      />
    </div>
  );
}
