import type { CalendarItemOut } from '@docket/types';
import type { JSX } from 'react';

import type { ScheduleItemDensity } from '../../../components/scheduling';

const KIND_LABELS: Record<CalendarItemOut['kind'], string> = {
  provider_event: 'Calendar event',
  native_event: 'Event',
  native_block: 'Block',
  timebox: 'Timebox',
  task_timebox: 'Task timebox',
  availability_block: 'Availability',
};

/** Return compact application-owned sync copy without exposing provider failures. */
function syncLabel(item: CalendarItemOut): string | null {
  if (item.hasConflict || item.status === 'conflicted') return 'Conflict';
  if (item.syncState === 'local_dirty' || item.syncState === 'push_pending') return 'Saving…';
  if (item.syncState === 'provider_error') return 'Sync issue';
  return null;
}

/** Render event kind and sync state directly on a calendar card. */
export function CalendarScheduleItemContent({
  item,
  density,
}: {
  readonly item: CalendarItemOut;
  readonly density: ScheduleItemDensity;
}): JSX.Element {
  if (density !== 'full') return <span className="truncate">{item.title}</span>;

  const state = syncLabel(item);
  const metadata = `${KIND_LABELS[item.kind]}${state ? ` · ${state}` : ''}`;
  return (
    <span className="flex min-w-0 items-baseline gap-1">
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      <span className="text-on-surface-variant max-w-[45%] shrink-0 truncate text-[10px] font-normal">
        {metadata}
      </span>
    </span>
  );
}
