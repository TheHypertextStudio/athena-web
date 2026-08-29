'use client';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@docket/ui/primitives';
import { createContext, type JSX, type ReactNode, useCallback, useContext, useState } from 'react';

import { AuthenticationRequiredError } from '@/lib/query-core';

import { safeSameOriginPath, signInReturnPath } from './app-shell-utils';

interface AuthenticationInterlockValue {
  /** Block the current surface until the person explicitly continues to sign-in. */
  readonly requireAuthentication: (returnPath?: string) => void;
  /** Explain that session cleanup stopped because private browser data could not be cleared. */
  readonly reportSessionCleanupFailure: () => void;
  /** Explain that an explicit account-bound sign-out request did not finish. */
  readonly reportSignOutFailure: () => void;
}

const AuthenticationInterlockContext = createContext<AuthenticationInterlockValue | null>(null);

/** A foreground action that resolves with its successful result or rethrows its original error. */
export type AuthenticationRecoveryAction = <T>(action: () => Promise<T>) => Promise<T>;

/** Read the current same-origin location for an action that does not supply its own target. */
function currentReturnPath(): string {
  return `${window.location.pathname}${window.location.search}`;
}

/**
 * Make an explicit missing-session recovery decision available to protected routes and actions.
 *
 * @remarks
 * This provider deliberately does not observe every failed request. A background refetch is not
 * user intent, while a protected deep link or a button click is; those owners call
 * {@link useAuthenticationInterlock} when they receive `code: unauthorized`. Navigation happens
 * only after the person explicitly chooses to sign in — that part is unchanged.
 *
 * The dialog **is** dismissible, which reverses an earlier decision. It was previously a modal
 * with no escape: no close button, `Escape` suppressed, outside-clicks suppressed, and
 * `onOpenChange` a no-op. That trapped someone whose session had lapsed inside a wall, taking the
 * navigation, the settings surfaces, and every already-loaded page down with it. Signing in is the
 * recommended action, not a toll gate — dismissing leaves the person in the app with the shell
 * intact, and any protected action they retry simply asks again.
 */
export function AuthenticationInterlockProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const [returnPath, setReturnPath] = useState('/today');
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<'authentication' | 'cleanup-failed' | 'sign-out-failed'>(
    'authentication',
  );

  const requireAuthentication = useCallback((nextPath?: string): void => {
    setReturnPath(safeSameOriginPath(nextPath ?? currentReturnPath()) ?? '/today');
    setReason('authentication');
    setOpen(true);
  }, []);

  const reportSessionCleanupFailure = useCallback((): void => {
    setReason('cleanup-failed');
    setOpen(true);
  }, []);

  const reportSignOutFailure = useCallback((): void => {
    setReason('sign-out-failed');
    setOpen(true);
  }, []);

  function continueToSignIn(): void {
    window.location.assign(signInReturnPath(returnPath));
  }

  return (
    <AuthenticationInterlockContext.Provider
      value={{ requireAuthentication, reportSessionCleanupFailure, reportSignOutFailure }}
    >
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {reason === 'authentication'
                ? 'Sign in to continue'
                : reason === 'cleanup-failed'
                  ? 'Sign-out could not finish safely'
                  : 'Sign-out could not finish'}
            </DialogTitle>
            <DialogDescription>
              {reason === 'authentication'
                ? 'Your session is no longer available for this action. Sign in to continue from this exact place, or close this to keep looking around.'
                : reason === 'cleanup-failed'
                  ? "Docket could not clear this browser's offline data, so it stopped before another account could be affected. Close other Docket tabs and try again."
                  : 'Docket could not confirm that your session ended. Your account remains available in this tab. Check your connection and try again.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {reason === 'authentication' ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setOpen(false);
                  }}
                >
                  Not now
                </Button>
                <Button type="button" onClick={continueToSignIn}>
                  Sign in to continue
                </Button>
              </>
            ) : (
              <Button
                type="button"
                onClick={() => {
                  setOpen(false);
                }}
              >
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AuthenticationInterlockContext.Provider>
  );
}

/** Access the explicit authentication interlock for a protected route or user action. */
export function useAuthenticationInterlock(): AuthenticationInterlockValue {
  const value = useContext(AuthenticationInterlockContext);
  if (!value) {
    throw new Error(
      'useAuthenticationInterlock must be used within AuthenticationInterlockProvider',
    );
  }
  return value;
}

/**
 * Wrap a foreground operation so only `code: unauthorized` opens the blocking auth interlock.
 *
 * @remarks
 * This is the direct-action counterpart to {@link useApiMutation}: components that perform an
 * imperative `unwrap` call (OAuth starts, setup flows, and similar one-off actions) use this
 * wrapper instead of accidentally rendering a missing session as a normal inline failure. The
 * original error is always rethrown so existing cleanup and field-error handling still run.
 */
export function useAuthenticationRecovery(): AuthenticationRecoveryAction {
  const { requireAuthentication } = useAuthenticationInterlock();
  return useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action();
      } catch (error) {
        if (error instanceof AuthenticationRequiredError) requireAuthentication();
        throw error;
      }
    },
    [requireAuthentication],
  );
}

/**
 * Read the interlock when the caller is mounted in the product provider tree.
 *
 * @remarks
 * Shared data-layer unit tests and server-adjacent helpers can run without browser providers; they
 * retain their typed error result rather than inventing a navigation side effect.
 */
export function useOptionalAuthenticationInterlock(): AuthenticationInterlockValue | null {
  return useContext(AuthenticationInterlockContext);
}

/**
 * The optional form used by the shared mutation hook and isolated unit-test wrappers.
 *
 * @remarks
 * Product routes always mount {@link AuthenticationInterlockProvider}; the optional form keeps
 * the server-safe data-layer tests focused on their returned error without inventing navigation.
 */
export function useOptionalAuthenticationRecovery(): AuthenticationRecoveryAction {
  const interlock = useOptionalAuthenticationInterlock();
  return useCallback(
    async <T,>(action: () => Promise<T>): Promise<T> => {
      try {
        return await action();
      } catch (error) {
        if (error instanceof AuthenticationRequiredError) interlock?.requireAuthentication();
        throw error;
      }
    },
    [interlock],
  );
}
