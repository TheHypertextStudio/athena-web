import { createAuthClient } from 'better-auth/react';

/**
 * Resolve the same-origin base origin for the Better Auth client.
 *
 * @remarks
 * In the browser this is `window.location.origin` (so the session cookie flows). During
 * Next's server prerender there is no `window`, and Better Auth validates its `baseURL`
 * eagerly, so it must be a full URL — taken from `NEXT_PUBLIC_APP_URL` with no hidden
 * fallback: a missing value fails fast rather than silently pointing at a guessed host.
 */
function resolveAuthOrigin(): string {
  if (typeof window !== 'undefined') return window.location.origin;
  const origin = process.env['NEXT_PUBLIC_APP_URL'];
  if (!origin) {
    throw new Error(
      'NEXT_PUBLIC_APP_URL is required to construct the auth client during SSR — see .env.example.',
    );
  }
  return origin;
}

/** The absolute, same-origin base URL for the Better Auth handler (`<origin>/api/auth`). */
const AUTH_BASE_URL = `${resolveAuthOrigin()}/api/auth`;

/**
 * The Better Auth client for the Docket product app.
 *
 * @remarks
 * Configured with an absolute, same-origin {@link AUTH_BASE_URL} resolving to `/api/auth`,
 * which the Next `rewrites` proxy to the API's Better Auth handler. Same-origin means the
 * session cookie set by the server flows back to the browser and is sent on every
 * subsequent request.
 *
 * Email/password is the only enabled method (`@docket/auth` config), so the relevant
 * calls are `authClient.signIn.email(...)` and `authClient.signUp.email(...)`.
 */
export const authClient = createAuthClient({ baseURL: AUTH_BASE_URL });

/**
 * The email/password sign-in namespace (`signIn.email({ email, password })`).
 *
 * @remarks Convenience re-export of {@link authClient.signIn}.
 */
export const signIn = authClient.signIn;

/**
 * The email/password sign-up namespace (`signUp.email({ email, password, name })`).
 *
 * @remarks Convenience re-export of {@link authClient.signUp}.
 */
export const signUp = authClient.signUp;

/**
 * Sign the current user out, clearing the session cookie.
 *
 * @remarks Convenience re-export of {@link authClient.signOut}.
 */
export const signOut = authClient.signOut;

/**
 * React hook returning the reactive session state (`{ data, isPending, error }`).
 *
 * @remarks Convenience re-export of {@link authClient.useSession}.
 */
export const useSession = authClient.useSession;
