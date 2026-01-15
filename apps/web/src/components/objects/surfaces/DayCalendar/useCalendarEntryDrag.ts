'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useDraggable } from '@dnd-kit/core';
import type { Transform } from '@dnd-kit/utilities';
import { MIN_SLOT_MINUTES } from '@/lib/calendar-utils';
import type { CalendarEntry } from './types';

interface DragPreviewTimes {
  startTime: Date;
  endTime: Date;
}

interface UseCalendarEntryDragProps {
  entry: CalendarEntry;
  baseTop: number;
  currentTop: number;
  hourHeight: number;
  startHour: number;
  endHour: number;
  date?: Date;
  isPreview: boolean;
  onPreviewMove?: (newStart: Date, newEnd: Date) => void;
}

export function useCalendarEntryDrag({
  entry,
  baseTop,
  currentTop,
  hourHeight,
  startHour,
  endHour,
  date,
  isPreview,
  onPreviewMove,
}: UseCalendarEntryDragProps) {
  const draggableId = isPreview ? 'preview-entry' : entry.id;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: draggableId,
    data: {
      type: isPreview ? 'preview' : entry.type,
      entry,
      isPreview,
    },
  });

  const dragStartValuesRef = useRef<{
    hourHeight: number;
    baseTop: number;
    entryStartTime: number;
    entryEndTime: number;
  } | null>(null);

  if (isDragging && dragStartValuesRef.current === null) {
    dragStartValuesRef.current = {
      hourHeight,
      baseTop,
      entryStartTime: entry.startTime.getTime(),
      entryEndTime: entry.endTime.getTime(),
    };
  } else if (!isDragging && dragStartValuesRef.current !== null) {
    dragStartValuesRef.current = null;
  }

  const stableHourHeight = dragStartValuesRef.current?.hourHeight ?? hourHeight;
  const effectiveTop =
    isDragging && dragStartValuesRef.current ? dragStartValuesRef.current.baseTop : currentTop;

  const snappedTransform: Transform | null = useMemo(() => {
    if (!transform) return null;
    const snapSize = stableHourHeight / 12;
    return {
      x: 0,
      y: Math.round(transform.y / snapSize) * snapSize,
      scaleX: 1,
      scaleY: 1,
    };
  }, [transform, stableHourHeight]);

  const dragPreviewTimes = useMemo<DragPreviewTimes | null>(() => {
    if (!isDragging || !snappedTransform || !dragStartValuesRef.current) return null;

    const pixelsPerMinute = stableHourHeight / 60;
    const deltaMinutes =
      Math.round(snappedTransform.y / pixelsPerMinute / MIN_SLOT_MINUTES) * MIN_SLOT_MINUTES;

    if (deltaMinutes === 0) return null;

    const originalStartTime = dragStartValuesRef.current.entryStartTime;
    const originalEndTime = dragStartValuesRef.current.entryEndTime;
    const duration = originalEndTime - originalStartTime;

    let newStart = new Date(originalStartTime + deltaMinutes * 60 * 1000);
    let newEnd = new Date(newStart.getTime() + duration);

    if (date) {
      const minTime = new Date(date);
      minTime.setHours(startHour, 0, 0, 0);
      const maxTime = new Date(date);
      maxTime.setHours(endHour, 0, 0, 0);

      if (newStart < minTime) {
        newStart = minTime;
        newEnd = new Date(minTime.getTime() + duration);
      }
      if (newEnd > maxTime) {
        newEnd = maxTime;
        newStart = new Date(maxTime.getTime() - duration);
      }
    }

    return { startTime: newStart, endTime: newEnd };
  }, [isDragging, snappedTransform, stableHourHeight, date, startHour, endHour]);

  const prevPreviewTimesRef = useRef<{ start: number; end: number } | null>(null);

  useEffect(() => {
    if (!isPreview || !isDragging || !dragPreviewTimes || !onPreviewMove) {
      prevPreviewTimesRef.current = null;
      return;
    }

    const newStart = dragPreviewTimes.startTime.getTime();
    const newEnd = dragPreviewTimes.endTime.getTime();
    const prev = prevPreviewTimesRef.current;

    if (prev?.start !== newStart || prev.end !== newEnd) {
      prevPreviewTimesRef.current = { start: newStart, end: newEnd };
      onPreviewMove(dragPreviewTimes.startTime, dragPreviewTimes.endTime);
    }
  }, [isPreview, isDragging, dragPreviewTimes, onPreviewMove]);

  return {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
    snappedTransform,
    effectiveTop,
    dragPreviewTimes,
  };
}
