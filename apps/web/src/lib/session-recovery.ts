/**
 * What a `401` from a data endpoint actually means, decided by asking the session authority.
 *
 * @remarks
 * This module exists because of a specific, self-fulfilling bug. The global TanStack `onError`
 * treated a {@link SessionExpiredError} from *any* of the app's data surfaces as proof that the
 * person had been signed out, and reacted by calling Better Auth's `signOut()` and hard-navigating
 * to `/sign-in`. A single `401` is not proof of anything of the sort:
 *
 * - The API can answer `401` on a cold start, before its session store is reachable.
 * - `session.updateAge` is 24h (`packages/auth/src/auth-builder.ts`), so every active user hits a
 *   session-record refresh daily; a read already in flight across that rotation can lose the race.
 * - A transient failure in the Next `rewrites` proxy surfaces as an ordinary `401`.
 *
 * Because the old reaction called `signOut()` *first*, a spurious `401` destroyed a session that
 * was still perfectly valid — so the forced sign-in the person then saw was real, and repeated
 * every time the race recurred. The bug manufactured its own evidence.
 *
 * The rule this module enforces: **a data endpoint's `401` is evidence to check, never a verdict to
 * execute.** Only `/get-session` — the one endpoint whose entire job is answering "is this person
 * signed in?" — may end a session, and it must be asked before anything is torn down. That is the
 * same principle {@link resolveSessionStatus} already encodes for the app shell; this module extends
 * it to the one path that used to bypass it.
 *
 * @see {@link file://./session-status.ts} for the shell's four-way classifier, whose
 * signed-out-vs-unreachable distinction this mirrors.
 */

/** The observable result of re-reading the session endpoint after a `401`. */
export interface SessionProbe {
  /** Whether `/get-session` answered with a session. */
  readonly hasSession: boolean;
  /**
   * Whether the probe could not get an answer at all.
   *
   * @remarks
   * A network rejection or a 5xx — *not* a `401`. A `401` from `/get-session` is a real answer
   * ("you have no session") and must set this `false`, or a genuinely expired session would never
   * be recognized.
   */
  readonly failed: boolean;
}

/**
 * What to do about a `401`, once the session authority has answered.
 *
 * @remarks
 * Three outcomes rather than a boolean, for the same reason {@link SessionStatus} has four states:
 * "your session ended" and "I could not find out" require opposite handling, and collapsing them is
 * what produced the original bug.
 */
export type UnauthorizedVerdict =
  /** The session is fine; the `401` was scoped or transient. Surface the failure inline, nothing more. */
  | 'session-live'
  /** The session authority confirms there is no session. Safe to purge local state and ask for sign-in. */
  | 'session-ended'
  /** No answer available. Change nothing — never tear down a session on a guess. */
  | 'unconfirmed';

/**
 * Turn a session probe into a verdict.
 *
 * @remarks
 * Pure and React-free so the decision is directly testable, matching
 * {@link resolveSessionStatus}'s shape. The ordering is load-bearing: an unusable probe outranks
 * its (meaningless) `hasSession` value, so a failed probe can never be read as a sign-out.
 *
 * @param probe - The reduced facts about the confirming read.
 * @returns The verdict the caller should act on.
 *
 * @example
 * ```typescript
 * // Server unreachable while a background refetch 401'd — do not touch the session.
 * resolveUnauthorizedVerdict({ hasSession: false, failed: true }); // 'unconfirmed'
 * ```
 */
export function resolveUnauthorizedVerdict(probe: SessionProbe): UnauthorizedVerdict {
  if (probe.failed) return 'unconfirmed';
  return probe.hasSession ? 'session-live' : 'session-ended';
}

/**
 * Wrap a session probe so concurrent `401`s produce exactly one confirming read.
 *
 * @remarks
 * A single expired session typically fails several mounted queries at once — the shell's org list,
 * a page's list read, a poll — and each one reports through the global `onError`. Without
 * single-flighting, each would fire its own `/get-session` and its own teardown. This collapses a
 * burst into one question and one answer, while still allowing a *later* `401` to ask again (the
 * slot is released once settled, so this is de-duplication, not a one-shot latch).
 *
 * Returned as a factory rather than a module-level singleton so each test gets its own state
 * instead of leaking a resolved promise between cases.
 *
 * @param probe - Reads the session endpoint. Its rejection is treated as `'unconfirmed'`, so a
 * caller never has to defend against this throwing.
 * @returns A function that resolves the shared verdict for the current burst.
 *
 * @example
 * ```typescript
 * const confirm = createUnauthorizedConfirmer(probeSession);
 * const [a, b] = await Promise.all([confirm(), confirm()]); // one probe, same verdict
 * ```
 */
export function createUnauthorizedConfirmer(
  probe: () => Promise<SessionProbe>,
): () => Promise<UnauthorizedVerdict> {
  let inFlight: Promise<UnauthorizedVerdict> | null = null;

  return function confirmUnauthorized(): Promise<UnauthorizedVerdict> {
    inFlight ??= (async (): Promise<UnauthorizedVerdict> => {
      try {
        return resolveUnauthorizedVerdict(await probe());
      } catch {
        // Never let a broken probe escalate into a teardown. Absence of an answer is not a sign-out.
        return 'unconfirmed';
      } finally {
        // Released so a genuinely later 401 can ask again, rather than reusing a stale verdict.
        inFlight = null;
      }
    })();
    return inFlight;
  };
}
