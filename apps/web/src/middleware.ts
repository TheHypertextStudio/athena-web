import { NextResponse, type NextRequest } from 'next/server';

/**
 * Restore the browser-facing host before the API rewrite proxy strips it.
 *
 * @remarks
 * The dev stack puts the browser two reverse-proxy hops from the Hono API:
 *
 * ```
 * browser → portless(:443) → Next(:webPort) → [next.config rewrite] → portless → API
 * ```
 *
 * portless forwards upstream with `Host: 127.0.0.1:<port>` and the real host only in
 * `x-forwarded-host`. Next's rewrite to `API_URL` then re-derives its own outbound
 * `x-forwarded-host` from that loopback `Host` — discarding the real host — so the API
 * resolves its Better Auth base to the `BETTER_AUTH_URL` fallback (`api.docket.localhost`)
 * instead of the host the user is actually on (`docket.localhost`).
 *
 * For most calls that's harmless (session cookies are host-only and ride the same-origin
 * XHR). But Better Auth's `oAuthProxy` builds an **absolute** proxy-callback URL from the
 * request's resolved host, so a wrong host sends the OAuth round-trip — and its session
 * cookie + post-login redirect — to `api.docket.localhost`, breaking sign-in on the host
 * the user is browsing.
 *
 * Copying `x-forwarded-host` back onto `Host` makes Next's rewrite re-derive the correct
 * `x-forwarded-host`, so the API sees the true browser host and OAuth stays same-origin.
 * In production (single proxy hop, `Host` already correct) `x-forwarded-host` equals `Host`,
 * so this is a no-op.
 */
export function middleware(request: NextRequest): NextResponse {
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (!forwardedHost || forwardedHost === request.headers.get('host')) {
    return NextResponse.next();
  }
  const headers = new Headers(request.headers);
  headers.set('host', forwardedHost);
  return NextResponse.next({ request: { headers } });
}

/** Only the paths that are reverse-proxied to the API need the host restored. */
export const config = {
  matcher: ['/api/auth/:path*', '/v1/:path*'],
};
