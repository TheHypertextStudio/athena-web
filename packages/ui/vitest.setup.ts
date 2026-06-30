/**
 * `@docket/ui` — Vitest setup.
 *
 * @remarks
 * Registers the `@testing-library/jest-dom` matchers (e.g. `toBeInTheDocument`,
 * `toHaveClass`) on Vitest's `expect` for every component test, and polyfills
 * `window.matchMedia` (which jsdom does not implement) so components reading responsive
 * state via `useMediaQuery` render their narrow-viewport branch in tests.
 */
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// jsdom does not implement `matchMedia`; stub a minimal, non-matching implementation so components
// reading responsive state via `useMediaQuery` render their narrow-viewport branch under test.
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(() => false),
}));
