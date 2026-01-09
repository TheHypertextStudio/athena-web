'use client';

import { getYFromTime } from '@/lib/calendar-utils';

export interface CurrentTimeIndicatorProps {
  startHour: number;
  hourHeight: number;
}

export function CurrentTimeIndicator({ startHour, hourHeight }: CurrentTimeIndicatorProps) {
  const now = new Date();
  const y = getYFromTime(now, startHour, hourHeight);

  return (
    <div
      className="duration-medium2 ease-emphasized-decelerate pointer-events-none absolute right-0 left-10 z-30 flex items-center transition-[top]"
      style={{ top: `${String(y)}px` }}
    >
      <div className="bg-error -ml-1.5 h-3 w-3 rounded-full" />
      <div className="bg-error h-0.5 flex-1" />
    </div>
  );
}
