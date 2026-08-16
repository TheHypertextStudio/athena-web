/**
 * `settings` — how work-location delivery states read.
 *
 * @remarks
 * The API distinguishes five causes for an account that cannot publish a work location, and the
 * settings surface collapsed four of them into "Account action is required" — which names no
 * account, no action, and no requirement. A missing scope and an unsupported account call for
 * opposite responses: one is two clicks away, the other cannot be fixed at all.
 *
 * Kept out of the page so the wording has one home and the mapping can be asserted without
 * pinning the words, and so a sixth cause is a type error rather than another silent fold into a
 * catch-all.
 *
 * Nothing here quotes Google. Why a provider refused is diagnostic text the provider wrote; what
 * the reader needs is what to do about it, which is application-owned and the same every time.
 */
import type { WorkLocationSyncReason } from '@docket/types';

/** Why one linked account cannot publish your work location, and what ends it. */
export const SYNC_REASON: Record<WorkLocationSyncReason, string> = {
  unsupported_account: 'This account type cannot publish a work location.',
  missing_scope: 'Docket needs permission to edit this calendar.',
  unsupported_recurrence: 'Change the Google recurrence to daily or weekly to continue.',
  provider_unavailable: 'Google is not responding. Docket keeps trying.',
  reauth_required: 'Sign in to this account again to resume publishing.',
};

/**
 * Plain-language delivery state for one linked account.
 *
 * @param state - The account's sync state.
 * @param reason - The specific cause, when the API identified one.
 * @returns one line of application-owned status copy.
 */
export function syncStateCopy(state: string, reason: WorkLocationSyncReason | null): string {
  if (reason !== null) return SYNC_REASON[reason];
  if (state === 'healthy') return 'Up to date';
  if (state === 'pending') return 'Preparing location sync';
  if (state === 'retrying') return 'Retrying safely';
  if (state === 'unsupported') return 'Work-location sync is not supported for this account.';
  return 'This account needs attention before it can publish your location.';
}

/**
 * Whether the reader can do something about it from the Google Calendar surface.
 *
 * @remarks
 * `provider_unavailable` resolves itself and `unsupported_account` never resolves; offering
 * "Review" for either sends someone to a page that cannot help them.
 *
 * @param state - The account's sync state.
 * @param reason - The specific cause, when the API identified one.
 * @returns whether to offer the recovery link.
 */
export function isActionable(state: string, reason: WorkLocationSyncReason | null): boolean {
  if (reason === 'provider_unavailable' || reason === 'unsupported_account') return false;
  return reason !== null || state === 'action_required';
}
