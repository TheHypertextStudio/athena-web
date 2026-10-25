import { docketVitest } from '../../tooling/vitest/preset';

/**
 * Proofs against a dedicated, already-populated PostgreSQL database named by
 * `DOCKET_SCHEDULE_POSTGRES_DATABASE`. These never run in the shared Postgres acceptance job,
 * which provisions a fresh database.
 */
export default docketVitest({
  include: ['tests/**/*.owned-postgres.acceptance.ts'],
  fileParallelism: false,
  maxWorkers: 1,
  testTimeout: 180_000,
  hookTimeout: 180_000,
});
