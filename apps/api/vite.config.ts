import { docketVitest } from '../../tooling/vitest/preset';
import { API_TEST_ENV } from './tests/support/env';

// This package's 280+ test files run under CI's coverage-instrumented, oversubscribed runner,
// where individual tests have repeatedly lost the race against the preset's 30s default (most
// recently calendar-sync-engine's full-sync test, which finishes in under a second locally).
// Other packages have hit the identical pattern with a *different* test each time depending on
// what CI's runner happened to be busy with. Raising this package's own budget once addresses
// the actual cause — the runner, not any one test — instead of chasing whichever is unlucky.
// A ratchet on this package's real branch coverage, not the preset's 90% aspiration. Billing and
// task expansion nearly doubled the measured branch count before their coverage repair landed.
// The recovered tests establish an 88.30% (18084/20478) baseline. Raise this line as the remaining
// discount and command branches gain coverage, and never lower it for an individual feature.
// `forks`, not the preset's `threads`: every suite here boots PGlite, which is WASM, and V8 keeps
// one JIT page registry per process. Tearing several PGlite instances down on sibling threads
// trips its `jit_page_->allocations_.erase(addr) == 1` check and aborts the run with SIGILL
// *after* the last test passes — which is what has been failing CI's `Test (api)` job while every
// assertion in it succeeded. One process per worker gives each instance its own registry.
export default docketVitest({
  env: API_TEST_ENV,
  // 120s, not 60s: under an oversubscribed runner five files in this package have timed out at
  // 60s — `route-auth.test.ts` in its `beforeAll` (now inheriting the preset's 180s hook budget)
  // and four more in `it()` bodies, which land here. A timed-out file contributes no coverage, so
  // the failure surfaces as a branch-coverage regression against the 88% threshold rather than as
  // the timeout it is, which is a far more expensive thing to diagnose. The cause is the runner,
  // not any one test, so the budget is raised once for the package.
  testTimeout: 120_000,
  coverageThreshold: 88,
  pool: 'forks',
});
