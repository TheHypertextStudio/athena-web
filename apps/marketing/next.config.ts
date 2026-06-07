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
};

export default nextConfig;
