'use client';

import { addDays, weekdayOf } from '@docket/ui/components';
import { Text } from '@docket/ui/primitives';
import { type JSX, useRef } from 'react';

import { formatDay } from '@/components/date-picker';

/** One date cell in the visible Agenda week. */
export interface AgendaDayCell {
  /** Calendar date represented by the cell. */
  readonly iso: string;
  /** Narrow localized weekday label. */
  readonly weekday: string;
  /** Localized day-of-month label. */
  readonly day: string;
  /** Whether this cell is the selected Agenda date. */
  readonly selected: boolean;
  /** Whether this cell is Today in the display timezone. */
  readonly today: boolean;
}

/** Build the Sunday-to-Saturday week containing the selected calendar date. */
export function agendaWeek(selected: string, today: string): readonly AgendaDayCell[] {
  const start = addDays(selected, -weekdayOf(selected));
  return Array.from({ length: 7 }, (_, index) => {
    const iso = addDays(start, index);
    return {
      iso,
      weekday: formatDay(iso, { weekday: 'narrow' }) ?? '',
      day: formatDay(iso, { day: 'numeric' }) ?? '',
      selected: iso === selected,
      today: iso === today,
    };
  });
}

/** Props for the narrow Agenda day strip. */
interface AgendaDayStripProps {
  /** Selected Agenda calendar date. */
  readonly date: string;
  /** Today in the Agenda display timezone. */
  readonly today: string;
  /** Select one visible calendar date. */
  readonly onSelect: (date: string) => void;
  /** Page the visible week while retaining the selected weekday. */
  readonly onPageWeek: (direction: 'previous' | 'next') => void;
}

interface PointerOrigin {
  readonly id: number;
  readonly x: number;
  readonly y: number;
}

const PAGE_GESTURE_THRESHOLD_PX = 48;
const WHEEL_PAGE_COOLDOWN_MS = 300;

/** Render seven nearby days as the primary narrow-surface date switcher. */
export function AgendaDayStrip({
  date,
  today,
  onSelect,
  onPageWeek,
}: AgendaDayStripProps): JSX.Element {
  const pointerOrigin = useRef<PointerOrigin | null>(null);
  const lastWheelPageAt = useRef(0);
  const days = agendaWeek(date, today);

  return (
    <div
      role="list"
      aria-label="Choose a day"
      className="grid touch-pan-y grid-cols-7 gap-1"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        pointerOrigin.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      }}
      onPointerCancel={() => {
        pointerOrigin.current = null;
      }}
      onPointerUp={(event) => {
        const origin = pointerOrigin.current;
        pointerOrigin.current = null;
        if (origin?.id !== event.pointerId) return;
        const deltaX = event.clientX - origin.x;
        const deltaY = event.clientY - origin.y;
        if (Math.abs(deltaX) < PAGE_GESTURE_THRESHOLD_PX || Math.abs(deltaX) <= Math.abs(deltaY)) {
          return;
        }
        onPageWeek(deltaX < 0 ? 'next' : 'previous');
      }}
      onWheel={(event) => {
        if (
          Math.abs(event.deltaX) < PAGE_GESTURE_THRESHOLD_PX ||
          Math.abs(event.deltaX) <= Math.abs(event.deltaY)
        ) {
          return;
        }
        const now = Date.now();
        if (now - lastWheelPageAt.current < WHEEL_PAGE_COOLDOWN_MS) return;
        event.preventDefault();
        lastWheelPageAt.current = now;
        onPageWeek(event.deltaX > 0 ? 'next' : 'previous');
      }}
    >
      {days.map((day) => {
        const label =
          formatDay(day.iso, { weekday: 'long', month: 'long', day: 'numeric' }) ?? day.iso;
        return (
          <div key={day.iso} role="listitem" className="flex min-w-0 justify-center">
            <button
              type="button"
              aria-label={label}
              aria-current={day.selected ? 'date' : undefined}
              data-agenda-date={day.iso}
              data-agenda-today={day.today ? '' : undefined}
              className="focus-visible:ring-ring text-on-surface-variant relative flex min-h-10 min-w-10 flex-col items-center justify-center rounded-full outline-none focus-visible:ring-2"
              onClick={() => {
                onSelect(day.iso);
              }}
            >
              <Text token="label-small" tone="inherit">
                {day.weekday}
              </Text>
              <Text
                token="label-large"
                tone="inherit"
                numeric
                className={
                  day.selected
                    ? 'bg-primary-container text-on-primary-container mt-0.5 flex size-8 items-center justify-center rounded-full'
                    : 'mt-0.5 flex size-8 items-center justify-center'
                }
              >
                {day.day}
              </Text>
              {day.today && !day.selected ? (
                <span
                  aria-hidden="true"
                  className="bg-primary absolute bottom-0 size-1 rounded-full"
                />
              ) : null}
            </button>
          </div>
        );
      })}
    </div>
  );
}
