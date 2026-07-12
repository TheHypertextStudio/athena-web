'use client';

import { Button, Input } from '@docket/ui/primitives';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type JSX, useEffect, useState } from 'react';

import { authClient, passkey, twoFactor } from '@/lib/auth-client';
import { userErrorMessage } from '@/lib/problem';

import { AuthError, Spinner } from '../_components/auth-feedback';
import { AuthShell } from '../_components/auth-shell';
import { passkeyErrorMessage } from '../_lib/passkey-error';
import { isWebAuthnSupported } from '../_lib/webauthn';

/** Where a recovered user lands once they've re-enrolled (or skipped) a passkey. */
const HOME_DESTINATION = '/today';

/** Shown when the recovery endpoints return 429 (rate-limited, 10/min). */
const RATE_LIMIT_MESSAGE = 'Too many attempts. Please wait a minute and try again.';

/**
 * Begin the recovery challenge for an email so a backup code can be verified without a session.
 *
 * @remarks
 * Hits the custom `/two-factor/recovery-challenge` endpoint, which sets the signed `two_factor`
 * challenge cookie when the email has recovery codes. It always returns 200 (anti-enumeration)
 * unless rate-limited (429), so this is best-effort: the real gate is
 * {@link twoFactor.verifyBackupCode}, which fails clearly if no challenge was armed or the code is
 * wrong. Returns whether the call was rate-limited so the caller can message that distinctly.
 */
async function armRecoveryChallenge(email: string): Promise<{ rateLimited: boolean }> {
  const res = await authClient.$fetch('/two-factor/recovery-challenge', {
    method: 'POST',
    body: { email },
  });
  return { rateLimited: res.error?.status === 429 };
}

/**
 * Normalize a recovery code as the user types: drop non-alphanumerics, cap at 10 chars, and
 * re-insert the `xxxxx-xxxxx` hyphen. Codes are case-sensitive, so case is preserved.
 */
function formatRecoveryCode(raw: string): string {
  const alnum = raw.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
  return alnum.length > 5 ? `${alnum.slice(0, 5)}-${alnum.slice(5)}` : alnum;
}

/**
 * The account-recovery screen: sign back in with a backup code, then re-enrol a passkey.
 *
 * @remarks
 * Docket is passwordless, so a lost passkey would otherwise lock a user out for good. This screen
 * is the way back: enter your email + a recovery code, which arms the recovery challenge
 * ({@link armRecoveryChallenge}) and then verifies the code ({@link twoFactor.verifyBackupCode}) —
 * consuming it and minting a session. Once recovered, the user is prompted to register a fresh
 * passkey for this device (so they aren't locked out next time); they can also skip and do it later
 * from settings. Reached via a link on the sign-in screen.
 */
export default function RecoverPage(): JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<'verify' | 'enroll'>('verify');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(true);

  useEffect(() => {
    setHydrated(true);
    setPasskeySupported(isWebAuthnSupported());
  }, []);

  /** Arm the challenge, verify the backup code, and advance to passkey re-enrolment on success. */
  async function recover(): Promise<void> {
    setError(null);
    setPending(true);
    try {
      const { rateLimited } = await armRecoveryChallenge(email.trim().toLowerCase());
      if (rateLimited) {
        setError(RATE_LIMIT_MESSAGE);
        return;
      }
      const { error: verifyError } = await twoFactor.verifyBackupCode({ code: code.trim() });
      if (verifyError) {
        setError(
          verifyError.status === 429
            ? RATE_LIMIT_MESSAGE
            : userErrorMessage(verifyError, 'That code didn’t work. Check it and try again.'),
        );
        return;
      }
      setPhase('enroll');
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setPending(false);
    }
  }

  /** Register a fresh passkey on the recovered session, then enter the app. */
  async function enrollPasskey(): Promise<void> {
    setError(null);
    setPending(true);
    try {
      const { error: passkeyError } = await passkey.addPasskey({ name: email.trim() });
      if (passkeyError) {
        setError(
          passkeyErrorMessage(
            passkeyError,
            'We could not set up your new passkey. You can add one later from settings.',
          ),
        );
        return;
      }
      router.push(HOME_DESTINATION);
    } catch (caught) {
      setError(
        passkeyErrorMessage(caught, 'We could not set up your new passkey. Please try again.'),
      );
    } finally {
      setPending(false);
    }
  }

  const canVerify = hydrated && !pending && email.trim().length > 0 && code.trim().length > 0;

  if (phase === 'enroll') {
    return (
      <AuthShell
        title="You're back in"
        description="Set up a new passkey so you can sign in without a code next time."
        footer={
          <Link
            href={HOME_DESTINATION}
            className="text-primary font-medium underline-offset-4 hover:underline"
          >
            Skip for now
          </Link>
        }
      >
        <div className="flex flex-col gap-4">
          <AuthError message={error} />

          {!passkeySupported && hydrated ? (
            <p className="text-on-surface-variant text-body" role="status">
              This browser does not support passkeys. You&apos;re signed in — add a passkey later
              from a supported device.
            </p>
          ) : null}

          <Button
            type="button"
            disabled={!hydrated || !passkeySupported || pending}
            onClick={() => {
              void enrollPasskey();
            }}
          >
            {pending ? (
              <>
                <Spinner />
                Setting up your passkey…
              </>
            ) : (
              'Add a new passkey'
            )}
          </Button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Recover your account"
      description="Lost your passkey? Use a recovery code to get back in."
      footer={
        <>
          Remembered it?{' '}
          <Link
            href="/sign-in"
            className="text-primary font-medium underline-offset-4 hover:underline"
          >
            Back to sign in
          </Link>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!canVerify) return;
          void recover();
        }}
      >
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
        <div className="flex flex-col gap-1.5">
          <label htmlFor="code" className="text-body font-medium">
            Recovery code
          </label>
          <Input
            id="code"
            type="text"
            autoComplete="one-time-code"
            required
            value={code}
            onChange={(e) => {
              setCode(formatRecoveryCode(e.target.value));
            }}
            placeholder="xxxxx-xxxxx"
            className="font-mono"
          />
        </div>

        <AuthError message={error} />

        <Button type="submit" disabled={!canVerify}>
          {pending ? (
            <>
              <Spinner />
              Verifying…
            </>
          ) : (
            'Recover account'
          )}
        </Button>
      </form>
    </AuthShell>
  );
}
