'use client';

import { useState, useCallback, type RefObject, type MouseEvent } from 'react';
import { getTimeFromY, getYFromTime, MIN_SLOT_MINUTES } from '@/lib/calendar-utils';
import type { CalendarEntry } from '../types';

export interface ResizeState {
  entryId: string;
  edge: 'top' | 'bottom';
  originalEntry: CalendarEntry;
  currentY: number;
}

export interface UseEntryResizeOptions {
  gridRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  date: Date;
  startHour: number;
  endHour: number;
  hourHeight: number;
  entries: CalendarEntry[];
  onEntryResize?: (entryId: string, newStart: Date, newEnd: Date) => void;
}

export interface UseEntryResizeReturn {
  resizeState: ResizeState | null;
  handleResizeStart: (entry: CalendarEntry, edge: 'top' | 'bottom', e: MouseEvent) => void;
  handleResizeMove: (e: MouseEvent<HTMLDivElement>) => void;
  handleResizeEnd: () => void;
  getResizePreview: (entry: CalendarEntry) => { top?: number; height?: number } | null;
  isResizing: boolean;
}

/**
 * Encapsulates entry resize behavior.
 */
export function useEntryResize({
  gridRef: _gridRef,
  scrollRef,
  date,
  startHour,
  endHour,
  hourHeight,
  entries,
  onEntryResize,
}: UseEntryResizeOptions): UseEntryResizeReturn {
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);

  const handleResizeStart = useCallback(
    (entry: CalendarEntry, edge: 'top' | 'bottom', e: MouseEvent) => {
      e.preventDefault();
      // Use scroll container rect + scrollTop to get position relative to grid content
      const scrollRect = scrollRef.current?.getBoundingClientRect();
      if (!scrollRect) return;

      const scrollTop = scrollRef.current?.scrollTop ?? 0;
      setResizeState({
        entryId: entry.id,
        edge,
        originalEntry: entry,
        currentY: e.clientY - scrollRect.top + scrollTop,
      });
    },
    [scrollRef],
  );

  const handleResizeMove = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!resizeState || !scrollRef.current) return;

      const scrollRect = scrollRef.current.getBoundingClientRect();
      const scrollTop = scrollRef.current.scrollTop;
      const maxY = (endHour - startHour) * hourHeight;
      const y = Math.max(0, Math.min(e.clientY - scrollRect.top + scrollTop, maxY));

      setResizeState((prev) => (prev ? { ...prev, currentY: y } : null));
    },
    [resizeState, scrollRef, endHour, startHour, hourHeight],
  );

  const handleResizeEnd = useCallback(() => {
    if (!resizeState) return;

    const entry = entries.find((e) => e.id === resizeState.entryId);
    if (!entry) {
      setResizeState(null);
      return;
    }

    const newTime = getTimeFromY(resizeState.currentY, date, startHour, hourHeight);

    let newStart = entry.startTime;
    let newEnd = entry.endTime;

    if (resizeState.edge === 'top') {
      newStart = newTime;
      if (newStart >= newEnd) {
        newStart = new Date(newEnd.getTime() - MIN_SLOT_MINUTES * 60 * 1000);
      }
    } else {
      newEnd = newTime;
      if (newEnd <= newStart) {
        newEnd = new Date(newStart.getTime() + MIN_SLOT_MINUTES * 60 * 1000);
      }
    }

    onEntryResize?.(entry.id, newStart, newEnd);
    setResizeState(null);
  }, [resizeState, entries, date, startHour, hourHeight, onEntryResize]);

  const getResizePreview = useCallback(
    (entry: CalendarEntry): { top?: number; height?: number } | null => {
      if (resizeState?.entryId !== entry.id) return null;

      const originalTop = getYFromTime(entry.startTime, startHour, hourHeight);
      const originalBottom = getYFromTime(entry.endTime, startHour, hourHeight);
      const minHeight = (MIN_SLOT_MINUTES * hourHeight) / 60;

      if (resizeState.edge === 'top') {
        const newTop = resizeState.currentY;
        return {
          top: Math.min(newTop, originalBottom - minHeight),
          height: originalBottom - Math.min(newTop, originalBottom - minHeight),
        };
      } else {
        const newBottom = resizeState.currentY;
        return {
          height: Math.max(newBottom - originalTop, minHeight),
        };
      }
    },
    [resizeState, startHour, hourHeight],
  );

  return {
    resizeState,
    handleResizeStart,
    handleResizeMove,
    handleResizeEnd,
    getResizePreview,
    isResizing: resizeState !== null,
  };
}
