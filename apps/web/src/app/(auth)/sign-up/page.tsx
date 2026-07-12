'use client';

import { Button, Input } from '@docket/ui/primitives';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type JSX, useEffect, useState } from 'react';

import { authClient, passkey, signIn } from '@/lib/auth-client';
import { userErrorMessage } from '@/lib/problem';

import { AuthError, Spinner } from '../_components/auth-feedback';
import { AuthShell } from '../_components/auth-shell';
import { OAuthButtons } from '../_components/oauth-buttons';
import { passkeyErrorMessage } from '../_lib/passkey-error';
import { isWebAuthnSupported } from '../_lib/webauthn';

/** Where a new account lands once its passkey is registered. */
const POST_SIGNUP_DESTINATION = '/onboarding';

const SIGNUP_SESSION_ERROR = 'Your account was created. Please try again to finish signing in.';

/** Shown when a challenge endpoint returns 429 (rate-limited). */
const RATE_LIMIT_MESSAGE = 'Too many attempts. Please wait a minute and try again.';

/** Shown when the API did not accept a request to send the verification code. */
const SIGNUP_CODE_UNAVAILABLE_MESSAGE =
  'We could not send your verification code. Please try again in a few moments.';

/** The two phases of passwordless sign-up: prove the email, then register the passkey. */
type Step = 'collect' | 'verify';

/** The only outcomes that may move the signup UI from email collection to code verification. */
type SignupCodeResult =
  | { readonly kind: 'sent' }
  | { readonly kind: 'rate-limited' }
  | { readonly kind: 'unavailable' };

/**
 * Request a one-time sign-up code for the given email.
 *
 * @remarks
 * Hits the `signup-challenge` plugin's `/sign-up/request-code`, which stores a hashed code and
 * emails the plaintext. Always succeeds (anti-enumeration) unless rate-limited (429). Returns
 * whether the API accepted the send, rate-limited it, or failed before accepting it. A failed
 * request must never advance the UI to the email-sent state.
 */
async function requestSignupCode(name: string, email: string): Promise<SignupCodeResult> {
  const res = await authClient.$fetch('/sign-up/request-code', {
    method: 'POST',
    body: { name, email },
  });
  if (!res.error) return { kind: 'sent' };
  return res.error.status === 429 ? { kind: 'rate-limited' } : { kind: 'unavailable' };
}

/**
 * Verify the emailed code and obtain the single-use registration intent token.
 *
 * @remarks
 * Hits `/sign-up/verify-code`. On success returns the `intent` token to pass as the passkey
 * registration `context`; on a bad/expired code (or 429) returns an error message to surface.
 *
 * @returns the intent token, or an error message describing why verification failed.
 */
async function verifySignupCode(
  email: string,
  code: string,
): Promise<{ intent: string } | { error: string }> {
  const res = await authClient.$fetch<{ intent: string }>('/sign-up/verify-code', {
    method: 'POST',
    body: { email, code },
  });
  if (res.error) {
    if (res.error.status === 429) return { error: RATE_LIMIT_MESSAGE };
    return { error: userErrorMessage(res.error, 'That code is invalid or has expired.') };
  }
  return { intent: res.data.intent };
}

/**
 * The passwordless, passkey-first sign-up screen — email verified BEFORE the passkey is bound.
 *
 * @remarks
 * A Client Component owning a two-step flow. Step 1 ("collect") takes a name + email and requests a
 * one-time code (`/sign-up/request-code`). Step 2 ("verify") takes the code, exchanges it for a
 * single-use registration intent (`/sign-up/verify-code`), then runs a WebAuthn registration
 * ceremony via `passkey.addPasskey({ name, context: intent })`. Because the server only binds a
 * passkey to an email a caller has demonstrably received mail at, a stranger can never graft a
 * credential onto someone else's account (closes the pre-registration account-takeover). Passkey
 * registration mints no session, so we immediately `signIn.passkey()` before entering onboarding.
 * There is NO password.
 *
 * Robustness:
 * - WebAuthn support is feature-detected; unsupported browsers see a clear message and the passkey
 *   step is disabled (OAuth, when configured, remains available).
 * - Submission is disabled until hydration so a pre-hydration native submit cannot post the form.
 * - Errors are surfaced in an assertive `role="alert"` region; a user-cancelled ceremony is a no-op.
 * - Secondary OAuth buttons render only when their providers are configured (env-gated).
 */
export default function SignUpPage(): JSX.Element {
  const router = useRouter();
  const [step, setStep] = useState<Step>('collect');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
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

  /** Step 1 → 2: request the emailed code, then advance to the verification step. */
  async function sendCode(): Promise<void> {
    setError(null);
    setPending(true);
    try {
      const result = await requestSignupCode(name.trim(), email.trim());
      if (result.kind !== 'sent') {
        setError(
          result.kind === 'rate-limited' ? RATE_LIMIT_MESSAGE : SIGNUP_CODE_UNAVAILABLE_MESSAGE,
        );
        return;
      }
      setCode('');
      setStep('verify');
    } catch {
      setError(SIGNUP_CODE_UNAVAILABLE_MESSAGE);
    } finally {
      setPending(false);
    }
  }

  /** Step 2: verify the code, register the passkey against the proven email, then sign in. */
  async function verifyAndRegister(): Promise<void> {
    setError(null);
    setPending(true);
    try {
      const result = await verifySignupCode(email.trim(), code.trim());
      if ('error' in result) {
        setError(result.error);
        return;
      }
      const { error: passkeyError } = await passkey.addPasskey({
        name: email.trim(),
        context: result.intent,
      });
      if (passkeyError) {
        // A 5xx (e.g. the API/database is down) surfaces an outage-aware message instead of a bare
        // "please try again", so the user isn't stuck retrying a futile ceremony.
        setError(
          passkeyErrorMessage(
            passkeyError,
            'We could not finish setting up your passkey. Please try again.',
          ),
        );
        return;
      }
      // Registration creates the credential but does NOT start a session, so authenticate with the
      // just-created passkey (which mints the session cookie) before entering onboarding.
      const { error: signInError } = await signIn.passkey();
      if (signInError) {
        setError(passkeyErrorMessage(signInError, SIGNUP_SESSION_ERROR));
        return;
      }
      router.push(POST_SIGNUP_DESTINATION);
    } catch (caught) {
      setError(
        passkeyErrorMessage(
          caught,
          'Something went wrong creating your account. Please try again.',
        ),
      );
    } finally {
      setPending(false);
    }
  }

  const canSubmit =
    hydrated &&
    passkeySupported &&
    !pending &&
    (step === 'collect'
      ? name.trim().length > 0 && email.trim().length > 0
      : code.trim().length > 0);

  return (
    <AuthShell
      title="Create your account"
      description="Run every organization from one calm place."
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
          // Guard the native submit and hand off to the active step when ready. Until hydration
          // `canSubmit` is false, so a pre-hydration native submit is a no-op.
          event.preventDefault();
          if (!canSubmit) return;
          void (step === 'collect' ? sendCode() : verifyAndRegister());
        }}
      >
        {step === 'collect' ? (
          <>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="name" className="text-body font-medium">
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
              <label htmlFor="email" className="text-body font-medium">
                Email
              </label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                }}
                placeholder="you@example.com"
              />
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="code" className="text-body font-medium">
              Verification code
            </label>
            <p className="text-on-surface-variant text-body">
              We emailed a 6-digit code to <span className="font-medium">{email.trim()}</span>.
              Enter it to finish creating your account.
            </p>
            <Input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              autoFocus
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
              }}
              placeholder="123456"
            />
            <button
              type="button"
              className="text-on-surface-variant hover:text-on-surface self-start text-xs underline-offset-4 hover:underline"
              onClick={() => {
                setError(null);
                setStep('collect');
              }}
            >
              Use a different email
            </button>
          </div>
        )}

        <AuthError message={error} />

        {!passkeySupported && hydrated ? (
          <p className="text-on-surface-variant text-body" role="status">
            This browser does not support passkeys. You can still continue with one of the options
            below if available.
          </p>
        ) : null}

        <Button type="submit" disabled={!canSubmit}>
          {pending ? (
            <>
              <Spinner />
              {step === 'collect' ? 'Sending code…' : 'Creating account…'}
            </>
          ) : step === 'collect' ? (
            'Continue with email'
          ) : (
            'Verify and create account'
          )}
        </Button>

        <p className="text-on-surface-variant text-center text-xs leading-relaxed">
          No passwords. Your device&rsquo;s Face ID, Touch ID, or security key becomes your secure
          key to Docket.
        </p>
      </form>

      {step === 'collect' ? (
        <OAuthButtons callbackURL={POST_SIGNUP_DESTINATION} disabled={pending} onError={setError} />
      ) : null}
    </AuthShell>
  );
}
