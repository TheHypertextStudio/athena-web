'use client';

import type { CalendarItemOut, CalendarLayerOut } from '@docket/types';
import { useMemo } from 'react';

import { shiftISODate } from '@/components/agenda/agenda-context';
import { calendarItemsDef, calendarLayersDef } from '@/components/calendar/calendar-data';
import type { ScheduleLane } from '@/components/scheduling';
import { useApiListQuery } from '@/lib/query';

import {
  buildDateLane,
  dateRange,
  deriveRollingDateWindow,
  type RollingDateWindowPolicy,
} from './calendar-schedule-model';

/** Read model for the viewport-sized rolling date axis. */
export interface CalendarDateAxisState {
  readonly windowStartDate: string;
  readonly windowLaneCount: number;
  readonly initialLaneIndex: number;
  readonly startISO: string;
  readonly endISO: string;
  readonly lanes: readonly ScheduleLane[];
  readonly items: readonly CalendarItemOut[];
  readonly itemById: ReadonlyMap<string, CalendarItemOut>;
  readonly layers: readonly CalendarLayerOut[];
  readonly itemsPending: boolean;
  readonly itemsError: boolean;
  readonly layersError: boolean;
  readonly conflictCount: number;
  readonly failedCount: number;
}

/**
 * Load and map the rolling date window derived from live lane geometry.
 *
 * @remarks
 * The hook keeps one measured viewport before and after the anchor. It never assigns a named view
 * mode or a fixed number of dates.
 */
export function useCalendarDateAxis(
  anchorDate: string,
  visibleLaneCount: number,
  policy?: RollingDateWindowPolicy,
): CalendarDateAxisState {
  const window = deriveRollingDateWindow(anchorDate, visibleLaneCount, policy);
  const windowStartDate = window.startDate;
  const windowLaneCount = window.laneCount;
  const { startISO, endISO } = dateRange(windowStartDate, windowLaneCount);
  const itemsQuery = useApiListQuery(calendarItemsDef(startISO, endISO));
  const layersQuery = useApiListQuery(calendarLayersDef());
  const items = useMemo(() => itemsQuery.data?.items ?? [], [itemsQuery.data]);
  const layers = useMemo(() => layersQuery.data?.items ?? [], [layersQuery.data]);
  const colorByLayer = useMemo(
    () => new Map(layers.map((layer) => [layer.id, layer.color])),
    [layers],
  );
  const lanes = useMemo(
    () =>
      Array.from({ length: windowLaneCount }, (_, index) =>
        buildDateLane(shiftISODate(windowStartDate, index), items, colorByLayer),
      ),
    [colorByLayer, items, windowLaneCount, windowStartDate],
  );
  const itemById = useMemo(
    () => new Map<string, CalendarItemOut>(items.map((item) => [item.id, item])),
    [items],
  );

  return {
    windowStartDate,
    windowLaneCount,
    initialLaneIndex: window.initialLaneIndex,
    startISO,
    endISO,
    lanes,
    items,
    itemById,
    layers,
    itemsPending: itemsQuery.isPending,
    itemsError: itemsQuery.isError,
    layersError: layersQuery.isError,
    conflictCount: items.filter((item) => item.hasConflict).length,
    failedCount: items.filter((item) => !item.hasConflict && item.syncState === 'provider_error')
      .length,
  };
}
