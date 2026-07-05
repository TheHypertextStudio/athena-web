'use client';

/**
 * `calendar/calendar-week-grid` — the full calendar view's week mode: a compact 7-day grid.
 *
 * @remarks
 * Week mode trades the day timeline's pixel-precise hour grid (and its drag/resize gestures) for a
 * denser, scannable 7-column layout — each day a stack of compact `row`-layout
 * {@link CalendarItemCard}s in start-time order. Deliberately read-only-by-gesture (every card
 * still opens the item workspace, where the inline edit form covers the non-pointer path); a full
 * drag-across-days interaction is out of this pass's scope.
 */
import type { CalendarItemOut, CalendarLayerOut } from '@docket/types';
import { type JSX, useMemo } from 'react';

import { shiftISODate } from '@/components/agenda/agenda-context';
import { todayISODate } from '@/lib/today';

import CalendarItemCard from './calendar-item-card';

/** The local calendar day (`YYYY-MM-DD`) an ISO instant falls on, or a bare date as-is. */
function localDay(item: CalendarItemOut): string | null {
  if (item.startsAt) return todayISODate(new Date(item.startsAt));
  if (item.allDayStartDate) return item.allDayStartDate;
  return null;
}

/** The item's sort key within its day: timed items by start, all-day items first. */
function sortKey(item: CalendarItemOut): string {
  return item.startsAt ?? item.allDayStartDate ?? '';
}

/** Props for {@link CalendarWeekGrid}. */
export interface CalendarWeekGridProps {
  /** The first day of the week to show, as `YYYY-MM-DD`. */
  weekStartDate: string;
  /** The items to place across the week's 7 days. */
  items: readonly CalendarItemOut[];
  /** Every layer touched by `items`, for color/title lookups. */
  layers: readonly CalendarLayerOut[];
  /** Open the item workspace for an item. */
  onOpenItem: (itemId: string) => void;
}

/** The week grid: 7 day columns, each a compact stack of item cards. */
export default function CalendarWeekGrid({
  weekStartDate,
  items,
  layers,
  onOpenItem,
}: CalendarWeekGridProps): JSX.Element {
  const layerById = useMemo(() => new Map(layers.map((layer) => [layer.id, layer])), [layers]);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => shiftISODate(weekStartDate, i)),
    [weekStartDate],
  );
  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalendarItemOut[]>(days.map((day) => [day, []]));
    for (const item of items) {
      const day = localDay(item);
      const bucket = day ? map.get(day) : undefined;
      if (bucket) bucket.push(item);
    }
    for (const bucket of map.values()) bucket.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    return map;
  }, [items, days]);

  return (
    <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-7">
      {days.map((day) => (
        <div key={day} className="flex min-w-0 flex-col gap-1.5">
          <p className="text-on-surface-variant text-xs font-medium">
            {new Date(`${day}T00:00:00`).toLocaleDateString(undefined, {
              weekday: 'short',
              day: 'numeric',
            })}
          </p>
          <div className="flex flex-col gap-1">
            {(itemsByDay.get(day) ?? []).length === 0 ? (
              <p className="text-on-surface-variant text-[11px]">—</p>
            ) : (
              (itemsByDay.get(day) ?? []).map((item) => (
                <CalendarItemCard
                  key={item.id}
                  item={item}
                  layer={layerById.get(item.layerId)}
                  layout="row"
                  onOpen={onOpenItem}
                />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
