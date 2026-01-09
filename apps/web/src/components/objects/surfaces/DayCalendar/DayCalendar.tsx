'use client';

/**
 * DayCalendar - Time-based calendar surface
 *
 * A unified calendar view showing events, time blocks, and tasks.
 * Supports:
 * - Click-drag to create new time selections
 * - Drag to move events and time blocks
 * - Right-click context menus
 * - Day/week view modes
 */

import { useRef, useMemo, useCallback, useEffect, type MouseEvent } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import { getTimeFromY, getYFromTime } from '@/lib/calendar-utils';
import { useSelection } from '../../context/SelectionContext';
import { surfaceId } from '../../types';

import {
  useContainerSize,
  useScrollState,
  useCalendarNavigation,
  useCalendarZoom,
  useTimeSelection,
  useEntryResize,
  useEntryDrag,
} from './hooks';
import { CalendarHeader } from './CalendarHeader';
import { CalendarEntryCard } from './CalendarEntryCard';
import { TimeSelectionOverlay } from './TimeSelectionOverlay';
import { CurrentTimeIndicator } from './CurrentTimeIndicator';
import { HourRow } from './HourRow';
import type { DayCalendarProps, CalendarEntry } from './types';

export function DayCalendar({
  date,
  entries,
  viewMode = 'day',
  onViewModeChange,
  scrollMode = 'fit',
  startHour = 0,
  endHour = 24,
  onDateChange,
  onCreateSelection,
  onEntryClick,
  onEntryContextMenu,
  onEntryMove,
  onEntryResize,
  onSlotContextMenu,
  onTaskClick,
  id,
  className,
  previewEntry,
}: DayCalendarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const calendarSurfaceId = id ?? surfaceId('day-calendar');
  const selectionCtx = useSelection();

  // Container and scroll state
  const { height: containerHeight } = useContainerSize({ ref: scrollRef });
  const { isScrolled } = useScrollState({ scrollRef });

  // Navigation
  const navigation = useCalendarNavigation({
    date,
    onDateChange,
  });

  // Zoom
  const numberOfHours = endHour - startHour;
  const { zoom, hourHeight, zoomIn, zoomOut, canZoomIn, canZoomOut } = useCalendarZoom({
    scrollRef,
    containerHeight,
    numberOfHours,
    scrollMode,
  });

  // Time selection
  const timeSelection = useTimeSelection({
    gridRef,
    scrollRef,
    date,
    startHour,
    endHour,
    hourHeight,
    onCreateSelection,
  });

  // Entry resize
  const entryResize = useEntryResize({
    gridRef,
    scrollRef,
    date,
    startHour,
    endHour,
    hourHeight,
    entries,
    onEntryResize,
  });

  // Entry drag
  useEntryDrag({
    date,
    startHour,
    endHour,
    hourHeight,
    onEntryMove,
  });

  // Hour rows
  const hours = useMemo(() => {
    return Array.from({ length: endHour - startHour }, (_, i) => startHour + i);
  }, [startHour, endHour]);

  // Check if current time is visible
  const now = new Date();
  const currentHour = now.getHours() + now.getMinutes() / 60;
  const showCurrentTime =
    date.toDateString() === now.toDateString() && currentHour >= startHour && currentHour < endHour;

  // Droppable for receiving dragged items
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: calendarSurfaceId,
    data: {
      type: 'calendar',
      date,
    },
  });

  // Scroll to current time on mount in scroll mode
  useEffect(() => {
    if (scrollMode !== 'scroll' || !scrollRef.current) return;

    const currentTime = new Date();
    if (date.toDateString() !== currentTime.toDateString()) return;

    const currentHourPos =
      (currentTime.getHours() + currentTime.getMinutes() / 60 - startHour) * hourHeight;
    const containerMid = containerHeight / 2;
    scrollRef.current.scrollTop = Math.max(0, currentHourPos - containerMid);
  }, [scrollMode, date, startHour, hourHeight, containerHeight]);

  // Combined mouse handlers
  const handleMouseDown = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!entryResize.isResizing) {
        timeSelection.handleMouseDown(e);
      }
    },
    [entryResize.isResizing, timeSelection],
  );

  const handleMouseMove = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (entryResize.isResizing) {
        entryResize.handleResizeMove(e);
      } else {
        timeSelection.handleMouseMove(e);
      }
    },
    [entryResize, timeSelection],
  );

  const handleMouseUp = useCallback(() => {
    if (entryResize.isResizing) {
      entryResize.handleResizeEnd();
    } else {
      timeSelection.handleMouseUp();
    }
  }, [entryResize, timeSelection]);

  // Slot context menu
  const handleSlotContextMenu = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest('[data-entry]')) return;

      e.preventDefault();
      const scrollRect = scrollRef.current?.getBoundingClientRect();
      if (!scrollRect) return;

      const scrollTop = scrollRef.current?.scrollTop ?? 0;
      const y = e.clientY - scrollRect.top + scrollTop;
      const time = getTimeFromY(y, date, startHour, hourHeight);
      onSlotContextMenu?.(time, e);
    },
    [date, startHour, hourHeight, onSlotContextMenu],
  );

  // Entry click
  const handleEntryClick = useCallback(
    (entry: CalendarEntry, e: MouseEvent) => {
      e.stopPropagation();

      if (e.metaKey || e.ctrlKey) {
        selectionCtx.toggle(entry.id, calendarSurfaceId);
      } else {
        selectionCtx.select(entry.id, calendarSurfaceId);
      }

      onEntryClick?.(entry, e);
    },
    [selectionCtx, calendarSurfaceId, onEntryClick],
  );

  // Entry context menu
  const handleEntryContextMenu = useCallback(
    (entry: CalendarEntry, e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onEntryContextMenu?.(entry, e);
    },
    [onEntryContextMenu],
  );

  const gridHeight = (endHour - startHour) * hourHeight;

  return (
    <div className={cn('bg-surface-container flex flex-col overflow-hidden rounded-lg', className)}>
      <CalendarHeader
        isScrolled={isScrolled}
        navigation={navigation}
        zoom={{ zoom, zoomIn, zoomOut, canZoomIn, canZoomOut }}
        viewMode={viewMode}
        onViewModeChange={onViewModeChange}
      />

      {/* Scrollable calendar body */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div
          ref={(node) => {
            gridRef.current = node;
            setDroppableRef(node);
          }}
          className={cn(
            'duration-medium2 ease-emphasized-decelerate relative transition-[height] select-none',
            isOver && 'bg-primary/5',
          )}
          style={{ height: `${String(gridHeight)}px` }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onContextMenu={handleSlotContextMenu}
          data-surface-id={calendarSurfaceId}
          data-surface-type="calendar"
        >
          {/* Hour grid */}
          {hours.map((hour) => (
            <HourRow key={hour} hour={hour} hourHeight={hourHeight} />
          ))}

          {/* Entries */}
          {entries.map((entry) => {
            const preview = entryResize.getResizePreview(entry);
            return (
              <CalendarEntryCard
                key={entry.id}
                entry={entry}
                startHour={startHour}
                hourHeight={hourHeight}
                selected={selectionCtx.isSelected(entry.id)}
                isResizing={entryResize.resizeState?.entryId === entry.id}
                resizePreviewTop={preview?.top}
                resizePreviewHeight={preview?.height}
                onClick={(e) => {
                  handleEntryClick(entry, e);
                }}
                onContextMenu={(e) => {
                  handleEntryContextMenu(entry, e);
                }}
                onTaskClick={(task, e) => onTaskClick?.(task, entry, e)}
                onResizeStart={(edge, e) => {
                  entryResize.handleResizeStart(entry, edge, e);
                }}
              />
            );
          })}

          {/* Preview entry (shown while creating) */}
          {previewEntry && (
            <div
              className="bg-primary/20 pointer-events-none absolute right-3 left-12 rounded-lg"
              style={{
                top: getYFromTime(previewEntry.startTime, startHour, hourHeight),
                height: Math.max(
                  hourHeight / 4,
                  getYFromTime(previewEntry.endTime, startHour, hourHeight) -
                    getYFromTime(previewEntry.startTime, startHour, hourHeight),
                ),
              }}
            />
          )}

          {/* Current time indicator */}
          {showCurrentTime && (
            <CurrentTimeIndicator startHour={startHour} hourHeight={hourHeight} />
          )}

          {/* Selection overlay */}
          {timeSelection.selection && <TimeSelectionOverlay selection={timeSelection.selection} />}
        </div>
      </div>
    </div>
  );
}

export default DayCalendar;
