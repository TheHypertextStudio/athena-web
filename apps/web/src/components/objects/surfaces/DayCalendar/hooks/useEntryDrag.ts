'use client';

import { useDndMonitor } from '@dnd-kit/core';
import { MIN_SLOT_MINUTES } from '@/lib/calendar-utils';
import type { CalendarEntry } from '../types';

export interface UseEntryDragOptions {
  date: Date;
  startHour: number;
  endHour: number;
  hourHeight: number;
  onEntryMove?: (entryId: string, newStart: Date, newEnd: Date) => void;
}

/**
 * Encapsulates entry drag-and-drop with time snapping.
 * Wraps useDndMonitor to calculate snapped time deltas.
 */
export function useEntryDrag({
  date,
  startHour,
  endHour,
  hourHeight,
  onEntryMove,
}: UseEntryDragOptions): void {
  useDndMonitor({
    onDragEnd(event) {
      const { active, delta } = event;
      if (delta.x === 0 && delta.y === 0) return;

      // Check if this is a calendar entry drag
      const activeData = active.data.current;
      if (activeData?.type !== 'event' && activeData?.type !== 'time-block') return;

      const entry = activeData.entry as CalendarEntry | undefined;
      if (!entry) return;

      // Calculate time delta from pixel delta
      // Snap to MIN_SLOT_MINUTES increments
      const pixelsPerMinute = hourHeight / 60;
      const deltaMinutes =
        Math.round(delta.y / pixelsPerMinute / MIN_SLOT_MINUTES) * MIN_SLOT_MINUTES;

      if (deltaMinutes === 0) return;

      // Calculate new times
      const newStart = new Date(entry.startTime.getTime() + deltaMinutes * 60 * 1000);
      const newEnd = new Date(entry.endTime.getTime() + deltaMinutes * 60 * 1000);

      // Clamp to visible hours
      const minTime = new Date(date);
      minTime.setHours(startHour, 0, 0, 0);
      const maxTime = new Date(date);
      maxTime.setHours(endHour, 0, 0, 0);

      const duration = entry.endTime.getTime() - entry.startTime.getTime();

      let finalStart = newStart;
      let finalEnd = newEnd;

      // Clamp to bounds
      if (finalStart < minTime) {
        finalStart = minTime;
        finalEnd = new Date(minTime.getTime() + duration);
      }
      if (finalEnd > maxTime) {
        finalEnd = maxTime;
        finalStart = new Date(maxTime.getTime() - duration);
      }

      onEntryMove?.(entry.id, finalStart, finalEnd);
    },
  });
}
