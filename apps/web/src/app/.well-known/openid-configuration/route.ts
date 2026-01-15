import { oauthProviderOpenIdConfigMetadata } from '@better-auth/oauth-provider';
import { auth } from '@/lib/auth-server';

/**
 * OpenID Connect Discovery endpoint.
 * Provides OIDC-compliant metadata for client discovery.
 *
 * @see https://openid.net/specs/openid-connect-discovery-1_0.html
 */
export const GET = oauthProviderOpenIdConfigMetadata(auth);
