import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

/** Execute Runner tests inside the Cloudflare Workers runtime. */
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/index.ts',
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      // Istanbul, not the repo-default v8 provider: these suites execute inside workerd via
      // @cloudflare/vitest-pool-workers, and workerd exposes no V8 inspector, so the v8 provider
      // aborts with ERR_METHOD_NOT_IMPLEMENTED before a single test runs. Istanbul instruments at
      // transform time instead, which workerd runs like any other code.
      provider: 'istanbul',
      reporter: ['text', 'json-summary', 'json'],
      include: ['src/**/*.ts'],
      // A ratchet on this package's real measured coverage, not the repo-wide 90% aspiration —
      // these suites had never executed in CI at all (no `test:coverage` script existed, and CI's
      // only test job runs that task), so this is the first number the package has ever had. It
      // locks in "never worse" today. Raise each line as the uncovered paths gain tests; never
      // lower one for an individual change. The known gap is `workflow.ts`'s durable-execution
      // retry/failure branches (32% of its branches), which warrant tests of their own.
      thresholds: { statements: 82, branches: 71, functions: 82, lines: 83 },
    },
  },
});
