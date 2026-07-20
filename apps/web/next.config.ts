import path from 'path';
import type { NextConfig } from 'next';

import { validatedApiOrigin } from './src/lib/proxy-origin';

/** The API origin the browser is rewritten to (same-origin so Better Auth cookies flow). */
const apiUrl = process.env['API_URL'];
if (!apiUrl) {
  throw new Error(
    'API_URL is required (the origin the web app proxies /v1 + /api/auth to) — see .env.example.',
  );
}
const API_ORIGIN = validatedApiOrigin(apiUrl, process.env['NEXT_PUBLIC_APP_URL']);

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
 */
const securityHeaders = [
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

/**
 * Next.js config for the Docket product app.
 *
 * @remarks
 * Workspace packages (`@docket/ui`, `@docket/types`, `@docket/env`, `@docket/notifications`) ship
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
  transpilePackages: ['@docket/ui', '@docket/types', '@docket/env', '@docket/notifications'],
  // Portless serves dev over https://web.docket.localhost; allow its HMR/devtools resources
  // so hot-reload works (Next 16 blocks cross-origin dev resources by default).
  allowedDevOrigins: ['web.docket.localhost', '*.docket.localhost', ...authAllowedDevOrigins()],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async redirects() {
    return [
      {
        source: '/orgs/:orgId/settings/connections',
        destination: '/settings/connections',
        permanent: false,
      },
      {
        source: '/orgs/:orgId/settings/connections/google-calendar',
        destination: '/settings/connections/google-calendar',
        permanent: false,
      },
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
    ];
  },
};

export default nextConfig;
