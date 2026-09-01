/**
 * `calendar/calendar-layer-dedup` — find calendar layers that are the *same calendar* arriving
 * twice because more than one account is linked.
 *
 * @remarks
 * Linking a work account and a personal account almost always produces literal duplicates: the
 * same national holiday calendar subscribed on both, and the personal account's own calendar shared
 * into the work account. Both render as two identically-timed stacks of events on the grid, which
 * is the thing that makes a busy day unreadable.
 *
 * Everything here is derived from data the API already returns — no new endpoint, no new field, no
 * heuristic on event contents. A Google calendar id is globally unique, so the same id appearing
 * under two different `connectionId`s **is** the same calendar subscribed twice; that is a fact
 * about the provider's identifiers, not a guess.
 *
 * These functions only *describe* redundancy. Acting on it is an explicit, reversible user choice
 * made in {@link CalendarLayerPanel} — nothing here hides a calendar, and no caller may hide one
 * silently. A calendar the person cannot see and was never told about is exactly the failure mode
 * the connector-reliability rule exists to prevent.
 */
import type { CalendarConnectionOut, CalendarLayerOut } from '@docket/planning/calendar-contract';

/** Why two or more layers are considered the same calendar. */
export type CalendarLayerDuplicateReason =
  /** The identical provider calendar subscribed on 2+ linked accounts. */
  | 'same_provider_calendar'
  /** The same holiday calendar arriving on 2+ accounts. */
  | 'holiday_calendar'
  /** A personal account's own calendar showing up on a work account. */
  | 'other_account_primary';

/** One set of layers that all render the same calendar, and which copy to keep. */
export interface CalendarLayerDuplicateGroup {
  /** Stable identity of the duplicated calendar; unique within one result. */
  readonly key: string;
  /** Why the group's members are the same calendar. */
  readonly reason: CalendarLayerDuplicateReason;
  /** The copy that should stay visible. */
  readonly keep: CalendarLayerOut;
  /** The copies that add nothing but a second stack of the same events. */
  readonly redundant: readonly CalendarLayerOut[];
}

/** Provider id suffixes that mark a generated calendar rather than a person's mailbox. */
const NON_MAILBOX_SUFFIXES = [
  '@group.v.calendar.google.com',
  '@import.calendar.google.com',
  '@holiday.calendar.google.com',
] as const;

/** Google's two shapes for a holiday calendar id. */
const HOLIDAY_ID_PATTERN = /#holidays?@/i;

/**
 * Whether a layer is a national/religious holiday calendar.
 *
 * @remarks
 * Decided entirely from the provider calendar id. Titles are localized, user-editable, and
 * routinely collide, so a title is only ever *supporting evidence for display* — never the key a
 * dedup decision rests on.
 *
 * @param layer - The layer to classify.
 * @returns `true` when the layer's provider id is a holiday calendar id.
 *
 * @example
 * ```typescript
 * isHolidayLayer({ externalLayerId: 'en.usa#holiday@group.v.calendar.google.com', … }); // true
 * ```
 */
export function isHolidayLayer(layer: CalendarLayerOut): boolean {
  const id = layer.externalLayerId?.trim();
  if (!id) return false;
  return HOLIDAY_ID_PATTERN.test(id) || id.toLowerCase().endsWith('@holiday.calendar.google.com');
}

/**
 * The globally unique identity of the provider calendar a layer renders.
 *
 * @param layer - The layer to key.
 * @returns `provider:id`, or `null` for a Docket-native layer, which is always distinct.
 */
function layerIdentityKey(layer: CalendarLayerOut): string | null {
  if (layer.provider === null || layer.externalLayerId === null) return null;
  const id = layer.externalLayerId.trim().toLowerCase();
  return id.length === 0 ? null : `${layer.provider}:${id}`;
}

/** Whether a provider calendar id is a person's mailbox rather than a generated calendar. */
function isMailboxLayerId(externalLayerId: string): boolean {
  const id = externalLayerId.trim().toLowerCase();
  if (!id.includes('@')) return false;
  return !NON_MAILBOX_SUFFIXES.some((suffix) => id.endsWith(suffix));
}

/** Case-folded account email per connection id, for connections that report one. */
function emailByConnectionId(
  connections: readonly CalendarConnectionOut[],
): ReadonlyMap<string, string> {
  const emails = new Map<string, string>();
  for (const connection of connections) {
    const email = connection.accountEmail?.trim().toLowerCase();
    if (email) emails.set(connection.id, email);
  }
  return emails;
}

/**
 * Pick the copy of a duplicated calendar that should stay visible.
 *
 * @remarks
 * In precedence order: the account that actually owns the calendar (its own mailbox address), then
 * the account's primary calendar, then the oldest connection, then the lowest id purely so the
 * result never depends on input order.
 *
 * @param candidates - Two or more layers rendering the same calendar.
 * @param accountEmails - Case-folded account email per connection id.
 * @returns The layer to keep.
 */
function preferredLayer(
  candidates: readonly [CalendarLayerOut, ...CalendarLayerOut[]],
  accountEmails: ReadonlyMap<string, string>,
): CalendarLayerOut {
  const ownsItsCalendar = (layer: CalendarLayerOut): boolean => {
    const id = layer.externalLayerId?.trim().toLowerCase();
    const email = layer.connectionId === null ? undefined : accountEmails.get(layer.connectionId);
    return id !== undefined && email !== undefined && id === email;
  };
  const beats = (left: CalendarLayerOut, right: CalendarLayerOut): boolean => {
    const ownership = Number(ownsItsCalendar(left)) - Number(ownsItsCalendar(right));
    if (ownership !== 0) return ownership > 0;
    const primary = Number(left.primary) - Number(right.primary);
    if (primary !== 0) return primary > 0;
    if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt;
    return left.id < right.id;
  };
  return candidates.reduce((best, candidate) => (beats(candidate, best) ? candidate : best));
}

/** Build one group from candidates that are already known to be the same calendar. */
function duplicateGroup(
  key: string,
  reason: CalendarLayerDuplicateReason,
  candidates: readonly [CalendarLayerOut, ...CalendarLayerOut[]],
  accountEmails: ReadonlyMap<string, string>,
): CalendarLayerDuplicateGroup {
  const keep = preferredLayer(candidates, accountEmails);
  return { key, reason, keep, redundant: candidates.filter((layer) => layer.id !== keep.id) };
}

/** Number of distinct linked accounts a set of layers spans. */
function connectionSpan(layers: readonly CalendarLayerOut[]): number {
  return new Set(layers.map((layer) => layer.connectionId)).size;
}

/**
 * Group calendar layers that render the same calendar more than once.
 *
 * @remarks
 * Degrades gracefully: with no connections (or a failed settings read) the identity-key and
 * holiday rules still apply, because neither needs account data — only the
 * "someone else's mailbox" rule does. Never throws, and never returns a group of one, so a caller
 * can never be led to hide the only copy of a calendar.
 *
 * @param layers - Every layer for the signed-in user, selected or not.
 * @param connections - The linked accounts, used to recognise mailbox ownership.
 * @returns One group per duplicated calendar, ordered by key for a stable render.
 *
 * @example
 * ```typescript
 * const groups = findDuplicateCalendarLayers(layers, connections);
 * const redundantCount = groups.reduce((total, group) => total + group.redundant.length, 0);
 * ```
 *
 * @see {@link isHolidayLayer} for how a holiday calendar is recognised.
 */
export function findDuplicateCalendarLayers(
  layers: readonly CalendarLayerOut[],
  connections: readonly CalendarConnectionOut[],
): readonly CalendarLayerDuplicateGroup[] {
  const accountEmails = emailByConnectionId(connections);
  const linkedEmails = new Set(accountEmails.values());
  const byKey = new Map<string, [CalendarLayerOut, ...CalendarLayerOut[]]>();
  for (const layer of layers) {
    const key = layerIdentityKey(layer);
    if (key === null) continue;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(layer);
    else byKey.set(key, [layer]);
  }

  const groups: CalendarLayerDuplicateGroup[] = [];
  const grouped = new Set<string>();
  for (const [key, candidates] of byKey) {
    if (candidates.length < 2) continue;
    const firstId = candidates[0].externalLayerId?.trim().toLowerCase() ?? '';
    const reason: CalendarLayerDuplicateReason = candidates.every(isHolidayLayer)
      ? 'holiday_calendar'
      : // The same mailbox calendar on 2+ accounts, one of which *is* that mailbox: this is
        // literally "my personal calendar showing up on my work account".
        isMailboxLayerId(firstId) && linkedEmails.has(firstId) && connectionSpan(candidates) > 1
        ? 'other_account_primary'
        : 'same_provider_calendar';
    groups.push(duplicateGroup(key, reason, candidates, accountEmails));
    for (const layer of candidates) grouped.add(layer.id);
  }

  // Holiday calendars are the one case where different provider ids really are the same calendar:
  // Google issues per-locale ids (`en.usa#holiday@…`, `en-gb.usa#holiday@…`) for one holiday set,
  // so identical titles on different accounts are the same events twice over. Restricted to
  // holiday layers, where a title collision cannot mean anything else.
  const byHolidayTitle = new Map<string, [CalendarLayerOut, ...CalendarLayerOut[]]>();
  for (const layer of layers) {
    if (grouped.has(layer.id) || !isHolidayLayer(layer)) continue;
    const title = layer.title.trim().toLowerCase();
    if (title.length === 0) continue;
    const bucket = byHolidayTitle.get(title);
    if (bucket) bucket.push(layer);
    else byHolidayTitle.set(title, [layer]);
  }
  for (const [title, candidates] of byHolidayTitle) {
    if (candidates.length < 2 || connectionSpan(candidates) < 2) continue;
    groups.push(
      duplicateGroup(`holiday-title:${title}`, 'holiday_calendar', candidates, accountEmails),
    );
  }

  return groups.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
}
