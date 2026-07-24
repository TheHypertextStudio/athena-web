'use client';

/**
 * `@docket/ui/hooks` — redirect an already-authenticated visitor away from an auth-only screen.
 *
 * @remarks
 * Extracted after a production incident: a sign-in/sign-up page each hand-rolled a `useEffect`
 * that watched a reactive `useSession()`-style read and pushed away the moment a session was
 * present. That read also updates the instant the page's OWN sign-in/sign-up ceremony mints a
 * fresh session — so an effect that stays live for the component's whole lifetime fires a SECOND
 * time right as the ceremony's own navigation resolves, racing it with a less-informed redirect.
 * On a sign-up flow this can even land the user on the wrong destination.
 *
 * This hook closes the race by construction: it checks exactly once, the first time the pending
 * session read resolves after mount, and never again. That is all an "already-authenticated
 * visitor" check should ever need — it exists to catch a stale tab or bookmark, not to react to a
 * session appearing mid-flow.
 */
import { useEffect, useRef } from 'react';

/**
 * Redirect away from the current screen once, if a session is already present when the pending
 * read first resolves.
 *
 * @param session - The `data` half of the app's `useSession()`-style result (any truthy value
 * counts as "signed in"; the type is intentionally generic since each app's auth client returns
 * its own session shape).
 * @param isPending - The `isPending` half of the same result.
 * @param onRedirect - Called with the resolved destination exactly once, only when a session was
 * already present on the initial resolve. Typically a router's `push`.
 * @param destination - Where to send an already-authenticated visitor. Pass a function (not a
 * string) when it needs to read something live, like the current `?callbackURL=`, so it evaluates
 * at redirect time rather than every render.
 *
 * @example
 * ```tsx
 * const { data: session, isPending } = authClient.useSession();
 * useRedirectIfAuthenticated(session, isPending, router.push, '/today');
 * ```
 */
export function useRedirectIfAuthenticated(
  session: unknown,
  isPending: boolean,
  onRedirect: (destination: string) => void,
  destination: string | (() => string),
): void {
  const checked = useRef(false);

  useEffect(() => {
    if (isPending || checked.current) return;
    checked.current = true;
    if (session) {
      onRedirect(typeof destination === 'function' ? destination() : destination);
    }
    // `onRedirect`/`destination` deliberately aren't dependencies: the ref guard above makes
    // every re-run after the first a no-op, so re-subscribing to new closure identities on every
    // render would only add noise, not correctness.
  }, [session, isPending]);
}
