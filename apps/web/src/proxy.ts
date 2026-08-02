import { NextResponse, type NextRequest } from 'next/server';

/**
 * The `(app)` route group's top-level segments — the surfaces that require a session.
 *
 * @remarks
 * An explicit list rather than a catch-all with exclusions, so marketing (`/`), `/onboarding`,
 * `/open`, the auth screens, and every static asset are untouched by construction. The list is kept
 * in lockstep with {@link config}'s matcher by `apps/web/tests/auth/entry-gate.test.ts` — the
 * matcher cannot be derived from this array at runtime because Next statically analyses the
 * exported `config` at build time.
 */
const PROTECTED_SEGMENTS: readonly string[] = [
  'today',
  'inbox',
  'stream',
  'portfolio',
  'tasks',
  'calendar',
  'search',
  'settings',
  'athena',
  'exports',
  'workspaces',
  'orgs',
];

/**
 * Whether `pathname` addresses an authenticated `(app)` surface.
 *
 * @param pathname - The request pathname, always starting with `/`.
 * @returns `true` when the first path segment is one of the protected `(app)` segments.
 */
export function isProtectedPath(pathname: string): boolean {
  const segment = pathname.split('/')[1] ?? '';
  return PROTECTED_SEGMENTS.includes(segment);
}

/**
 * Whether the request carries a Better Auth session cookie *at all*.
 *
 * @remarks
 * Name-matched with `endsWith` so both the dev cookie (`better-auth.session_token`) and the
 * production `__Secure-`-prefixed variant count. This is deliberately a presence check and nothing
 * more: absence is a *certainty* that there is no session (the cookie is the only thing that could
 * carry one), which is why the redirect below is safe without a network call. Presence proves
 * nothing — the token may be expired or revoked — so a present cookie falls through to the
 * authoritative `readServerSession()` check in the `(app)` layout.
 *
 * @param request - The incoming request.
 * @returns `true` when any cookie name ends with `better-auth.session_token`.
 */
function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some((cookie) => cookie.name.endsWith('better-auth.session_token'));
}

/**
 * The absolute `/sign-in` URL to bounce an obviously-signed-out request to.
 *
 * @remarks
 * Built from the browser-facing host (`x-forwarded-host` when the dev reverse proxy supplied one)
 * rather than `request.nextUrl`, which behind that proxy carries the loopback host Next was
 * actually reached on. Redirecting to the loopback host would send the browser somewhere it cannot
 * reach, and the host-scoped session cookie would not ride the trip back.
 *
 * @param request - The incoming request.
 * @param returnPath - Where to send the user after they authenticate (`pathname` + `search`).
 * @returns The absolute sign-in URL carrying a `callbackURL`.
 */
function signInUrl(request: NextRequest, returnPath: string): URL {
  const host =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? request.nextUrl.host;
  const proto =
    request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '');
  const url = new URL(`${proto}://${host}/sign-in`);
  url.searchParams.set('callbackURL', returnPath);
  return url;
}

/**
 * Two request-time responsibilities: restore the browser-facing host for proxied API calls, and
 * gate the authenticated `(app)` surfaces.
 *
 * @remarks
 * **Host restore (`/api/auth/*`, `/v1/*`).** The dev stack puts the browser two reverse-proxy hops
 * from the Hono API:
 *
 * ```
 * browser -> portless(:443) -> Next(:webPort) -> [next.config rewrite] -> portless -> API
 * ```
 *
 * portless forwards upstream with `Host: 127.0.0.1:<port>` and the real host only in
 * `x-forwarded-host`. Next's rewrite to `API_URL` then re-derives its own outbound
 * `x-forwarded-host` from that loopback `Host` -- discarding the real host -- so the API
 * resolves its Better Auth base to the `BETTER_AUTH_URL` fallback (`api.docket.localhost`)
 * instead of the host the user is actually on (`docket.localhost`).
 *
 * For most calls that's harmless (session cookies are host-only and ride the same-origin
 * XHR). But Better Auth's `oAuthProxy` builds an absolute proxy-callback URL from the
 * request's resolved host, so a wrong host sends the OAuth round-trip -- and its session
 * cookie + post-login redirect -- to `api.docket.localhost`, breaking sign-in on the host
 * the user is browsing.
 *
 * Copying `x-forwarded-host` back onto `Host` makes Next's rewrite re-derive the correct
 * `x-forwarded-host`, so the API sees the true browser host and OAuth stays same-origin.
 * In production (single proxy hop, `Host` already correct) `x-forwarded-host` equals `Host`,
 * so this is a no-op.
 *
 * **Entry gate.** A request for an authenticated surface carrying no session cookie at all is
 * redirected to `/sign-in?callbackURL=…` here, before Next renders anything. That is the cheap,
 * certain half of protected-route enforcement and it costs no network call; the expensive,
 * authoritative half lives in the `(app)` layout, which every other case falls through to.
 *
 * Every matched protected request also carries its own path forward in `x-docket-pathname`
 * (`pathname` + `search`), because Next gives a layout no other way to learn the request path and
 * the layout needs it to build a `callbackURL` that returns the user where they were headed.
 *
 * There is deliberately **no** cookie check for `/sign-in` or `/sign-up`. Cookie presence cannot
 * distinguish a valid session from a stale one, so an optimistic redirect here paired with the
 * layout's authoritative one would bounce a stale cookie between the two forever.
 *
 * @param request - The incoming request.
 * @returns The sign-in redirect, or a `next()` carrying any rewritten request headers.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const protectedPath = isProtectedPath(pathname);

  if (protectedPath && !hasSessionCookie(request)) {
    return NextResponse.redirect(signInUrl(request, `${pathname}${search}`));
  }

  const forwardedHost = request.headers.get('x-forwarded-host');
  const restoreHost = forwardedHost !== null && forwardedHost !== request.headers.get('host');

  if (!protectedPath && !restoreHost) {
    return NextResponse.next();
  }

  const headers = new Headers(request.headers);
  if (restoreHost) headers.set('host', forwardedHost);
  if (protectedPath) headers.set('x-docket-pathname', `${pathname}${search}`);
  return NextResponse.next({ request: { headers } });
}

/**
 * The paths this middleware runs on.
 *
 * @remarks
 * `/api/auth/*` and `/v1/*` are the reverse-proxied API paths that need the host restored. The rest
 * are the `(app)` route group's top-level segments — each as both the bare path and its subtree —
 * which need the session gate. Written out as literals because Next statically analyses this export
 * at build time and cannot evaluate a derived array; the two lists are held in sync by
 * `apps/web/tests/auth/entry-gate.test.ts`.
 */
export const config = {
  matcher: [
    '/api/auth/:path*',
    '/v1/:path*',
    '/today',
    '/today/:path*',
    '/inbox',
    '/inbox/:path*',
    '/stream',
    '/stream/:path*',
    '/portfolio',
    '/portfolio/:path*',
    '/tasks',
    '/tasks/:path*',
    '/calendar',
    '/calendar/:path*',
    '/search',
    '/search/:path*',
    '/settings',
    '/settings/:path*',
    '/athena',
    '/athena/:path*',
    '/exports',
    '/exports/:path*',
    '/workspaces',
    '/workspaces/:path*',
    '/orgs',
    '/orgs/:path*',
  ],
};

/** The protected `(app)` segments, exported for the matcher-sync contract test. */
export const protectedSegments: readonly string[] = PROTECTED_SEGMENTS;
