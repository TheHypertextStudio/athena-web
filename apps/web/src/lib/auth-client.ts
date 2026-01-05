/**
 * Better Auth client configuration.
 *
 * @packageDocumentation
 */

import { createAuthClient } from 'better-auth/react';
import { passkeyClient } from '@better-auth/passkey/client';

const baseURL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

/**
 * Configured auth client with passkey support.
 */
export const authClient = createAuthClient({
  baseURL,
  plugins: [passkeyClient()],
});

/**
 * Export auth hooks and utilities.
 */
export const { signIn, signUp, signOut, useSession, getSession } = authClient;

/**
 * Social sign-in helper.
 */
export function signInWithGoogle() {
  return signIn.social({ provider: 'google' });
}

export function signInWithApple() {
  return signIn.social({ provider: 'apple' });
}

export function signInWithMicrosoft() {
  return signIn.social({ provider: 'microsoft' });
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
