/**
 * Better Auth client configuration.
 *
 * Auth runs on the same origin (Next.js route handlers),
 * so no baseURL configuration is needed.
 *
 * @packageDocumentation
 */

import { createAuthClient } from 'better-auth/react';
import { passkeyClient } from '@better-auth/passkey/client';
import { lastLoginMethodClient } from 'better-auth/client/plugins';

/**
 * Configured auth client with passkey support.
 * No baseURL needed - auth routes are same-origin at /api/auth/*
 */
export const authClient = createAuthClient({
  plugins: [passkeyClient(), lastLoginMethodClient()],
});

/**
 * Export auth hooks and utilities.
 */
export const { signIn, signUp, signOut, useSession, getSession } = authClient;

/**
 * Social sign-in helpers.
 * All OAuth sign-ins redirect to /home after successful authentication.
 */
export function signInWithGoogle() {
  return signIn.social({
    provider: 'google',
    callbackURL: '/home',
  });
}

export function signInWithApple() {
  return signIn.social({
    provider: 'apple',
    callbackURL: '/home',
  });
}

export function signInWithMicrosoft() {
  return signIn.social({
    provider: 'microsoft',
    callbackURL: '/home',
  });
}

/**
 * Passkey helpers.
 */
export function registerPasskey(name?: string) {
  return authClient.passkey.addPasskey({ name });
}

export function signInWithPasskey() {
  return signIn.passkey();
}

/**
 * Sign in with passkey using conditional UI (autofill).
 *
 * @param options - Options including abort signal for cleanup
 * @returns Authentication result
 */
export function signInWithPasskeyAutofill(options?: { signal?: AbortSignal }) {
  return signIn.passkey({
    autoFill: true,
    fetchOptions: options?.signal ? { signal: options.signal } : undefined,
  });
}

// =============================================================================
// Account Linking
// =============================================================================

type SocialProvider = 'google' | 'apple' | 'microsoft';

interface LinkSocialOptions {
  provider: SocialProvider;
  callbackURL?: string;
  scopes?: string[];
}

/**
 * Link an additional social provider to the current user's account.
 * The user must already be signed in.
 *
 * @example
 * ```typescript
 * // Link Google account
 * await linkSocialAccount({ provider: 'google' });
 *
 * // Link with additional scopes (e.g., for calendar access)
 * await linkSocialAccount({
 *   provider: 'google',
 *   scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
 * });
 * ```
 */
export function linkSocialAccount(options: LinkSocialOptions) {
  return authClient.linkSocial({
    provider: options.provider,
    callbackURL: options.callbackURL ?? '/settings/security',
    scopes: options.scopes,
  });
}

/**
 * Link Google account with optional calendar access.
 */
export function linkGoogleAccount(options?: { withCalendar?: boolean }) {
  const scopes = options?.withCalendar
    ? ['https://www.googleapis.com/auth/calendar.readonly']
    : undefined;

  return linkSocialAccount({
    provider: 'google',
    scopes,
  });
}

/**
 * Link Apple account.
 */
export function linkAppleAccount() {
  return linkSocialAccount({ provider: 'apple' });
}

/**
 * Link Microsoft account.
 */
export function linkMicrosoftAccount() {
  return linkSocialAccount({ provider: 'microsoft' });
}

// =============================================================================
// Linked Accounts Management
// =============================================================================

export interface LinkedAccount {
  id: string;
  providerId: string;
  accountId: string;
  createdAt: string;
}

interface LinkedAccountsResponse {
  accounts: LinkedAccount[];
}

const isLinkedAccountsResponse = (value: unknown): value is LinkedAccountsResponse => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as { accounts?: unknown };
  return Array.isArray(record.accounts);
};

const getErrorMessage = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as { message?: unknown };
  return typeof record.message === 'string' ? record.message : undefined;
};

/**
 * Get all linked OAuth accounts for the current user.
 */
export async function getLinkedAccounts(): Promise<LinkedAccount[]> {
  const response = await fetch('/api/auth/linked-accounts', {
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch linked accounts');
  }

  const data: unknown = await response.json();
  if (!isLinkedAccountsResponse(data)) {
    throw new Error('Invalid linked accounts response');
  }
  return data.accounts;
}

/**
 * Unlink a social account from the current user.
 * Will fail if it's the user's only sign-in method.
 *
 * @param accountId - The account record ID to unlink
 */
export async function unlinkAccount(accountId: string): Promise<void> {
  const response = await fetch(`/api/auth/linked-accounts/${accountId}`, {
    method: 'DELETE',
    credentials: 'include',
  });

  if (!response.ok) {
    const errorData: unknown = await response.json();
    throw new Error(getErrorMessage(errorData) ?? 'Failed to unlink account');
  }
}

// =============================================================================
// Last Login Method
// =============================================================================

/**
 * Get the last authentication method used by the user.
 *
 * @returns The last login method (e.g., 'google', 'apple', 'passkey') or null if not set
 */
export function getLastUsedLoginMethod(): string | null {
  return authClient.getLastUsedLoginMethod();
}

/**
 * Check if a specific method was the last used login method.
 *
 * @param method - The method to check (e.g., 'google', 'apple', 'passkey')
 * @returns True if the specified method was last used
 */
export function isLastUsedLoginMethod(method: string): boolean {
  return authClient.isLastUsedLoginMethod(method);
}

/**
 * Clear the stored last login method.
 */
export function clearLastUsedLoginMethod(): void {
  authClient.clearLastUsedLoginMethod();
}
