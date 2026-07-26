'use client';

import { useSession } from '@/lib/auth-client';
import { resolveSessionStatus } from '@/lib/session-status';

/**
 * The marketing site's view of who is reading it.
 *
 * @remarks
 * Deliberately coarser than {@link SessionStatus}. Marketing has no privileged surface and nothing
 * to degrade, so it does not need the shell's signed-out-vs-unreachable distinction — it only needs
 * to know whether to invite someone in or welcome them back, and to say neither while it does not
 * yet know.
 */
export type MarketingAuthState =
  /** The session read has not settled (or could not). Render the visitor-facing copy. */
  | 'unknown'
  /** A live session: this person already has a workspace to return to. */
  | 'signed-in'
  /** The server confirmed there is no session. */
  | 'signed-out';

/**
 * Read whether the current reader is already signed in.
 *
 * @remarks
 * Folded through {@link resolveSessionStatus} rather than testing `session`/`isPending` directly, so
 * marketing shares the app's one session authority instead of hand-rolling a second, less careful
 * interpretation. That matters here for the same reason it does in the shell: an errored session read
 * must not be reported as a confirmed answer.
 *
 * `'unreachable'` and `'pending'` both collapse to `'unknown'`, which callers render exactly as they
 * render a genuine visitor. That is the honest default — marketing pages are served statically and
 * are read overwhelmingly by people who are not signed in — and it is why the swap to the
 * signed-in treatment is additive rather than a correction.
 *
 * The session snapshot in `session-snapshot.ts` is deliberately **not** consulted to pre-empt the
 * pending window. Its documented contract is that it answers "who was here last", never "is this
 * person signed in?", and a cosmetic button label is nowhere near a good enough reason to erode an
 * invariant a reviewer is told to check.
 *
 * @returns The coarse auth state for CTA copy.
 *
 * @example
 * ```tsx
 * const auth = useMarketingAuthState();
 * return auth === 'signed-in' ? <OpenDocket /> : <GetStarted />;
 * ```
 */
export function useMarketingAuthState(): MarketingAuthState {
  const { data: session, isPending, error } = useSession();

  const status = resolveSessionStatus({
    hasSession: Boolean(session),
    isPending,
    hasError: error !== null,
    // Marketing has no loading treatment to escape and no offline surface to fall back to, so a
    // hanging read simply stays `unknown`. The patience budget exists for the shell, not here.
    pendingTimedOut: false,
  });

  if (status === 'authenticated') return 'signed-in';
  if (status === 'signed-out') return 'signed-out';
  return 'unknown';
}
