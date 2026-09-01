/**
 * `calendar/calendar-event-dedup` — collapse the *same event* arriving on more than one calendar.
 *
 * @remarks
 * Linking a work account and a personal account puts the same objects on the grid twice: a national
 * holiday calendar subscribed on both, a meeting you were invited to at two addresses, a personal
 * calendar shared into a work account. The overlap machinery then does exactly what it is supposed
 * to and lays the copies side by side, so a day with three real meetings renders six half-width
 * blocks and reads as twice as busy as it is.
 *
 * {@link calendar-layer-dedup} answers the same question one level up — "is this the same
 * *calendar*?" — and the two are deliberately independent: a person may keep both copies of a
 * calendar visible (to see which account an event came from) and still want one block per event,
 * and a duplicate event can arrive from two calendars that are not themselves duplicates of each
 * other.
 *
 * ## What counts as the same event
 *
 * Two items are the same event only when they sit on **different layers** and one of these holds:
 *
 * 1. **Same provider event.** Same `provider`, same `externalEventId`, same
 *    `recurrenceInstanceKey`. Google issues one event id per underlying event and reuses it across
 *    every calendar that carries a copy, so this is a fact about the provider's identifiers rather
 *    than a guess about contents.
 * 2. **Same title at the same instant.** Identical case-folded title and identical start/end. This
 *    is the fallback for the holiday case, where two accounts subscribe to *different* generated
 *    calendars ("Holidays in United States" issued per locale) that publish the same days.
 *
 * The different-layer requirement is load-bearing. Two items with the same title and time inside one
 * calendar are two real entries — a double-booked room, a duplicated invite the owner has to see and
 * fix — and hiding one of those would be the app lying about what is on the calendar.
 *
 * Nothing here mutates or deletes: the collapsed copies are returned alongside the survivor so the
 * item's own detail view can name every calendar it came from. A copy that vanishes with no way to
 * find out where it went is the failure mode the connector-reliability rule exists to prevent.
 *
 * @see {@link file://./calendar-layer-dedup.ts} for the calendar-level equivalent.
 */
import type { CalendarItemOut, CalendarLayerOut } from '@docket/planning/calendar-contract';

/** One event and the copies of it that were folded away, in render order. */
export interface CalendarItemDuplicateGroup {
  /** The copy that stays on the grid. */
  readonly keep: CalendarItemOut;
  /** The copies of the same event that were collapsed into {@link keep}. */
  readonly duplicates: readonly CalendarItemOut[];
}

/** A de-duplicated item list plus the provenance of everything that was folded away. */
export interface DeduplicatedCalendarItems {
  /** The items to render — one per distinct event, in the input's order. */
  readonly items: readonly CalendarItemOut[];
  /** Collapsed copies, keyed by the id of the item that survived. Empty when nothing collapsed. */
  readonly duplicatesByItemId: ReadonlyMap<string, readonly CalendarItemOut[]>;
}

/** An empty result, so a caller with no items never allocates a map. */
const EMPTY_RESULT: DeduplicatedCalendarItems = { items: [], duplicatesByItemId: new Map() };

/**
 * The provider-identifier key for an item, when it has one.
 *
 * @param item - The item to key.
 * @returns A stable key, or `null` for a Docket-native item, which is never a provider duplicate.
 */
function providerEventKey(item: CalendarItemOut): string | null {
  const provider = item.provider;
  const eventId = item.externalEventId?.trim();
  if (provider === null || eventId === undefined || eventId.length === 0) return null;
  return `provider:${provider}:${eventId.toLowerCase()}:${item.recurrenceInstanceKey ?? ''}`;
}

/**
 * The title-and-instant key for an item.
 *
 * @remarks
 * All-day items key off their bare dates rather than their instants: the same holiday arriving from
 * two accounts in two timezones has the same `allDayStartDate` and different `startsAt`.
 *
 * @param item - The item to key.
 * @returns A stable key, or `null` when the item has no title to match on.
 */
function occurrenceKey(item: CalendarItemOut): string | null {
  const title = item.title.trim().toLowerCase();
  if (title.length === 0) return null;
  const start = item.allDayStartDate ?? item.startsAt ?? '';
  const end = item.allDayEndDate ?? item.endsAt ?? '';
  return `occurrence:${title}:${start}:${end}`;
}

/** Layer ids that are their account's primary calendar. */
function primaryLayerIds(layers: readonly CalendarLayerOut[]): ReadonlySet<string> {
  return new Set(layers.filter((layer) => layer.primary).map((layer) => layer.id));
}

/**
 * Decide which of two copies of one event stays on the grid.
 *
 * @remarks
 * In precedence order: the copy you can actually edit (so the surviving block stays draggable and
 * resizable), then the copy on its account's primary calendar, then the lower layer id, then the
 * lower item id purely so the result never depends on input order.
 *
 * @param left - A candidate copy.
 * @param right - The copy currently held.
 * @param primaryLayers - Layer ids that are their account's primary calendar.
 * @returns `true` when `left` should replace `right`.
 */
function beats(
  left: CalendarItemOut,
  right: CalendarItemOut,
  primaryLayers: ReadonlySet<string>,
): boolean {
  const editable = Number(left.permissions.canEditCore) - Number(right.permissions.canEditCore);
  if (editable !== 0) return editable > 0;
  const primary =
    Number(primaryLayers.has(left.layerId)) - Number(primaryLayers.has(right.layerId));
  if (primary !== 0) return primary > 0;
  if (left.layerId !== right.layerId) return left.layerId < right.layerId;
  return left.id < right.id;
}

/**
 * Collapse copies of the same event arriving from more than one calendar into one block.
 *
 * @remarks
 * Order-stable and total: every input item is either returned or recorded as a duplicate of one that
 * was, so no event can be silently dropped. Never throws; an item with no usable key simply cannot
 * match anything and is returned as-is.
 *
 * @param items - Every calendar item in the visible range, across every selected layer.
 * @param layers - The layers those items belong to, used only to recognise a primary calendar.
 * @returns The items to render plus the copies folded into each of them.
 *
 * @example
 * ```ts
 * const { items, duplicatesByItemId } = deduplicateCalendarItems(range.items, layers);
 * const alsoOn = duplicatesByItemId.get(items[0].id) ?? [];
 * ```
 */
export function deduplicateCalendarItems(
  items: readonly CalendarItemOut[],
  layers: readonly CalendarLayerOut[],
): DeduplicatedCalendarItems {
  if (items.length < 2)
    return items.length === 0 ? EMPTY_RESULT : { items, duplicatesByItemId: new Map() };

  const primaryLayers = primaryLayerIds(layers);
  // Every key an item answers to, so a provider-id match and a title match can reach one bucket.
  const keysFor = (item: CalendarItemOut): readonly string[] =>
    [providerEventKey(item), occurrenceKey(item)].filter((key): key is string => key !== null);

  /** Bucket id per key; buckets merge when one item's two keys reach two existing buckets. */
  const bucketByKey = new Map<string, number>();
  const buckets: CalendarItemOut[][] = [];
  for (const item of items) {
    const keys = keysFor(item);
    // A bucket is only reusable when the item genuinely comes from another calendar. Two entries in
    // one calendar that happen to share a title and a time are two real entries.
    const existing = keys
      .map((key) => bucketByKey.get(key))
      .find(
        (index) =>
          index !== undefined && buckets[index]?.every((held) => held.layerId !== item.layerId),
      );
    const index = existing ?? buckets.push([]) - 1;
    buckets[index]?.push(item);
    for (const key of keys) if (!bucketByKey.has(key)) bucketByKey.set(key, index);
  }

  const duplicatesByItemId = new Map<string, readonly CalendarItemOut[]>();
  const kept = new Map<string, CalendarItemOut>();
  for (const bucket of buckets) {
    const [first, ...rest] = bucket;
    if (first === undefined) continue;
    const keep = rest.reduce(
      (best, candidate) => (beats(candidate, best, primaryLayers) ? candidate : best),
      first,
    );
    kept.set(keep.id, keep);
    if (bucket.length > 1) {
      duplicatesByItemId.set(
        keep.id,
        bucket.filter((candidate) => candidate.id !== keep.id),
      );
    }
  }

  // Preserve the caller's ordering rather than the bucket ordering: the range endpoint returns
  // items sorted, and re-sorting here would make the grid's paint order depend on dedup internals.
  return { items: items.filter((item) => kept.has(item.id)), duplicatesByItemId };
}
