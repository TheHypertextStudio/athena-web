'use client';

/**
 * CalendarGrid - Time-Based Layout Surface
 *
 * Displays events and time blocks in a calendar grid.
 * Supports day and week views with drag-to-schedule and resize.
 */

import { useCallback, useMemo, type ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useDragDrop } from '../context/DragDropContext';
import type { AnyObject, ObjectType, SurfaceId } from '../types';

// =============================================================================
// Types
// =============================================================================

interface TimeSlot {
  hour: number;
  minute: number;
  date: Date;
}

interface CalendarEvent {
  id: string;
  object: AnyObject;
  startTime: Date;
  endTime: Date;
}

interface CalendarGridProps {
  /** Unique ID for this calendar */
  id: SurfaceId;

  /** Date to display (for day view) or start of week */
  date: Date;

  /** View mode */
  view?: 'day' | 'week';

  /** Events/time blocks to display */
  events: CalendarEvent[];

  /** Render function for events */
  renderEvent: (event: CalendarEvent, context: CalendarEventContext) => ReactNode;

  /** Start hour (0-23) */
  startHour?: number;

  /** End hour (0-23) */
  endHour?: number;

  /** Slot duration in minutes */
  slotDuration?: number;

  /** Object types accepted for drops */
  accepts?: ObjectType[];

  /** Callback when an object is dropped on the calendar */
  onDrop?: (object: AnyObject, slot: TimeSlot) => void;

  /** Callback when an event is moved */
  onEventMove?: (eventId: string, newStart: Date, newEnd: Date) => void;

  /** Callback when an event is resized */
  onEventResize?: (eventId: string, newStart: Date, newEnd: Date) => void;

  /** Additional class names */
  className?: string;

  /** Height of each hour in pixels */
  hourHeight?: number;
}

interface CalendarEventContext {
  /** Pixel position from top */
  top: number;

  /** Pixel height */
  height: number;

  /** Whether the event spans multiple days */
  isMultiDay: boolean;

  /** Column index (for week view) */
  column: number;

  /** Style object for positioning */
  style: React.CSSProperties;
}

// =============================================================================
// Helpers
// =============================================================================

function getEventPosition(
  event: CalendarEvent,
  startHour: number,
  hourHeight: number,
): { top: number; height: number } {
  const startMinutes = event.startTime.getHours() * 60 + event.startTime.getMinutes();
  const endMinutes = event.endTime.getHours() * 60 + event.endTime.getMinutes();

  const startOffset = startMinutes - startHour * 60;
  const duration = endMinutes - startMinutes;

  const top = (startOffset / 60) * hourHeight;
  const height = Math.max((duration / 60) * hourHeight, hourHeight / 4); // Min height

  return { top, height };
}

function getDayOfWeek(date: Date, dayIndex: number): Date {
  const result = new Date(date);
  const currentDay = result.getDay();
  const diff = dayIndex - currentDay;
  result.setDate(result.getDate() + diff);
  return result;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// =============================================================================
// TimeSlotDropZone Component
// =============================================================================

interface TimeSlotDropZoneProps {
  id: string;
  slot: TimeSlot;
  surfaceId: SurfaceId;
  accepts: ObjectType[];
  onDrop: (object: AnyObject, slot: TimeSlot) => void;
  hourHeight: number;
  slotDuration: number;
}

function TimeSlotDropZone({
  id,
  slot,
  surfaceId,
  accepts,
  onDrop: _onDrop,
  hourHeight,
  slotDuration,
}: TimeSlotDropZoneProps) {
  const dragDrop = useDragDrop();

  const { setNodeRef, isOver } = useDroppable({
    id,
    data: {
      type: 'time-slot',
      surfaceId,
      slot,
    },
  });

  const canAccept =
    dragDrop.state.isDragging &&
    dragDrop.state.draggedType &&
    accepts.includes(dragDrop.state.draggedType);

  const isActiveTarget = isOver && canAccept;

  const slotHeight = (slotDuration / 60) * hourHeight;

  return (
    <div
      ref={setNodeRef}
      className={cn('absolute right-0 left-0 transition-colors', isActiveTarget && 'bg-primary/10')}
      style={{
        top: ((slot.hour - 6) * 60 + slot.minute) * (hourHeight / 60),
        height: slotHeight,
      }}
      data-slot-hour={slot.hour}
      data-slot-minute={slot.minute}
    />
  );
}

// =============================================================================
// DayColumn Component
// =============================================================================

interface DayColumnProps {
  date: Date;
  events: CalendarEvent[];
  renderEvent: CalendarGridProps['renderEvent'];
  startHour: number;
  endHour: number;
  hourHeight: number;
  slotDuration: number;
  surfaceId: SurfaceId;
  accepts: ObjectType[];
  onDrop?: (object: AnyObject, slot: TimeSlot) => void;
  columnIndex: number;
  showTimeGutter?: boolean;
}

function DayColumn({
  date,
  events,
  renderEvent,
  startHour,
  endHour,
  hourHeight,
  slotDuration,
  surfaceId,
  accepts,
  onDrop,
  columnIndex,
  showTimeGutter = false,
}: DayColumnProps) {
  // Filter events for this day
  const dayEvents = useMemo(
    () => events.filter((event) => isSameDay(event.startTime, date)),
    [events, date],
  );

  // Generate time slots for drop zones
  const slots = useMemo(() => {
    const result: TimeSlot[] = [];
    for (let hour = startHour; hour < endHour; hour++) {
      for (let minute = 0; minute < 60; minute += slotDuration) {
        const slotDate = new Date(date);
        slotDate.setHours(hour, minute, 0, 0);
        result.push({ hour, minute, date: slotDate });
      }
    }
    return result;
  }, [date, startHour, endHour, slotDuration]);

  const totalHeight = (endHour - startHour) * hourHeight;

  return (
    <div className="relative flex-1" style={{ height: totalHeight }}>
      {/* Time gutter (only for first column) */}
      {showTimeGutter && (
        <div className="border-outline-variant absolute top-0 bottom-0 left-0 w-16 border-r">
          {Array.from({ length: endHour - startHour }, (_, i) => (
            <div
              key={i}
              className="text-on-surface-variant absolute right-2 text-xs"
              style={{ top: i * hourHeight - 6 }}
            >
              {formatHour(startHour + i)}
            </div>
          ))}
        </div>
      )}

      {/* Hour lines */}
      {Array.from({ length: endHour - startHour }, (_, i) => (
        <div
          key={i}
          className="border-outline-variant/50 absolute right-0 left-0 border-t"
          style={{ top: i * hourHeight }}
        />
      ))}

      {/* Drop zones */}
      {onDrop &&
        slots.map((slot) => (
          <TimeSlotDropZone
            key={`${String(slot.hour)}-${String(slot.minute)}`}
            id={`${surfaceId}-slot-${date.toISOString()}-${String(slot.hour)}-${String(slot.minute)}`}
            slot={slot}
            surfaceId={surfaceId}
            accepts={accepts}
            onDrop={onDrop}
            hourHeight={hourHeight}
            slotDuration={slotDuration}
          />
        ))}

      {/* Events */}
      {dayEvents.map((event) => {
        const { top, height } = getEventPosition(event, startHour, hourHeight);
        const context: CalendarEventContext = {
          top,
          height,
          isMultiDay: false,
          column: columnIndex,
          style: {
            position: 'absolute',
            top,
            height,
            left: showTimeGutter ? '4.5rem' : '0.25rem',
            right: '0.25rem',
          },
        };

        return (
          <motion.div
            key={event.id}
            layout
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            style={context.style}
          >
            {renderEvent(event, context)}
          </motion.div>
        );
      })}
    </div>
  );
}

function formatHour(hour: number): string {
  if (hour === 0 || hour === 24) return '12 AM';
  if (hour === 12) return '12 PM';
  if (hour < 12) return `${String(hour)} AM`;
  return `${String(hour - 12)} PM`;
}

// =============================================================================
// CalendarGrid Component
// =============================================================================

export function CalendarGrid({
  id,
  date,
  view = 'day',
  events,
  renderEvent,
  startHour = 6,
  endHour = 22,
  slotDuration = 30,
  accepts = ['task', 'event'],
  onDrop,
  onEventMove: _onEventMove,
  onEventResize: _onEventResize,
  className,
  hourHeight = 60,
}: CalendarGridProps) {
  const handleDrop = useCallback(
    (object: AnyObject, slot: TimeSlot) => {
      onDrop?.(object, slot);
    },
    [onDrop],
  );

  if (view === 'day') {
    return (
      <div
        className={cn('calendar-grid relative', className)}
        data-surface-id={id}
        data-surface-type="calendar"
        data-view={view}
      >
        <DayColumn
          date={date}
          events={events}
          renderEvent={renderEvent}
          startHour={startHour}
          endHour={endHour}
          hourHeight={hourHeight}
          slotDuration={slotDuration}
          surfaceId={id}
          accepts={accepts}
          onDrop={handleDrop}
          columnIndex={0}
          showTimeGutter
        />
      </div>
    );
  }

  // Week view
  const weekDays = useMemo(() => {
    const days: Date[] = [];
    const startOfWeek = getDayOfWeek(date, 0); // Sunday
    for (let i = 0; i < 7; i++) {
      const day = new Date(startOfWeek);
      day.setDate(day.getDate() + i);
      days.push(day);
    }
    return days;
  }, [date]);

  return (
    <div
      className={cn('calendar-grid', className)}
      data-surface-id={id}
      data-surface-type="calendar"
      data-view={view}
    >
      {/* Day headers */}
      <div className="border-outline-variant flex border-b">
        <div className="w-16 shrink-0" /> {/* Time gutter spacer */}
        {weekDays.map((day, i) => (
          <div
            key={i}
            className={cn(
              'flex-1 py-2 text-center text-sm',
              isSameDay(day, new Date()) && 'bg-primary/10 font-medium',
            )}
          >
            <div className="text-on-surface-variant">
              {day.toLocaleDateString('en-US', { weekday: 'short' })}
            </div>
            <div className="text-lg">{day.getDate()}</div>
          </div>
        ))}
      </div>

      {/* Grid body */}
      <div className="relative flex">
        {/* Time gutter */}
        <div
          className="border-outline-variant w-16 shrink-0 border-r"
          style={{ height: (endHour - startHour) * hourHeight }}
        >
          {Array.from({ length: endHour - startHour }, (_, i) => (
            <div
              key={i}
              className="text-on-surface-variant absolute right-2 text-xs"
              style={{ top: i * hourHeight - 6 }}
            >
              {formatHour(startHour + i)}
            </div>
          ))}
        </div>

        {/* Day columns */}
        {weekDays.map((day, i) => (
          <DayColumn
            key={i}
            date={day}
            events={events}
            renderEvent={renderEvent}
            startHour={startHour}
            endHour={endHour}
            hourHeight={hourHeight}
            slotDuration={slotDuration}
            surfaceId={id}
            accepts={accepts}
            onDrop={handleDrop}
            columnIndex={i}
          />
        ))}
      </div>
    </div>
  );
}
