/**
 * Quick event creation form.
 *
 * @packageDocumentation
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import { Plus, X, MapPin } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { eventsApi, type Event } from '@/lib/api-client';
import { agendaKeys } from '@/lib/agenda-api';
import { cn } from '@/lib/utils';

interface QuickCreateEventProps {
  /** Called when an event is successfully created */
  onCreated?: (event: Event) => void;
  /** Date for the event (YYYY-MM-DD) */
  date: string;
}

/**
 * Inline form for quickly creating new events.
 */
export function QuickCreateEvent({ onCreated, date }: QuickCreateEventProps) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [location, setLocation] = useState('');
  const [isAllDay, setIsAllDay] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  function handleOpen() {
    setIsOpen(true);
  }

  function handleClose() {
    setIsOpen(false);
    setTitle('');
    setStartTime('09:00');
    setEndTime('10:00');
    setLocation('');
    setIsAllDay(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || isSubmitting) return;

    setIsSubmitting(true);
    try {
      const startDateTime = isAllDay ? `${date}T00:00:00Z` : `${date}T${startTime}:00`;

      const endDateTime = isAllDay ? `${date}T23:59:59Z` : `${date}T${endTime}:00`;

      const result = await eventsApi.create({
        title: title.trim(),
        startTime: startDateTime,
        endTime: endDateTime,
        location: location.trim() || undefined,
        isAllDay,
      });

      // Invalidate agenda queries to refresh the list
      void queryClient.invalidateQueries({ queryKey: agendaKeys.all });

      onCreated?.(result.data);
      handleClose();
    } catch {
      // Could show error toast here
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      handleClose();
    }
  }

  if (!isOpen) {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={handleOpen}
        className="text-muted-foreground hover:text-foreground w-full justify-start gap-2"
      >
        <Plus className="h-4 w-4" />
        Add event
      </Button>
    );
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      onKeyDown={handleKeyDown}
      className="bg-card space-y-3 rounded-lg border p-3"
    >
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
          }}
          placeholder="Event title..."
          className="flex-1"
          disabled={isSubmitting}
        />
        <Button type="button" variant="ghost" size="icon" onClick={handleClose} className="h-8 w-8">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/* All Day Checkbox */}
        <div className="flex items-center gap-2">
          <Checkbox
            id="all-day"
            checked={isAllDay}
            onCheckedChange={(checked) => {
              setIsAllDay(checked === true);
            }}
            disabled={isSubmitting}
          />
          <Label htmlFor="all-day" className="text-sm">
            All day
          </Label>
        </div>

        {/* Time Inputs */}
        {!isAllDay && (
          <>
            <Input
              type="time"
              value={startTime}
              onChange={(e) => {
                setStartTime(e.target.value);
              }}
              className="w-28"
              disabled={isSubmitting}
            />
            <span className="text-muted-foreground">to</span>
            <Input
              type="time"
              value={endTime}
              onChange={(e) => {
                setEndTime(e.target.value);
              }}
              className="w-28"
              disabled={isSubmitting}
            />
          </>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-1">
          <MapPin className="text-muted-foreground h-4 w-4" />
          <Input
            value={location}
            onChange={(e) => {
              setLocation(e.target.value);
            }}
            placeholder="Location (optional)"
            className="flex-1"
            disabled={isSubmitting}
          />
        </div>

        <Button
          type="submit"
          size="sm"
          disabled={!title.trim() || isSubmitting}
          className={cn(isSubmitting && 'opacity-50')}
        >
          {isSubmitting ? 'Adding...' : 'Add'}
        </Button>
      </div>
    </form>
  );
}
