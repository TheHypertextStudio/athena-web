import type { CalendarItemOut } from '@docket/planning/calendar-contract';
import type { JSX } from 'react';

import type { ScheduleItemDensity } from '../../../components/scheduling';

/**
 * Render one calendar item's title without provider or persistence chrome.
 *
 * @remarks
 * This used to also print a per-card kind label — `Block`, `Calendar event`, `Timebox`. Measured on
 * a 154px card at 1440, that label took 32px and **never truncated** while the title was cut off at
 * 98px: a fixed piece of chrome outranking the content on the one surface whose whole job is to show
 * events. The kind is already carried by the layer's colour stripe and stated in full in the item's
 * drawer, so nothing is lost by giving the line back to the title.
 *
 * @param props - The item to draw and the density the canvas resolved for its box.
 * @returns The card's label content.
 */
export function CalendarScheduleItemContent({
  item,
  density: _density,
}: {
  readonly item: CalendarItemOut;
  readonly density: ScheduleItemDensity;
}): JSX.Element {
  return <span className="truncate">{item.title}</span>;
}
