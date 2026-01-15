import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider';
import { auth } from '@/lib/auth-server';

/**
 * OAuth 2.1 Authorization Server Metadata endpoint.
 * RFC 8414 compliant.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc8414
 */
export const GET = oauthProviderAuthServerMetadata(auth);
