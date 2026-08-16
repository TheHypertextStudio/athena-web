import { docketVitest } from './tooling/vitest/preset';

/**
 * Root Vitest config, the entry point for `pnpm test:tooling`. Tests run per-package via turbo
 * (`pnpm test` / `pnpm test:coverage`), each using the shared {@link docketVitest} preset with its
 * default include; see {@link DocketVitestOptions.include} for why this one overrides it.
 */
export default docketVitest({ include: ['repo-tests/**/*.{test,spec}.{ts,tsx}'] });
