/**
 * The four-way session state the app shell gates on.
 *
 * @remarks
 * Pure, React-free, and deliberately not exported as a boolean pair: the whole point is that
 * "we have no session" and "we could not ask" are different answers that must drive different UI.
 * Conflating them is what makes an offline PWA shove a sign-in dialog at someone whose session is
 * perfectly valid.
 *
 * @see {@link resolveSessionStatus} for how each state is derived.
 */
export type SessionStatus = 'pending' | 'authenticated' | 'signed-out' | 'unreachable';

/** The observable facts about the session query, reduced to booleans. */
export interface SessionStatusInput {
  /** Whether the session query resolved a session object. */
  readonly hasSession: boolean;
  /** Whether the session query is still in flight and has never settled. */
  readonly isPending: boolean;
  /**
   * Whether the session query settled with an error.
   *
   * @remarks
   * A boolean rather than the error itself, for two reasons. It keeps this module pure and
   * trivially testable, and it structurally satisfies the repository's error-source policy
   * (`packages/test-utils/tests/web-error-source-policy.test.ts`), which forbids reading `.message`
   * off an exception outside the central classifiers — a rule this module cannot violate because it
   * never sees an error object at all.
   */
  readonly hasError: boolean;
  /**
   * Whether the pending state has outlived its patience budget.
   *
   * @remarks
   * Covers the captive-portal case: a hotel or airport network that accepts the TCP connection and
   * then never answers leaves the request hanging indefinitely, so `isPending` never flips and the
   * shell would otherwise sit on its loading treatment forever. Treating a long-enough pend as
   * `unreachable` gives the person an offline surface with a retry instead of a dead spinner.
   */
  readonly pendingTimedOut: boolean;
}

/**
 * Classify the session query into the state the shell should render.
 *
 * @remarks
 * The discriminator is exact rather than heuristic, because Better Auth distinguishes the two
 * failure modes at the transport level:
 *
 * - Signed out is a **successful** response. `/get-session` answers `200` with a body of `null`
 *   when there is no session, so the query settles with no session and **no error**.
 * - Unreachable is a **rejection**. Better Auth's fetch layer does not catch network failures, so
 *   offline (or a 5xx) settles with an error, and Better Auth deliberately preserves the previous
 *   `data` rather than nulling it — it only nulls `data` on a 401.
 *
 * That asymmetry is what lets this function be certain. `navigator.onLine` is not consulted at all:
 * it reports `true` on a captive portal and on a LAN with no upstream route, so it is fit for
 * choosing wording, not for deciding whether someone is signed in.
 *
 * Only `'signed-out'` may trigger the sign-in interlock.
 *
 * @param input - The reduced facts about the session query.
 * @returns Which of the four states the shell is in.
 *
 * @example
 * ```typescript
 * // Offline with a previously valid session — render the shell read-only, never the dialog.
 * resolveSessionStatus({ hasSession: false, isPending: false, hasError: true,
 *   pendingTimedOut: false }); // 'unreachable'
 * ```
 */
export function resolveSessionStatus(input: SessionStatusInput): SessionStatus {
  const { hasSession, isPending, hasError, pendingTimedOut } = input;

  // A settled session always wins, even if a later background refetch errored: Better Auth keeps
  // the last good value on a network failure, and someone signed in should not be interrupted
  // because a refresh happened to land while the connection was dropping.
  if (hasSession) return 'authenticated';

  // An error outranks a pend, and this ordering is load-bearing. Better Auth retries a failed
  // session lookup, so `isPending` flaps back to true between attempts — checking it first left the
  // shell reporting `pending` forever against a server that was answering 500 in five milliseconds,
  // and reset the patience timer on every retry so the deadline below never arrived. Once there is
  // an error and no session, we already know the answer: nobody useful is responding.
  if (hasError) return 'unreachable';

  if (isPending) return pendingTimedOut ? 'unreachable' : 'pending';

  // Settled, no session, no error: the server genuinely said there is no session.
  return 'signed-out';
}
