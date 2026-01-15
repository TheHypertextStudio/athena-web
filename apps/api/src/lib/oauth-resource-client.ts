/**
 * OAuth 2.1 Resource Server Client.
 *
 * Used for verifying OAuth access tokens in the API.
 *
 * @packageDocumentation
 */

import { createAuthClient } from 'better-auth/client';
import { oauthProviderResourceClient } from '@better-auth/oauth-provider/resource-client';
import { auth } from './auth.js';

/**
 * Server-side auth client with OAuth resource capabilities.
 * Used for token verification in API middleware.
 */
export const serverClient = createAuthClient({
  plugins: [oauthProviderResourceClient(auth)],
});

/**
 * Verify an OAuth access token and return its payload.
 *
 * @param accessToken - The access token to verify
 * @param options - Verification options
 * @returns The token payload if valid
 * @throws Error if token is invalid
 */
export async function verifyAccessToken(
  accessToken: string,
  options?: {
    scopes?: string[];
    audience?: string;
  },
) {
  const { env } = await import('./env.js');

  const payload = await serverClient.verifyAccessToken(accessToken, {
    verifyOptions: {
      issuer: env.BETTER_AUTH_URL,
      audience: options?.audience ?? `${env.BETTER_AUTH_URL}/mcp`,
    },
    scopes: options?.scopes,
  });

  return payload;
}
