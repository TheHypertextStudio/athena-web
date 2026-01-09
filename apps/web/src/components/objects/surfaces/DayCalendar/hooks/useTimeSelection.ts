'use client';

import { useState, useCallback, type RefObject, type MouseEvent } from 'react';
import { getTimeFromY, MIN_SLOT_MINUTES } from '@/lib/calendar-utils';

export interface TimeSelection {
  startY: number;
  endY: number;
  startTime: Date;
  endTime: Date;
}

export interface UseTimeSelectionOptions {
  gridRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  date: Date;
  startHour: number;
  endHour: number;
  hourHeight: number;
  onCreateSelection?: (start: Date, end: Date, anchorRect: DOMRect) => void;
}

export interface UseTimeSelectionReturn {
  selection: TimeSelection | null;
  isDragging: boolean;
  handleMouseDown: (e: MouseEvent<HTMLDivElement>) => void;
  handleMouseMove: (e: MouseEvent<HTMLDivElement>) => void;
  handleMouseUp: () => void;
}

/**
 * Encapsulates click-drag time selection behavior.
 */
export function useTimeSelection({
  gridRef: _gridRef,
  scrollRef,
  date,
  startHour,
  endHour,
  hourHeight,
  onCreateSelection,
}: UseTimeSelectionOptions): UseTimeSelectionReturn {
  const [selection, setSelection] = useState<TimeSelection | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      // Don't start selection if clicking on an entry
      if ((e.target as HTMLElement).closest('[data-entry]')) return;
      if (e.button !== 0) return; // Left click only

      const scrollRect = scrollRef.current?.getBoundingClientRect();
      if (!scrollRect) return;

      const scrollTop = scrollRef.current?.scrollTop ?? 0;
      const y = e.clientY - scrollRect.top + scrollTop;
      const time = getTimeFromY(y, date, startHour, hourHeight);

      setSelection({
        startY: y,
        endY: y,
        startTime: time,
        endTime: time,
      });
      setIsDragging(true);
    },
    [scrollRef, date, startHour, hourHeight],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!isDragging || !selection || !scrollRef.current) return;

      const scrollRect = scrollRef.current.getBoundingClientRect();
      const scrollTop = scrollRef.current.scrollTop;
      const maxY = (endHour - startHour) * hourHeight;
      const y = Math.max(0, Math.min(e.clientY - scrollRect.top + scrollTop, maxY));
      const time = getTimeFromY(y, date, startHour, hourHeight);

      setSelection((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          endY: y,
          endTime: time,
        };
      });
    },
    [isDragging, selection, scrollRef, date, startHour, endHour, hourHeight],
  );

  const handleMouseUp = useCallback(() => {
    if (isDragging && selection && scrollRef.current) {
      const start =
        selection.startTime < selection.endTime ? selection.startTime : selection.endTime;
      const end = selection.startTime < selection.endTime ? selection.endTime : selection.startTime;

      const durationMs = end.getTime() - start.getTime();
      if (durationMs >= MIN_SLOT_MINUTES * 60 * 1000) {
        // Calculate the anchor rect for the selection
        const scrollRect = scrollRef.current.getBoundingClientRect();
        const scrollTop = scrollRef.current.scrollTop;
        const minY = Math.min(selection.startY, selection.endY);
        const maxY = Math.max(selection.startY, selection.endY);

        // Convert scroll-relative Y to screen coordinates
        const anchorRect = new DOMRect(
          scrollRect.left,
          scrollRect.top + minY - scrollTop,
          scrollRect.width,
          maxY - minY,
        );

        onCreateSelection?.(start, end, anchorRect);
      }
    }

    setSelection(null);
    setIsDragging(false);
  }, [isDragging, selection, scrollRef, onCreateSelection]);

  return {
    selection,
    isDragging,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
  };
}
