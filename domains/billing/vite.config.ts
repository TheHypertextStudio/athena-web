import { docketVitest } from '../../tooling/vitest/preset';

/**
 * Billing keeps the repository's shared deterministic Vitest policy.
 *
 * @remarks
 * The application tests drive the real lifecycle SQL against an embedded PGlite database, so
 * `DATABASE_URL` selects the in-process driver here. `SKIP_ENV_VALIDATION` keeps importing
 * `@docket/db` from pulling the production env contract into a unit test.
 */
export default docketVitest({
  env: { DATABASE_URL: 'pglite://memory://', SKIP_ENV_VALIDATION: '1' },
});
