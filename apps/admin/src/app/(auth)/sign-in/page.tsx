'use client';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@docket/ui/primitives';
import { useRouter } from 'next/navigation';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';

import { authClient } from '@/lib/auth-client';

import { passkeyErrorMessage } from '../_lib/passkey-error';

/** Whether this browser exposes the WebAuthn API at all. */
function isWebAuthnSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';
}

/** Whether the browser supports conditional-mediation (passkey autofill). */
async function isConditionalMediationSupported(): Promise<boolean> {
  try {
    return (
      isWebAuthnSupported() &&
      typeof window.PublicKeyCredential.isConditionalMediationAvailable === 'function' &&
      (await window.PublicKeyCredential.isConditionalMediationAvailable())
    );
  } catch {
    return false;
  }
}

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
 */
export default function SignInPage(): JSX.Element {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(true);
  const conditionalArmed = useRef(false);

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
        const { error: passkeyError } = await authClient.signIn.passkey({ autoFill });
        if (passkeyError) {
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

  // After hydration, reflect real WebAuthn capability and arm the autofill prompt once.
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
    <main className="bg-surface-container text-on-surface flex min-h-screen items-center justify-center px-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-h1">Docket service admin</CardTitle>
          <CardDescription>Sign in with your operator passkey.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
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
            <p role="alert" className="text-destructive text-body">
              {error}
            </p>
          ) : null}

          {!passkeySupported && hydrated ? (
            <p className="text-on-surface-variant text-body" role="status">
              This browser does not support passkeys, so operator sign-in is unavailable here. Use a
              device with Face ID / Touch ID or a security key.
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="flex flex-col items-stretch gap-3">
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => {
              void authenticate(false);
            }}
          >
            {pending ? 'Waiting for your passkey…' : 'Sign in with a passkey'}
          </Button>
          <p className="text-on-surface-variant text-center text-xs">
            Operator access only. Non-staff accounts are rejected.
          </p>
        </CardFooter>
      </Card>
    </main>
  );
}
