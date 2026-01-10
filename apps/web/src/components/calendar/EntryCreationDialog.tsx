'use client';

import { useState, useCallback, useEffect } from 'react';
import EventIcon from '@mui/icons-material/Event';
import GridViewOutlinedIcon from '@mui/icons-material/GridViewOutlined';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { CalendarEntry } from '@/components/objects/surfaces/DayCalendar';
import { RecurrenceSelector } from './RecurrenceSelector';

// =============================================================================
// Types
// =============================================================================

export interface EntryCreationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  startTime: Date;
  endTime: Date;
  /** Called when creating a new entry */
  onSubmit: (entry: Omit<CalendarEntry, 'id'>) => void;
  /** Entry to edit (when in edit mode) */
  entry?: CalendarEntry;
  /** Called when updating an existing entry */
  onUpdate?: (entryId: string, updates: Partial<CalendarEntry>) => void;
}

type EntryType = 'event' | 'time-block';

// =============================================================================
// Helpers
// =============================================================================

function formatTimeForInput(date: Date): string {
  return date.toTimeString().slice(0, 5);
}

function formatDateDisplay(date: Date): string {
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

// =============================================================================
// Component
// =============================================================================

export function EntryCreationDialog({
  open,
  onOpenChange,
  startTime,
  endTime,
  onSubmit,
  entry,
  onUpdate,
}: EntryCreationDialogProps) {
  const isEditMode = Boolean(entry);
  const [entryType, setEntryType] = useState<EntryType>(entry?.type ?? 'event');
  const [title, setTitle] = useState(entry?.title ?? '');
  const [start, setStart] = useState(formatTimeForInput(entry?.startTime ?? startTime));
  const [end, setEnd] = useState(formatTimeForInput(entry?.endTime ?? endTime));
  const [location, setLocation] = useState(entry?.location ?? '');
  const [recurrenceRule, setRecurrenceRule] = useState<string | null>(
    entry?.recurrenceRule ?? null,
  );

  // Update form when entry changes (for edit mode)
  useEffect(() => {
    if (entry) {
      setEntryType(entry.type);
      setTitle(entry.title);
      setStart(formatTimeForInput(entry.startTime));
      setEnd(formatTimeForInput(entry.endTime));
      setLocation(entry.location ?? '');
      setRecurrenceRule(entry.recurrenceRule ?? null);
    }
  }, [entry]);

  const handleSubmit = useCallback(() => {
    if (!title.trim()) return;

    if (isEditMode && entry && onUpdate) {
      // Update existing entry
      const updates: Partial<CalendarEntry> = {
        title: title.trim(),
        startTime: parseTimeInput(start, entry.startTime),
        endTime: parseTimeInput(end, entry.startTime),
      };
      if (entryType === 'event' && location.trim()) {
        updates.location = location.trim();
      }
      if (recurrenceRule) {
        updates.recurrenceRule = recurrenceRule;
      }
      onUpdate(entry.id, updates);
    } else {
      // Create new entry
      const newEntry: Omit<CalendarEntry, 'id'> = {
        type: entryType,
        title: title.trim(),
        startTime: parseTimeInput(start, startTime),
        endTime: parseTimeInput(end, startTime),
        ...(entryType === 'event' && location.trim() ? { location: location.trim() } : {}),
        ...(recurrenceRule ? { recurrenceRule } : {}),
      };
      onSubmit(newEntry);
    }

    onOpenChange(false);

    // Reset form
    setTitle('');
    setLocation('');
    setEntryType('event');
    setRecurrenceRule(null);
  }, [
    isEditMode,
    entry,
    entryType,
    title,
    start,
    end,
    location,
    recurrenceRule,
    startTime,
    onSubmit,
    onUpdate,
    onOpenChange,
  ]);

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (newOpen && !entry) {
        // Reset form when opening in create mode
        setStart(formatTimeForInput(startTime));
        setEnd(formatTimeForInput(endTime));
        setTitle('');
        setLocation('');
        setEntryType('event');
        setRecurrenceRule(null);
      }
      onOpenChange(newOpen);
    },
    [startTime, endTime, entry, onOpenChange],
  );

  const displayDate = entry?.startTime ?? startTime;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit Entry' : 'New Entry'}</DialogTitle>
          <p className="text-on-surface-variant text-sm">{formatDateDisplay(displayDate)}</p>
        </DialogHeader>

        {/* Entry type toggle (only shown in create mode) */}
        {!isEditMode && (
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setEntryType('event');
              }}
              className={cn(
                'flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-3 transition-colors',
                entryType === 'event'
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high',
              )}
            >
              <EventIcon sx={{ fontSize: 20 }} />
              <span className="text-sm font-medium">Event</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setEntryType('time-block');
              }}
              className={cn(
                'flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-3 transition-colors',
                entryType === 'time-block'
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high',
              )}
            >
              <GridViewOutlinedIcon sx={{ fontSize: 20 }} />
              <span className="text-sm font-medium">Time Block</span>
            </button>
          </div>
        )}

        {/* Form fields */}
        <div className="mt-6 space-y-4">
          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
              }}
              placeholder={entryType === 'event' ? 'Meeting name' : 'What are you working on?'}
              autoFocus
            />
          </div>

          {/* Time range */}
          <div className="flex gap-4">
            <div className="flex-1 space-y-2">
              <Label htmlFor="start">Start</Label>
              <Input
                id="start"
                type="time"
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                }}
              />
            </div>
            <div className="flex-1 space-y-2">
              <Label htmlFor="end">End</Label>
              <Input
                id="end"
                type="time"
                value={end}
                onChange={(e) => {
                  setEnd(e.target.value);
                }}
              />
            </div>
          </div>

          {/* Recurrence */}
          <RecurrenceSelector value={recurrenceRule} onChange={setRecurrenceRule} />

          {/* Location (events only) */}
          {entryType === 'event' && (
            <div className="space-y-2">
              <Label htmlFor="location">Location</Label>
              <div className="relative">
                <PlaceOutlinedIcon
                  sx={{ fontSize: 20 }}
                  className="text-on-surface-variant absolute top-1/2 left-3 -translate-y-1/2"
                />
                <Input
                  id="location"
                  value={location}
                  onChange={(e) => {
                    setLocation(e.target.value);
                  }}
                  placeholder="Add location"
                  className="pl-10"
                />
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!title.trim()}>
            {isEditMode ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
