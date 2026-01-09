'use client';

import { formatTime } from '@/lib/calendar-utils';
import type { TimeSelection } from './hooks/useTimeSelection';

export interface TimeSelectionOverlayProps {
  selection: TimeSelection;
}

export function TimeSelectionOverlay({ selection }: TimeSelectionOverlayProps) {
  const top = Math.min(selection.startY, selection.endY);
  const height = Math.abs(selection.endY - selection.startY);

  return (
    <div
      className="bg-primary/15 pointer-events-none absolute right-2 left-14 z-40 rounded-md"
      style={{ top: `${String(top)}px`, height: `${String(Math.max(height, 24))}px` }}
    >
      <div className="text-primary px-2 py-1 text-sm font-medium">
        {formatTime(selection.startTime)} - {formatTime(selection.endTime)}
      </div>
    </div>
  );
}
