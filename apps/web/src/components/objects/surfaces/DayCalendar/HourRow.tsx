'use client';

import { formatHour } from '@/lib/calendar-utils';

export interface HourRowProps {
  hour: number;
  hourHeight: number;
}

export function HourRow({ hour, hourHeight }: HourRowProps) {
  return (
    <div
      className="duration-medium2 ease-emphasized-decelerate relative flex transition-[height]"
      style={{ height: `${String(hourHeight)}px` }}
    >
      {/* Hour label */}
      <div className="w-12 -translate-y-2 pr-2 text-right">
        <span className="text-label-small text-on-surface-variant">{formatHour(hour)}</span>
      </div>

      {/* Grid line */}
      <div className="relative flex-1">
        <div className="bg-outline-variant/30 absolute top-0 right-0 left-0 h-px" />
      </div>
    </div>
  );
}
