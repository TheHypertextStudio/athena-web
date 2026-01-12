'use client';

import { useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import EventIcon from '@mui/icons-material/Event';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CalendarEntry } from '@/components/objects/surfaces/DayCalendar';

// =============================================================================
// Types
// =============================================================================

export interface EntryDetailPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: CalendarEntry | null;
  anchorRect: DOMRect | null;
  onEdit?: (entry: CalendarEntry) => void;
  onDelete?: (entry: CalendarEntry) => void;
}

interface PopoverPosition {
  top: number;
  left: number;
  placement: 'right' | 'left';
}

// =============================================================================
// Constants
// =============================================================================

const POPOVER_WIDTH = 320;
const POPOVER_GAP = 12;
const VIEWPORT_PADDING = 16;

// =============================================================================
// Helpers
// =============================================================================

function formatTimeRange(start: Date, end: Date): string {
  const formatTime = (d: Date) =>
    d.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  return `${formatTime(start)} – ${formatTime(end)}`;
}

function formatDateFull(date: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dateOnly = new Date(date);
  dateOnly.setHours(0, 0, 0, 0);

  const dayDiff = Math.floor((dateOnly.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (dayDiff === 0) {
    return 'Today';
  } else if (dayDiff === 1) {
    return 'Tomorrow';
  } else if (dayDiff === -1) {
    return 'Yesterday';
  }

  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function getDurationText(start: Date, end: Date): string {
  const diffMs = end.getTime() - start.getTime();
  const diffMins = Math.round(diffMs / (1000 * 60));

  if (diffMins < 60) {
    return `${String(diffMins)} min`;
  }

  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;

  if (mins === 0) {
    return `${String(hours)} hr`;
  }

  return `${String(hours)} hr ${String(mins)} min`;
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

export function EntryDetailPopover({
  open,
  onOpenChange,
  entry,
  anchorRect,
  onEdit,
  onDelete,
}: EntryDetailPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  const position = useMemo(() => {
    if (!anchorRect) return null;
    const estimatedHeight = 200;
    return calculatePosition(anchorRect, estimatedHeight);
  }, [anchorRect]);

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
      if (popoverRef.current?.contains(target)) {
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

  const handleEdit = useCallback(() => {
    if (entry && onEdit) {
      onEdit(entry);
      onOpenChange(false);
    }
  }, [entry, onEdit, onOpenChange]);

  const handleDelete = useCallback(() => {
    if (entry && onDelete) {
      onDelete(entry);
      onOpenChange(false);
    }
  }, [entry, onDelete, onOpenChange]);

  if (!open || !position || !entry) return null;

  const TypeIcon = entry.type === 'event' ? EventIcon : GridViewOutlinedIcon;
  const typeLabel = entry.type === 'event' ? 'Event' : 'Time block';

  const popoverContent = (
    <div
      ref={popoverRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="detail-popover-title"
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
    >
      {/* Header with colored bar */}
      <div
        className="h-2"
        style={{
          backgroundColor: entry.color ?? 'var(--color-primary)',
        }}
      />

      {/* Title and type */}
      <div className="px-5 pt-4 pb-2">
        <h2
          id="detail-popover-title"
          className="text-on-surface text-xl font-medium tracking-tight"
        >
          {entry.title}
        </h2>
        <div className="text-on-surface-variant mt-1 flex items-center gap-1.5 text-sm">
          <TypeIcon sx={{ fontSize: 16 }} />
          <span>{typeLabel}</span>
        </div>
      </div>

      {/* Time info */}
      <div className="space-y-1 px-5 pb-4">
        <div className="text-on-surface-variant flex items-center gap-3">
          <AccessTimeIcon sx={{ fontSize: 20 }} className="text-on-surface-variant/70" />
          <div>
            <div className="text-on-surface text-sm font-medium">
              {formatDateFull(entry.startTime)}
            </div>
            <div className="text-on-surface-variant text-sm">
              {formatTimeRange(entry.startTime, entry.endTime)}
              <span className="text-on-surface-variant/60 ml-2">
                ({getDurationText(entry.startTime, entry.endTime)})
              </span>
            </div>
          </div>
        </div>

        {/* Location (if present) */}
        {entry.location && (
          <div className="text-on-surface-variant flex items-center gap-3 pt-1">
            <PlaceOutlinedIcon sx={{ fontSize: 20 }} className="text-on-surface-variant/70" />
            <span className="text-on-surface text-sm">{entry.location}</span>
          </div>
        )}

        {/* Tasks (if present) */}
        {entry.tasks && entry.tasks.length > 0 && (
          <div className="pt-2">
            <div className="text-on-surface-variant mb-1 text-xs font-medium tracking-wide uppercase">
              Tasks
            </div>
            <ul className="space-y-1">
              {entry.tasks.map((task) => (
                <li
                  key={task.id}
                  className={cn(
                    'text-sm',
                    task.completed ? 'text-on-surface-variant line-through' : 'text-on-surface',
                  )}
                >
                  {task.title}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="border-outline-variant/30 flex justify-end gap-2 border-t px-4 py-3">
        {onDelete && (
          <Button
            variant="text"
            size="sm"
            onClick={handleDelete}
            className="text-error hover:bg-error/10"
          >
            <DeleteOutlineIcon sx={{ fontSize: 18 }} className="mr-1" />
            Delete
          </Button>
        )}
        {onEdit && (
          <Button variant="text" size="sm" onClick={handleEdit} className="text-primary">
            <EditOutlinedIcon sx={{ fontSize: 18 }} className="mr-1" />
            Edit
          </Button>
        )}
      </div>
    </div>
  );

  if (typeof window === 'undefined') return null;
  return createPortal(popoverContent, document.body);
}
