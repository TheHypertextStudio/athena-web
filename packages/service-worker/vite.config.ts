import { docketVitest } from '../../tooling/vitest/preset';

/**
 * The worker's own suite.
 *
 * @remarks
 * `jsdom`, even though a service worker never has a `document`: the specs construct `Request` and
 * `Response` objects and stub `caches`, and jsdom is what the rest of the repo already uses to get
 * a browser-shaped global. The worker's *types* are kept honest separately by
 * `src/worker/tsconfig.json`, which compiles against `WebWorker` and not `DOM`.
 *
 * Coverage is measured over `src/worker` alone. `bin/build.ts` is an esbuild invocation and
 * `precache-manifest.ts` walks a build directory; both are IO wrappers whose behaviour is proven
 * by the artifact they produce, not by mocking a filesystem.
 */
export default docketVitest({
  environment: 'jsdom',
  coverageInclude: ['src/worker/**/*.ts'],
});
