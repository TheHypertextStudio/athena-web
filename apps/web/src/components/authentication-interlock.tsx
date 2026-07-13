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

interface AuthenticationInterlockValue {
  /** Block the current surface until the person explicitly continues to sign-in. */
  readonly requireAuthentication: (returnPath?: string) => void;
}

const AuthenticationInterlockContext = createContext<AuthenticationInterlockValue | null>(null);

/** Keep an auth return target on this origin; never turn an error payload into an open redirect. */
function safeReturnPath(value: string | undefined): string {
  if (value?.startsWith('/') && !value.startsWith('//')) return value;
  return '/today';
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
    window.location.assign(`/sign-in?next=${encodeURIComponent(returnPath)}`);
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
 * Read the interlock when the caller is mounted in the product provider tree.
 *
 * @remarks
 * Shared data-layer unit tests and server-adjacent helpers can run without browser providers; they
 * retain their typed error result rather than inventing a navigation side effect.
 */
export function useOptionalAuthenticationInterlock(): AuthenticationInterlockValue | null {
  return useContext(AuthenticationInterlockContext);
}
