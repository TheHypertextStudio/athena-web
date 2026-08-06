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
 * Coverage is scoped to the modules that decide behaviour: the routing table, the document cache,
 * and the push handler. `sw.ts` is the worker's event wiring, `strategies.ts` is largely fetch
 * plumbing around those decisions, and `bin/build.ts` and `precache-manifest.ts` are IO wrappers
 * proven by the artifact they emit rather than by mocking a filesystem. Measuring those would
 * report on how much of the wiring a mock happened to touch, not on whether the rules are right.
 *
 * That is the same rule `apps/web` applies, and it is why these numbers appear now: the specs
 * moved out of a package that scoped them out entirely, into one where the default is everything.
 */
export default docketVitest({
  environment: 'jsdom',
  coverageInclude: [
    'src/worker/routing.ts',
    'src/worker/documents.ts',
    'src/worker/elicitation-push.ts',
  ],
});
