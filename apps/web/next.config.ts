import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@athena/shared', '@athena/types'],
};

export default nextConfig;
