import type { CalendarItemOut } from '@docket/types';
import type { JSX } from 'react';

import type { ScheduleItemDensity } from '../../../components/scheduling';

/**
 * Return compact application-owned sync copy without exposing provider failures.
 *
 * @remarks
 * Never the provider's own words. `provider_error` becomes "Sync issue" — a fact the reader can act
 * on — rather than whatever sentence the API happened to receive from Google.
 *
 * @param item - The calendar item being drawn.
 * @returns The state to print beside the title, or `null` when the item is simply fine.
 */
function syncLabel(item: CalendarItemOut): string | null {
  if (item.hasConflict || item.status === 'conflicted') return 'Conflict';
  if (item.syncState === 'local_dirty' || item.syncState === 'push_pending') return 'Saving…';
  if (item.syncState === 'provider_error') return 'Sync issue';
  return null;
}

/**
 * Render one calendar item's on-card content: its title, and a state only when there is one.
 *
 * @remarks
 * This used to also print a per-card kind label — `Block`, `Calendar event`, `Timebox`. Measured on
 * a 154px card at 1440, that label took 32px and **never truncated** while the title was cut off at
 * 98px: a fixed piece of chrome outranking the content on the one surface whose whole job is to show
 * events. The kind is already carried by the layer's colour stripe and stated in full in the item's
 * drawer, so nothing is lost by giving the line back to the title.
 *
 * A *sync state* is different in kind and stays: "Conflict" or "Sync issue" is something the reader
 * has to do something about, and it appears on the small minority of cards that actually have one.
 *
 * @param props - The item to draw and the density the canvas resolved for its box.
 * @returns The card's label content.
 */
export function CalendarScheduleItemContent({
  item,
  density,
}: {
  readonly item: CalendarItemOut;
  readonly density: ScheduleItemDensity;
}): JSX.Element {
  const state = syncLabel(item);
  if (density !== 'full' || state === null) return <span className="truncate">{item.title}</span>;

  return (
    <span className="flex min-w-0 items-baseline gap-1">
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      <span className="text-on-surface-variant text-body-medium max-w-[45%] shrink-0 truncate">
        {state}
      </span>
    </span>
  );
}
