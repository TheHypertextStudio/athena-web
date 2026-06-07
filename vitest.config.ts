import { docketVitest } from './tooling/vitest/preset';

/**
 * Root Vitest config. Tests run per-package via turbo (`pnpm test` / `pnpm test:coverage`),
 * each package using the shared {@link docketVitest} preset; this root config exists only
 * for ad-hoc root-level `vitest` invocations and delegates to the same preset.
 */
export default docketVitest();
