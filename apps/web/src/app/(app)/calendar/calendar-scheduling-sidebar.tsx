import type { JSX } from 'react';

import CalendarLayerPanel from '@/components/calendar/calendar-layer-panel';

import type { CalendarAxis } from './calendar-schedule-model';
import type { CalendarDateAxisState } from './use-calendar-date-axis';

interface CalendarSchedulingSidebarProps {
  readonly axis: CalendarAxis;
  readonly dateAxis: CalendarDateAxisState;
}

/** Render the axis-specific controls beside the shared scheduling canvas. */
export function CalendarSchedulingSidebar({
  axis,
  dateAxis,
}: CalendarSchedulingSidebarProps): JSX.Element {
  return (
    <aside className="flex min-h-0 min-w-0 flex-col gap-2 overflow-y-auto">
      {axis === 'dates' ? (
        <>
          <h2 className="text-on-surface text-sm font-semibold">Layers</h2>
          {dateAxis.layersError ? (
            <p role="status" className="text-on-surface-variant text-xs">
              Layer controls are temporarily unavailable.
            </p>
          ) : null}
          <CalendarLayerPanel layers={dateAxis.layers} />
        </>
      ) : (
        <div className="border-outline-variant rounded-lg border p-3">
          <h2 className="text-on-surface text-sm font-semibold">Shared schedules</h2>
          <p className="text-on-surface-variant mt-1 text-xs">
            Details appear only from layers each person shared with this workspace. Private provider
            events always appear as Busy.
          </p>
        </div>
      )}
    </aside>
  );
}
