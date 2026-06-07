import type { NextConfig } from 'next';

/**
 * Next.js config for the Docket marketing/landing site.
 *
 * @remarks
 * Consumes only the `@docket/ui` token layer; JIT workspace packages are
 * transpiled by Next per the compilation policy in build-sequence §0.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@docket/ui', '@docket/env'],
  // Portless serves dev over https://marketing.docket.localhost; allow its HMR/devtools
  // resources so hot-reload works (Next 16 blocks cross-origin dev resources by default).
  allowedDevOrigins: ['marketing.docket.localhost', '*.docket.localhost'],
};

export default nextConfig;
