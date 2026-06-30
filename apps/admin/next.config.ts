import path from 'path';
import type { NextConfig } from 'next';

/** The API origin the browser is rewritten to (same-origin so Better Auth cookies flow). */
const API_ORIGIN = process.env['API_URL'];
if (!API_ORIGIN) {
  throw new Error(
    'API_URL is required (the origin the admin app proxies /v1 + /api/auth to) — see .env.example.',
  );
}

/**
 * Extra allowed dev origins taken from the auth allowlist (e.g. a cloudflared tunnel host).
 *
 * @remarks
 * `BETTER_AUTH_ALLOWED_HOSTS` is the single source of truth for hosts the app answers on, so a
 * tunnel host added there also clears Next 16's cross-origin dev-resource block — no extra env
 * var. The `*.docket.localhost` wildcard already covers the portless hosts.
 */
function authAllowedDevOrigins(): string[] {
  return (process.env['BETTER_AUTH_ALLOWED_HOSTS'] ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter((host) => host.length > 0 && !host.endsWith('docket.localhost'));
}

/**
 * Next.js config for the Docket service-admin console.
 *
 * @remarks
 * Workspace packages (`@docket/ui`, `@docket/types`, `@docket/env`) ship raw TypeScript and
 * are transpiled by Next via `transpilePackages`. `@docket/api` is consumed type-only (for
 * the `AppType` RPC contract) so it needs no transpilation.
 *
 * The {@link NextConfig.rewrites | rewrites} make the browser same-origin with the Hono
 * API: `/v1/*` (the typed RPC routers, including `/v1/admin/*`) and `/api/auth/*` (Better
 * Auth) proxy to `API_URL`. Keeping these same-origin is what lets the staff session cookie
 * set by Better Auth be sent on every `hc<AppType>` request; the admin API 403s when the
 * signed-in user is not a staff member.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  transpilePackages: ['@docket/ui', '@docket/types', '@docket/env'],
  // Portless serves dev over https://admin.docket.localhost; allow its HMR/devtools
  // resources so hot-reload works (Next 16 blocks cross-origin dev resources by default).
  allowedDevOrigins: ['admin.docket.localhost', '*.docket.localhost', ...authAllowedDevOrigins()],
  async rewrites() {
    return [
      { source: '/v1/:path*', destination: `${API_ORIGIN}/v1/:path*` },
      { source: '/api/auth/:path*', destination: `${API_ORIGIN}/api/auth/:path*` },
    ];
  },
};

export default nextConfig;
