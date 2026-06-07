import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Options for {@link docketVitest}.
 */
export interface DocketVitestOptions {
  /** Test environment. `node` for libraries/API, `jsdom` for React components. */
  environment?: 'node' | 'jsdom';
  /** Enable the React plugin (for `.tsx` component tests). */
  react?: boolean;
  /** Extra setup files (relative to the package root). */
  setupFiles?: string[];
  /**
   * Coverage threshold (% for statements/branches/functions/lines).
   *
   * Defaults to 90. The "trust spine" — packages where a silent coverage gap means
   * a security hole or data corruption, and that are pure enough for honest full
   * coverage (`@docket/authz`, `@docket/auth`, `@docket/env`, `@docket/types`,
   * `@docket/db`) — opts into `100`. Apps, UI, and IO adapters stay at the default.
   */
  coverageThreshold?: number;
  /**
   * Extra globs (relative to package root) to exclude from coverage — for IO
   * boundaries that can only be exercised by mock-wiring tests or a live service
   * (e.g. a DB-driver migration runner). We don't write mock-wiring tests to chase
   * those lines; they're verified by really running in dev/prod.
   */
  coverageExclude?: string[];
  /**
   * Globs (relative to package root) that coverage is measured over.
   *
   * Defaults to `['src/**\/*.{ts,tsx}']` — every source file, which is right for a
   * library or service where the whole package is unit-tested. A large *app* (e.g.
   * `@docket/web`) is verified primarily by typecheck/lint and by running it, not by
   * unit-testing every component; such a package narrows this to the small set of
   * pure, behavior-bearing modules that warrant their own unit test, so coverage
   * stays a meaningful gate rather than a chase over wiring/UI code.
   */
  coverageInclude?: string[];
}

/**
 * The single, standardized Vitest configuration every Docket package uses.
 *
 * Each package's `vite.config.ts` is a one-liner: `export default docketVitest({...})`.
 * Coverage is the v8 provider over `src` (excluding tests + type-declaration files),
 * with `all: true` so untested files count. The threshold defaults to 90% and the
 * trust-spine packages opt into 100% via {@link DocketVitestOptions.coverageThreshold}.
 * The bar is met with MEANINGFUL tests (real behavior), never brittle wiring/tautology
 * tests. Generous timeouts keep the heavily-parallel full-suite run reliable.
 */
export function docketVitest(options: DocketVitestOptions = {}) {
  const {
    environment = 'node',
    react: useReact = false,
    setupFiles = [],
    coverageThreshold = 90,
    coverageExclude = [],
    coverageInclude = ['src/**/*.{ts,tsx}'],
  } = options;
  return defineConfig({
    plugins: useReact ? [react()] : [],
    test: {
      globals: true,
      environment,
      setupFiles,
      include: ['tests/**/*.{test,spec}.{ts,tsx}'],
      // Turbo runs every package's vitest concurrently, so the machine is heavily
      // oversubscribed during `pnpm test`. The default 5s timeout false-fails
      // otherwise-passing tests (e.g. crypto/pglite-heavy ones) purely from CPU
      // starvation. Generous timeouts keep the full-suite run reliably green
      // without affecting the happy path.
      testTimeout: 30_000,
      hookTimeout: 30_000,
      // Coverage is gated (with all:true so untested files count). Default 90% gives
      // headroom so we don't write brittle wiring/tautology tests to chase the last
      // few lines; the trust-spine packages pass coverageThreshold:100. Either bar is
      // met with MEANINGFUL behavior tests.
      coverage: {
        provider: 'v8',
        all: true,
        reporter: ['text', 'json-summary', 'json'],
        include: coverageInclude,
        exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/**/*.d.ts', ...coverageExclude],
        thresholds: {
          statements: coverageThreshold,
          branches: coverageThreshold,
          functions: coverageThreshold,
          lines: coverageThreshold,
        },
      },
    },
  });
}
