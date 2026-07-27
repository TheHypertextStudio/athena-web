/**
 * `@docket/api` — the split CORS policy for the root server.
 */
import type { MiddlewareHandler } from 'hono';
import { cors } from 'hono/cors';

import type { AppEnv } from './context';

/**
 * The public half of the OAuth 2.0 Authorization Server surface: dynamic client
 * registration (RFC 7591), token exchange, introspection (RFC 7662), revocation (RFC 7009),
 * the JWKS, and the AS/RS discovery documents (RFC 8414 / RFC 9728). None of these carry the
 * caller's session cookie — a client authenticates itself with its own credentials or PKCE,
 * never with `BETTER_AUTH_TRUSTED_ORIGINS`'s cookie-bearing session — so unlike every other
 * route they must not require that strict, hand-maintained allowlist. Gating them behind it
 * defeats the point of dynamic registration: any MCP client's web UI has to be able to call
 * these without us maintaining a per-vendor origin list, or the next browser-hosted client
 * that isn't already on the list breaks the same way the first one did.
 *
 * `/api/auth/oauth2/authorize` is deliberately absent: the browser reaches it by a top-level
 * redirect, never a `fetch`, so CORS never applies to it regardless of policy.
 */
const PUBLIC_OAUTH_PATHS: ReadonlySet<string> = new Set([
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-authorization-server/api/auth',
  '/.well-known/mcp-client.json',
  '/api/auth/oauth2/register',
  '/api/auth/oauth2/token',
  '/api/auth/oauth2/introspect',
  '/api/auth/oauth2/revoke',
  '/api/auth/jwks',
]);

/**
 * Build the root server's CORS middleware: a strict, credentialed allowlist
 * ({@link trustedOrigins}) for every session-cookie route, and an open, credential-free
 * policy for {@link PUBLIC_OAUTH_PATHS}.
 */
export function buildCorsMiddleware(trustedOrigins: readonly string[]): MiddlewareHandler<AppEnv> {
  const sessionCors = cors({
    origin: [...trustedOrigins],
    credentials: true,
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Authorization', 'WWW-Authenticate'],
  });
  const publicOAuthCors = cors({
    origin: '*',
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Authorization', 'WWW-Authenticate'],
  });
  return (c, next) => (PUBLIC_OAUTH_PATHS.has(c.req.path) ? publicOAuthCors : sessionCors)(c, next);
}
