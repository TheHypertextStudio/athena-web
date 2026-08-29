'use client';

import { createContext, type JSX, type ReactNode, useContext } from 'react';

const MISSING_RESOLVED_ACCOUNT = Symbol('missing-resolved-account');
const ResolvedAccountContext = createContext<string | null | typeof MISSING_RESOLVED_ACCOUNT>(
  MISSING_RESOLVED_ACCOUNT,
);

/** Props for the shell-owned resolved account boundary. */
export interface ResolvedAccountProviderProps {
  /** The account whose private page state may render, or `null` while an account switch settles. */
  readonly userId: string | null;
  /** Private application content owned by the resolved account. */
  readonly children: ReactNode;
}

/** Provide the account identity that the app shell has cleared and released for private rendering. */
export function ResolvedAccountProvider({
  userId,
  children,
}: ResolvedAccountProviderProps): JSX.Element {
  return (
    <ResolvedAccountContext.Provider value={userId}>{children}</ResolvedAccountContext.Provider>
  );
}

/**
 * Read the account identity released by the app shell for private page state.
 *
 * @returns The stable account id for the rendered application subtree, or `null` while unknown.
 * @throws {Error} when called outside the authenticated shell.
 */
export function useResolvedAccountId(): string | null {
  const userId = useContext(ResolvedAccountContext);
  if (userId === MISSING_RESOLVED_ACCOUNT) {
    throw new Error('useResolvedAccountId must be used inside a resolved app shell.');
  }
  return userId;
}
