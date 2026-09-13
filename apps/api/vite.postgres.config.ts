import { docketVitest } from '../../tooling/vitest/preset';
import { API_TEST_ENV } from './tests/support/env';

export default docketVitest({
  env: {
    ...API_TEST_ENV,
    DATABASE_URL: process.env['DATABASE_URL'] ?? API_TEST_ENV.DATABASE_URL,
    DATABASE_URL_UNPOOLED:
      process.env['DATABASE_URL_UNPOOLED'] ??
      process.env['DATABASE_URL'] ??
      API_TEST_ENV.DATABASE_URL,
  },
  include: ['tests/**/*.postgres.acceptance.ts'],
  fileParallelism: false,
  maxWorkers: 1,
  pool: 'forks',
  testTimeout: 180_000,
  hookTimeout: 180_000,
});
