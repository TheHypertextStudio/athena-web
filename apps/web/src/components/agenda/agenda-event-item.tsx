/**
 * Individual event item in the agenda.
 *
 * @packageDocumentation
 */

'use client';

import { Clock, MapPin } from 'lucide-react';
import type { Event } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface AgendaEventItemProps {
  /** The event to display */
  event: Event;
}

/**
 * Format time for display (e.g., "9:00 AM").
 */
function formatTime(dateString: string): string {
  return new Date(dateString).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Event item component for the agenda view.
 */
export function AgendaEventItem({ event }: AgendaEventItemProps) {
  const timeDisplay = event.isAllDay
    ? 'All day'
    : event.endTime
      ? `${formatTime(event.startTime)} - ${formatTime(event.endTime)}`
      : formatTime(event.startTime);

  return (
    <div
      className={cn(
        'bg-card flex items-start gap-3 rounded-lg border border-l-4 border-l-blue-500 p-3',
      )}
    >
      {/* Time */}
      <div className="text-muted-foreground flex items-center gap-1 text-xs">
        <Clock className="h-3 w-3" />
        <span className="whitespace-nowrap">{timeDisplay}</span>
      </div>

      {/* Event Content */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{event.title}</p>

        {/* Location */}
        {event.location && (
          <p className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
            <MapPin className="h-3 w-3" />
            <span className="truncate">{event.location}</span>
          </p>
        )}

        {/* Description */}
        {event.description && (
          <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">{event.description}</p>
        )}
      </div>
    </div>
  );
}
