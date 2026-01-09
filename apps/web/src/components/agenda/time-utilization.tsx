/**
 * Time utilization progress bar component.
 *
 * @packageDocumentation
 */

'use client';

import { Clock } from 'lucide-react';
import type { AgendaTodaySummary } from '@/lib/agenda-api';

interface TimeUtilizationProps {
  /** Summary data from agenda API */
  summary: AgendaTodaySummary;
}

/**
 * Displays time utilization for the day as a progress bar.
 */
export function TimeUtilization({ summary }: TimeUtilizationProps) {
  const { utilizationPercent, estimatedTaskMinutes, scheduledEventMinutes, availableMinutes } =
    summary;

  // Determine color based on utilization
  let progressColor = 'bg-green-500';
  if (utilizationPercent > 80) {
    progressColor = 'bg-red-500';
  } else if (utilizationPercent > 60) {
    progressColor = 'bg-yellow-500';
  }

  const totalScheduled = estimatedTaskMinutes + scheduledEventMinutes;
  const hours = Math.floor(totalScheduled / 60);
  const minutes = totalScheduled % 60;
  const hoursLabel = String(hours);
  const minutesLabel = String(minutes);

  return (
    <div className="bg-card rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="text-muted-foreground h-4 w-4" />
          <span className="text-sm font-medium">Time Utilization</span>
        </div>
        <span className="text-muted-foreground text-sm">
          {hours > 0 ? `${hoursLabel}h ${minutesLabel}m` : `${minutesLabel}m`} scheduled
        </span>
      </div>

      {/* Progress Bar */}
      <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
        <div
          className={`h-full transition-all ${progressColor}`}
          style={{ width: `${String(Math.min(utilizationPercent, 100))}%` }}
        />
      </div>

      {/* Stats */}
      <div className="text-muted-foreground mt-3 flex justify-between text-xs">
        <span>{Math.round(utilizationPercent)}% of day scheduled</span>
        <span>
          {String(Math.floor(availableMinutes / 60))}h {String(availableMinutes % 60)}m available
        </span>
      </div>
    </div>
  );
}
