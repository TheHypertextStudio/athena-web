'use client';

import { Button } from '@docket/ui/primitives';
import { type JSX, useCallback, useEffect, useRef, useState } from 'react';

import { authClient } from '@/lib/auth-client';

import { AuthError, Spinner } from '../_components/auth-feedback';

interface Credential {
  readonly slug: string;
  readonly email: string;
  readonly token: string;
}

/** Read the private fragment once, then scrub it before any session exchange or navigation. */
function readCredential(): Credential | null {
  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
  const slug = url.searchParams.get('demo');
  const email = fragment.get('email');
  const token = fragment.get('token');
  return slug && email && token ? { slug, email, token } : null;
}

const LINK_ERROR =
  'We could not sign you in with this link. Please try again or contact the person who supplied it.';

/**
 * Automatically exchange a supplied reviewer link, without collecting another credential.
 * @param props - The existing post-sign-in routing callback.
 */
export function DemoLinkSignIn({
  onSignedIn,
}: {
  readonly onSignedIn: () => Promise<void>;
}): JSX.Element {
  const credential = useRef<Credential | null>(null);
  const started = useRef(false);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const signIn = useCallback(async (): Promise<void> => {
    if (!credential.current) return;
    setPending(true);
    setError(null);
    try {
      const result = await authClient.$fetch('/sign-in/demo-link', {
        method: 'POST',
        body: credential.current,
      });
      if (result.error) {
        setError(LINK_ERROR);
        return;
      }
      await onSignedIn();
    } catch {
      setError(LINK_ERROR);
    } finally {
      setPending(false);
    }
  }, [onSignedIn]);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    credential.current = readCredential();
    if (!credential.current) {
      setPending(false);
      setError('Open the full link supplied for your review to sign in.');
      return;
    }
    void signIn();
  }, [signIn]);
  return (
    <div className="flex flex-col gap-4">
      {pending ? (
        <p
          role="status"
          className="text-body-medium text-on-surface-variant flex items-center gap-2"
        >
          <Spinner />
          Signing in…
        </p>
      ) : null}
      <AuthError message={error} />
      {error && credential.current ? (
        <Button
          type="button"
          size="lg"
          onClick={() => {
            void signIn();
          }}
        >
          Try again
        </Button>
      ) : null}
    </div>
  );
}
