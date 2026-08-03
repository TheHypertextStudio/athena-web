/**
 * `@docket/ui` — Vitest setup.
 *
 * @remarks
 * Registers the `@testing-library/jest-dom` matchers (e.g. `toBeInTheDocument`,
 * `toHaveClass`) on Vitest's `expect` for every component test, polyfills
 * `window.matchMedia` (which jsdom does not implement) so components reading responsive
 * state via `useMediaQuery` render their narrow-viewport branch in tests, and polyfills
 * `window.localStorage` for the same reason `matchMedia` needs one — see the remarks below.
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

/**
 * A minimal in-memory `Storage` implementation, stubbed in for `window.localStorage`.
 *
 * @remarks
 * As of jsdom 29 (bundled here), `window.localStorage` delegates to Node's own built-in
 * `node:internal` web storage implementation when it's present — which is gated behind Node's
 * `--localstorage-file` flag (an *experimental* feature as of Node 22+). Without that flag,
 * `window.localStorage` itself is `undefined` — not a jsdom bug exactly, but a real environment
 * dependency this suite should not have. Stubbing our own, like the `matchMedia` polyfill above,
 * makes every test deterministic regardless of which Node version or CLI flags run it, rather
 * than relying on process-level configuration nobody would think to look for here.
 */
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
}

vi.stubGlobal('localStorage', createMemoryStorage());
vi.stubGlobal('sessionStorage', createMemoryStorage());
