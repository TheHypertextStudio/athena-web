/**
 * A last-known-good record of who was signed in, so the shell can render offline.
 *
 * @remarks
 * When the session endpoint is unreachable, the shell has no user id — and without one it cannot
 * resolve the persisted last-used org, the density preference, the open-documents set, or the
 * per-user query-cache partition, all of which are keyed by user id. This snapshot supplies that id
 * from the last successful session so an offline launch renders the right person's workspace
 * instead of a blank one.
 *
 * **This is not an authentication mechanism, and it must never become one.** Six properties keep it
 * honest, and a reviewer should check all six:
 *
 * 1. It holds **no session token**. Better Auth's session cookie is `HttpOnly` and stays that way;
 *    nothing here can be replayed to authenticate a request.
 * 2. It is consulted **only** when {@link SessionStatus} is `'unreachable'` — never to answer
 *    "is this person signed in?", only "who was here last, so I can render their shell?".
 * 3. The server always wins the moment it answers. A `'signed-out'` result opens the sign-in
 *    interlock and clears the snapshot, regardless of what is stored here.
 * 4. Every write fails fast while offline, so no privileged action can be taken on the strength of
 *    a cached identity.
 * 5. It is cleared on explicit sign-out and on session expiry, before the redirect — so
 *    "signed out, then offline" can never render a shell.
 * 6. A persistent, non-dismissible offline banner is visible the entire time it is in use. Nobody
 *    is told they are live when they are not.
 *
 * It stores display identity only, and expires after {@link SNAPSHOT_MAX_AGE_MS} so an abandoned
 * device stops volunteering a name.
 *
 * @see {@link file://./session-status.ts} for the state machine that decides when this is read.
 */
import { clearStoredValue, readStoredJson, writeStoredJson } from '@docket/ui/lib/browser-storage';

/** The storage key. Not user-keyed: only one person can be signed in per origin at a time. */
const STORAGE_KEY = 'docket:session-snapshot';

/**
 * How long a snapshot stays usable.
 *
 * @remarks
 * Seven days is long enough to cover a weekend and a flight — the cases where opening Docket
 * offline is actually useful — and short enough that a shared or abandoned device stops rendering
 * a stale identity within a week.
 */
export const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Display identity for the last successfully authenticated session. */
export interface SessionSnapshot {
  /** The user id every per-user storage key and query-cache partition is derived from. */
  readonly userId: string;
  /** Display name, for the account menu while offline. */
  readonly name: string;
  /** Email, for the account menu while offline. */
  readonly email: string;
  /** Avatar URL, or null when unset. */
  readonly image: string | null;
  /** Epoch milliseconds the snapshot was written, for expiry. */
  readonly savedAt: number;
}

/** Whether a parsed value has the shape of a snapshot. */
function isSnapshot(value: unknown): value is SessionSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['userId'] === 'string' &&
    candidate['userId'].length > 0 &&
    typeof candidate['name'] === 'string' &&
    typeof candidate['email'] === 'string' &&
    typeof candidate['savedAt'] === 'number' &&
    (candidate['image'] === null || typeof candidate['image'] === 'string')
  );
}

/**
 * Read the stored snapshot, if one is present and unexpired.
 *
 * @param now - Current epoch milliseconds. Passed in rather than read from the clock so the expiry
 * boundary is directly testable.
 * @returns The snapshot, or `null` when absent, malformed, expired, or storage is unavailable.
 */
export function readSessionSnapshot(now: number): SessionSnapshot | null {
  // Private mode, disabled storage, or a hand-edited value all arrive here as `null` from
  // {@link readStoredJson}. Absence is always a safe answer: the caller falls back to the plain
  // offline screen.
  const parsed = readStoredJson(STORAGE_KEY);
  if (!isSnapshot(parsed)) return null;
  if (now - parsed.savedAt > SNAPSHOT_MAX_AGE_MS) return null;
  return parsed;
}

/**
 * Record the currently authenticated identity.
 *
 * @param snapshot - Display identity for the live session.
 * @param now - Current epoch milliseconds, stamped as `savedAt`.
 */
export function writeSessionSnapshot(
  snapshot: Omit<SessionSnapshot, 'savedAt'>,
  now: number,
): void {
  // Best-effort, exactly like the other shell preferences: failing to persist costs an offline
  // convenience, never correctness.
  writeStoredJson(STORAGE_KEY, { ...snapshot, savedAt: now });
}

/** Forget the stored identity. Called on sign-out and on session expiry, before any redirect. */
export function clearSessionSnapshot(): void {
  clearStoredValue(STORAGE_KEY);
}
