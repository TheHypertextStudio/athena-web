/**
 * `settings` — how a connector's health reads, in one place.
 *
 * @remarks
 * Every connector surface has to answer the same question — *is this working?* — and every one of
 * them has to answer it the same way, because a surface that hardcodes "Connected" while the
 * server has the connection in `error` is not a cosmetic inconsistency: it is the product telling
 * somebody their sync is fine while it is broken.
 *
 * The copy lives here rather than in each card so there is exactly one set of words for each
 * state, and so a new surface cannot accidentally invent an optimistic one.
 *
 * Nothing here reads a server-supplied error string. Why the connection is unhealthy is diagnostic
 * text the provider wrote; what the reader needs is what to *do*, which is application-owned copy
 * and always the same for a given state.
 */
import type { IntegrationOut } from '@docket/types';

import { relativeTime } from './format-time';

/**
 * The status-aware subtitle for a provider that has an integration.
 *
 * @remarks
 * Never implies a connection that was not validated: only a `connected` integration reads
 * "Connected", and the last-synced stamp is appended only when a sync has actually succeeded.
 *
 * @param existing - The integration to describe.
 * @returns one line of application-owned status copy.
 */
export function integrationStatusLabel(existing: IntegrationOut): string {
  if (existing.status === 'error') {
    // "Connection needs attention" withheld the two facts that decide whether it is urgent: how
    // long it has been broken, and how stale the data you are looking at now is.
    const since =
      existing.lastErrorAt === null ? '' : ` since ${relativeTime(existing.lastErrorAt)}`;
    const stale =
      existing.lastSyncedAt === null
        ? ' · Never synced'
        : ` · Last synced ${relativeTime(existing.lastSyncedAt)}`;
    return `Connection needs attention${since}${stale}`;
  }
  if (existing.status === 'disconnected') return 'Disconnected';
  if (existing.status === 'pending') return 'Finishing setup';

  // A connector with no cadence never syncs again on its own. Reading "Connected" and nothing
  // else, you would reasonably assume it keeps itself current.
  const cadence =
    existing.syncCadenceMinutes === null ? null : cadencePhrase(existing.syncCadenceMinutes);
  const rhythm = cadence === null ? ' · Syncs when you ask it to' : ` · Syncs ${cadence}`;
  if (existing.lastSyncedAt)
    return `Connected · Last synced ${relativeTime(existing.lastSyncedAt)}${rhythm}`;
  return `Connected${rhythm}`;
}

/**
 * A sync cadence in the words someone would use for it.
 *
 * @param minutes - The background re-sync interval.
 * @returns an adverbial phrase that completes "Syncs …".
 */
function cadencePhrase(minutes: number): string {
  if (minutes < 60) return `every ${minutes} minutes`;
  if (minutes === 60) return 'hourly';
  if (minutes === 1440) return 'daily';
  if (minutes % 1440 === 0) return `every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return `every ${minutes / 60} hours`;
  return `every ${minutes} minutes`;
}

/** Whether a status should read as healthy — the one place that decision is made. */
export function isHealthyStatus(status: IntegrationOut['status']): boolean {
  return status === 'connected';
}

/**
 * The persistent alert shown while a connection itself is broken.
 *
 * @remarks
 * Only the message is shared. The follow-up line names the recovery affordance, which differs by
 * surface — the provider card has a Reconnect button, the Notion hub has to send you to
 * Connections — so each caller supplies its own rather than the shared copy naming a control the
 * reader cannot see.
 */
export const CONNECTION_ERROR_MESSAGE =
  'This connection needs attention. Reconnect it to restore syncing.';
