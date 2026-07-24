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

import { signInReturnPath } from './app-shell-utils';

interface AuthenticationInterlockValue {
  /** Block the current surface until the person explicitly continues to sign-in. */
  readonly requireAuthentication: (returnPath?: string) => void;
}

const AuthenticationInterlockContext = createContext<AuthenticationInterlockValue | null>(null);

/** A foreground action that resolves with its successful result or rethrows its original error. */
export type AuthenticationRecoveryAction = <T>(action: () => Promise<T>) => Promise<T>;

/**
 * Keep an auth return target on this origin; never turn an error payload into an open redirect.
 *
 * @remarks
 * Resolves `value` against the current origin with the native `URL` parser rather than hand-rolled
 * prefix checks — it rejects protocol-relative and cross-origin values (including the backslash and
 * unicode tricks browsers normalize before a manual `startsWith` check would ever see them) by
 * comparing the resolved `origin`, not by pattern-matching the raw string.
 */
function safeReturnPath(value: string | undefined): string {
  if (!value) return '/today';
  try {
    const resolved = new URL(value, window.location.origin);
    if (resolved.origin !== window.location.origin) return '/today';
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return '/today';
  }
}

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
 * {@link useAuthenticationInterlock} when they receive `code: unauthorized`. The dialog cannot
 * be dismissed, and navigation happens only after the person explicitly chooses to sign in.
 */
export function AuthenticationInterlockProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const [returnPath, setReturnPath] = useState('/today');
  const [open, setOpen] = useState(false);

  const requireAuthentication = useCallback((nextPath?: string): void => {
    setReturnPath(safeReturnPath(nextPath ?? currentReturnPath()));
    setOpen(true);
  }, []);

  function continueToSignIn(): void {
    window.location.assign(signInReturnPath(returnPath));
  }

  return (
    <AuthenticationInterlockContext.Provider value={{ requireAuthentication }}>
      {children}
      <Dialog open={open} onOpenChange={() => undefined}>
        <DialogContent
          showClose={false}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Sign in to continue</DialogTitle>
            <DialogDescription>
              Your session is no longer available for this action. Sign in to continue from this
              exact place.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" onClick={continueToSignIn}>
              Sign in to continue
            </Button>
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
