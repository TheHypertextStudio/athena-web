import { docketVitest } from '../../tooling/vitest/preset';

// dispatch/* talks to `@docket/db`, so tests need a DATABASE_URL before that module is ever
// touched — an embedded, ephemeral PGlite instance (bootstrapped per test file from the real
// generated migration SQL; see tests/support/db.ts).
export default docketVitest({
  env: {
    DATABASE_URL: 'pglite://memory',
  },
});
