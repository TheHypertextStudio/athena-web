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
  if (existing.status === 'error') return 'Connection needs attention';
  if (existing.status === 'disconnected') return 'Disconnected';
  if (existing.status === 'pending') return 'Finishing setup';
  if (existing.lastSyncedAt)
    return `Connected · Last synced ${relativeTime(existing.lastSyncedAt)}`;
  return 'Connected';
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
