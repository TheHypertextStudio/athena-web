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
 * The share-token header a "what am I working on" widget presents.
 *
 * @remarks
 * Duplicated as a literal rather than imported from `time/share` so this module stays free of
 * route/domain imports — CORS policy is read by people auditing what the server exposes, and it
 * should be legible without following an import into the Time Ledger.
 */
const SHARE_TOKEN_HEADER = 'X-Docket-Share-Token';

/**
 * Paths a person's own website may read, authorized by a token they minted rather than by their
 * session cookie.
 *
 * @remarks
 * Exactly one entry, and it answers one question — see `routes/time-public.ts`. It belongs to the
 * credential-free policy for the same reason the OAuth endpoints do: the caller authenticates
 * with something it holds, so a browser must never attach Docket's session cookie, and the set of
 * origins is by definition unknowable in advance (that is what "my personal site" means).
 */
const PUBLIC_SHARE_PATHS: ReadonlySet<string> = new Set(['/v1/public/time/status']);

/**
 * Build the root server's CORS middleware: a strict, credentialed allowlist
 * ({@link trustedOrigins}) for every session-cookie route, and an open, credential-free
 * policy for {@link PUBLIC_OAUTH_PATHS} and {@link PUBLIC_SHARE_PATHS}.
 */
/**
 * Request headers a browser client is allowed to send.
 *
 * @remarks
 * A header absent from this list is not merely ignored — the preflight fails and the browser
 * never sends the request at all. So this list is the real boundary of what the conditional-
 * request and retry-safety contracts mean from a browser: `If-Match` that cannot be sent is a
 * lost-update guard that does not exist, and an `Idempotency-Key` that cannot be sent is a
 * duplicate create waiting to happen.
 */
const ALLOWED_REQUEST_HEADERS = [
  'Content-Type',
  'Authorization',
  // Conditional requests (RFC 9110 §13.1) — the write half of the entity-tag contract.
  'If-Match',
  'If-None-Match',
  // Retry safety on POST.
  'Idempotency-Key',
];

/**
 * Response headers a browser client is allowed to read.
 *
 * @remarks
 * `fetch` exposes only a short safelist by default; everything else is present on the wire and
 * invisible to script. `Location` and `ETag` are the two that matter most here — without them a
 * client cannot learn where a create landed, cannot hold a tag to write against, and cannot
 * build a conditional request even though the server answers them correctly.
 */
const EXPOSED_RESPONSE_HEADERS = [
  'Authorization',
  'WWW-Authenticate',
  // Where a 201 put the new resource, and where a 202 reports progress.
  'Location',
  // The tag a client echoes back as `If-None-Match` or `If-Match`.
  'ETag',
  // What a 405 says it would have accepted.
  'Allow',
  // Whether a 202/201 was computed or replayed from an earlier attempt under the same key.
  'Idempotency-Replayed',
  // How long to wait before retrying a 429 or 503.
  'Retry-After',
];

export function buildCorsMiddleware(trustedOrigins: readonly string[]): MiddlewareHandler<AppEnv> {
  const sessionCors = cors({
    origin: [...trustedOrigins],
    credentials: true,
    allowHeaders: ALLOWED_REQUEST_HEADERS,
    exposeHeaders: EXPOSED_RESPONSE_HEADERS,
  });
  const publicOAuthCors = cors({
    origin: '*',
    allowHeaders: [...ALLOWED_REQUEST_HEADERS, SHARE_TOKEN_HEADER],
    exposeHeaders: EXPOSED_RESPONSE_HEADERS,
  });
  return (c, next) =>
    PUBLIC_OAUTH_PATHS.has(c.req.path) || PUBLIC_SHARE_PATHS.has(c.req.path)
      ? publicOAuthCors(c, next)
      : sessionCors(c, next);
}
