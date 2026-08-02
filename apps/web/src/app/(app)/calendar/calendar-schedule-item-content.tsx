import type { CalendarItemOut } from '@docket/types';
import type { JSX } from 'react';

import type { ScheduleItemDensity } from '../../../components/scheduling';

const KIND_LABELS = {
  provider_event: 'Calendar event',
  native_event: 'Event',
  native_block: 'Block',
  timebox: 'Timebox',
  task_timebox: 'Task timebox',
  availability_block: 'Availability',
} satisfies Record<CalendarItemOut['kind'], string>;

/**
 * The kind label shown on a card, never `undefined`.
 *
 * @remarks
 * The API and the web app deploy independently, so an API that adds a `CalendarItemKind` ahead of a
 * web release would hand this map a key it does not have — and an unguarded lookup prints the literal
 * string `undefined` onto every affected event. Falling back to the generic word keeps an unknown
 * kind merely unspecific instead of visibly broken.
 *
 * The map is read through a widened local rather than indexed directly: `satisfies` keeps the
 * literal exhaustive against today's union, while the widened type is what makes the fallback
 * reachable at runtime — indexing the narrow type would make the `??` provably dead and the
 * defence would be linted away.
 *
 * @param kind - The item kind reported by the API.
 * @returns The display label for that kind.
 */
function kindLabel(kind: CalendarItemOut['kind']): string {
  const labels: Readonly<Record<string, string | undefined>> = KIND_LABELS;
  return labels[kind] ?? 'Event';
}

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
  const metadata = `${kindLabel(item.kind)}${state ? ` · ${state}` : ''}`;
  return (
    <span className="flex min-w-0 items-baseline gap-1">
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      <span className="text-on-surface-variant text-body-small max-w-[45%] shrink-0 truncate">
        {metadata}
      </span>
    </span>
  );
}
