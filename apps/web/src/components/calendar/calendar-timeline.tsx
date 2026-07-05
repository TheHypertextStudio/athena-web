'use client';

/**
 * `calendar/calendar-timeline` — the full calendar view's day timeline.
 *
 * @remarks
 * An hour grid (the visual geometry mirrors the agenda rail's timeline: the three constants below
 * are duplicated, not imported, from `agenda-canvas.tsx` — that module doesn't export them, and per
 * this task's brief `agenda-canvas.tsx` itself is not refactored to export them) with timed items
 * placed by {@link layoutLanes} so overlaps form stable side-by-side columns instead of hiding text.
 *
 * Each placed card owns its own drag-to-move / drag-to-resize gesture and its own bound
 * {@link useUpdateCalendarItem} (one item, one mutation instance — the same shape
 * `calendar-item-drawer.tsx`'s `LinkedTaskRow` uses for its own per-row mutation). A gesture tracks
 * a live pixel preview locally (`dragPx`/`resizePx`) and only commits — snapped to 15 minutes — on
 * pointer-up; {@link CalendarItemCard} itself gates the move/resize handles on
 * `permissions.canEditCore`, so a read-only item never receives a gesture callback.
 */
import type { CalendarItemOut, CalendarLayerOut } from '@docket/types';
import { type JSX, type PointerEvent as ReactPointerEvent, useMemo, useState } from 'react';

import CalendarItemCard from './calendar-item-card';
import { useUpdateCalendarItem } from './calendar-mutations';
import { layoutLanes } from './lane-layout';

// Duplicated (not imported) from `agenda-canvas.tsx`'s unexported hour-grid constants, for visual
// consistency between the agenda rail and the full calendar view's timeline.
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 22;
const HOUR_HEIGHT = 56;

/** Drag/resize gestures snap to this many minutes. */
const SNAP_MINUTES = 15;

/** The hour labels down the timeline gutter. */
const HOUR_LABELS: readonly number[] = Array.from(
  { length: DAY_END_HOUR - DAY_START_HOUR + 1 },
  (_, i) => DAY_START_HOUR + i,
);

/** Format an hour (0–23) as a compact 12-hour label, e.g. `9 AM`. */
function formatHour(hour: number): string {
  const period = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${String(display)} ${period}`;
}

/** Fractional hours since local midnight for an ISO timestamp. */
function hoursOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() + d.getMinutes() / 60;
}

/** Round a minute delta to the nearest {@link SNAP_MINUTES}. */
function snapMinutes(minutes: number): number {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

/** A calendar item narrowed to its timed shape (both bounds present). */
interface TimedCalendarItem extends CalendarItemOut {
  startsAt: string;
  endsAt: string;
}

/** Narrow an item to {@link TimedCalendarItem}; all-day/untimed items don't place on this grid. */
function isTimed(item: CalendarItemOut): item is TimedCalendarItem {
  return item.startsAt !== null && item.endsAt !== null;
}

/** One item's full grid placement: pixel top/height (time) plus lane geometry (overlap column). */
interface PlacedItem {
  item: TimedCalendarItem;
  top: number;
  height: number;
  lane: number;
  laneCount: number;
}

/** Combine time-derived pixel geometry with {@link layoutLanes}'s overlap placement. */
function placeItems(items: readonly TimedCalendarItem[]): PlacedItem[] {
  const laneById = new Map(
    layoutLanes(
      items.map((item) => ({ id: item.id, startsAt: item.startsAt, endsAt: item.endsAt })),
    ).map((placement) => [placement.id, placement]),
  );
  return items.map((item) => {
    const startH = Math.max(hoursOfDay(item.startsAt), DAY_START_HOUR);
    const endH = Math.min(hoursOfDay(item.endsAt), DAY_END_HOUR + 1);
    const top = (startH - DAY_START_HOUR) * HOUR_HEIGHT;
    const height = Math.max((endH - startH) * HOUR_HEIGHT, HOUR_HEIGHT / 2);
    const lane = laneById.get(item.id);
    return { item, top, height, lane: lane?.lane ?? 0, laneCount: lane?.laneCount ?? 1 };
  });
}

/** A gesture's fixed reference point, captured at pointer-down. */
interface GestureOrigin {
  kind: 'move' | 'resize';
  pointerStartY: number;
}

/** Props for {@link PlacedItemCard}. */
interface PlacedItemCardProps {
  /** The item's computed grid placement. */
  placed: PlacedItem;
  /** The item's owning layer, for color/title. */
  layer?: CalendarLayerOut;
  /** Open the item workspace for this item. */
  onOpenItem: (itemId: string) => void;
}

/** One placed, gesture-capable item card. */
function PlacedItemCard({ placed, layer, onOpenItem }: PlacedItemCardProps): JSX.Element {
  const { item, top, height, lane, laneCount } = placed;
  const update = useUpdateCalendarItem(item.id);
  const [dragPx, setDragPx] = useState(0);
  const [resizePx, setResizePx] = useState(0);

  /** Start a move or resize gesture: track pointer moves live, commit (snapped) on pointer-up. */
  const startGesture = (origin: GestureOrigin['kind'], event: ReactPointerEvent): void => {
    const pointerStartY = event.clientY;
    const onMove = (moveEvent: PointerEvent): void => {
      const deltaY = moveEvent.clientY - pointerStartY;
      if (origin === 'move') setDragPx(deltaY);
      else setResizePx(deltaY);
    };
    const onUp = (upEvent: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setDragPx(0);
      setResizePx(0);
      const deltaMinutes = snapMinutes(((upEvent.clientY - pointerStartY) / HOUR_HEIGHT) * 60);
      if (deltaMinutes === 0) return;
      const startMs = new Date(item.startsAt).getTime();
      const endMs = new Date(item.endsAt).getTime();
      if (origin === 'move') {
        update.mutate({
          startsAt: new Date(startMs + deltaMinutes * 60_000).toISOString(),
          endsAt: new Date(endMs + deltaMinutes * 60_000).toISOString(),
        });
      } else {
        const minEndMs = startMs + SNAP_MINUTES * 60_000;
        update.mutate({
          endsAt: new Date(Math.max(endMs + deltaMinutes * 60_000, minEndMs)).toISOString(),
        });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      className="absolute px-0.5"
      style={{
        top: top + dragPx,
        height: Math.max(height + resizePx, HOUR_HEIGHT / 2),
        left: `${String((lane / laneCount) * 100)}%`,
        width: `${String(100 / laneCount)}%`,
      }}
    >
      <CalendarItemCard
        item={item}
        layer={layer}
        layout="block"
        onOpen={onOpenItem}
        onDragHandlePointerDown={(_id, event) => {
          startGesture('move', event);
        }}
        onResizeHandlePointerDown={(_id, event) => {
          startGesture('resize', event);
        }}
      />
    </div>
  );
}

/** Props for {@link CalendarTimeline}. */
export interface CalendarTimelineProps {
  /** The items to place; untimed/all-day items are filtered out (they don't place on this grid). */
  items: readonly CalendarItemOut[];
  /** Every layer touched by `items`, for color/title lookups. */
  layers: readonly CalendarLayerOut[];
  /** Whether the shown day is today — drives the "now" line. */
  isToday: boolean;
  /** Open the item workspace for an item. */
  onOpenItem: (itemId: string) => void;
}

/** The day timeline: an hour grid with lane-placed, drag/resize-capable item cards. */
export default function CalendarTimeline({
  items,
  layers,
  isToday,
  onOpenItem,
}: CalendarTimelineProps): JSX.Element {
  const layerById = useMemo(() => new Map(layers.map((layer) => [layer.id, layer])), [layers]);
  const placed = useMemo(() => placeItems(items.filter(isTimed)), [items]);
  const gridHeight = HOUR_LABELS.length * HOUR_HEIGHT;

  const now = new Date();
  const nowHours = now.getHours() + now.getMinutes() / 60;
  const showNow = isToday && nowHours >= DAY_START_HOUR && nowHours <= DAY_END_HOUR + 1;
  const nowTop = (nowHours - DAY_START_HOUR) * HOUR_HEIGHT;

  return (
    <div className="relative" style={{ height: gridHeight }}>
      {HOUR_LABELS.map((hour, i) => (
        <div
          key={hour}
          className="border-outline-variant absolute inset-x-0 border-t"
          style={{ top: i * HOUR_HEIGHT }}
        >
          <span className="text-on-surface-variant absolute -top-2 left-0 text-[10px] tabular-nums">
            {formatHour(hour)}
          </span>
        </div>
      ))}
      {showNow ? (
        <div
          className="bg-primary pointer-events-none absolute inset-x-0 z-10 h-px"
          style={{ top: nowTop }}
        >
          <div className="bg-primary absolute top-1/2 left-0 size-2 -translate-y-1/2 rounded-full" />
        </div>
      ) : null}
      <div className="absolute inset-y-0 right-0 left-12">
        {placed.map((placement) => (
          <PlacedItemCard
            key={placement.item.id}
            placed={placement}
            layer={layerById.get(placement.item.layerId)}
            onOpenItem={onOpenItem}
          />
        ))}
      </div>
    </div>
  );
}
