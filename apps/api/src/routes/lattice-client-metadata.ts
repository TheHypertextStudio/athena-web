/** Public metadata for Docket's independently owned Lovelace OAuth client. */
import { LATTICE_SCOPE_PARAM } from '@docket/integrations';
import { Hono } from 'hono';

import { env } from '../env';

/** The public document path, also reverse-proxied by the web origin. */
export const LATTICE_CLIENT_METADATA_PATH = '/.well-known/lattice-client.json';

/**
 * Publish the same public client identity in every configured Docket environment.
 *
 * The canonical web origin hosts the document so its verified URL also binds the FedCM relying
 * party origin. The separately configured API owns the callback and the PKCE verifier.
 */
export const latticeClientMetadata = new Hono().get(LATTICE_CLIENT_METADATA_PATH, (c) => {
  if (!env.LATTICE_GATEWAY_URL) return c.json({ error: 'temporarily_unavailable' }, 503);
  c.header('Cache-Control', 'public, max-age=300');
  return c.json({
    client_id: new URL(LATTICE_CLIENT_METADATA_PATH, env.WEB_URL).href,
    client_name: 'Docket',
    client_uri: env.WEB_URL,
    policy_uri: new URL('/privacy', env.WEB_URL).href,
    tos_uri: new URL('/terms', env.WEB_URL).href,
    redirect_uris: [new URL('/internal/integrations/lattice/callback', env.API_URL).href],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: LATTICE_SCOPE_PARAM,
    resource: [env.LATTICE_RESOURCE_URL ?? env.LATTICE_GATEWAY_URL],
  });
});
