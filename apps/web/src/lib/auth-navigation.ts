import { sameOriginPath } from './same-origin-path';

/** Build a sign-in URL that returns to one already-validated application path. */
export function signInReturnPath(returnPath: string): string {
  return `/sign-in?${new URLSearchParams({ callbackURL: returnPath }).toString()}`;
}

/**
 * Resolve a return target against the browser's origin, rejecting anything that would leave it.
 *
 * This module deliberately has no dependency on the application shell. Authentication and
 * onboarding import it on their critical path; pulling the shell utility barrel here would also
 * pull the generated offline-route registry and every authenticated page into those bundles.
 */
export function safeSameOriginPath(value: string | null | undefined): string | null {
  if (typeof window === 'undefined') return null;
  return sameOriginPath(value, window.location.origin);
}
