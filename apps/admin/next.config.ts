import type { NextConfig } from 'next';

/** The API origin the browser is rewritten to (same-origin so Better Auth cookies flow). */
const API_ORIGIN = process.env['API_URL'];
if (!API_ORIGIN) {
  throw new Error(
    'API_URL is required (the origin the admin app proxies /v1 + /api/auth to) — see .env.example.',
  );
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
  transpilePackages: ['@docket/ui', '@docket/types', '@docket/env'],
  async rewrites() {
    return [
      { source: '/v1/:path*', destination: `${API_ORIGIN}/v1/:path*` },
      { source: '/api/auth/:path*', destination: `${API_ORIGIN}/api/auth/:path*` },
    ];
  },
};

export default nextConfig;
