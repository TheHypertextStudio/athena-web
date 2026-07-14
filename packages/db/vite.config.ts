import { docketVitest } from '../../tooling/vitest/preset';

// db straddles pure schema/logic and DB-driver IO. The pure parts are covered at the
// 90% default; migrate.ts is the offline migration runner (an IO boundary) — its pglite
// path is smoke-tested and its postgres/neon path runs for real in deploy, so it is
// excluded from the metric rather than covered with a mock-wiring test.
export default docketVitest({
  coverageThreshold: 90,
  coverageExclude: ['src/migrate.ts'],
  // Five files replay the full PGlite migration chain. Serializing files avoids WASM/CPU
  // starvation when Turbo is already running every package suite concurrently.
  fileParallelism: false,
});
