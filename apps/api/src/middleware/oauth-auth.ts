/**
 * OAuth 2.1 Bearer token authentication middleware.
 *
 * Used for authenticating MCP clients and third-party applications
 * that have obtained access tokens via the OAuth authorization flow.
 *
 * @packageDocumentation
 */

import type { Context, Next } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { verifyAccessToken } from '../lib/oauth-resource-client.js';
import { hasScope } from '../lib/oauth-scopes.js';
import { logger } from '../lib/logger.js';

/**
 * JWT payload from verified OAuth access token.
 */
export interface OAuthTokenPayload {
  /** Subject (user ID) */
  sub: string;
  /** Issuer */
  iss: string;
  /** Audience */
  aud: string | string[];
  /** Expiration time */
  exp: number;
  /** Issued at */
  iat: number;
  /** Scopes granted */
  scope?: string;
  /** Client ID that obtained the token */
  azp?: string;
  /** Custom claims */
  'athena:user_id'?: string;
  'athena:scopes'?: string[];
}

export interface OAuthContext {
  userId: string;
  oauthPayload: OAuthTokenPayload;
  oauthScopes: string[];
}

/**
 * Extract Bearer token from Authorization header.
 */
function extractBearerToken(c: Context): string | null {
  const authorization = c.req.header('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return null;
  }
  return authorization.slice(7); // Remove "Bearer " prefix
}

/**
 * Middleware that requires OAuth Bearer token authentication.
 *
 * @param options - Optional configuration
 * @param options.scopes - Required scopes for this endpoint
 */
export function requireOAuthAuth(options?: { scopes?: string[] }) {
  return async (c: Context, next: Next): Promise<void> => {
    const accessToken = extractBearerToken(c);

    if (!accessToken) {
      throw new HTTPException(401, {
        message: 'Missing access token',
        cause: { error: 'invalid_token', error_description: 'Bearer token required' },
      });
    }

    try {
      const payload = (await verifyAccessToken(accessToken, {
        scopes: options?.scopes,
      })) as OAuthTokenPayload;

      // Extract user ID from token
      const userId = payload['athena:user_id'] ?? payload.sub;
      if (!userId) {
        throw new HTTPException(401, {
          message: 'Invalid token: missing user ID',
          cause: {
            error: 'invalid_token',
            error_description: 'Token does not contain user identifier',
          },
        });
      }

      // Parse scopes from token
      const scopes = payload['athena:scopes'] ?? payload.scope?.split(' ') ?? [];

      // Verify required scopes if specified
      if (options?.scopes) {
        for (const requiredScope of options.scopes) {
          if (!hasScope(scopes, requiredScope)) {
            throw new HTTPException(403, {
              message: `Insufficient scope: ${requiredScope} required`,
              cause: { error: 'insufficient_scope', scope: requiredScope },
            });
          }
        }
      }

      // Set context variables
      c.set('userId', userId);
      c.set('oauthPayload', payload);
      c.set('oauthScopes', scopes);

      await next();
    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      logger.warn({ error }, '[OAuth] Token verification failed');

      throw new HTTPException(401, {
        message: 'Invalid or expired access token',
        cause: { error: 'invalid_token', error_description: 'Token verification failed' },
      });
    }
  };
}

/**
 * Get the OAuth token payload from context.
 */
export function getOAuthPayload(c: Context): OAuthTokenPayload {
  const payload = c.get('oauthPayload') as OAuthTokenPayload | undefined;
  if (!payload) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }
  return payload;
}

/**
 * Get the granted OAuth scopes from context.
 */
export function getOAuthScopes(c: Context): string[] {
  return (c.get('oauthScopes') as string[] | undefined) ?? [];
}

/**
 * Check if the current request has a specific OAuth scope.
 */
export function hasOAuthScope(c: Context, scope: string): boolean {
  const scopes = getOAuthScopes(c);
  return hasScope(scopes, scope);
}

/**
 * Check if the request is authenticated via OAuth (vs session).
 */
export function isOAuthRequest(c: Context): boolean {
  return c.get('oauthPayload') !== undefined;
}
