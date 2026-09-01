import path from 'path';
import type { NextConfig } from 'next';

import { docsSiteOrigin } from './src/lib/docs-site';
import { validatedApiOrigin } from './src/lib/proxy-origin';
import { assertPublishingHostConfigured } from './src/lib/require-publishing-host';

/** The API origin the browser is rewritten to (same-origin so Better Auth cookies flow). */
const apiUrl = process.env['API_URL'];
if (!apiUrl) {
  throw new Error(
    'API_URL is required (the origin the web app proxies /v1 + /api/auth to) — see .env.example.',
  );
}
const API_ORIGIN = validatedApiOrigin(apiUrl, process.env['NEXT_PUBLIC_APP_URL']);

assertPublishingHostConfigured(process.env['VERCEL_ENV'], process.env['NEXT_PUBLIC_BRIEF_HOST']);

/**
 * Retired product-domain alias that must never become a second browser origin.
 *
 * @remarks
 * Better Auth uses its API URL for a host outside `BETTER_AUTH_ALLOWED_HOSTS`. Leaving this alias
 * live would therefore produce an API-host OAuth callback instead of Docket's registered browser
 * callback. The dots are escaped because Next treats `has.value` as a regex-like matcher.
 */
const LEGACY_ATHENA_HOST = 'athena\\.hypertext\\.studio';

/**
 * The rewrites that put the public documentation site (`apps/docs`) under `/docs` on this origin.
 *
 * @remarks
 * Five sources, not two: `/_mintlify/*` and `/mintlify-assets/*` carry the client bundle, fonts,
 * and search index, and `/api/request` is the telemetry endpoint the in-page search calls. Omit
 * those three and the page looks correct with no working search.
 *
 * Unconfigured until the subpath is enabled on the Mintlify side ("Host at"); the rewrites are then
 * omitted and `/docs` 404s, which is also what makes the marketing nav drop the link.
 */
function docsRewrites(): { source: string; destination: string }[] {
  const origin = docsSiteOrigin();
  if (origin === undefined) return [];
  return [
    { source: '/docs', destination: `${origin}/docs` },
    { source: '/docs/:path*', destination: `${origin}/docs/:path*` },
    { source: '/_mintlify/:path*', destination: `${origin}/_mintlify/:path*` },
    { source: '/mintlify-assets/:path+', destination: `${origin}/mintlify-assets/:path+` },
    { source: '/api/request', destination: `${origin}/_mintlify/api/request` },
  ];
}

/**
 * Extra allowed dev origins taken from the auth allowlist.
 *
 * @remarks
 * `BETTER_AUTH_ALLOWED_HOSTS` is the single source of truth for hosts the app answers on, including
 * a dev tunnel host (e.g. a cloudflared `dev.<domain>`). Mirroring it here means adding a tunnel
 * host in ONE place also stops Next 16 from blocking that origin's HMR/devtools resources — no
 * separate env var. The `*.docket.localhost` wildcard below already covers the portless hosts, so
 * those are dropped to avoid noise.
 */
function authAllowedDevOrigins(): string[] {
  return (process.env['BETTER_AUTH_ALLOWED_HOSTS'] ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter((host) => host.length > 0 && !host.endsWith('docket.localhost'));
}

/**
 * Baseline security response headers applied to every route.
 *
 * @remarks
 * `Content-Security-Policy: frame-ancestors 'none'` (plus the legacy `X-Frame-Options: DENY`) is the
 * anti-clickjacking control — it stops the OAuth consent page (`/oauth/authorize`) and every other
 * surface from being framed, closing the UI-redress attack. Only the framing directive is set here;
 * a full content CSP (`script-src`/`style-src`) is a deliberate follow-up (Next's inline styles
 * need a nonce pipeline first) and would be introduced in report-only mode. HSTS is honored only
 * over HTTPS (ignored on localhost). `publickey-credentials-*` are intentionally NOT restricted so
 * passkeys keep working.
 *
 * `microphone=(self)` — not `()` — because Athena's voice mode calls `getUserMedia` from this
 * origin. `()` blocks it outright, which the browser reports only as a permissions-policy
 * violation in the console while the UI shows a permission denial the person cannot fix from
 * their own browser settings. `self` still forbids every embedded third-party frame from asking.
 * The camera and geolocation stay fully denied: nothing in Docket uses either.
 *
 * Every one of these replaces the upstream header on the `/docs` paths proxied to Mintlify, which
 * is fine for all five — Docket's values are at least as strict, and `X-Frame-Options: DENY` is
 * wanted there. The CSP is the exception and is split into {@link cspHeader}; see it for why.
 */
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
];

/**
 * The app's own CSP, applied everywhere except the documentation subpath.
 *
 * @remarks
 * `frame-ancestors 'none'` (plus the legacy `X-Frame-Options: DENY` above) is the anti-clickjacking
 * control — it stops the OAuth consent page (`/oauth/authorize`) and every other surface from being
 * framed, closing the UI-redress attack. Only the framing directive is set; a full content CSP
 * (`script-src`/`style-src`) is a deliberate follow-up (Next's inline styles need a nonce pipeline
 * first) and would be introduced in report-only mode.
 *
 * `/docs` is excluded because a same-named header replaces the upstream one, and applying this CSP
 * there would discard Mintlify's much stricter policy — one covering services this repo cannot
 * track (CloudFront, `mintcdn.com`, `leaves.mintlify.com`, hCaptcha's `unsafe-eval`), where a
 * hand-copied allowlist would go stale into a silently broken search box. `X-Frame-Options: DENY`
 * still covers those paths via {@link securityHeaders}.
 * See https://www.mintlify.com/docs/deploy/csp-configuration.
 *
 * The lookahead is anchored so `/documentation` keeps the CSP;
 * `tests/config/security-headers.test.ts` compiles this `source` and asserts both directions.
 */
const cspHeader = [{ key: 'Content-Security-Policy', value: "frame-ancestors 'none'" }];

/** Every route except the documentation subpath, as a header `source` pattern. */
const NON_DOCS_ROUTES = '/:path((?!docs$|docs/).*)';

/**
 * Next.js config for the Docket product app.
 *
 * @remarks
 * Workspace packages (`@docket/ui`, `domain packages`, `@docket/env`, `@docket/notifications`) ship
 * raw TypeScript and are transpiled by Next via `transpilePackages`.
 *
 * The {@link NextConfig.rewrites | rewrites} make the browser same-origin with the
 * Hono API: `/v1/*` (the typed RPC routers) and `/api/auth/*` (Better Auth) proxy to
 * `API_URL`. Keeping these same-origin is what lets the session cookie set by Better Auth
 * be sent on every `hc<AppType>` request.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev-mode route indicator (bottom-left) is dev-only chrome that never ships to
  // production, but it overlaps real page content in narrow-viewport design-review captures
  // taken against `next dev` and reads as a product bug until you check the build mode.
  devIndicators: false,
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  transpilePackages: ['@docket/ui', 'domain packages', '@docket/env', '@docket/notifications'],
  // Portless serves dev over https://web.docket.localhost; allow its HMR/devtools resources
  // so hot-reload works (Next 16 blocks cross-origin dev resources by default).
  allowedDevOrigins: ['web.docket.localhost', '*.docket.localhost', ...authAllowedDevOrigins()],
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      { source: NON_DOCS_ROUTES, headers: cspHeader },
      {
        // The worker script itself must never be served stale, or a deployed update can sit
        // unnoticed behind a cached copy for as long as the browser's heuristic freshness lasts —
        // and the update prompt only fires when the browser actually re-fetches these bytes and
        // finds them different. The assets the worker caches are content-hashed and unaffected.
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' }],
      },
    ];
  },
  async redirects() {
    return [
      // Redirects run before rewrites, so this prevents the legacy alias from reaching the
      // `/api/auth/*` proxy and lets Docket choose the canonical GitHub callback origin instead.
      {
        source: '/:path*',
        has: [{ type: 'host', value: LEGACY_ATHENA_HOST }],
        destination: 'https://docket.hypertext.studio/:path*',
        permanent: true,
      },
      // NOTE: `connections` and its `google-calendar` child are deliberately NOT redirected here,
      // unlike every other entry below. Those redirects predate the org-scoped Connections page
      // being real: `ConnectionsPanel` renders a "This workspace" section stating outright that a
      // workspace's connections are shared and admin-managed, and the whole Notion mirror feature
      // (designed databases, identity matching) is `organization_id`-scoped data. Redirecting them
      // here silently discarded `:orgId` and dropped a team member into the CALLER's personal
      // workspace's connections instead of their team's — for every link anywhere in the app that
      // points at `/orgs/:orgId/settings/connections*`, not merely the Settings sidebar. Every
      // other section redirected below is genuinely caller/user-identity-scoped (see e.g.
      // `connected-accounts/page.tsx`'s own doc comment: "the OAuth grant belongs to the user, not
      // an org") and those redirects are intentional, not the same bug.
      {
        source: '/orgs/:orgId/settings/connected-accounts',
        destination: '/settings/connections',
        permanent: false,
      },
      {
        source: '/orgs/:orgId/settings/notifications',
        destination: '/settings/notifications',
        permanent: false,
      },
      {
        source: '/orgs/:orgId/settings/calendar',
        destination: '/settings/calendar',
        permanent: false,
      },
      {
        source: '/orgs/:orgId/settings/security',
        destination: '/settings/security',
        permanent: false,
      },
      {
        source: '/orgs/:orgId/settings/connected-apps',
        destination: '/settings/connected-apps',
        permanent: false,
      },
      {
        source: '/orgs/:orgId/settings/export',
        destination: '/settings/data-privacy',
        permanent: false,
      },
      {
        source: '/orgs/:orgId/settings/danger',
        destination: '/settings/data-privacy',
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [
      { source: '/v1/:path*', destination: `${API_ORIGIN}/v1/:path*` },
      { source: '/api/auth/:path*', destination: `${API_ORIGIN}/api/auth/:path*` },
      {
        source: '/internal/integrations/github/:path*',
        destination: `${API_ORIGIN}/internal/integrations/github/:path*`,
      },
      ...docsRewrites(),
    ];
  },
};

export default nextConfig;
