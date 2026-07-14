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
  /** Custom environment variables assigned by Vitest before running tests. */
  env?: Partial<NodeJS.ProcessEnv>;
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
  /** Per-test timeout in milliseconds. */
  testTimeout?: number;
  /** Per-hook timeout in milliseconds. */
  hookTimeout?: number;
  /** Whether separate test files may run concurrently. Defaults to Vitest's parallel behavior. */
  fileParallelism?: boolean;
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
    env = {},
    coverageThreshold = 90,
    coverageExclude = [],
    coverageInclude = ['src/**/*.{ts,tsx}'],
    testTimeout = 30_000,
    hookTimeout = 180_000,
    fileParallelism = true,
  } = options;
  return defineConfig({
    plugins: useReact ? [react()] : [],
    test: {
      globals: true,
      environment,
      setupFiles,
      env,
      unstubEnvs: true,
      // Keep Vitest file parallelism, but avoid fork-worker startup starvation when
      // Turbo is already running package tests concurrently.
      pool: 'threads',
      fileParallelism,
      include: ['tests/**/*.{test,spec}.{ts,tsx}'],
      // Turbo runs every package's vitest concurrently, so the machine is heavily
      // oversubscribed during `pnpm test`. PGlite/route bootstrap hooks can spend
      // real time waiting behind CPU-bound file workers, while per-test timeouts
      // stay tighter so assertion-level hangs still surface quickly.
      testTimeout,
      hookTimeout,
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
