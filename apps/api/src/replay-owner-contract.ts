/** The account id captured before an offline-capable live attempt or replay. */
export const REPLAY_OWNER_HEADER = 'X-Docket-Replay-Owner';

const REPLAY_OWNER_PATH = /^\/v1\/orgs\/[^/]+\/object-commands$/u;

/**
 * Return whether a request may carry the replay-owner account binding.
 *
 * @param method - The actual method or the method named by a CORS preflight.
 * @param path - The request path without its query or fragment.
 * @returns `true` only for the atomically idempotent object-command POST route.
 */
export function isReplayOwnerRequest(method: string | undefined, path: string): boolean {
  return method === 'POST' && REPLAY_OWNER_PATH.test(path);
}
