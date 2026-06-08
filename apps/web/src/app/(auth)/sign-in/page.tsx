'use client';

import { Button } from '@docket/ui/primitives';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { readError } from '@/lib/problem';

import { AuthError, Spinner } from '../_components/auth-feedback';
import { AuthShell } from '../_components/auth-shell';
import { OAuthButtons } from '../_components/oauth-buttons';
import { passkeyErrorMessage } from '../_lib/passkey-error';
import { isConditionalMediationSupported, isWebAuthnSupported } from '../_lib/webauthn';

/** The Hub cockpit a returning user lands in once signed in. */
const HOME_DESTINATION = '/today';

/** Where a signed-in user with no organization is routed instead of the cockpit. */
const ONBOARDING_DESTINATION = '/onboarding';

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
 *   passkey button is disabled (OAuth, when configured, remains available).
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
      const res = await api.v1.orgs.$get();
      if (res.ok) {
        const { items } = await res.json();
        router.push(items.length > 0 ? HOME_DESTINATION : ONBOARDING_DESTINATION);
        return;
      }
    } catch {
      // Fall through to onboarding: the session is valid, the org lookup just failed.
    }
    router.push(ONBOARDING_DESTINATION);
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
        const { error: passkeyError } = await authClient.signIn.passkey({ autoFill });
        if (passkeyError) {
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
          setError(readError(caught, 'Something went wrong signing in. Please try again.'));
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
          <p className="text-on-surface-variant text-sm" role="status">
            This browser does not support passkeys. You can still continue with one of the options
            below if available.
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

      <OAuthButtons callbackURL={HOME_DESTINATION} disabled={pending} onError={setError} />
    </AuthShell>
  );
}
