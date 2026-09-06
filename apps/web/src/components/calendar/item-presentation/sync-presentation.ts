/**
 * `calendar/item-presentation/sync-presentation` — application-owned copy for the provider seam.
 *
 * @remarks
 * A Docket calendar event that came from Google is a shared record: some of it round-trips and some
 * of it is Docket's own. `syncState` is the only honest account of where a local edit currently
 * sits, and until now nothing rendered it — a conflicted event simply went read-only with no
 * explanation and no way out, against the acceptance criterion in
 * `docs/core/specs/layered-calendar.md` that provider conflicts be visible. Every string here is
 * written by this application; provider error text never reaches a person.
 */
import type { CalendarItemOut, CalendarItemSyncState } from '@docket/planning/calendar-contract';
import type { CalendarLayerOut } from '@docket/planning/calendar-contract';

/** How a sync notice should read. */
export type SyncNoticeTone = 'progress' | 'attention';

/** One rendered account of an item's provider write state. */
export interface SyncNotice {
  /** What happened, in this application's own words. */
  readonly text: string;
  /** The recovery action's label, when the outbox can be retried. */
  readonly actionLabel: string | null;
  /** Whether the notice is a quiet progress note or something the person should act on. */
  readonly tone: SyncNoticeTone;
}

/**
 * Name the provider a person recognizes, never the enum.
 *
 * @param layer - The item's owning layer, when it has loaded.
 * @returns the provider's product name, or a neutral phrase for an unknown source.
 */
export function providerLabel(layer: CalendarLayerOut | undefined): string {
  return layer?.provider === 'google' ? 'Google Calendar' : 'source calendar';
}

/**
 * Describe an item's outbox state, or say nothing when there is nothing to say.
 *
 * @param item - The calendar item whose write state is being described.
 * @param layer - The item's owning layer, used to name the provider.
 * @returns the notice to render, or `null` when the item is settled.
 */
export function syncNotice(
  item: CalendarItemOut,
  layer: CalendarLayerOut | undefined,
): SyncNotice | null {
  const provider = providerLabel(layer);
  const notices: Record<CalendarItemSyncState, SyncNotice | null> = {
    clean: null,
    local_dirty: {
      text: `Saved here. Not sent to ${provider} yet.`,
      actionLabel: null,
      tone: 'progress',
    },
    push_pending: {
      text: `Sending your changes to ${provider}…`,
      actionLabel: null,
      tone: 'progress',
    },
    provider_error: {
      text: `${provider} turned down the last change. Your version is still here.`,
      actionLabel: 'Try again',
      tone: 'attention',
    },
    conflict: {
      text: `This event changed in ${provider} while you were editing it. Your version is still here, and nothing has been overwritten.`,
      actionLabel: 'Keep my changes',
      tone: 'attention',
    },
  };
  return notices[item.syncState];
}

/**
 * The one line under an event's header naming which parts of it Docket shares with the provider.
 *
 * @param item - The calendar item being described.
 * @param layer - The item's owning layer, used to name the provider.
 * @returns the seam sentence, or `null` for a Docket-native item that has no seam.
 */
export function providerSeamLabel(
  item: CalendarItemOut,
  layer: CalendarLayerOut | undefined,
): string | null {
  // `provider` is 'docket' on a native event, so it cannot answer this. Only an item that came
  // from a connected account has a seam to describe.
  if (item.kind !== 'provider_event') return null;
  const provider = providerLabel(layer);
  return item.permissions.canEditCore
    ? `Synced from ${provider} · your edits push back`
    : `Synced from ${provider} · read-only here`;
}
