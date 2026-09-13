/**
 * `@docket/auth` — canonical OAuth protected-resource identities and exact request parsing.
 */
import { createHash } from 'node:crypto';

import { OAUTH_ISSUABLE_SCOPES } from '@docket/identity-access/oauth-scope-contract';

/** Private JWT claim that binds an access token to one durable authorization ceremony. */
export const OAUTH_GRANT_CLAIM = 'https://clearthedocket.com/oauth/grant';

/** Resolve the provider's nullable legacy client scope field without overriding an explicit deny-all value. */
export function effectiveOAuthClientScopes(
  scopes: readonly string[] | null | undefined,
): readonly string[] {
  return scopes ?? OAUTH_ISSUABLE_SCOPES;
}

/** Hash a provider credential with the one digest used by storage, lookup, and revocation. */
export async function hashOAuthToken(token: string): Promise<string> {
  return createHash('sha256').update(token).digest('base64url');
}

/** The OAuth error returned when a resource request is absent, ambiguous, or unsupported. */
export class OAuthResourceError extends Error {
  /** Stable OAuth error code exposed by the authorization server. */
  readonly code: 'invalid_grant' | 'invalid_target';

  constructor(code: 'invalid_grant' | 'invalid_target') {
    super(code);
    this.name = 'OAuthResourceError';
    this.code = code;
  }
}

/** Derive the REST protected-resource URI from the configured API origin. */
export function resolveRestResourceUrl(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/, '')}/v1`;
}

/**
 * Resolve the resource on an authorization request.
 *
 * Omission retains the prerelease MCP compatibility default. Every explicit value must occur
 * exactly once and match one canonical resource byte-for-byte.
 */
export function parseAuthorizationResource(
  values: readonly string[],
  mcpResource: string,
  restResource: string,
): string {
  if (values.length === 0) return mcpResource;
  if (values.length !== 1) throw new OAuthResourceError('invalid_target');
  const value = values[0];
  if (value !== mcpResource && value !== restResource) {
    throw new OAuthResourceError('invalid_target');
  }
  return value;
}

/** Resolve a token request against its immutable authorization or refresh-grant binding. */
export function resolveTokenResource(
  requested: string | undefined,
  bound: string | null | undefined,
  mcpResource: string,
  restResource: string,
): string {
  if (bound !== mcpResource && bound !== restResource) {
    throw new OAuthResourceError('invalid_grant');
  }
  if (requested !== undefined && requested !== bound) {
    throw new OAuthResourceError('invalid_target');
  }
  return bound;
}
