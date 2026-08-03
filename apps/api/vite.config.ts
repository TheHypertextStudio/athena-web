import { docketVitest } from '../../tooling/vitest/preset';
import { API_TEST_ENV } from './tests/support/env';

// This package's 280+ test files run under CI's coverage-instrumented, oversubscribed runner,
// where individual tests have repeatedly lost the race against the preset's 30s default (most
// recently calendar-sync-engine's full-sync test, which finishes in under a second locally).
// Other packages have hit the identical pattern with a *different* test each time depending on
// what CI's runner happened to be busy with. Raising this package's own budget once addresses
// the actual cause — the runner, not any one test — instead of chasing whichever is unlucky.
export default docketVitest({ env: API_TEST_ENV, testTimeout: 60_000 });
