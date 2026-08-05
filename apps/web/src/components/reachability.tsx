'use client';

import { createContext, useContext, useEffect, type JSX, type ReactNode } from 'react';

import { resetAvailabilityProbes } from '@/lib/offline-availability';

/**
 * Whether Docket's server can currently be reached, published to the whole authenticated tree.
 *
 * @remarks
 * The shell already knows this: `session-status.ts` distinguishes a server that answered "no
 * session" from one that could not be reached at all, and `AppShellFrame` resolves it on every
 * render. Everything else in the app had no way to ask, so this publishes the answer.
 *
 * **Not `navigator.onLine`.** That reports whether a network interface is up, which is `true` behind
 * a captive portal and `true` on a LAN with no route to anywhere. It is a fine signal for wording a
 * banner and a bad one for deciding whether a navigation can succeed — and deciding that is the
 * whole reason this exists. `navigator.onLine` also cannot tell you the server is down while your
 * wifi is perfect, which is precisely the case where an uncaught navigation costs the person a
 * twenty-second stall on a blank tab.
 */

/**
 * `true` when the server has answered, `false` when it could not be reached.
 *
 * @remarks
 * Defaults to `true`. Outside the authenticated shell — the sign-in page, marketing — nothing has
 * asked the server anything, and assuming reachable means links behave exactly as they always have.
 */
const ReachabilityContext = createContext(true);

/** Props for {@link ReachabilityProvider}. */
export interface ReachabilityProviderProps {
  /** Whether the server answered the shell's session request. */
  readonly reachable: boolean;
  /** The subtree that may read it. */
  readonly children: ReactNode;
}

/** Publish the shell's view of whether the server is reachable. */
export function ReachabilityProvider({
  reachable,
  children,
}: ReachabilityProviderProps): JSX.Element {
  // A route whose chunk could not be fetched while offline can be fetched now, and a link left
  // inert after its reason disappeared is the same lie as one that looks live but is not.
  useEffect(() => {
    if (reachable) {
      resetAvailabilityProbes();
    }
  }, [reachable]);

  return <ReachabilityContext value={reachable}>{children}</ReachabilityContext>;
}

/**
 * Whether the server can be reached right now.
 *
 * @returns `false` only when the shell's session request failed to reach the server.
 */
export function useServerReachable(): boolean {
  return useContext(ReachabilityContext);
}
