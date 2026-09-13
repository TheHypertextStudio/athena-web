/**
 * `@docket/api` — RFC 9728 metadata for the public REST protected resource.
 */
import { OAUTH_ISSUABLE_SCOPES } from '@docket/identity-access/oauth-scope-contract';
import type { Context } from 'hono';

import { env } from '../env';

/** Serve metadata for the canonical `${API_URL}/v1` resource identifier. */
export function restProtectedResourceMetadata(c: Context): Response {
  const origin = env.API_URL.replace(/\/+$/, '');
  const issuerOrigin = (env.MCP_ISSUER_URL ?? origin).replace(/\/+$/, '');
  return c.json({
    resource: `${origin}/v1`,
    authorization_servers: [`${issuerOrigin}/api/auth`],
    scopes_supported: [...OAUTH_ISSUABLE_SCOPES],
    bearer_methods_supported: ['header'],
  });
}
