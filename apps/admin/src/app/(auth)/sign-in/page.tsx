'use client';

import { AuthLayout } from '@docket/ui/components';
import { useRedirectIfAuthenticated } from '@docket/ui/hooks';
import { Button, Stack } from '@docket/ui/primitives';
import { useRouter } from 'next/navigation';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';

import { authClient, useSession } from '@/lib/auth-client';

import { isPasskeyUnknownToServer, passkeyErrorMessage } from '../_lib/passkey-error';
import {
  isConditionalMediationSupported,
  isWebAuthnSupported,
  signalUnknownPasskey,
} from '../_lib/webauthn';

/**
 * The passwordless, passkey-first operator sign-in screen.
 *
 * @remarks
 * A Client Component. Docket has NO passwords anywhere — including the admin console. The
 * primary action runs a WebAuthn ceremony via `authClient.signIn.passkey()` (Face ID / Touch
 * ID / security key); where the browser supports it, a passkey autofill prompt is also armed on
 * mount. On success it routes to the operator dashboard (`/`); the admin API then 403s the
 * session unless it resolves to a `staff_user` row, which the dashboard surfaces inline. There
 * is no admin sign-up — staff accounts (and their passkeys, registered on the product app) are
 * provisioned out of band.
 *
 * An already-authenticated browser landing here is redirected to the dashboard immediately
 * (via {@link useRedirectIfAuthenticated}) rather than rendering the form or arming a fresh
 * ceremony — otherwise a signed-in operator revisiting `/sign-in` would silently mint a
 * redundant session every time.
 *
 * The screen shares {@link AuthLayout} with the product app's auth screens, so both consoles
 * stack and split identically. The wordmark stays in Plex rather than the product's Fraunces:
 * the admin console has no marketing half to hand off from, and the face difference is the
 * honest signal that this is the operator tool. The operator-only restriction sits in the left
 * panel as standing context rather than as a footnote under the button, where it read as an
 * afterthought to a control the reader had already decided to press.
 *
 * The WebAuthn capability checks come from `@docket/ui/lib/webauthn`, shared with the product
 * app. This page used to re-implement both of them inline, with a support check that missed
 * `navigator.credentials`.
 */
export default function SignInPage(): JSX.Element {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(true);
  const conditionalArmed = useRef(false);
  const { data: existingSession, isPending: sessionPending } = useSession();

  useRedirectIfAuthenticated(
    existingSession,
    sessionPending,
    (destination) => {
      router.push(destination);
    },
    '/',
  );

  /**
   * Run a passkey authentication ceremony and route to the dashboard on success.
   *
   * @param autoFill - When `true`, arm the browser's conditional-UI autofill prompt instead of
   * opening the modal picker; a user-cancelled autofill prompt is treated as a silent no-op.
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
        router.push('/');
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
    [router],
  );

  // After hydration, reflect real WebAuthn capability and, where supported, arm the
  // conditional-UI autofill prompt exactly once — only once we're sure there's no existing
  // session to redirect away with instead (see useRedirectIfAuthenticated above).
  useEffect(() => {
    setHydrated(true);
    const supported = isWebAuthnSupported();
    setPasskeySupported(supported);
    if (!supported) return;
    if (sessionPending || existingSession) return;
    void (async () => {
      if (conditionalArmed.current) return;
      if (await isConditionalMediationSupported()) {
        conditionalArmed.current = true;
        void authenticate(true);
      }
    })();
  }, [authenticate, existingSession, sessionPending]);

  const canSubmit = hydrated && passkeySupported && !pending;

  return (
    <AuthLayout
      brand={
        <span className="text-on-surface text-headline-small leading-none font-semibold tracking-tight">
          Docket
        </span>
      }
      intro={
        <>
          <h1 className="text-headline-small text-on-surface font-medium">Service admin</h1>
          <p className="text-on-surface-variant text-body-medium">
            Operator access only. Non-staff accounts are rejected.
          </p>
        </>
      }
    >
      <Stack gap={4}>
        {/* Carries the webauthn autocomplete token so browsers with conditional mediation can
            surface saved passkeys in their native autofill UI. */}
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

        {error ? (
          <p role="alert" className="text-destructive text-body-medium">
            {error}
          </p>
        ) : null}

        {!passkeySupported && hydrated ? (
          <p className="text-on-surface-variant text-body-medium" role="status">
            This browser does not support passkeys, so operator sign-in is unavailable here. Use a
            device with Face ID / Touch ID or a security key.
          </p>
        ) : null}

        {/* `lg` (h-10) clears the craft rubric's 40px mobile touch-target gate. */}
        <Button
          type="button"
          size="lg"
          disabled={!canSubmit}
          onClick={() => {
            void authenticate(false);
          }}
        >
          {pending ? 'Waiting for your passkey…' : 'Sign in with a passkey'}
        </Button>
      </Stack>
    </AuthLayout>
  );
}
