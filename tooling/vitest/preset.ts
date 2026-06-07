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
}

/**
 * The single, standardized Vitest configuration every Docket package uses.
 *
 * Each package's `vite.config.ts` is a one-liner: `export default docketVitest({...})`.
 * Coverage is the v8 provider over `src` (excluding tests + type-declaration files),
 * with `all: true` so untested files count, and HARD 100% thresholds on statements,
 * branches, functions, and lines — no exceptions.
 */
export function docketVitest(options: DocketVitestOptions = {}) {
  const { environment = 'node', react: useReact = false, setupFiles = [] } = options;
  return defineConfig({
    plugins: useReact ? [react()] : [],
    test: {
      globals: true,
      environment,
      setupFiles,
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      coverage: {
        provider: 'v8',
        all: true,
        reporter: ['text', 'json-summary', 'json'],
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/**/*.d.ts'],
        thresholds: {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  });
}
