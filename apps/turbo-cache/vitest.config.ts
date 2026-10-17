import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';
import { cacheConfig } from './src/config';

/** Run protocol, cryptographic authentication and R2 tests inside workerd. */
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/index.ts',
      // The existing shared test pool bundles a July workerd; production uses the current date.
      miniflare: {
        compatibilityDate: '2026-07-16',
        compatibilityFlags: ['nodejs_compat'],
        bindings: cacheConfig.bindings,
        r2Buckets: ['R2_STORE'],
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'istanbul',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      thresholds: { statements: 80, branches: 80, functions: 80, lines: 80 },
    },
  },
});
