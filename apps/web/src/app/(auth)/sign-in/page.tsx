'use client';

import { Button } from '@docket/ui/primitives';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';

import { AuthError, Spinner } from '../_components/auth-feedback';
import { AuthShell } from '../_components/auth-shell';
import { isPasskeyUnknownToServer, passkeyErrorMessage } from '../_lib/passkey-error';
import {
  isConditionalMediationSupported,
  isWebAuthnSupported,
  signalUnknownPasskey,
} from '../_lib/webauthn';

/** The Hub cockpit a returning user lands in once signed in. */
const HOME_DESTINATION = '/today';

/** Where a signed-in user with no organization is routed instead of the cockpit. */
const ONBOARDING_DESTINATION = '/onboarding';

/** How many times to retry the first authenticated read after Better Auth reports success. */
const SESSION_SETTLE_ATTEMPTS = 4;

/** Delay between session-cookie read attempts after a passkey ceremony succeeds. */
const SESSION_SETTLE_DELAY_MS = 125;

const SESSION_COOKIE_ERROR = 'We could not finish signing you in. Please try again.';

/**
 * The safe `?callbackURL=` return-to path, or `null`.
 *
 * @remarks
 * A mid-session expiry redirect (see `providers.tsx`) sends the user to
 * `/sign-in?callbackURL=<where they were>`; honoring it lands them back on that surface after
 * re-authenticating instead of always dumping them at {@link HOME_DESTINATION}. Resolving the raw
 * value against the current origin with the native `URL` parser — rather than hand-rolled prefix
 * checks — rejects protocol-relative and cross-origin values by comparing the resolved `origin`,
 * so this can never become an open redirect.
 */
function safeCallbackPath(): string | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('callbackURL');
  if (!raw) return null;
  try {
    const resolved = new URL(raw, window.location.origin);
    if (resolved.origin !== window.location.origin) return null;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return null;
  }
}

type OrgsResponse = Awaited<ReturnType<typeof api.v1.orgs.$get>>;

/** Wait briefly for the browser/proxy cookie path to settle. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** Load orgs after sign-in, tolerating a short-lived missing-session read. */
async function loadOrgsAfterSignIn(): Promise<OrgsResponse> {
  let lastResponse: OrgsResponse | null = null;
  for (let attempt = 0; attempt < SESSION_SETTLE_ATTEMPTS; attempt += 1) {
    const response = await api.v1.orgs.$get();
    if (response.status !== 401) return response;
    lastResponse = response;
    if (attempt < SESSION_SETTLE_ATTEMPTS - 1) {
      await delay(SESSION_SETTLE_DELAY_MS);
    }
  }
  return lastResponse ?? api.v1.orgs.$get();
}

/**
 * The passwordless, passkey-first sign-in screen.
 *
 * @remarks
 * A Client Component. The primary action is "Sign in with a passkey", which runs a WebAuthn
 * authentication ceremony via `authClient.signIn.passkey()` — no email, no password. Where the
 * browser supports conditional mediation, a passkey autofill prompt is ALSO armed on mount
 * (`autoFill: true`) so saved passkeys surface in the browser's own UI; both paths converge on
 * {@link routeAfterSignIn}. On success it routes to {@link HOME_DESTINATION} (or
 * {@link ONBOARDING_DESTINATION} when the user belongs to no organization yet); the membership
 * lookup rides the freshly-set session cookie through the typed RPC client.
 *
 * Robustness:
 * - WebAuthn support is feature-detected; unsupported browsers see a clear message and the
 *   passkey button is disabled. Passkeys are the only sign-in method — there is deliberately no
 *   OAuth/social fallback.
 * - The conditional-UI prompt is armed at most once and only when supported.
 * - Errors are surfaced in an assertive `role="alert"` region; a user-cancelled ceremony is
 *   treated as a no-op rather than an error.
 */
export default function SignInPage(): JSX.Element {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(true);
  const conditionalArmed = useRef(false);

  /** Route into the cockpit, or onboarding when the user has no organization yet. */
  const routeAfterSignIn = useCallback(async (): Promise<void> => {
    try {
      const res = await loadOrgsAfterSignIn();
      if (res.ok) {
        const { items } = await res.json();
        if (items.length === 0) {
          router.push(ONBOARDING_DESTINATION);
          return;
        }
        // Honor a safe return-to from a session-expiry redirect; otherwise land in the cockpit.
        router.push(safeCallbackPath() ?? HOME_DESTINATION);
        return;
      }
      if (res.status === 401) {
        setError(SESSION_COOKIE_ERROR);
        return;
      }
      setError('We could not load your workspaces. Please try signing in again.');
      return;
    } catch {
      setError('We could not load your workspaces. Please try signing in again.');
      return;
    }
  }, [router]);

  /**
   * Run a passkey authentication ceremony and route on success.
   *
   * @param autoFill - When `true`, arm the browser's conditional-UI autofill prompt instead of
   * opening the modal picker; the promise resolves once the user selects a passkey.
   */
  const authenticate = useCallback(
    async (autoFill: boolean): Promise<void> => {
      if (!autoFill) setPending(true);
      setError(null);
      try {
        const result = await authClient.signIn.passkey({ autoFill, returnWebAuthnResponse: true });
        const passkeyError = result.error;
        if (passkeyError) {
          // When the server no longer holds the presented credential (deleted passkey), tell the
          // platform authenticator to prune it via the WebAuthn Signal API — even on the silent
          // autofill path, so the stale passkey stops surfacing in the browser's own UI.
          if (isPasskeyUnknownToServer(passkeyError) && 'webauthn' in result) {
            void signalUnknownPasskey(result.webauthn.response.id);
          }
          // A user-cancelled or timed-out conditional prompt should not nag the user. For the
          // explicit button path a 5xx (e.g. the API/database is down) surfaces an outage-aware
          // message instead of a bare "please try again".
          if (!autoFill) {
            setError(
              passkeyErrorMessage(
                passkeyError,
                'Could not sign in with that passkey. Please try again.',
              ),
            );
          }
          return;
        }
        await routeAfterSignIn();
      } catch (caught) {
        if (!autoFill) {
          setError(
            passkeyErrorMessage(caught, 'Something went wrong signing in. Please try again.'),
          );
        }
      } finally {
        if (!autoFill) setPending(false);
      }
    },
    [routeAfterSignIn],
  );

  // After hydration, reflect real WebAuthn capability and, where supported, arm the
  // conditional-UI autofill prompt exactly once.
  useEffect(() => {
    setHydrated(true);
    const supported = isWebAuthnSupported();
    setPasskeySupported(supported);
    if (!supported) return;
    void (async () => {
      if (conditionalArmed.current) return;
      if (await isConditionalMediationSupported()) {
        conditionalArmed.current = true;
        void authenticate(true);
      }
    })();
  }, [authenticate]);

  const canSubmit = hydrated && passkeySupported && !pending;

  return (
    <AuthShell
      title="Welcome back"
      description="Sign in to your Docket workspace."
      footer={
        <>
          New to Docket?{' '}
          <Link
            href="/sign-up"
            className="text-primary font-medium underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* A hidden field carries the webauthn autocomplete token so browsers that support
            conditional mediation can surface saved passkeys in their native autofill UI. */}
        <input
          type="text"
          name="passkey"
          autoComplete="username webauthn"
          aria-hidden="true"
          tabIndex={-1}
          className="sr-only"
          readOnly
          value=""
        />

        <AuthError message={error} />

        {!passkeySupported && hydrated ? (
          <p className="text-on-surface-variant text-body-medium" role="status">
            This browser does not support passkeys. Try a different browser or device to sign in.
          </p>
        ) : null}

        <Button
          type="button"
          disabled={!canSubmit}
          onClick={() => {
            void authenticate(false);
          }}
        >
          {pending ? (
            <>
              <Spinner />
              Waiting for your passkey…
            </>
          ) : (
            'Sign in with a passkey'
          )}
        </Button>
      </div>

      <p className="text-on-surface-variant text-body-medium text-center">
        Can&apos;t sign in?{' '}
        <Link
          href="/recover"
          className="text-primary font-medium underline-offset-4 hover:underline"
        >
          Recover your account
        </Link>
      </p>
    </AuthShell>
  );
}
