import { passkeyClient } from '@better-auth/passkey/client';
import { SESSION_OWNER_HEADER } from '@docket/identity-access/session-contract';
import { createAuthClient } from 'better-auth/react';
import { twoFactorClient } from 'better-auth/client/plugins';

import type { SessionProbe } from './session-recovery';

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
 * **Passwordless: passkeys are the primary credential.** The {@link passkeyClient} plugin
 * mirrors the server's `@better-auth/passkey` plugin, exposing the WebAuthn ceremonies the
 * auth screens drive:
 *
 * - `authClient.signIn.passkey({ autoFill })` — authenticate with an existing passkey
 *   (Face ID / Touch ID / security key), optionally as a conditional-UI autofill prompt.
 * - `authClient.passkey.addPasskey({ name, context })` — register a passkey. During
 *   passwordless sign-UP there is no prior session; the caller first proves inbox ownership via
 *   the `signup-challenge` endpoints (`/sign-up/request-code` → `/sign-up/verify-code`), and the
 *   single-use `intent` that returns rides in as the `context` token, which the server's
 *   `registration.resolveUser` consumes before creating the user (so a passkey can only ever bind
 *   to a verified email).
 *
 * Secondary OAuth (Google / GitHub / Linear) is reached via `authClient.signIn.social(...)`
 * and is rendered only when the corresponding provider is configured (env-gated).
 *
 * The {@link twoFactorClient} plugin mirrors the server's `twoFactor` plugin, used here only for
 * the locked-out **account recovery** flow: `authClient.twoFactor.verifyBackupCode()` consumes a
 * code during `/recover` (paired with the custom `/two-factor/recovery-challenge` endpoint that
 * arms the challenge when the user has no session). Generating codes for a signed-in user goes
 * through Docket's REST API (`POST /v1/me/recovery-codes`), not this client.
 */
export const authClient = createAuthClient({
  baseURL: AUTH_BASE_URL,
  plugins: [passkeyClient(), twoFactorClient()],
});

/**
 * The sign-in namespace.
 *
 * @remarks
 * Passwordless: the relevant call is `signIn.passkey(...)` (and `signIn.social(...)` for the
 * env-gated OAuth providers). Email/password is intentionally not enabled on the server.
 */
export const signIn = authClient.signIn;

/**
 * The passkey namespace (`passkey.addPasskey(...)`, `passkey.listUserPasskeys()`, …).
 *
 * @remarks Convenience re-export of {@link authClient.passkey}.
 */
export const passkey = authClient.passkey;

/**
 * The two-factor namespace — used only for `twoFactor.verifyBackupCode(...)` in the locked-out
 * `/recover` flow (generation goes through Docket's REST API, not this client).
 *
 * @remarks Convenience re-export of {@link authClient.twoFactor}.
 */
export const twoFactor = authClient.twoFactor;

/** Outcome of an account-bound network sign-out request. */
export type SignOutOutcome = 'signed-out' | 'owner-changed' | 'failed';

/**
 * Sign out only the account under which the browser action began.
 *
 * @param expectedUserId - The captured account id required by the server contract.
 * @returns Whether sign-out completed, the cookie changed accounts, or the request failed.
 */
export async function signOut(expectedUserId: string): Promise<SignOutOutcome> {
  try {
    const { error } = await authClient.signOut({
      fetchOptions: { headers: { [SESSION_OWNER_HEADER]: expectedUserId } },
    });
    if (!error) return 'signed-out';
    return error.status === 409 ? 'owner-changed' : 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * Request an account email change: `{ newEmail, callbackURL }`.
 *
 * @remarks
 * A base Better Auth client method (no plugin). Sends a confirmation link to the CURRENT
 * (old) address — never the new one — which the user must click to complete the swap; see
 * `packages/auth/src/auth-builder.ts`'s `user.changeEmail.sendChangeEmailConfirmation`.
 * Convenience re-export of {@link authClient.changeEmail}.
 */
export const changeEmail = authClient.changeEmail;

/**
 * React hook returning the reactive session state (`{ data, isPending, error }`).
 *
 * @remarks Convenience re-export of {@link authClient.useSession}.
 */
export const useSession = authClient.useSession;

/**
 * Ask the session endpoint directly whether a session still exists.
 *
 * @remarks
 * The authoritative one-shot read behind {@link createUnauthorizedConfirmer}: `/get-session` is the
 * only endpoint whose job is answering "is this person signed in?", so it is the only one allowed to
 * settle that question. A `401` from some unrelated data endpoint is not an answer — see
 * {@link file://./session-recovery.ts} for why conflating the two used to sign people out of valid
 * sessions.
 *
 * `disableCookieCache` forces a real session-store lookup rather than letting Better Auth answer
 * from a signed cookie. Docket configures no cookie cache today, but this read exists precisely to
 * be trustworthy, and it should not quietly become advisory if that ever changes.
 *
 * The three-way mapping is deliberate:
 *
 * - a `401` **is** a real answer (no session) and reports `failed: false`, or a genuinely expired
 *   session could never be recognized;
 * - any other error, and any rejection, reports `failed: true` — "could not ask" — so the caller
 *   changes nothing.
 *
 * @returns The reduced facts for {@link resolveUnauthorizedVerdict}.
 */
export async function probeSession(): Promise<SessionProbe> {
  try {
    const { data, error } = await authClient.getSession({
      query: { disableCookieCache: true },
    });
    if (error) return { hasSession: false, failed: error.status !== 401 };
    return { hasSession: Boolean(data), failed: false };
  } catch {
    // Offline, DNS failure, captive portal: no answer, so no verdict.
    return { hasSession: false, failed: true };
  }
}
