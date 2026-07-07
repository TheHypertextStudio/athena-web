import { docketVitest } from '../../tooling/vitest/preset';

export default docketVitest({
  // API route suites repeatedly migrate/import PGlite fixtures. Running those
  // setup hooks with the default worker count can starve workers and false-fail
  // the full gate before beforeAll() completes.
  maxWorkers: 2,
  testTimeout: 240_000,
  hookTimeout: 240_000,
});
