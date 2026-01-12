'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import EventIcon from '@mui/icons-material/Event';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { CalendarEntry } from '@/components/objects/surfaces/DayCalendar';

// =============================================================================
// Types
// =============================================================================

export interface EntryCreationPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startTime: Date;
  endTime: Date;
  anchorRect: DOMRect | null;
  onSubmit: (entry: Omit<CalendarEntry, 'id'>) => void;
}

type EntryType = 'event' | 'time-block';

interface PopoverPosition {
  top: number;
  left: number;
  placement: 'right' | 'left';
}

// =============================================================================
// Constants
// =============================================================================

const POPOVER_WIDTH = 340;
const POPOVER_GAP = 12;
const VIEWPORT_PADDING = 16;

// =============================================================================
// Helpers
// =============================================================================

function formatTimeForInput(date: Date): string {
  return date.toTimeString().slice(0, 5);
}

function formatTimeRange(start: Date, end: Date): string {
  const formatTime = (d: Date) =>
    d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  return `${formatTime(start)} – ${formatTime(end)}`;
}

function formatDateCompact(date: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dateOnly = new Date(date);
  dateOnly.setHours(0, 0, 0, 0);

  if (dateOnly.getTime() === today.getTime()) {
    return 'Today';
  }

  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function parseTimeInput(timeStr: string, baseDate: Date): Date {
  const parts = timeStr.split(':').map(Number);
  const hours = parts[0] ?? 0;
  const minutes = parts[1] ?? 0;
  const result = new Date(baseDate);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

function calculatePosition(anchorRect: DOMRect, popoverHeight: number): PopoverPosition {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = anchorRect.right + POPOVER_GAP;
  let placement: 'right' | 'left' = 'right';

  if (left + POPOVER_WIDTH + VIEWPORT_PADDING > viewportWidth) {
    left = anchorRect.left - POPOVER_WIDTH - POPOVER_GAP;
    placement = 'left';
  }

  if (left < VIEWPORT_PADDING) {
    left = VIEWPORT_PADDING;
  }

  let top = anchorRect.top + anchorRect.height / 2 - popoverHeight / 2;

  if (top < VIEWPORT_PADDING) {
    top = VIEWPORT_PADDING;
  }
  if (top + popoverHeight + VIEWPORT_PADDING > viewportHeight) {
    top = viewportHeight - popoverHeight - VIEWPORT_PADDING;
  }

  return { top, left, placement };
}

// =============================================================================
// Component
// =============================================================================

export function EntryCreationPopover({
  open,
  onOpenChange,
  startTime,
  endTime,
  anchorRect,
  onSubmit,
}: EntryCreationPopoverProps) {
  const [entryType, setEntryType] = useState<EntryType>('event');
  const [title, setTitle] = useState('');
  const [start, setStart] = useState(formatTimeForInput(startTime));
  const [end, setEnd] = useState(formatTimeForInput(endTime));
  const [location, setLocation] = useState('');
  const [showTimeEdit, setShowTimeEdit] = useState(false);

  const popoverRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const position = useMemo(() => {
    if (!anchorRect) return null;
    const estimatedHeight = showTimeEdit ? 320 : 240;
    return calculatePosition(anchorRect, estimatedHeight);
  }, [anchorRect, showTimeEdit]);

  useEffect(() => {
    if (open) {
      setStart(formatTimeForInput(startTime));
      setEnd(formatTimeForInput(endTime));
      setTitle('');
      setLocation('');
      setShowTimeEdit(false);
      setTimeout(() => titleInputRef.current?.focus(), 50);
    }
  }, [open, startTime, endTime]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onOpenChange(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Don't close if clicking on the popover itself
      if (popoverRef.current?.contains(target)) {
        return;
      }
      // Don't close if clicking on the preview entry (user is dragging it)
      if (target.closest('[data-preview-entry]')) {
        return;
      }
      onOpenChange(false);
    };

    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 10);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open, onOpenChange]);

  const handleSubmit = useCallback(() => {
    if (!title.trim()) return;

    const entry: Omit<CalendarEntry, 'id'> = {
      type: entryType,
      title: title.trim(),
      startTime: parseTimeInput(start, startTime),
      endTime: parseTimeInput(end, startTime),
      ...(entryType === 'event' && location.trim() ? { location: location.trim() } : {}),
    };

    onSubmit(entry);
    onOpenChange(false);
  }, [entryType, title, start, end, location, startTime, onSubmit, onOpenChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && title.trim()) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, title],
  );

  if (!open || !position) return null;

  const popoverContent = (
    <div
      ref={popoverRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="popover-title"
      className={cn(
        'bg-surface-container fixed z-50 overflow-hidden rounded-2xl shadow-xl',
        'animate-in fade-in-0 zoom-in-95 duration-150',
        position.placement === 'right' ? 'slide-in-from-left-2' : 'slide-in-from-right-2',
      )}
      style={{
        top: position.top,
        left: position.left,
        width: POPOVER_WIDTH,
      }}
      onKeyDown={handleKeyDown}
    >
      {/* Title input - hero element */}
      <div className="px-5 pt-5 pb-3">
        <input
          ref={titleInputRef}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
          placeholder={entryType === 'event' ? 'Add title' : 'What will you work on?'}
          className={cn(
            'w-full bg-transparent outline-none',
            'text-on-surface placeholder:text-on-surface-variant/40 text-xl',
            'font-normal tracking-tight',
          )}
        />
      </div>

      {/* Type selector - segmented button style */}
      <div className="px-5 pb-4">
        <div className="bg-surface-container inline-flex rounded-full p-1">
          <button
            type="button"
            onClick={() => {
              setEntryType('event');
            }}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-all duration-150',
              'text-label-large',
              entryType === 'event'
                ? 'bg-secondary-container text-on-secondary-container'
                : 'text-on-surface-variant hover:text-on-surface',
            )}
          >
            <EventIcon sx={{ fontSize: 18 }} />
            <span>Event</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setEntryType('time-block');
            }}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-3 py-1.5 transition-all duration-150',
              'text-label-large',
              entryType === 'time-block'
                ? 'bg-secondary-container text-on-secondary-container'
                : 'text-on-surface-variant hover:text-on-surface',
            )}
          >
            <GridViewOutlinedIcon sx={{ fontSize: 18 }} />
            <span>Time block</span>
          </button>
        </div>
      </div>

      {/* Time & details section */}
      <div className="space-y-2 px-5 pb-4">
        {/* Time row */}
        <button
          type="button"
          onClick={() => {
            setShowTimeEdit(!showTimeEdit);
          }}
          className={cn(
            '-mx-3 flex w-full items-center gap-3 rounded-lg px-3 py-2',
            'text-on-surface-variant hover:bg-on-surface/5 transition-colors',
            'text-left',
          )}
        >
          <AccessTimeIcon sx={{ fontSize: 20 }} className="text-on-surface-variant/70" />
          <div className="flex-1">
            <span className="text-body-medium text-on-surface">
              {formatTimeRange(parseTimeInput(start, startTime), parseTimeInput(end, startTime))}
            </span>
            <span className="text-body-medium text-on-surface-variant/70 ml-2">
              {formatDateCompact(startTime)}
            </span>
          </div>
        </button>

        {/* Expanded time inputs */}
        {showTimeEdit && (
          <div className="animate-in fade-in-0 slide-in-from-top-1 flex gap-3 pl-9 duration-150">
            <div className="flex-1">
              <Input
                type="time"
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                }}
                className="bg-surface-container h-10"
              />
            </div>
            <span className="text-on-surface-variant self-center">to</span>
            <div className="flex-1">
              <Input
                type="time"
                value={end}
                onChange={(e) => {
                  setEnd(e.target.value);
                }}
                className="bg-surface-container h-10"
              />
            </div>
          </div>
        )}

        {/* Location (events only) */}
        {entryType === 'event' && (
          <div className="hover:bg-on-surface/5 -mx-3 flex items-center gap-3 rounded-lg px-3 py-2 transition-colors">
            <PlaceOutlinedIcon sx={{ fontSize: 20 }} className="text-on-surface-variant/70" />
            <input
              value={location}
              onChange={(e) => {
                setLocation(e.target.value);
              }}
              placeholder="Add location"
              className="text-body-medium text-on-surface placeholder:text-on-surface-variant/40 flex-1 bg-transparent outline-none"
            />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 px-5 py-4">
        <Button
          variant="text"
          onClick={() => {
            onOpenChange(false);
          }}
          className="text-primary hover:bg-primary/8"
        >
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!title.trim()}
          className="bg-primary text-on-primary hover:bg-primary/90 disabled:opacity-40"
        >
          Save
        </Button>
      </div>
    </div>
  );

  if (typeof window === 'undefined') return null;
  return createPortal(popoverContent, document.body);
}
