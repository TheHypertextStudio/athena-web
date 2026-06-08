'use client';

import { Button, Input } from '@docket/ui/primitives';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type JSX, useEffect, useState } from 'react';

import { passkey, signIn } from '@/lib/auth-client';
import { readError } from '@/lib/problem';

import { AuthError, Spinner } from '../_components/auth-feedback';
import { AuthShell } from '../_components/auth-shell';
import { OAuthButtons } from '../_components/oauth-buttons';
import { passkeyErrorMessage } from '../_lib/passkey-error';
import { isWebAuthnSupported } from '../_lib/webauthn';

/** Where a new account lands once its passkey is registered. */
const POST_SIGNUP_DESTINATION = '/onboarding';

/**
 * Mint the server-signed passkey-intent token carrying the new account's `{ name, email }`.
 *
 * @remarks
 * Passwordless sign-up registers a passkey with no prior session, so the server's
 * `registration.resolveUser` needs a tamper-proof token to find-or-create the user. The
 * `/passkey-intent` Route Handler (same route group) mints it server-side.
 *
 * @param name - The new account's display name.
 * @param email - The new account's email.
 * @returns the opaque `context` token to pass to `passkey.addPasskey`.
 * @throws {Error} when the server declines to mint a token.
 */
async function mintPasskeyIntent(name: string, email: string): Promise<string> {
  const res = await fetch('/passkey-intent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, email }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? 'Could not start passkey registration. Please try again.');
  }
  const { context } = (await res.json()) as { context: string };
  return context;
}

/**
 * The passwordless, passkey-first sign-up screen.
 *
 * @remarks
 * A Client Component owning the form state. The user provides only a name and email; on submit
 * the screen mints a server-signed intent token (`/passkey-intent`) and triggers a WebAuthn
 * registration ceremony via `passkey.addPasskey({ name, context })` — the device's Face ID /
 * Touch ID / security key becomes the credential. On success the session cookie is set and the
 * user is routed to {@link POST_SIGNUP_DESTINATION} to set up their first organization. There
 * is NO password.
 *
 * Robustness:
 * - WebAuthn support is feature-detected; unsupported browsers see a clear message and the
 *   passkey button is disabled (OAuth, when configured, remains available).
 * - The submit button is disabled until hydration so a pre-hydration native submit cannot post
 *   the form to the server route as a navigation.
 * - Errors are surfaced in an assertive `role="alert"` region.
 * - Secondary OAuth buttons render only when their providers are configured (env-gated).
 */
export default function SignUpPage(): JSX.Element {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(true);

  // After hydration, enable submission and reflect real WebAuthn capability. Until then the
  // button stays disabled so a native submit cannot fire before the handler is attached.
  useEffect(() => {
    setHydrated(true);
    setPasskeySupported(isWebAuthnSupported());
  }, []);

  /** Mint the intent, run the WebAuthn registration ceremony, then route into onboarding. */
  async function registerPasskey(): Promise<void> {
    setError(null);
    setPending(true);
    try {
      const context = await mintPasskeyIntent(name.trim(), email.trim());
      const { error: passkeyError } = await passkey.addPasskey({
        name: email.trim(),
        context,
      });
      if (passkeyError) {
        // A 5xx (e.g. the API/database is down) surfaces an outage-aware message instead of
        // a bare "please try again", so the user isn't stuck retrying a futile ceremony.
        setError(
          passkeyErrorMessage(
            passkeyError,
            'We could not finish setting up your passkey. Please try again.',
          ),
        );
        return;
      }
      // Passkey REGISTRATION (verify-registration) creates the account + credential but does
      // NOT start a session, so we immediately authenticate with the just-created passkey
      // (verify-authentication, which mints the session cookie) before entering onboarding —
      // otherwise onboarding's first authenticated call (create-org) 401s ("Authentication
      // required") on a brand-new account.
      const { error: signInError } = await signIn.passkey();
      if (signInError) {
        setError(
          passkeyErrorMessage(
            signInError,
            'Your account was created. Please sign in with your passkey to continue.',
          ),
        );
        return;
      }
      router.push(POST_SIGNUP_DESTINATION);
    } catch (caught) {
      setError(readError(caught, 'Something went wrong creating your account. Please try again.'));
    } finally {
      setPending(false);
    }
  }

  const canSubmit =
    hydrated && passkeySupported && !pending && name.trim().length > 0 && email.trim().length > 0;

  return (
    <AuthShell
      title="Create your account"
      description="Start your calm command center for work."
      footer={
        <>
          Already have an account?{' '}
          <Link
            href="/sign-in"
            className="text-primary font-medium underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          // Guard the native submit and hand off to the passkey ceremony when ready. Until
          // hydration `canSubmit` is false, so a pre-hydration native submit is a no-op.
          event.preventDefault();
          if (!canSubmit) return;
          void registerPasskey();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="name" className="text-sm font-medium">
            Name
          </label>
          <Input
            id="name"
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            placeholder="Ada Lovelace"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <Input
            id="email"
            type="email"
            autoComplete="email webauthn"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
            placeholder="you@example.com"
          />
        </div>

        <AuthError message={error} />

        {!passkeySupported && hydrated ? (
          <p className="text-on-surface-variant text-sm" role="status">
            This browser does not support passkeys. You can still continue with one of the options
            below if available.
          </p>
        ) : null}

        <Button type="submit" disabled={!canSubmit}>
          {pending ? (
            <>
              <Spinner />
              Setting up your passkey…
            </>
          ) : (
            'Create account with a passkey'
          )}
        </Button>

        <p className="text-on-surface-variant text-center text-xs leading-relaxed">
          No passwords. Your device&rsquo;s Face ID, Touch ID, or security key becomes your secure
          key to Docket.
        </p>
      </form>

      <OAuthButtons callbackURL={POST_SIGNUP_DESTINATION} disabled={pending} onError={setError} />
    </AuthShell>
  );
}
